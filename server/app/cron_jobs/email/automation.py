"""Background scheduler loop for dispatching daily automated emails."""

import asyncio
import datetime
import logging

from fastapi import HTTPException
from sqlalchemy import select

from app.helpers.config.system_config_service import SystemConfigService
from app.models.email_department_config import EmailDepartmentConfig
from app.modules.email.service import EmailService
from config.database import async_session

logger = logging.getLogger(__name__)


async def email_automation_loop():
    """Background polling loop that triggers automated daily emails and tomorrow alerts."""
    try:
        enabled_str = await SystemConfigService.get_from_db("email_automation_background_poll", default="true")
        enabled = enabled_str.strip().lower() in ("true", "1", "yes", "on", "t")
        if not enabled:
            logger.info("Email automation background sync is disabled (email_automation_background_poll=false).")
            return

        logger.info("Starting Daily Email Automation scheduler.")
        last_trigger_date = None
        last_fnf_emp_trigger = None
        last_tracker_trigger = None

        while True:
            try:
                # 1. Master email notification toggle check
                master_val = await SystemConfigService.get_from_db("email_notification", default="on")
                master_enabled = master_val.strip().lower() in ("on", "true", "1", "yes")
                if not master_enabled:
                    await asyncio.sleep(30)
                    continue

                now = datetime.datetime.now()
                time_str = now.strftime("%H:%M")
                date_str = now.strftime("%Y-%m-%d")

                timing_mode = SystemConfigService.get("email_timing_mode", "app_wide")
                target_timing = SystemConfigService.get("email_daily_timing", "10:00")

                def matches_time(conf_times_str: str, current_time: str) -> bool:
                    if not conf_times_str:
                        return False
                    cleaned = [t.strip() for t in conf_times_str.split(",") if t.strip()]
                    return current_time in cleaned

                clearance_reminders_enabled = SystemConfigService.get_bool("clearance_reminders_enabled", True)
                if clearance_reminders_enabled and timing_mode == "app_wide":
                    current_trigger_key = f"{date_str}_{time_str}_app_wide"
                    if matches_time(target_timing, time_str) and last_trigger_date != current_trigger_key:
                        logger.info(f"Background Email Scheduler: Configured time {time_str} reached. Initiating daily email jobs...")
                        last_trigger_date = current_trigger_key

                        await EmailService.run_10am_job()
                        await asyncio.sleep(2)
                        await EmailService.run_tomorrow_alert_job()
                        logger.info("Background Email Scheduler: Daily email jobs completed successfully.")
                elif clearance_reminders_enabled:
                    # Department-wise timing mode
                    async with async_session() as session:
                        stmt = select(EmailDepartmentConfig).where(
                            EmailDepartmentConfig.is_enabled == True
                        )
                        res = await session.execute(stmt)
                        all_enabled_depts = res.scalars().all()
                        for dept_cfg in all_enabled_depts:
                            if matches_time(dept_cfg.scheduled_time, time_str):
                                dept_key = f"{date_str}_{time_str}_{dept_cfg.department}"
                                if last_trigger_date != dept_key:
                                    logger.info(f"Triggering department-wise daily email for {dept_cfg.department} at {time_str}...")
                                    await EmailService.run_10am_job(target_department=dept_cfg.department)
                                    last_trigger_date = dept_key
                                    break

                # Scheduled employee F&F settlement email dispatch check
                fnf_emp_mode = SystemConfigService.get("employee_fnf_email_timing_mode", "instant")
                fnf_emp_time = SystemConfigService.get("employee_fnf_email_scheduled_time", "10:00")
                if fnf_emp_mode == "scheduled" and matches_time(fnf_emp_time, time_str):
                    fnf_trigger_key = f"{date_str}_{time_str}_fnf_emp"
                    if last_fnf_emp_trigger != fnf_trigger_key:
                        last_fnf_emp_trigger = fnf_trigger_key
                        logger.info(f"Background Email Scheduler: Configured time {time_str} reached for employee F&F documents. Dispatching...")
                        async with async_session() as session:
                            try:
                                await EmailService.send_auto_fnf_emails(session)
                            except Exception as ex:
                                logger.exception(f"Background Email Scheduler: Error sending scheduled employee F&F emails: {ex}")

                # Scheduled employee exit clearance tracker email dispatch check
                tracker_enabled = SystemConfigService.get_bool("employee_exit_tracker_enabled", True)
                tracker_mode = SystemConfigService.get("employee_exit_tracker_timing_mode", "scheduled")
                tracker_time = SystemConfigService.get("employee_exit_tracker_scheduled_time", "10:00")
                if tracker_enabled and tracker_mode == "scheduled" and matches_time(tracker_time, time_str):
                    tracker_trigger_key = f"{date_str}_{time_str}_exit_tracker"
                    if last_tracker_trigger != tracker_trigger_key:
                        last_tracker_trigger = tracker_trigger_key
                        logger.info(f"Background Email Scheduler: Configured time {time_str} reached for Employee Exit Tracker. Dispatching...")
                        async with async_session() as session:
                            try:
                                await EmailService.send_employee_exit_tracker_emails(session)
                            except Exception as ex:
                                logger.exception(f"Background Email Scheduler: Error sending employee exit tracker emails: {ex}")

            except asyncio.CancelledError:
                logger.info("Background Email Scheduler task cancelled.")
                break
            except Exception as e:
                logger.exception(f"Background Email Scheduler error: {e}")

            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                logger.info("Background Email Scheduler sleep cancelled.")
                break
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in email_automation_loop: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An internal server error occurred.")
