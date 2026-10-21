"""Admin control service handling configurations, automation pipelines, and audit logs."""

import asyncio
import csv
import importlib
import io
import logging
import os
import smtplib
import time
from datetime import datetime
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.automation.core.runner import get_job, list_jobs, submit_automation_job, update_job_progress
import app.automation.scripts.automation_scripts.download_ndc_report as ndc_script
import app.automation.scripts.automation_scripts.download_prejoining_report as prejoining_script
import app.automation.scripts.processing_scripts.process_fnf_closed_reports as fnf_process_script
import app.automation.scripts.processing_scripts.upload_to_sharepoint as sp_uploader
from app.helpers.config.system_config_service import SystemConfigService, _CONFIG_CACHE
from app.helpers.ff.sharepoint_service import SharePointService, get_httpx_client
from app.helpers.ff.sharepoint_sync_service import SharePointSyncService
from app.helpers.logging.audit_log_service import AuditLogService
from app.helpers.upload.status_mapper import APPROVAL_DEPARTMENTS
from app.models.automation_email_log import AutomationEmailLog
from app.models.email_department_config import EmailDepartmentConfig
from app.models.email_recipient import EmailRecipient
from app.models.system_configuration import SystemConfiguration
from app.dto.admin_control import (
    AutomationJobResponse,
    AutomationJobStatus,
    AutomationSchedulesUpdateRequest,
    ConfigUpdateRequest,
    DepartmentConfigCreateRequest,
    DepartmentConfigUpdateRequest,
    EmailTimingUpdateRequest,
    EmployeeDownloadRequest,
    EmployeeExitTrackerConfigRequest,
    EmployeeFnfEmailConfigRequest,
    SharePointUploadRequest,
)
from app.modules.email.service import EmailService
from config.database import async_session

logger = logging.getLogger(__name__)

ff_module = importlib.import_module("app.automation.scripts.automation_scripts.download_f&f_report")
download_ff_reports = ff_module.download_ff_reports


