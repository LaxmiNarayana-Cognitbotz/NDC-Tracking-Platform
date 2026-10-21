"""
Unified Automation Logger Wrapper.
Re-uses the centralized logging system defined in server/config/logger.py.
"""

from config.logger import (
    LOG_DIR,
    setup_logger,
    setup_logging,
    setup_server_logger,
)

__all__ = [
    "LOG_DIR",
    "setup_logger",
    "setup_logging",
    "setup_server_logger",
]
