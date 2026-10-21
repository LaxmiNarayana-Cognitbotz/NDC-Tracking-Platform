"""Application lifespan management for background scheduler loops and database initialization."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from app.cron_jobs.automation.scheduler import automation_scheduler_loop
from app.cron_jobs.email.automation import email_automation_loop
from app.cron_jobs.fnf.closed_report import fnf_closed_report_loop
from app.cron_jobs.fnf.completed_sync import fnf_completed_sync_loop
from app.cron_jobs.sharepoint.sync import sharepoint_sync_loop
from app.helpers.config.system_config_service import SystemConfigService
from config.database import async_session
from app.helpers.startup.service import StartupService

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown lifecycle events."""
    try:
        # Initialize database tables from SQLAlchemy declarative models
        await StartupService.init_models()

        async with async_session() as session:
            await StartupService.seed_super_admins(session)
            await StartupService.seed_demo_admin(session)
            await StartupService.seed_system_defaults(session)
            await session.commit()

        # Load dynamic configurations into memory cache
        await SystemConfigService.load_all_to_cache()

        # Start background tasks
        bg_task = asyncio.create_task(sharepoint_sync_loop())
        fnf_bg_task = asyncio.create_task(fnf_completed_sync_loop())
        fnf_closed_task = asyncio.create_task(fnf_closed_report_loop())
        email_task = asyncio.create_task(email_automation_loop())
        automation_task = asyncio.create_task(automation_scheduler_loop())

        yield

        # Cancel background tasks on shutdown
        bg_task.cancel()
        fnf_bg_task.cancel()
        fnf_closed_task.cancel()
        email_task.cancel()
        automation_task.cancel()

        for t in (automation_task, bg_task, fnf_bg_task, fnf_closed_task, email_task):
            try:
                await t
            except asyncio.CancelledError:
                pass
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in lifespan: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An internal server error occurred.")
