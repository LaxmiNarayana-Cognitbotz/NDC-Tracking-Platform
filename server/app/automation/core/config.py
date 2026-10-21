"""
Centralized project configuration and root directory resolution.
"""

from pathlib import Path

# Points directly to the server project root directory
ROOT_DIR = Path(__file__).resolve().parents[3]

# Standard runtime directories created directly in the root directory
UPLOADS_DIR = ROOT_DIR / "uploads"
LOGS_DIR = ROOT_DIR / "logs"
ERRORS_DIR = ROOT_DIR / "errors"
AUTOMATION_PROFILE_DIR = ROOT_DIR / "chrome_automation_profile"

# Ensure core operational directories exist immediately
LOGS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Subdirectories inside uploads/
NDC_REPORTS_DIR = UPLOADS_DIR / "NDC_Reports"
FF_REPORTS_DIR = UPLOADS_DIR / "FF_Reports"
PREJOINING_REPORTS_DIR = UPLOADS_DIR / "Pre_Joining_Reports"

# Subdirectories inside errors/
NDC_ERRORS_DIR = ERRORS_DIR / "NDC_Errors"
FF_ERRORS_DIR = ERRORS_DIR / "FF_Errors"
PREJOINING_ERRORS_DIR = ERRORS_DIR / "Pre_Joining_Errors"

# Helper function to create directories on-demand only when needed
def ensure_dir(directory: Path) -> Path:
    """Ensure a directory exists on-demand and return its path."""
    directory.mkdir(parents=True, exist_ok=True)
    return directory



