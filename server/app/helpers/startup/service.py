"""Database startup, table initialization, and system seeding service."""

import importlib
import logging
import os
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Import all models dynamically to register on Base.metadata
importlib.import_module("app.models")

from app.helpers.upload.status_mapper import APPROVAL_DEPARTMENTS
from app.models.email_department_config import EmailDepartmentConfig
from app.models.ndc_user_access import NdcUserAccess
from app.models.system_configuration import SystemConfiguration
from app.utils.crypto import ENCRYPTED_CONFIG_KEYS, encrypt_value, is_encrypted
from app.utils.password import hash_password
from config.database import Base, engine

logger = logging.getLogger(__name__)


class StartupService:
    """Service to handle startup initialization, encryption, and default seeding."""

    @staticmethod
    async def init_models() -> None:
        """Initialize database table structures from SQLAlchemy declarative models."""
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("Database model tables initialized.")
        except Exception as e:
            logger.error(f"Error initializing database models: {e}")
            raise

    @staticmethod
    async def encrypt_plaintext_credentials(session: AsyncSession) -> None:
        """Migrate any legacy plaintext credentials in system_configurations to AES-256."""
        try:
            stmt = select(SystemConfiguration).where(SystemConfiguration.config_key.in_(list(ENCRYPTED_CONFIG_KEYS)))
            res = await session.execute(stmt)
            rows = res.scalars().all()
            migrated_count = 0
            for r in rows:
                if r.config_value and not is_encrypted(r.config_value):
                    r.config_value = encrypt_value(r.config_value)
                    migrated_count += 1
            if migrated_count > 0:
                await session.commit()
                logger.info(f"Encrypted {migrated_count} legacy sensitive credential(s) in database to AES-256.")
        except Exception as exc:
            logger.warning(f"Could not migrate credentials to AES-256: {exc}")

    @staticmethod
    async def seed_system_defaults(session: AsyncSession) -> None:
        """Seed default configurations and department settings dynamically."""
        try:
            default_configs = [
                # Endpoints and execution mode
                ("credentials", "ORACLE_URL", os.getenv("ORACLE_URL", ""), "Oracle Fusion portal URL"),
                ("credentials", "CONTENT_SERVER_URL", os.getenv("CONTENT_SERVER_URL", ""), "OpenText Content Server DMS URL"),
                # Service account credentials are intentionally empty by default; only configured via UI
                ("credentials", "ORACLE_EMAIL", "", "Microsoft SSO / Oracle login account email"),
                ("credentials", "ORACLE_PASSWORD", "", "Microsoft SSO / Oracle login account password"),
                ("credentials", "HEADLESS", os.getenv("HEADLESS", "true"), "Browser headless execution mode (true/false)"),
                # Email system toggles and SMTP (seeded directly from .env)
                ("email", "email_notification", os.getenv("EMAIL_NOTIFICATION", "on"), "Master toggle for application email notification service (on/off)"),
                ("email", "sync_failure_email_enabled", "true", "Send automated email notification when data synchronization fails"),
                ("email", "sync_failure_email_recipients", os.getenv("ADMIN_EMAILS", os.getenv("SUPER_ADMIN_EMAIL", "")), "Recipients for data sync failure alerts"),
                ("email", "SMTP_HOST", os.getenv("SMTP_HOST", ""), "SMTP server hostname"),
                ("email", "SMTP_PORT", os.getenv("SMTP_PORT", "587"), "SMTP server port"),
                ("email", "SMTP_USER", os.getenv("SMTP_USER", ""), "SMTP username"),
                ("email", "SMTP_PASSWORD", os.getenv("SMTP_PASSWORD", ""), "SMTP password / app password"),
                ("email", "SMTP_FROM", os.getenv("SMTP_FROM", ""), "SMTP from sender email address"),
                # Scheduler settings
                ("scheduler", "automation_scheduler_enabled", "true", "Master toggle for background automation scheduler"),
                ("scheduler", "ndc_schedule_times", "", "NDC report download scheduled times (24h HH:MM comma-separated)"),
                ("scheduler", "fnf_schedule_times", "", "F&F closed process scheduled times (24h HH:MM comma-separated)"),
                ("scheduler", "sharepoint_sync_schedule_times", "", "SharePoint report ingestion scheduled times"),
                ("email_timing", "email_daily_timing", "10:00", "Default application-wide daily email notification time"),
                ("email_timing", "email_timing_mode", "app_wide", "Email scheduling mode ('app_wide' or 'department_wise')"),
                ("email", "employee_fnf_email_enabled", "on", "Toggle to enable or disable sending F&F settlement documents email directly to the actual separated employee (on/off)"),
                ("email_timing", "employee_fnf_email_timing_mode", "instant", "Timing mode for employee F&F emails: 'instant' or 'scheduled'"),
                ("email_timing", "employee_fnf_email_scheduled_time", "10:00", "Daily scheduled time (HH:MM) to dispatch employee F&F emails when mode is 'scheduled'"),
            ]

            for cat, key, val, desc in default_configs:
                stmt = select(SystemConfiguration).where(SystemConfiguration.config_key == key)
                res = await session.execute(stmt)
                if not res.scalar_one_or_none():
                    stored_val = str(val)
                    if key in ENCRYPTED_CONFIG_KEYS and stored_val:
                        stored_val = encrypt_value(stored_val)
                    session.add(SystemConfiguration(category=cat, config_key=key, config_value=stored_val, description=desc, updated_by="system"))

            # Migrate existing plaintext credentials to AES-256
            await StartupService.encrypt_plaintext_credentials(session)

            canonical_upper = {d.upper(): d for d in APPROVAL_DEPARTMENTS}

            # Remove legacy non-canonical departments
            existing_configs_res = await session.execute(select(EmailDepartmentConfig))
            for existing_cfg in existing_configs_res.scalars().all():
                if existing_cfg.department and existing_cfg.department.strip().upper() not in canonical_upper:
                    await session.delete(existing_cfg)

            default_cc = os.getenv("ADMIN_EMAILS", os.getenv("SUPER_ADMIN_EMAIL", "")).strip()

            for dept_name in APPROVAL_DEPARTMENTS:
                stmt = select(EmailDepartmentConfig).where(
                    EmailDepartmentConfig.department.ilike(dept_name)
                )
                res = await session.execute(stmt)
                if not res.scalar_one_or_none():
                    session.add(EmailDepartmentConfig(
                        department=dept_name,
                        is_enabled=True,
                        cc_recipients=default_cc,
                        scheduled_time="10:00",
                        notification_types="daily_summary,tomorrow_alert,delayed_reminder",
                        notes="",
                    ))

            await session.commit()
            logger.info("System defaults seeded successfully.")
        except Exception as e:
            logger.warning(f"Error seeding system defaults: {e}")
            await session.rollback()

    @staticmethod
    async def seed_super_admins(session: AsyncSession) -> None:
        """Seed or ensure super admin users exist in the database."""
        try:
            super_admin_env = os.getenv("SUPER_ADMIN_EMAIL", "")
            super_admins = [e.strip().lower() for e in super_admin_env.split(",") if e.strip()]
            if not super_admins:
                return

            for sa_email in super_admins:
                stmt = select(NdcUserAccess).where(NdcUserAccess.email == sa_email)
                res = await session.execute(stmt)
                user_access = res.scalar_one_or_none()
                if not user_access:
                    logger.info(f"Seeding super admin: {sa_email}")
                    user_access = NdcUserAccess(
                        email=sa_email,
                        name=sa_email.split('@')[0],
                        role="super_admin",
                        status="approved",
                        hashed_password=hash_password("Adani@123"),
                        approved_at=datetime.now(timezone.utc).replace(tzinfo=None),
                        approved_by="system"
                    )
                    session.add(user_access)
                else:
                    logger.info(f"Ensuring super admin privileges: {sa_email}")
                    user_access.role = "super_admin"
                    user_access.status = "approved"
                    if not user_access.hashed_password:
                        user_access.hashed_password = hash_password("Adani@123")
                    session.add(user_access)
            await session.commit()
        except Exception as e:
            logger.error('Error in seed_super_admins: %s', e, exc_info=True)
            await session.rollback()
            raise HTTPException(status_code=500, detail='An internal error occurred.')

    @staticmethod
    async def seed_demo_admin(session: AsyncSession) -> None:
        """Seed the demo admin user if configured in environment."""
        try:
            demo_email = os.getenv("DEMO_ADMIN_EMAIL", "").strip().lower()
            if not demo_email:
                return

            stmt = select(NdcUserAccess).where(NdcUserAccess.email == demo_email)
            res = await session.execute(stmt)
            demo_admin = res.scalar_one_or_none()
            if not demo_admin:
                logger.info(f"Seeding demo admin: {demo_email}")
                demo_admin = NdcUserAccess(
                    email=demo_email,
                    name=demo_email.split("@")[0],
                    role="admin",
                    status="approved",
                    hashed_password=hash_password("Adani@123"),
                    approved_at=datetime.now(timezone.utc).replace(tzinfo=None),
                    approved_by="system"
                )
                session.add(demo_admin)
            else:
                if not demo_admin.hashed_password:
                    demo_admin.hashed_password = hash_password("Adani@123")
                session.add(demo_admin)
            await session.commit()
        except Exception as e:
            logger.error('Error in seed_demo_admin: %s', e, exc_info=True)
            await session.rollback()
            raise HTTPException(status_code=500, detail='An internal error occurred.')
