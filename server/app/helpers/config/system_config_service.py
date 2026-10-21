"""System configuration service for runtime dynamic configurations and caching."""

import asyncio
import logging
import os
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email_department_config import EmailDepartmentConfig
from app.models.system_configuration import SystemConfiguration
from app.utils.crypto import ENCRYPTED_CONFIG_KEYS, decrypt_value, encrypt_value
from config.database import async_session

logger = logging.getLogger(__name__)

# In-memory configuration caches
_CONFIG_CACHE: Dict[str, str] = {}
_DEPT_CONFIG_CACHE: Dict[str, Dict[str, Any]] = {}


class SystemConfigService:
    """Service to load, cache, and update system configurations dynamically."""

    @classmethod
    async def load_all_to_cache(cls) -> None:
        """Load all configurations and department settings from database into cache."""
        try:
            async with async_session() as session:
                res = await session.execute(select(SystemConfiguration))
                rows = res.scalars().all()
                for row in rows:
                    if row.config_value is not None:
                        val = row.config_value
                        if row.config_key in ENCRYPTED_CONFIG_KEYS:
                            val = decrypt_value(val) or ""
                        _CONFIG_CACHE[row.config_key] = val
                        os.environ[row.config_key] = val
                logger.info(f"Loaded {len(rows)} system configuration(s) into cache.")

                dept_res = await session.execute(select(EmailDepartmentConfig))
                dept_rows = dept_res.scalars().all()
                for dept in dept_rows:
                    if dept.department:
                        cls.cache_department_config(dept)
                logger.info(f"Loaded {len(dept_rows)} department email configuration(s) into cache.")
        except Exception as e:
            logger.warning(f"Could not load system configurations to cache: {e}")

    @classmethod
    def cache_department_config(cls, dept_obj: Any) -> None:
        """Cache an EmailDepartmentConfig model instance."""
        try:
            dept_name = getattr(dept_obj, "department", "").strip().upper()
            if dept_name:
                _DEPT_CONFIG_CACHE[dept_name] = {
                    "id": getattr(dept_obj, "id", None),
                    "is_enabled": getattr(dept_obj, "is_enabled", True),
                    "cc_recipients": getattr(dept_obj, "cc_recipients", "") or "",
                    "scheduled_time": getattr(dept_obj, "scheduled_time", "10:00"),
                    "notification_types": getattr(dept_obj, "notification_types", "") or "",
                }
        except Exception as e:
            logger.error(f"Error caching department config: {e}")

    @classmethod
    def remove_cached_department_config(cls, dept_name: str) -> None:
        """Remove a department configuration from in-memory cache."""
        try:
            norm = (dept_name or "").strip().upper()
            _DEPT_CONFIG_CACHE.pop(norm, None)
        except Exception as e:
            logger.error(f"Error removing cached department config: {e}")

    @classmethod
    def get_department_cc(cls, department: str) -> list[str]:
        """Return CC email list for a department from cache."""
        try:
            norm = (department or "").strip().upper()
            cfg = _DEPT_CONFIG_CACHE.get(norm)
            if not cfg and norm in ("F&F", "FNF", "FNF TEAM"):
                cfg = _DEPT_CONFIG_CACHE.get("F&F TEAM")
            if not cfg and norm in ("GCC", "GCC HR"):
                cfg = _DEPT_CONFIG_CACHE.get("GCC HR")

            if cfg and cfg.get("cc_recipients"):
                raw = cfg["cc_recipients"]
                return [e.strip() for e in raw.replace(";", ",").split(",") if e.strip()]
            return []
        except Exception as e:
            logger.error(f"Error getting department CC list: {e}")
            return []

    @classmethod
    def is_department_email_enabled(cls, department: str) -> bool:
        """Check if email notifications are enabled for the department."""
        try:
            norm = (department or "").strip().upper()
            cfg = _DEPT_CONFIG_CACHE.get(norm)
            if not cfg and norm in ("F&F", "FNF", "FNF TEAM"):
                cfg = _DEPT_CONFIG_CACHE.get("F&F TEAM")
            if not cfg and norm in ("GCC", "GCC HR"):
                cfg = _DEPT_CONFIG_CACHE.get("GCC HR")
            if cfg is not None:
                return bool(cfg.get("is_enabled", True))
            return True
        except Exception as e:
            logger.error(f"Error checking if department email is enabled: {e}")
            return True

    @classmethod
    def get(cls, key: str, default: Optional[str] = None) -> str:
        """Return configuration value from cache, falling back to os.getenv then default."""
        try:
            if key in _CONFIG_CACHE:
                return _CONFIG_CACHE[key]
            # Service account credentials are only configured via UI/database
            if key in ("ORACLE_EMAIL", "ORACLE_PASSWORD"):
                return default or ""
            return os.getenv(key, default or "")
        except Exception as e:
            logger.error(f"Error getting config '{key}': {e}")
            return default or ""

    @classmethod
    def get_bool(cls, key: str, default: bool = False) -> bool:
        """Parse configuration value as boolean."""
        try:
            val = cls.get(key, str(default)).strip().lower()
            return val in ("true", "1", "yes", "on", "t")
        except Exception as e:
            logger.error(f"Error getting boolean config '{key}': {e}")
            return default

    @classmethod
    async def get_from_db(cls, key: str, default: str = "") -> str:
        """Directly query the database for a dynamic runtime configuration."""
        try:
            async with async_session() as session:
                stmt = select(SystemConfiguration.config_value).where(SystemConfiguration.config_key == key)
                res = await session.execute(stmt)
                val = res.scalar_one_or_none()
                return val if val is not None else default
        except Exception as e:
            logger.error(f"Error querying config '{key}' from db: {e}")
            return default

    @classmethod
    def get_from_db_sync(cls, key: str, default: str = "") -> str:
        """Synchronously query the database for a dynamic configuration."""
        try:
            return asyncio.run(cls.get_from_db(key, default))
        except Exception as e:
            logger.error(f"Error querying config '{key}' from db synchronously: {e}")
            return default

    @classmethod
    async def set_config(
        cls,
        key: str,
        value: str,
        category: str = "general",
        description: Optional[str] = None,
        updated_by: Optional[str] = None,
        db: Optional[AsyncSession] = None,
    ) -> None:
        """Update or create a configuration in database and cache."""
        try:
            async def _do_update(session: AsyncSession):
                db_stored_val = value
                if key in ENCRYPTED_CONFIG_KEYS and value:
                    db_stored_val = encrypt_value(value)

                stmt = select(SystemConfiguration).where(SystemConfiguration.config_key == key)
                res = await session.execute(stmt)
                cfg = res.scalar_one_or_none()
                if not cfg:
                    cfg = SystemConfiguration(
                        category=category,
                        config_key=key,
                        config_value=db_stored_val,
                        description=description,
                        updated_by=updated_by,
                    )
                    session.add(cfg)
                else:
                    cfg.config_value = db_stored_val
                    if category:
                        cfg.category = category
                    if description:
                        cfg.description = description
                    cfg.updated_by = updated_by
                await session.commit()
                _CONFIG_CACHE[key] = value
                os.environ[key] = value

            if db:
                await _do_update(db)
            else:
                async with async_session() as s:
                    await _do_update(s)
        except Exception as e:
            logger.error(f"Failed to set config '{key}': {e}")
            raise

    @classmethod
    async def get_all_grouped(cls, db: AsyncSession) -> Dict[str, Dict[str, Any]]:
        """Return all configurations grouped by category."""
        try:
            res = await db.execute(select(SystemConfiguration))
            rows = res.scalars().all()
            grouped: Dict[str, Dict[str, Any]] = {}
            for row in rows:
                cat = row.category or "general"
                if cat not in grouped:
                    grouped[cat] = {}
                val = row.config_value
                if row.config_key in ENCRYPTED_CONFIG_KEYS and val:
                    val = decrypt_value(val)
                grouped[cat][row.config_key] = {
                    "value": val,
                    "description": row.description,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                    "updated_by": row.updated_by,
                }
            return grouped
        except Exception as e:
            logger.error(f"Failed to fetch grouped configurations: {e}")
            return {}
