import asyncio
import datetime
import logging

from app.helpers.config.system_config_service import SystemConfigService
from app.modules.admin_control.service import AdminControlService

logger = logging.getLogger(__name__)


async def automation_scheduler_loop():
    """
    Background scheduler loop that automatically executes NDC and F&F automation pipelines
    based on dynamic timings configured in the Admin Portal.
    """
    logger.info("Starting Centralized Automation Background Scheduler Loop...")
    last_triggers = {}

    while True:
        try:
            enabled_str = await SystemConfigService.get_from_db("automation_scheduler_enabled", default="true")
            enabled = enabled_str.strip().lower() in ("true", "1", "yes", "on", "t")
            if not enabled:
                await asyncio.sleep(30)
                continue

            now = datetime.datetime.now()
            time_str = now.strftime("%H:%M")
            date_str = now.strftime("%Y-%m-%d")
            trigger_key = f"{date_str}_{time_str}"

            # 1. NDC Download Schedule
            ndc_enabled_str = await SystemConfigService.get_from_db("ndc_automation_enabled", default="true")
            ndc_is_enabled = ndc_enabled_str.strip().lower() in ("true", "1", "yes", "on", "t")

            ndc_raw = await SystemConfigService.get_from_db("ndc_schedule_times", default="")
            ndc_times = [
                t.strip()
                for t in ndc_raw.split(",")
                if t.strip()
            ]
            if ndc_is_enabled and time_str in ndc_times and last_triggers.get("ndc") != trigger_key:
                last_triggers["ndc"] = trigger_key
                logger.info(f"Automation Scheduler: Triggering NDC Download at {time_str}...")
                try:
                    AdminControlService.run_ndc_download()
                except Exception as e:
                    logger.error(f"Error triggering scheduled NDC download: {e}", exc_info=True)

            # 2. F&F Process Schedule
            fnf_enabled_str = await SystemConfigService.get_from_db("fnf_automation_enabled", default="true")
            fnf_is_enabled = fnf_enabled_str.strip().lower() in ("true", "1", "yes", "on", "t")

            fnf_raw = await SystemConfigService.get_from_db("fnf_schedule_times", default="")
            fnf_times = [
                t.strip()
                for t in fnf_raw.split(",")
                if t.strip()
            ]
            if fnf_is_enabled and time_str in fnf_times and last_triggers.get("fnf") != trigger_key:
                last_triggers["fnf"] = trigger_key
                logger.info(f"Automation Scheduler: Triggering F&F Process at {time_str}...")
                try:
                    AdminControlService.run_fnf_process()
                except Exception as e:
                    logger.error(f"Error triggering scheduled F&F process: {e}", exc_info=True)

        except asyncio.CancelledError:
            logger.info("Automation Scheduler task cancelled.")
            break
        except Exception as e:
            logger.error(f"Unexpected error in automation_scheduler_loop: {e}", exc_info=True)

        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            break

