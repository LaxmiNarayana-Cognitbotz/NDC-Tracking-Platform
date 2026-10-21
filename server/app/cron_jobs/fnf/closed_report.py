import asyncio
import datetime
import logging

from fastapi import HTTPException

from app.helpers.config.system_config_service import SystemConfigService
from app.helpers.ff.sharepoint_sync_service import SharePointSyncService
from config.database import async_session

logger = logging.getLogger(__name__)

async def fnf_closed_report_loop():
    """
    Background polling loop that generates a FNF-Closed Excel report and uploads
    it to SharePoint at the configured daily times.
    """
    try:
        enabled_str = await SystemConfigService.get_from_db("sharepoint_sync_background_poll", default="true")
        enabled = enabled_str.strip().lower() in ("true", "1", "yes", "on", "t")
        if not enabled:
            logger.info("FNF Closed Report scheduler is disabled (sharepoint_sync_background_poll=false).")
            return

        sync_service = SharePointSyncService()
        last_trigger_key = None

        while True:
            try:
                times_str = await SystemConfigService.get_from_db("sharepoint_sync_schedule_times", default="")
                scheduled_times = {t.strip() for t in times_str.split(",") if t.strip()}

                now = datetime.datetime.now()
                time_str = now.strftime("%H:%M")
                date_str = now.strftime("%Y-%m-%d")
                current_trigger_key = f"{date_str}_{time_str}"

                if time_str in scheduled_times and current_trigger_key != last_trigger_key:
                    logger.info(
                        f"FNF Closed Report Scheduler: Time {time_str} reached. Generating & uploading report..."
                    )
                    last_trigger_key = current_trigger_key

                    async with async_session() as db:
                        result = await sync_service.generate_and_upload_fnf_closed_report(db)

                    if result["status"] == "success":
                        logger.info(
                            f"FNF Closed Report Scheduler: Report '{result['uploaded_file_name']}' uploaded "
                            f"with {result['records_exported']} record(s)."
                        )
                    else:
                        logger.error(
                            f"FNF Closed Report Scheduler: Report generation/upload failed. "
                            f"Errors: {result['errors']}"
                        )

            except asyncio.CancelledError:
                logger.info("FNF Closed Report Scheduler task cancelled.")
                break
            except Exception as e:
                logger.exception(f"FNF Closed Report Scheduler: Unexpected error: {e}")

            # Check every 30 seconds (same cadence as the main sync loop)
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                logger.info("FNF Closed Report Scheduler sleep cancelled.")
                break
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'Error in fnf_closed_report_loop: {e}', exc_info=True)
        raise HTTPException(status_code=500, detail='An internal server error occurred.')