class AdminControlService:
    """Service providing core business logic for the admin control portal."""

    @staticmethod
    async def get_all_configurations(db: AsyncSession) -> Dict[str, Dict[str, Any]]:
        """Retrieve all dynamic system configurations grouped by category."""
        try:
            return await SystemConfigService.get_all_grouped(db)
        except Exception as e:
            logger.error(f"Error fetching configurations: {e}")
            raise HTTPException(status_code=500, detail="Failed to fetch configurations.")

    @staticmethod
    async def update_configurations(payload: ConfigUpdateRequest, user_email: str, db: AsyncSession) -> Dict[str, str]:
        """Update runtime configurations and log the audit event."""
        t0 = time.perf_counter()
        try:
            for key, val in payload.configs.items():
                category = "general"
                if "ORACLE" in key or "CONTENT_SERVER" in key or "HEADLESS" in key:
                    category = "credentials"
                elif "SMTP" in key or "email" in key or "sync_failure" in key:
                    category = "email"
                elif "schedule" in key:
                    category = "scheduler"
                elif "timing" in key:
                    category = "email_timing"

                await SystemConfigService.set_config(
                    key=key,
                    value=str(val),
                    category=category,
                    updated_by=user_email,
                    db=db
                )

            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="AUTOMATION",
                action_type="CONFIG_UPDATE",
                status="SUCCESS",
                details=f"Updated keys: {', '.join(payload.configs.keys())}",
                admin_recipients=user_email,
                duration_seconds=duration,
                db=db
            )
            return {"status": "success", "message": "Configurations updated successfully."}
        except Exception as e:
            logger.error(f"Error updating configurations: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to update configurations: {e}")

    @staticmethod
    async def test_smtp(user_email: str, db: AsyncSession) -> Dict[str, str]:
        """Send a test email to verify configured SMTP credentials."""
        t0 = time.perf_counter()
        try:
            smtp_host = SystemConfigService.get("SMTP_HOST", "")
            smtp_port = int(SystemConfigService.get("SMTP_PORT", "587") or "587")
            smtp_user = SystemConfigService.get("SMTP_USER", "")
            smtp_password = SystemConfigService.get("SMTP_PASSWORD", "")
            smtp_from = SystemConfigService.get("SMTP_FROM", smtp_user or "")

            if not smtp_host:
                return {"status": "error", "message": "SMTP host is not configured."}

            msg = MIMEText(f"This is a test notification verifying NDC Portal SMTP configuration at {datetime.now().isoformat()}.")
            msg["Subject"] = "[NDC Portal] SMTP Verification Test"
            msg["From"] = smtp_from
            msg["To"] = user_email

            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                if smtp_port in (587, 25):
                    try:
                        server.starttls()
                    except Exception:
                        pass
                if smtp_user and smtp_password:
                    server.login(smtp_user, smtp_password)
                server.sendmail(smtp_from, [user_email], msg.as_string())

            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="EMAIL",
                action_type="SMTP_TEST",
                status="SUCCESS",
                target_recipient=user_email,
                details="SMTP test verification succeeded",
                duration_seconds=duration,
                db=db
            )
            return {"status": "success", "message": f"Test email sent successfully to {user_email}."}
        except Exception as e:
            logger.error(f"SMTP Test Error: {e}")
            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="EMAIL",
                action_type="SMTP_TEST",
                status="FAILED",
                error_message=str(e),
                duration_seconds=duration,
                db=db
            )
            raise HTTPException(status_code=400, detail=f"SMTP test failed: {str(e)}")

    @staticmethod
    async def get_master_email_toggle(db: Optional[AsyncSession] = None) -> Dict[str, bool]:
        """Return the master application-wide email toggle state directly from DB."""
        try:
            if db:
                stmt = select(SystemConfiguration.config_value).where(SystemConfiguration.config_key == "email_notification")
                res = await db.execute(stmt)
                val = res.scalar_one_or_none()
                if val is not None:
                    is_on = val.strip().lower() in ("true", "1", "on", "yes")
                    return {"enabled": is_on}
            val = SystemConfigService.get("email_notification", "on").lower() == "on"
            return {"enabled": val}
        except Exception as e:
            logger.error(f"Error reading master email toggle: {e}")
            return {"enabled": True}

    @staticmethod
    async def set_master_email_toggle(enabled: bool, user_email: str, db: AsyncSession) -> Dict[str, Any]:
        """Toggle master email notification service and persist directly to DB."""
        t0 = time.perf_counter()
        try:
            val = "on" if enabled else "off"
            await SystemConfigService.set_config(
                key="email_notification",
                value=val,
                category="email",
                description="Master toggle for application email notification service",
                updated_by=user_email,
                db=db
            )
            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="EMAIL",
                action_type="MASTER_EMAIL_TOGGLE",
                status="SUCCESS",
                details=f"Master email notification set to {val.upper()} by {user_email}",
                admin_recipients=user_email,
                duration_seconds=duration,
                db=db
            )
            return {"status": "success", "enabled": enabled, "message": f"Master email service turned {'on' if enabled else 'off'} successfully."}
        except Exception as e:
            logger.error(f"Error toggling master email service: {e}")
            raise HTTPException(status_code=500, detail="Failed to toggle master email service.")

    @staticmethod
    async def list_department_configs(db: AsyncSession) -> List[Dict[str, Any]]:
        """List all department email and CC management settings, joined with their main recipient."""
        try:
            res = await db.execute(select(EmailDepartmentConfig).order_by(EmailDepartmentConfig.department))
            depts = res.scalars().all()

            rec_res = await db.execute(select(EmailRecipient))
            recs = rec_res.scalars().all()
            rec_map = {
                r.department.strip().lower(): r
                for r in recs
                if r.department and r.email
            }

            output = []
            for d in depts:
                dept_key = d.department.strip().lower()
                matched_rec = rec_map.get(dept_key)
                output.append({
                    "id": d.id,
                    "department": d.department,
                    "is_enabled": d.is_enabled,
                    "cc_recipients": d.cc_recipients or "",
                    "scheduled_time": d.scheduled_time or "10:00",
                    "notification_types": d.notification_types or "",
                    "notes": d.notes or "",
                    "main_recipient": matched_rec.email if matched_rec else "",
                    "main_recipient_name": matched_rec.name if matched_rec else "",
                })
            return output
        except Exception as e:
            logger.error(f"Error listing department configs: {e}")
            raise HTTPException(status_code=500, detail="Failed to list department configs.")

    @staticmethod
    async def get_available_departments(db: AsyncSession) -> Dict[str, List[str]]:
        """Return canonical NDC approval departments."""
        try:
            return {"departments": list(APPROVAL_DEPARTMENTS)}
        except Exception as e:
            logger.error(f"Error getting departments: {e}")
            return {"departments": []}

    @staticmethod
    async def create_department_config(payload: DepartmentConfigCreateRequest, db: AsyncSession) -> EmailDepartmentConfig:
        """Create a new department email and CC configuration and sync main recipient."""
        try:
            from app.models.email_recipient import EmailRecipient
            dept_name = payload.department.strip().upper()
            existing = await db.execute(select(EmailDepartmentConfig).where(EmailDepartmentConfig.department == dept_name))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=400, detail=f"Department '{dept_name}' already exists.")

            item = EmailDepartmentConfig(
                department=dept_name,
                is_enabled=payload.is_enabled,
                cc_recipients=payload.cc_recipients or "",
                scheduled_time=payload.scheduled_time or "10:00",
                notification_types=payload.notification_types or "daily_summary,tomorrow_alert,delayed_reminder",
                notes=payload.notes or "",
            )
            db.add(item)

            # Sync main recipient to EmailRecipient table
            if payload.main_recipient is not None and payload.main_recipient.strip():
                clean_email = payload.main_recipient.strip().lower()
                clean_name = payload.main_recipient_name.strip() if payload.main_recipient_name else dept_name
                rec_stmt = select(EmailRecipient).where(
                    func.lower(func.trim(EmailRecipient.department)) == dept_name.lower()
                )
                rec_res = await db.execute(rec_stmt)
                rec_item = rec_res.scalars().first()
                if rec_item:
                    rec_item.email = clean_email
                    if payload.main_recipient_name:
                        rec_item.name = clean_name
                else:
                    db.add(EmailRecipient(
                        name=clean_name,
                        email=clean_email,
                        department=dept_name,
                        role="Primary Recipient"
                    ))

            await db.commit()
            await db.refresh(item)
            SystemConfigService.cache_department_config(item)
            return item
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error creating department config: {e}")
            await db.rollback()
            raise HTTPException(status_code=500, detail="Failed to create department config.")

    @staticmethod
    async def update_department_config(dept_id: int, payload: DepartmentConfigUpdateRequest, db: AsyncSession) -> EmailDepartmentConfig:
        """Update department email configuration and sync main recipient to EmailRecipient table."""
        try:
            res = await db.execute(select(EmailDepartmentConfig).where(EmailDepartmentConfig.id == dept_id))
            item = res.scalar_one_or_none()
            if not item:
                raise HTTPException(status_code=404, detail="Department config not found.")

            if payload.is_enabled is not None:
                item.is_enabled = payload.is_enabled
            if payload.cc_recipients is not None:
                item.cc_recipients = payload.cc_recipients
            if payload.scheduled_time is not None:
                item.scheduled_time = payload.scheduled_time
            if payload.notification_types is not None:
                item.notification_types = payload.notification_types
            if payload.notes is not None:
                item.notes = payload.notes

            # Two-way sync: update or create main recipient in EmailRecipient table
            if payload.main_recipient is not None:
                dept_name = item.department
                clean_email = payload.main_recipient.strip().lower()
                clean_name = payload.main_recipient_name.strip() if payload.main_recipient_name else dept_name
                rec_stmt = select(EmailRecipient).where(
                    func.lower(func.trim(EmailRecipient.department)) == dept_name.lower()
                )
                rec_res = await db.execute(rec_stmt)
                rec_item = rec_res.scalars().first()

                if clean_email:
                    if rec_item:
                        rec_item.email = clean_email
                        if payload.main_recipient_name:
                            rec_item.name = clean_name
                    else:
                        db.add(EmailRecipient(
                            name=clean_name,
                            email=clean_email,
                            department=dept_name,
                            role="Primary Recipient"
                        ))
                else:
                    if rec_item:
                        await db.delete(rec_item)

            await db.commit()
            await db.refresh(item)
            SystemConfigService.cache_department_config(item)
            return item
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating department config: {e}")
            await db.rollback()
            raise HTTPException(status_code=500, detail="Failed to update department config.")

    @staticmethod
    async def delete_department_config(dept_id: int, db: AsyncSession) -> Dict[str, str]:
        """Delete a department email configuration."""
        try:
            res = await db.execute(select(EmailDepartmentConfig).where(EmailDepartmentConfig.id == dept_id))
            item = res.scalar_one_or_none()
            if not item:
                raise HTTPException(status_code=404, detail="Department config not found.")
            dept_name = item.department
            await db.delete(item)
            await db.commit()
            SystemConfigService.remove_cached_department_config(dept_name)
            return {"status": "success", "message": "Department configuration removed."}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error deleting department config: {e}")
            await db.rollback()
            raise HTTPException(status_code=500, detail="Failed to delete department config.")

    @staticmethod
    def get_email_timing_settings() -> Dict[str, Any]:
        """Get application-wide and department-wise email scheduling timings."""
        try:
            return {
                "email_daily_timing": SystemConfigService.get("email_daily_timing", "10:00"),
                "email_timing_mode": SystemConfigService.get("email_timing_mode", "app_wide"),
                "is_enabled": SystemConfigService.get_bool("clearance_reminders_enabled", True),
            }
        except Exception as e:
            logger.error(f"Error getting email timings: {e}")
            return {"email_daily_timing": "10:00", "email_timing_mode": "app_wide", "is_enabled": True}

    @staticmethod
    async def update_email_timing_settings(payload: EmailTimingUpdateRequest, user_email: str, db: AsyncSession) -> Dict[str, str]:
        """Update email notification schedules in a single fast transaction."""
        t0 = time.perf_counter()
        try:
            updates = {
                "email_daily_timing": payload.email_daily_timing,
                "email_timing_mode": payload.email_timing_mode,
            }
            if payload.is_enabled is not None:
                updates["clearance_reminders_enabled"] = "on" if payload.is_enabled else "off" 
            stmt = select(SystemConfiguration).where(SystemConfiguration.config_key.in_(list(updates.keys())))
            res = await db.execute(stmt)
            existing_cfgs = {c.config_key: c for c in res.scalars().all()}

            for k, val in updates.items():
                if k in existing_cfgs:
                    existing_cfgs[k].config_value = val
                    existing_cfgs[k].updated_by = user_email
                else:
                    db.add(SystemConfiguration(
                        category="email_timing",
                        config_key=k,
                        config_value=val,
                        description="Email timing setting",
                        updated_by=user_email,
                    ))
                _CONFIG_CACHE[k] = val
                os.environ[k] = val

            await db.commit()
            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="EMAIL",
                action_type="TIMING_UPDATE",
                status="SUCCESS",
                details=f"Email timing updated to {payload.email_daily_timing} ({payload.email_timing_mode})",
                admin_recipients=user_email,
                duration_seconds=duration,
                db=db
            )
            return {"status": "success", "message": "Email timing configuration saved instantly."}
        except Exception as e:
            logger.error(f"Error updating email timing settings: {e}")
            await db.rollback()
            raise HTTPException(status_code=500, detail="Failed to update email timing settings.")

    @staticmethod
    def get_employee_fnf_email_config() -> Dict[str, Any]:
        """Return the configuration for direct employee F&F document emails."""
        try:
            return {
                "enabled": SystemConfigService.get_bool("employee_fnf_email_enabled", True),
                "timing_mode": SystemConfigService.get("employee_fnf_email_timing_mode", "instant"),
                "scheduled_time": SystemConfigService.get("employee_fnf_email_scheduled_time", "10:00"),
            }
        except Exception as e:
            logger.error(f"Error reading employee F&F email config: {e}")
            return {"enabled": True, "timing_mode": "instant", "scheduled_time": "10:00"}

    @staticmethod
    async def set_employee_fnf_email_config(payload: EmployeeFnfEmailConfigRequest, user_email: str, db: AsyncSession) -> Dict[str, Any]:
        """Save configuration for direct employee F&F document emails."""
        t0 = time.perf_counter()
        try:
            val_enabled = "on" if payload.enabled else "off"
            await SystemConfigService.set_config(
                key="employee_fnf_email_enabled",
                value=val_enabled,
                category="email",
                description="Toggle to send F&F settlement documents directly to the actual separated employee",
                updated_by=user_email,
                db=db
            )
            await SystemConfigService.set_config(
                key="employee_fnf_email_timing_mode",
                value=payload.timing_mode,
                category="email_timing",
                description="Timing mode for employee F&F emails: 'instant' or 'scheduled'",
                updated_by=user_email,
                db=db
            )
            await SystemConfigService.set_config(
                key="employee_fnf_email_scheduled_time",
                value=payload.scheduled_time,
                category="email_timing",
                description="Daily scheduled time (HH:MM) to dispatch employee F&F emails when mode is 'scheduled'",
                updated_by=user_email,
                db=db
            )
            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="EMAIL",
                action_type="EMPLOYEE_FNF_CONFIG_UPDATE",
                status="SUCCESS",
                details=f"Employee F&F email set to {val_enabled.upper()} (mode: {payload.timing_mode}, time: {payload.scheduled_time}) by {user_email}",
                admin_recipients=user_email,
                duration_seconds=duration,
                db=db
            )
            return {
                "status": "success",
                "enabled": payload.enabled,
                "timing_mode": payload.timing_mode,
                "scheduled_time": payload.scheduled_time,
                "message": "Employee F&F email configuration saved successfully."
            }
        except Exception as e:
            logger.error(f"Error saving employee F&F email config: {e}")
            raise HTTPException(status_code=500, detail="Failed to save employee F&F email configuration.")

    @staticmethod
    def get_employee_exit_tracker_config() -> Dict[str, Any]:
        """Return the configuration for employee exit clearance tracker emails."""
        try:
            return {
                "enabled": SystemConfigService.get_bool("employee_exit_tracker_enabled", True),
                "timing_mode": SystemConfigService.get("employee_exit_tracker_timing_mode", "scheduled"),
                "scheduled_time": SystemConfigService.get("employee_exit_tracker_scheduled_time", "10:00"),
            }
        except Exception as e:
            logger.error(f"Error reading employee exit tracker config: {e}")
            return {"enabled": True, "timing_mode": "scheduled", "scheduled_time": "10:00"}

    @staticmethod
    async def set_employee_exit_tracker_config(payload: EmployeeExitTrackerConfigRequest, user_email: str, db: AsyncSession) -> Dict[str, Any]:
        """Save configuration for employee exit clearance tracker emails."""
        t0 = time.perf_counter()
        try:
            val_enabled = "on" if payload.enabled else "off"
            await SystemConfigService.set_config(
                key="employee_exit_tracker_enabled",
                value=val_enabled,
                category="email",
                description="Toggle to send exit clearance stage updates directly to resigning employees",
                updated_by=user_email,
                db=db
            )
            await SystemConfigService.set_config(
                key="employee_exit_tracker_timing_mode",
                value=payload.timing_mode,
                category="email_timing",
                description="Timing mode for employee exit tracker emails: 'scheduled' or 'instant'",
                updated_by=user_email,
                db=db
            )
            await SystemConfigService.set_config(
                key="employee_exit_tracker_scheduled_time",
                value=payload.scheduled_time,
                category="email_timing",
                description="Daily scheduled time (HH:MM) to dispatch employee exit tracker emails",
                updated_by=user_email,
                db=db
            )
            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="EMAIL",
                action_type="EMPLOYEE_EXIT_TRACKER_CONFIG_UPDATE",
                status="SUCCESS",
                details=f"Employee exit tracker email set to {val_enabled.upper()} (mode: {payload.timing_mode}, time: {payload.scheduled_time}) by {user_email}",
                admin_recipients=user_email,
                duration_seconds=duration,
                db=db
            )
            return {
                "status": "success",
                "enabled": payload.enabled,
                "timing_mode": payload.timing_mode,
                "scheduled_time": payload.scheduled_time,
                "message": "Employee exit clearance tracker email configuration saved successfully."
            }
        except Exception as e:
            logger.error(f"Error saving employee exit tracker config: {e}")
            raise HTTPException(status_code=500, detail="Failed to save employee exit tracker configuration.")


    @staticmethod
    async def dispatch_emails_now(department: str, user_email: str, db: AsyncSession) -> Dict[str, Any]:
        """Trigger immediate email notifications in background without blocking HTTP request."""
        t0 = time.perf_counter()
        try:
            dept = department if department else "ALL"

            async def _worker():
                update_job_progress(f"Step 1/2: Running 10:00 AM notification job for {dept}...")
                await EmailService.run_10am_job(target_department=dept)
                update_job_progress(f"Step 2/2: Running tomorrow due-date alert job for {dept}...")
                await EmailService.run_tomorrow_alert_job(target_department=dept)
                return f"Email dispatch completed successfully for {dept}."

            job = submit_automation_job(f"immediate_email_dispatch_{dept.lower()}", _worker)

            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="EMAIL",
                action_type="IMMEDIATE_DISPATCH_QUEUED",
                department=dept,
                status="SUCCESS",
                details=f"Email dispatch started in background for {dept}. Job ID: {job['job_id']}",
                admin_recipients=user_email,
                duration_seconds=duration,
                db=db
            )
            return {
                "status": "success",
                "job_id": job["job_id"],
                "message": f"Email notifications for {dept} initiated in background. Track live progress in Logs tab."
            }
        except Exception as e:
            logger.error(f"Error dispatching immediate emails: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to dispatch emails: {e}")

    @staticmethod
    async def get_automation_schedules(db: Optional[AsyncSession] = None) -> Dict[str, Any]:
        """Retrieve automation scheduler timings and toggles directly from database."""
        try:
            if db:
                stmt = select(SystemConfiguration.config_key, SystemConfiguration.config_value).where(
                    SystemConfiguration.config_key.in_([
                        "automation_scheduler_enabled",
                        "ndc_schedule_times",
                        "fnf_schedule_times",
                        "sharepoint_sync_schedule_times",
                        "ndc_automation_enabled",
                        "fnf_automation_enabled",
                        "sharepoint_sync_automation_enabled",
                    ])
                )
                res = await db.execute(stmt)
                data = {k: v for k, v in res.all()}

                def _bool_val(k: str, default: bool = True) -> bool:
                    val = data.get(k)
                    if val is None:
                        return default
                    return val.strip().lower() in ("true", "1", "yes", "on", "t")

                return {
                    "scheduler_enabled": _bool_val("automation_scheduler_enabled", True),
                    "ndc_schedule_times": data.get("ndc_schedule_times") or "",
                    "fnf_schedule_times": data.get("fnf_schedule_times") or "",
                    "sharepoint_sync_schedule_times": data.get("sharepoint_sync_schedule_times") or "",
                    "ndc_enabled": _bool_val("ndc_automation_enabled", True),
                    "fnf_enabled": _bool_val("fnf_automation_enabled", True),
                    "sharepoint_sync_enabled": _bool_val("sharepoint_sync_automation_enabled", True),
                }

            return {
                "scheduler_enabled": SystemConfigService.get_bool("automation_scheduler_enabled", default=True),
                "ndc_schedule_times": SystemConfigService.get("ndc_schedule_times", ""),
                "fnf_schedule_times": SystemConfigService.get("fnf_schedule_times", ""),
                "sharepoint_sync_schedule_times": SystemConfigService.get("sharepoint_sync_schedule_times", ""),
                "ndc_enabled": SystemConfigService.get_bool("ndc_automation_enabled", default=True),
                "fnf_enabled": SystemConfigService.get_bool("fnf_automation_enabled", default=True),
                "sharepoint_sync_enabled": SystemConfigService.get_bool("sharepoint_sync_automation_enabled", default=True),
            }
        except Exception as e:
            logger.error(f"Error getting automation schedules: {e}")
            return {
                "scheduler_enabled": True,
                "ndc_schedule_times": "",
                "fnf_schedule_times": "",
                "sharepoint_sync_schedule_times": "",
                "ndc_enabled": True,
                "fnf_enabled": True,
                "sharepoint_sync_enabled": True,
            }

    @staticmethod
    async def get_automation_toggles(db: AsyncSession) -> Dict[str, bool]:
        """Return state for master and specific automation tasks (NDC, F&F, SharePoint)."""
        try:
            stmt = select(SystemConfiguration.config_key, SystemConfiguration.config_value).where(
                SystemConfiguration.config_key.in_([
                    "automation_scheduler_enabled",
                    "ndc_automation_enabled",
                    "fnf_automation_enabled",
                    "sharepoint_sync_automation_enabled"
                ])
            )
            res = await db.execute(stmt)
            mapping = {k: v for k, v in res.all()}

            def _parse(k: str, default: bool = True) -> bool:
                if k not in mapping or mapping[k] is None:
                    return default
                return mapping[k].strip().lower() in ("true", "1", "on", "yes", "t")

            return {
                "master_enabled": _parse("automation_scheduler_enabled", True),
                "ndc_enabled": _parse("ndc_automation_enabled", True),
                "fnf_enabled": _parse("fnf_automation_enabled", True),
                "sharepoint_sync_enabled": _parse("sharepoint_sync_automation_enabled", True),
            }
        except Exception as e:
            logger.error(f"Error querying automation toggles: {e}")
            return {
                "master_enabled": True,
                "ndc_enabled": True,
                "fnf_enabled": True,
                "sharepoint_sync_enabled": True,
            }

    @staticmethod
    async def get_automation_master_toggle(db: Optional[AsyncSession] = None) -> Dict[str, bool]:
        """Return the master background automation toggle state directly from DB."""
        try:
            if db:
                stmt = select(SystemConfiguration.config_value).where(SystemConfiguration.config_key == "automation_scheduler_enabled")
                res = await db.execute(stmt)
                val = res.scalar_one_or_none()
                if val is not None:
                    is_on = val.strip().lower() in ("true", "1", "on", "yes", "t")
                    return {"enabled": is_on}
            return {"enabled": SystemConfigService.get_bool("automation_scheduler_enabled", default=True)}
        except Exception as e:
            logger.error(f"Error reading automation master toggle: {e}")
            return {"enabled": True}

    @staticmethod
    async def set_automation_master_toggle(enabled: bool, user_email: str, db: AsyncSession) -> Dict[str, Any]:
        """Toggle master automation scheduler and log audit event."""
        t0 = time.perf_counter()
        try:
            val = "true" if enabled else "false"
            await SystemConfigService.set_config(
                key="automation_scheduler_enabled",
                value=val,
                category="scheduler",
                description="Master toggle for background automation scheduler",
                updated_by=user_email,
                db=db
            )
            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="AUTOMATION",
                action_type="MASTER_AUTOMATION_TOGGLE",
                status="SUCCESS",
                details=f"Master background automation scheduler set to {'ON' if enabled else 'OFF'} by {user_email}",
                admin_recipients=user_email,
                duration_seconds=duration,
                db=db
            )
            return {"status": "success", "enabled": enabled, "message": f"Master automation scheduler turned {'on' if enabled else 'off'} successfully."}
        except Exception as e:
            logger.error(f"Error toggling master automation scheduler: {e}")
            raise HTTPException(status_code=500, detail="Failed to toggle master automation scheduler.")

    @staticmethod
    async def set_automation_specific_toggle(key: str, enabled: bool, user_email: str, db: AsyncSession) -> Dict[str, Any]:
        """Toggle an individual automation schedule (ndc, fnf, sharepoint_sync, or master)."""
        t0 = time.perf_counter()
        config_key_map = {
            "master": "automation_scheduler_enabled",
            "ndc": "ndc_automation_enabled",
            "fnf": "fnf_automation_enabled",
            "sharepoint_sync": "sharepoint_sync_automation_enabled",
        }
        config_key = config_key_map.get(key.lower())
        if not config_key:
            raise HTTPException(status_code=400, detail=f"Invalid automation toggle key '{key}'.")

        try:
            val = "true" if enabled else "false"
            descriptions = {
                "master": "Master toggle for background automation scheduler",
                "ndc": "Toggle for automated daily NDC report downloads",
                "fnf": "Toggle for automated F&F exit settlement downloads",
                "sharepoint_sync": "Toggle for automated SharePoint document ingestion",
            }
            await SystemConfigService.set_config(
                key=config_key,
                value=val,
                category="scheduler",
                description=descriptions.get(key.lower(), "Automation schedule toggle"),
                updated_by=user_email,
                db=db
            )
            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="AUTOMATION",
                action_type="SPECIFIC_AUTOMATION_TOGGLE",
                status="SUCCESS",
                details=f"Automation task '{key.upper()}' set to {'ON' if enabled else 'OFF'} by {user_email}",
                admin_recipients=user_email,
                duration_seconds=duration,
                db=db
            )
            return {
                "status": "success",
                "key": key,
                "enabled": enabled,
                "message": f"{key.upper()} automation turned {'on' if enabled else 'off'} successfully."
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error setting automation toggle for '{key}': {e}")
            raise HTTPException(status_code=500, detail=f"Failed to update automation toggle for {key}.")

    @staticmethod
    async def sync_recipients_to_departments(user_email: str, db: AsyncSession) -> Dict[str, Any]:
        """Auto-populate and merge CC rules from EmailRecipient table into EmailDepartmentConfig."""
        t0 = time.perf_counter()
        try:
            from app.models.email_recipient import EmailRecipient

            # 1. Fetch all recipients from EmailRecipient
            rec_stmt = select(EmailRecipient)
            rec_res = await db.execute(rec_stmt)
            recipients = rec_res.scalars().all()

            # Group emails by department (normalized uppercase)
            dept_map: Dict[str, List[str]] = {}
            for r in recipients:
                d = (r.department or "").strip().upper()
                if d and r.email:
                    dept_map.setdefault(d, []).append(r.email.strip().lower())

            # 2. Fetch all department configs
            dept_stmt = select(EmailDepartmentConfig)
            dept_res = await db.execute(dept_stmt)
            departments = dept_res.scalars().all()

            updated_count = 0
            for d_cfg in departments:
                dept_norm = (d_cfg.department or "").strip().upper()
                new_emails = dept_map.get(dept_norm, [])
                if new_emails:
                    existing = [e.strip().lower() for e in (d_cfg.cc_recipients or "").replace(";", ",").split(",") if e.strip()]
                    merged = list(dict.fromkeys(existing + new_emails))
                    merged_str = ", ".join(merged)
                    if merged_str != (d_cfg.cc_recipients or ""):
                        d_cfg.cc_recipients = merged_str
                        SystemConfigService.cache_department_config(d_cfg)
                        updated_count += 1

            await db.commit()
            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="EMAIL",
                action_type="SYNC_RECIPIENTS_TO_DEPTS",
                status="SUCCESS",
                details=f"Synced CC rules from Email Recipients tab across {updated_count} department(s)",
                admin_recipients=user_email,
                duration_seconds=duration,
                db=db
            )
            return {
                "status": "success",
                "updated_departments": updated_count,
                "message": f"Successfully synced CC recipients for {updated_count} department(s) from Email Recipients tab."
            }
        except Exception as e:
            logger.error(f"Error syncing recipients to departments: {e}")
            await db.rollback()
            raise HTTPException(status_code=500, detail="Failed to sync recipients to department CC rules.")

    @staticmethod
    async def update_automation_schedules(payload: AutomationSchedulesUpdateRequest, user_email: str, db: AsyncSession) -> Dict[str, str]:
        """Modify automation execution times and scheduler status in a fast single transaction."""
        t0 = time.perf_counter()
        try:
            updates = {
                "automation_scheduler_enabled": str(payload.scheduler_enabled).lower(),
                "ndc_schedule_times": payload.ndc_schedule_times,
                "fnf_schedule_times": payload.fnf_schedule_times,
                "sharepoint_sync_schedule_times": payload.sharepoint_sync_schedule_times or "",
            }

            stmt = select(SystemConfiguration).where(SystemConfiguration.config_key.in_(list(updates.keys())))
            res = await db.execute(stmt)
            existing_cfgs = {c.config_key: c for c in res.scalars().all()}

            for k, val in updates.items():
                if k in existing_cfgs:
                    existing_cfgs[k].config_value = val
                    existing_cfgs[k].updated_by = user_email
                else:
                    db.add(SystemConfiguration(
                        category="scheduler",
                        config_key=k,
                        config_value=val,
                        description="Automation scheduler config",
                        updated_by=user_email,
                    ))
                _CONFIG_CACHE[k] = val
                os.environ[k] = val

            await db.commit()
            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="AUTOMATION",
                action_type="SCHEDULES_UPDATE",
                status="SUCCESS",
                details="Updated automation execution schedule times",
                admin_recipients=user_email,
                duration_seconds=duration,
                db=db
            )
            return {"status": "success", "message": "Automation schedules updated instantly."}
        except Exception as e:
            logger.error(f"Error updating automation schedules: {e}")
            await db.rollback()
            raise HTTPException(status_code=500, detail="Failed to update automation schedules.")

    @staticmethod
    def run_ndc_download(from_date: Optional[str] = None, business_unit: Optional[str] = None) -> AutomationJobResponse:
        """Run NDC report download pipeline in background."""
        try:
            job = submit_automation_job(
                "ndc_report_download",
                lambda: ndc_script.download_ndc_report(from_date=from_date, business_unit=business_unit)
            )
            return AutomationJobResponse(**job)
        except Exception as e:
            logger.error(f"Failed to trigger NDC download: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def run_fnf_process() -> AutomationJobResponse:
        """Run F&F report processing pipeline in background."""
        try:
            job = submit_automation_job("fnf_process_closed_reports", fnf_process_script.process_fnf_active_reports)
            return AutomationJobResponse(**job)
        except Exception as e:
            logger.error(f"Failed to trigger F&F process: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def run_fnf_download_by_ids(request: EmployeeDownloadRequest) -> AutomationJobResponse:
        """Run F&F document download by employee numbers."""
        try:
            clean_ids = [str(e).strip() for e in request.employee_numbers if str(e).strip()]
            if not clean_ids:
                raise HTTPException(status_code=400, detail="Employee numbers are required for F&F download.")
            job = submit_automation_job("fnf_download_by_ids", lambda: download_ff_reports(clean_ids))
            return AutomationJobResponse(**job)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to trigger F&F download by IDs: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def run_prejoining_download(request: EmployeeDownloadRequest) -> AutomationJobResponse:
        """Run Pre-Joining report download by employee numbers."""
        try:
            clean_ids = [str(e).strip() for e in request.employee_numbers if str(e).strip()]
            if not clean_ids:
                raise HTTPException(status_code=400, detail="Employee numbers are required for Pre-Joining download.")
            job = submit_automation_job("prejoining_download", lambda: prejoining_script.download_prejoining_reports(clean_ids))
            return AutomationJobResponse(**job)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to trigger Pre-Joining download: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def run_sharepoint_upload(request: SharePointUploadRequest) -> AutomationJobResponse:
        """Run SharePoint upload pipeline in background."""
        try:
            raw_target = request.target_pipeline.value if hasattr(request.target_pipeline, "value") else (request.target_pipeline or "all")
            target = str(raw_target).lower().strip()

            async def _upload():
                async with sp_uploader.httpx.AsyncClient(verify=False) as client:
                    site_id = await sp_uploader.get_site_id(client)
                    drive_id, folder_path = await sp_uploader.get_drive_details(client, site_id)

                    if target in ["all", "ndc"]:
                        await sp_uploader.upload_ndc_reports(client, site_id, drive_id, folder_path)
                    if target in ["all", "ff"]:
                        await sp_uploader.upload_ff_reports(client, site_id, drive_id, folder_path)
                    if target in ["all", "prejoining"]:
                        await sp_uploader.upload_prejoining_reports(client, site_id, drive_id, folder_path)

            job = submit_automation_job(f"sharepoint_upload_{target}", _upload)
            return AutomationJobResponse(**job)
        except Exception as e:
            logger.error(f"Failed to trigger SharePoint upload: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def run_fnf_sync_and_process() -> AutomationJobResponse:
        """Sync SharePoint F&F folders and process exit documents."""
        try:
            async def _worker():
                update_job_progress("Step 1/2: Syncing SharePoint F&F folder presence...")
                folders_count = 0
                try:
                    async with async_session() as session:
                        sync_service = SharePointSyncService()
                        doc_res = await sync_service.sync_fnf_document_presence(session)
                        folders_count = doc_res.get("folders_found", 0)
                except Exception as sync_err:
                    logger.warning(f"F&F presence check warning: {sync_err}")

                update_job_progress("Step 2/2: Checking active F&F reports queue and downloading documents...")
                process_res = await fnf_process_script.process_fnf_active_reports()
                return f"F&F Document Sync Complete: {folders_count} folder(s) scanned. {process_res or ''}".strip()

            job = submit_automation_job("fnf_process_closed_reports", _worker)
            return AutomationJobResponse(**job)
        except Exception as e:
            logger.error(f"Failed to run F&F sync and process: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def run_sharepoint_sync() -> AutomationJobResponse:
        """Check SharePoint and ingest new report files."""
        try:
            async def _worker():
                update_job_progress("Connecting to SharePoint repository...")
                async with async_session() as session:
                    sync_service = SharePointSyncService()
                    update_job_progress("Checking reports folder & ingesting new files...")
                    sp_res = await sync_service.check_and_ingest_new_files(session)
                    update_job_progress("Verifying F&F document presence...")
                    doc_res = await sync_service.sync_fnf_document_presence(session)

                files_count = sp_res.get("files_ingested", 0)
                folders_count = doc_res.get("folders_found", 0)
                return f"SharePoint Sync Complete: {files_count} new file(s) ingested, {folders_count} F&F folder(s) verified."

            job = submit_automation_job("sharepoint_sync", _worker)
            return AutomationJobResponse(**job)
        except Exception as e:
            logger.error(f"Failed to run SharePoint sync: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def run_full_system_sync() -> AutomationJobResponse:
        """Trigger complete end-to-end sync across all pipelines."""
        try:
            async def _worker():
                update_job_progress("Step 1/4: Checking SharePoint & ingesting new report files...")
                files_ingested = 0
                try:
                    async with async_session() as session:
                        sync_service = SharePointSyncService()
                        sp_res = await sync_service.check_and_ingest_new_files(session)
                        files_ingested = sp_res.get("files_ingested", 0)
                except Exception as sp_err:
                    logger.warning(f"SharePoint ingestion warning: {sp_err}")

                update_job_progress("Step 2/4: Syncing F&F document presence across employee records...")
                folders_found = 0
                try:
                    async with async_session() as session:
                        sync_service = SharePointSyncService()
                        doc_res = await sync_service.sync_fnf_document_presence(session)
                        folders_found = doc_res.get("folders_found", 0)
                except Exception as doc_err:
                    logger.warning(f"F&F presence check warning: {doc_err}")

                update_job_progress("Step 3/4: Downloading NDC status report from Oracle Fusion...")
                await ndc_script.download_ndc_report()

                update_job_progress("Step 4/4: Processing F&F exit documents queue...")
                await fnf_process_script.process_fnf_active_reports()

                return (
                    f"Full System Sync Complete: {files_ingested} file(s) ingested, "
                    f"{folders_found} folder(s) verified, NDC and F&F pipelines executed successfully."
                )

            job = submit_automation_job("full_system_sync", _worker)
            return AutomationJobResponse(**job)
        except Exception as e:
            logger.error(f"Failed to run full system sync: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def run_automation_on_demand(pipeline: str, request: Optional[EmployeeDownloadRequest] = None) -> AutomationJobResponse:
        """Dispatch on-demand execution for a specified pipeline."""
        try:
            p = pipeline.lower().strip()
            if p == "ndc":
                return AdminControlService.run_ndc_download()
            elif p == "fnf_process":
                return AdminControlService.run_fnf_process()
            elif p == "fnf_download_ids":
                if not request:
                    raise HTTPException(status_code=400, detail="Employee numbers are required for F&F download.")
                return AdminControlService.run_fnf_download_by_ids(request)
            elif p == "prejoining":
                if not request:
                    raise HTTPException(status_code=400, detail="Employee numbers are required for Pre-Joining download.")
                return AdminControlService.run_prejoining_download(request)
            else:
                raise HTTPException(status_code=400, detail=f"Unknown pipeline: '{pipeline}'.")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error running automation on demand '{pipeline}': {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def list_all_jobs() -> Dict[str, AutomationJobStatus]:
        """Return all in-memory tracked jobs."""
        try:
            return {jid: AutomationJobStatus(**info) for jid, info in list_jobs().items()}
        except Exception as e:
            logger.error(f"Error listing in-memory jobs: {e}")
            return {}

    @staticmethod
    async def list_all_jobs_async(db: Optional[AsyncSession] = None) -> Dict[str, AutomationJobStatus]:
        """Return in-memory and historical database jobs."""
        try:
            jobs_dict: Dict[str, AutomationJobStatus] = {}

            if db:
                try:
                    stmt = (
                        select(AutomationEmailLog)
                        .where(AutomationEmailLog.category.in_(["AUTOMATION", "SYNC"]))
                        .order_by(AutomationEmailLog.id.desc())
                        .limit(20)
                    )
                    res = await db.execute(stmt)
                    logs = res.scalars().all()
                    for log in logs:
                        created_iso = log.created_at.isoformat() if log.created_at else None
                        is_success = (log.status or "").upper() == "SUCCESS"
                        job_key = f"db_{log.id}"
                        jobs_dict[job_key] = AutomationJobStatus(
                            job_id=job_key,
                            pipeline=log.action_type or "automation",
                            status="completed" if is_success else "failed",
                            created_at=created_iso,
                            started_at=created_iso,
                            completed_at=created_iso,
                            duration_seconds=log.duration_seconds,
                            result=log.details if is_success else None,
                            error=log.error_message or (log.details if not is_success else None),
                        )
                except Exception as e:
                    logger.warning(f"Could not load historical jobs from DB: {e}")

            try:
                for jid, info in list_jobs().items():
                    jobs_dict[jid] = AutomationJobStatus(**info)
            except Exception as exc:
                logger.error(f"Error reading in-memory jobs: {exc}")

            return jobs_dict
        except Exception as e:
            logger.error(f"Error listing jobs: {e}")
            return {}

    @staticmethod
    def get_job_by_id(job_id: str) -> Optional[AutomationJobStatus]:
        """Retrieve execution status for a specific background job ID."""
        try:
            if not job_id or not job_id.strip():
                raise HTTPException(status_code=400, detail="Job ID cannot be empty.")
            info = get_job(job_id.strip())
            if not info:
                raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
            return AutomationJobStatus(**info)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error fetching job '{job_id}': {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    async def list_sharepoint_documents(search: Optional[str] = None) -> Dict[str, Any]:
        """List employee F&F folders in SharePoint."""
        try:
            sp_service = SharePointService()
            async with get_httpx_client() as client:
                folders = await sp_service.list_all_fnf_folders(client, search=search)
                return {"folders": folders, "total": len(folders)}
        except Exception as e:
            logger.error(f"Error listing SharePoint documents: {e}")
            raise HTTPException(status_code=500, detail="Failed to list SharePoint documents.")

    @staticmethod
    async def delete_sharepoint_document(person_number: str, user_email: str, db: AsyncSession) -> Dict[str, Any]:
        """Delete an employee F&F folder from SharePoint."""
        t0 = time.perf_counter()
        try:
            sp_service = SharePointService()
            async with get_httpx_client() as client:
                res = await sp_service.delete_employee_folder(client, person_number)
                duration = round(time.perf_counter() - t0, 2)
                if res.get("status") == "success":
                    await AuditLogService.log_event(
                        category="AUTOMATION",
                        action_type="SHAREPOINT_DELETE_DOCUMENTS",
                        status="SUCCESS",
                        target_recipient=str(person_number),
                        admin_recipients=user_email,
                        details=f"Deleted SharePoint F&F folder for employee {person_number}",
                        duration_seconds=duration,
                        db=db
                    )
                    return res
                else:
                    raise HTTPException(status_code=400, detail=res.get("message"))
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error deleting SharePoint folder: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    async def resync_sharepoint_document(person_number: str, user_email: str, db: AsyncSession) -> Dict[str, Any]:
        """Re-sync employee documents from DMS back into SharePoint."""
        t0 = time.perf_counter()
        try:
            clean_id = str(person_number).strip()
            if not clean_id:
                raise HTTPException(status_code=400, detail="Invalid person number.")

            req = EmployeeDownloadRequest(employee_numbers=[clean_id])
            job = AdminControlService.run_fnf_download_by_ids(req)

            duration = round(time.perf_counter() - t0, 2)
            await AuditLogService.log_event(
                category="AUTOMATION",
                action_type="DMS_RESYNC_DOCUMENTS",
                status="SUCCESS",
                target_recipient=clean_id,
                admin_recipients=user_email,
                details=f"Initiated DMS re-sync for employee {clean_id}. Job ID: {job.job_id}",
                duration_seconds=duration,
                db=db
            )
            return {
                "status": "queued",
                "job_id": job.job_id,
                "message": f"DMS re-download initiated for employee {clean_id}. Documents will be restored to SharePoint.",
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error re-syncing SharePoint document: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    async def list_audit_logs(
        category: Optional[str],
        status_filter: Optional[str],
        search: Optional[str],
        page: int,
        limit: int,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """Query centralized logs for emails and automation tasks."""
        try:
            stmt = select(AutomationEmailLog).order_by(desc(AutomationEmailLog.created_at))

            if category and category.upper() != "ALL":
                stmt = stmt.where(AutomationEmailLog.category == category.upper())

            if status_filter and status_filter.upper() != "ALL":
                stmt = stmt.where(AutomationEmailLog.status == status_filter.upper())

            if search:
                kw = f"%{search.strip()}%"
                stmt = stmt.where(
                    AutomationEmailLog.action_type.ilike(kw)
                    | AutomationEmailLog.department.ilike(kw)
                    | AutomationEmailLog.target_recipient.ilike(kw)
                    | AutomationEmailLog.details.ilike(kw)
                    | AutomationEmailLog.error_message.ilike(kw)
                )

            offset = (page - 1) * limit
            stmt = stmt.offset(offset).limit(limit)

            res = await db.execute(stmt)
            rows = res.scalars().all()
            return {"logs": rows, "page": page, "limit": limit, "count": len(rows)}
        except Exception as e:
            logger.error(f"Error querying audit logs: {e}")
            raise HTTPException(status_code=500, detail="Failed to load audit logs.")

    @staticmethod
    async def export_audit_logs_csv(category: Optional[str], status_filter: Optional[str], db: AsyncSession) -> StreamingResponse:
        """Export system logs as a streaming CSV file."""
        try:
            stmt = select(AutomationEmailLog).order_by(desc(AutomationEmailLog.created_at)).limit(1000)
            if category and category.upper() != "ALL":
                stmt = stmt.where(AutomationEmailLog.category == category.upper())
            if status_filter and status_filter.upper() != "ALL":
                stmt = stmt.where(AutomationEmailLog.status == status_filter.upper())

            res = await db.execute(stmt)
            rows = res.scalars().all()

            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow([
                "ID", "Timestamp", "Category", "Action / Pipeline", "Department",
                "Target Recipient", "CC Recipients", "Admin Recipients",
                "Status", "Duration (s)", "Details", "Error Message"
            ])

            action_map = {
                "config_update": "System Configuration Update",
                "master_email_toggle": "Master Email Service Toggle",
                "employee_fnf_config_update": "Employee F&F Email Settings Update",
                "smtp_test": "SMTP Connection Test",
                "admin_login": "Administrator Login",
                "user_access_approved": "User Access Approved",
                "user_access_rejected": "User Access Rejected",
                "user_access_requested": "New User Access Request",
                "password_reset_email": "Password Reset Request",
                "account_approval_token": "Access Approval Notification",
                "ndc_report_download": "NDC Report Download & Sync",
                "fnf_process_closed_reports": "F&F Closed Documents Sync",
                "download_ff_report": "F&F Report Download",
                "download_prejoining_report": "Pre-Joining Report Download",
                "upload_to_sharepoint": "SharePoint Document Upload",
                "fnf_download_ids": "Employee Document Download",
                "sharepoint_delete_documents": "SharePoint Document Deletion",
                "dms_resync_documents": "DMS Document Re-Sync",
                "fnf_details_email": "Employee F&F Settlement Email",
                "reminder_ndc_delayed": "Delayed Cases Reminder Email",
            }

            for r in rows:
                raw_act = (r.action_type or "").strip()
                display_act = action_map.get(raw_act.lower(), raw_act.replace("_", " ").title())
                writer.writerow([
                    r.id,
                    r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else "",
                    r.category,
                    display_act,
                    r.department or "",
                    r.target_recipient or "",
                    r.cc_recipients or "",
                    r.admin_recipients or "",
                    r.status,
                    f"{r.duration_seconds}s" if r.duration_seconds is not None else "—",
                    (r.details or "").replace("\n", " "),
                    (r.error_message or "").replace("\n", " "),
                ])

            output.seek(0)
            filename = f"NDC_Automation_Email_Logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'}
            )
        except Exception as e:
            logger.error(f"Error exporting logs CSV: {e}")
            raise HTTPException(status_code=500, detail="Failed to export audit logs CSV.")
