"""Background Automation Task Runner and State Registry."""

import asyncio
import contextvars
import logging
import sys
import traceback
import uuid
from datetime import datetime
from typing import Any, Callable, Coroutine, Dict, Optional

# Enable Windows Proactor loop on import for subprocess support
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

from app.helpers.ff.sharepoint_sync_service import SharePointSyncService
from app.helpers.logging.audit_log_service import AuditLogService
from config.database import async_session

logger = logging.getLogger(__name__)

# Context variable for the active job ID
current_job_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("current_job_id", default=None)

# In-memory registry for tracking background job states
JOB_REGISTRY: Dict[str, Dict[str, Any]] = {}


def update_job_progress(message: str, job_id: Optional[str] = None) -> None:
    """Update progress message of active or specified job."""
    try:
        jid = job_id or current_job_id_var.get()
        if not jid:
            return
        job = JOB_REGISTRY.get(jid)
        if job:
            job["result"] = message
    except Exception as e:
        logger.warning(f"Failed to update job progress: {e}")


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve job details by ID."""
    try:
        return JOB_REGISTRY.get(job_id)
    except Exception as e:
        logger.error(f"Failed to get job {job_id}: {e}")
        return None


def list_jobs() -> Dict[str, Dict[str, Any]]:
    """Retrieve all tracked jobs."""
    try:
        return JOB_REGISTRY
    except Exception as e:
        logger.error(f"Failed to list jobs: {e}")
        return {}


def get_active_job_count() -> int:
    """Return count of currently running background jobs."""
    try:
        return sum(1 for j in JOB_REGISTRY.values() if j.get("status") == "running")
    except Exception as e:
        logger.error(f"Failed to count active jobs: {e}")
        return 0


def _run_in_worker_proactor(func_or_coro: Any, jid: str) -> Any:
    """Run async task in worker thread with Proactor loop for Playwright on Windows."""
    try:
        current_job_id_var.set(jid)
        if sys.platform == "win32":
            loop = asyncio.WindowsProactorEventLoopPolicy().new_event_loop()
        else:
            loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            if asyncio.iscoroutine(func_or_coro):
                coro = func_or_coro
            elif callable(func_or_coro):
                coro = func_or_coro()
            else:
                raise TypeError(f"Expected callable or coroutine, got {type(func_or_coro)}")
            return loop.run_until_complete(coro)
        finally:
            try:
                loop.close()
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Worker proactor execution failed: {e}")
        raise


async def _execute_job_wrapper(job_id: str, coroutine_func: Callable[[], Coroutine[Any, Any, Any]]):
    """Execute background automation task and record execution telemetry."""
    try:
        job = JOB_REGISTRY.get(job_id)
        if not job:
            return

        current_job_id_var.set(job_id)
        job["status"] = "running"
        if not job.get("result") or job.get("result") == "Job queued in background...":
            job["result"] = "Starting execution..."
        start_time = datetime.now()
        job["started_at"] = start_time.isoformat()

        try:
            # Use isolated thread Proactor on Windows to avoid NotImplementedError in Playwright
            if sys.platform == "win32":
                result = await asyncio.to_thread(_run_in_worker_proactor, coroutine_func, job_id)
            else:
                result = await coroutine_func()

            result_str = str(result) if result is not None else ""
            if result_str and any(w in result_str.lower() for w in ["error", "fatal", "failed", "exception", "timed out", "did not complete"]):
                job["status"] = "failed"
                job["error"] = result_str
                job["result"] = None
            else:
                job["status"] = "completed"
                job["result"] = result_str if result_str else "Execution completed successfully."

            # Verify database ingestion if NDC report was downloaded
            if job.get("pipeline") == "ndc_report_download":
                try:
                    async with async_session() as session:
                        sync_service = SharePointSyncService()
                        await sync_service.check_and_ingest_new_files(session)
                except Exception as ing_exc:
                    logger.warning(f"Post-download auto-ingest check error: {ing_exc}")

            # Record success in audit logs
            try:
                await AuditLogService.log_event(
                    category="AUTOMATION",
                    action_type=job.get("pipeline", "AUTOMATION_PIPELINE"),
                    status="SUCCESS",
                    details=job.get("result"),
                    duration_seconds=round((datetime.now() - start_time).total_seconds(), 2),
                )
            except Exception as log_err:
                logger.error(f"Failed to record success audit log: {log_err}")

        except Exception as exc:
            job["status"] = "failed"
            exc_type = type(exc).__name__
            exc_msg = str(exc).strip()
            job["error"] = f"{exc_type}: {exc_msg}" if exc_msg else exc_type
            job["traceback"] = traceback.format_exc()
            logger.error(f"Automation '{job.get('pipeline')}' failed: {job['error']}")

            # Record failure in audit logs and send email alert
            try:
                await AuditLogService.log_event(
                    category="AUTOMATION",
                    action_type=job.get("pipeline", "AUTOMATION_PIPELINE"),
                    status="FAILED",
                    error_message=job.get("error"),
                    details=job.get("traceback"),
                    duration_seconds=round((datetime.now() - start_time).total_seconds(), 2),
                )
                await AuditLogService.notify_sync_failure(
                    module_name=f"Automation Pipeline: {job.get('pipeline')}",
                    error_reason=job.get("error", "Unknown automation failure"),
                    action_required="Check SSO password and system availability in Admin Settings.",
                    details=job.get("traceback"),
                )
            except Exception as log_err:
                logger.error(f"Failed to record failure audit log: {log_err}")
        finally:
            end_time = datetime.now()
            job["completed_at"] = end_time.isoformat()
            job["duration_seconds"] = round((end_time - start_time).total_seconds(), 2)

    except Exception as top_err:
        logger.error(f"Fatal error in job execution wrapper: {top_err}", exc_info=True)


def submit_automation_job(pipeline_name: str, coroutine_func: Callable[[], Coroutine[Any, Any, Any]]) -> Dict[str, Any]:
    """Submit an async automation task to run in the background."""
    try:
        job_id = str(uuid.uuid4())
        now_str = datetime.now().isoformat()

        job_record = {
            "job_id": job_id,
            "pipeline": pipeline_name,
            "status": "queued",
            "created_at": now_str,
            "started_at": None,
            "completed_at": None,
            "duration_seconds": None,
            "result": "Job queued in background...",
            "error": None,
            "traceback": None,
        }
        JOB_REGISTRY[job_id] = job_record

        asyncio.create_task(_execute_job_wrapper(job_id, coroutine_func))

        return {
            "job_id": job_id,
            "pipeline": pipeline_name,
            "status": "queued",
            "message": f"Pipeline '{pipeline_name}' started successfully in background.",
            "created_at": now_str,
        }
    except Exception as exc:
        logger.error(f"Failed to submit automation job '{pipeline_name}': {exc}")
        raise RuntimeError(f"Failed to submit job '{pipeline_name}': {exc}") from exc
