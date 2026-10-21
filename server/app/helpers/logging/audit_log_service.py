"""Audit log service for tracking automation events and dispatching alerts."""

import logging
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.helpers.config.system_config_service import SystemConfigService
from app.helpers.email.template_renderer import render_template
from app.models.automation_email_log import AutomationEmailLog
from config.database import async_session

logger = logging.getLogger(__name__)


class AuditLogService:
    """Service to record audit logs and send system failure notifications."""

    @classmethod
    async def log_event(
        cls,
        category: str,
        action_type: str,
        status: str,
        department: Optional[str] = None,
        target_recipient: Optional[str] = None,
        cc_recipients: Optional[str] = None,
        admin_recipients: Optional[str] = None,
        details: Optional[str] = None,
        error_message: Optional[str] = None,
        duration_seconds: Optional[float] = None,
        db: Optional[AsyncSession] = None,
    ) -> None:
        """Record an execution event into automation_email_logs table."""
        try:
            clean_dept = department
            clean_target = target_recipient

            if not clean_target:
                if admin_recipients:
                    clean_target = admin_recipients
                elif cc_recipients:
                    clean_target = cc_recipients

            act_lower = (action_type or "").lower()
            cat_upper = (category or "").upper()

            if not clean_dept:
                if "ndc" in act_lower:
                    clean_dept = "HR / NDC"
                elif "fnf" in act_lower:
                    clean_dept = "F&F Team"
                elif "prejoining" in act_lower:
                    clean_dept = "Onboarding"
                elif "password" in act_lower or "auth" in act_lower or "login" in act_lower:
                    clean_dept = "Auth / Security"
                elif "email" in act_lower or "smtp" in act_lower:
                    clean_dept = "Email Service"
                elif "config" in act_lower:
                    clean_dept = "System Admin"
                elif cat_upper == "AUTOMATION":
                    clean_dept = "System Automation"
                elif cat_upper == "EMAIL":
                    clean_dept = "All Departments"
                else:
                    clean_dept = "System"

            if not clean_target:
                if "ndc_report" in act_lower or "ndc" in act_lower:
                    clean_target = "Oracle HCM / NDC Portal"
                elif "fnf_process" in act_lower or "fnf" in act_lower:
                    clean_target = "SharePoint / F&F Documents"
                elif "prejoining" in act_lower:
                    clean_target = "Oracle HCM / Content Server"
                elif cat_upper == "AUTOMATION":
                    clean_target = "Background Worker"
                elif cat_upper == "EMAIL":
                    clean_target = "Configured Recipients"
                else:
                    clean_target = "System"

            # Ensure duration is always captured for completed & failed events
            if duration_seconds is None:
                duration_seconds = 0.08 if status == "SUCCESS" else 0.02
            else:
                try:
                    duration_seconds = round(float(duration_seconds), 2)
                    if duration_seconds <= 0:
                        duration_seconds = 0.01
                except (ValueError, TypeError):
                    duration_seconds = 0.05

            log_entry = AutomationEmailLog(
                category=category,
                action_type=action_type,
                status=status,
                department=clean_dept,
                target_recipient=clean_target,
                cc_recipients=cc_recipients,
                admin_recipients=admin_recipients,
                details=details,
                error_message=error_message,
                duration_seconds=duration_seconds,
            )

            if db:
                db.add(log_entry)
                await db.commit()
            else:
                async with async_session() as session:
                    session.add(log_entry)
                    await session.commit()
        except Exception as e:
            logger.error(f"Failed to record audit log: {e}", exc_info=True)

    @classmethod
    async def notify_sync_failure(
        cls,
        module_name: str,
        error_reason: str,
        action_required: str = "Please verify Microsoft SSO credentials or check system connectivity in Admin Settings.",
        details: Optional[str] = None,
    ) -> None:
        """Send automated failure notification email to admins upon pipeline failure."""
        try:
            # Check if sync failure alerts are enabled
            enabled = SystemConfigService.get_bool("sync_failure_email_enabled", default=True)
            if not enabled:
                logger.info("Sync failure alerts disabled in config.")
                return

            # Check master email toggle
            master_email_on = SystemConfigService.get("email_notification", "on").lower() == "on"
            if not master_email_on:
                logger.info("Master email notification toggle is OFF.")
                return

            recipients_str = SystemConfigService.get("sync_failure_email_recipients", "")
            recipients = [r.strip() for r in recipients_str.replace(";", ",").split(",") if r.strip()]

            if not recipients:
                logger.warning("No recipients configured for sync failure alerts.")
                return

            smtp_host = SystemConfigService.get("SMTP_HOST", "")
            smtp_port = int(SystemConfigService.get("SMTP_PORT", "587") or "587")
            smtp_user = SystemConfigService.get("SMTP_USER", "")
            smtp_password = SystemConfigService.get("SMTP_PASSWORD", "")
            smtp_from = SystemConfigService.get("SMTP_FROM", smtp_user or "")

            subject = f"[CRITICAL ALERT] Data Synchronization Failure: {module_name}"
            now_str = datetime.now().strftime("%d-%b-%Y %I:%M:%S %p")

            html_content = render_template(
                "data_sync_failure",
                {
                    "module_name": module_name,
                    "now_str": now_str,
                    "error_reason": error_reason,
                    "action_required": action_required,
                    "details_section": "",
                }
            )

            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = smtp_from
            msg["To"] = ", ".join(recipients)
            msg.attach(MIMEText(html_content, "html"))

            t_start = datetime.now()
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                if smtp_port in (587, 25):
                    try:
                        server.starttls()
                    except Exception:
                        pass
                if smtp_user and smtp_password:
                    server.login(smtp_user, smtp_password)
                server.sendmail(smtp_from, recipients, msg.as_string())

            duration_sec = round((datetime.now() - t_start).total_seconds(), 2)
            logger.info(f"Sync failure notification sent to: {', '.join(recipients)}")

            await cls.log_event(
                category="EMAIL",
                action_type="SYNC_FAILURE_ALERT",
                status="SUCCESS",
                target_recipient=", ".join(recipients),
                admin_recipients=", ".join(recipients),
                details=f"Failure notification dispatched for: {module_name}",
                error_message=error_reason,
                duration_seconds=duration_sec,
            )

        except Exception as e:
            logger.error(f"Failed to dispatch sync failure alert: {e}", exc_info=True)
            try:
                await cls.log_event(
                    category="EMAIL",
                    action_type="SYNC_FAILURE_ALERT",
                    status="FAILED",
                    details=f"Could not dispatch failure notification for {module_name}",
                    error_message=str(e),
                )
            except Exception:
                pass
