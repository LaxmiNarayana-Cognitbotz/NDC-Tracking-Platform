import asyncio
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Add server root to sys.path before local imports
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
os.chdir(BASE_DIR)

from sqlalchemy import text
from config.database import engine


def run_sync():
    """Synchronize database schema against SQLAlchemy models using Alembic."""
    print("=" * 60)
    print(f"[START] Database Synchronization at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # Ensure alembic/versions directory exists
    versions_dir = BASE_DIR / "alembic" / "versions"
    versions_dir.mkdir(parents=True, exist_ok=True)

    # Locate alembic executable in virtual environment
    alembic_exe = BASE_DIR / ".venv" / "Scripts" / "alembic.exe"
    if not alembic_exe.exists():
        alembic_exe = BASE_DIR / ".venv" / "bin" / "alembic"
    if not alembic_exe.exists():
        alembic_exe = "alembic"

    print("\n[1/3] Checking for pending migrations from database...")
    res_upg_initial = subprocess.run(
        [str(alembic_exe), "upgrade", "head"], 
        capture_output=True, text=True
    )
    if res_upg_initial.returncode != 0:
        if "Can't locate revision identified by" in res_upg_initial.stderr:
            print("[INFO] Orphaned revision hash found in database. Resetting it...")
            try:
                async def _clear():
                    async with engine.begin() as conn:
                        await conn.execute(text("DELETE FROM alembic_version;"))
                asyncio.run(_clear())
                print("[INFO] Reset successful. Continuing with schema sync...")
            except Exception as ex:
                print(f"[WARNING] Could not auto-clear alembic_version: {ex}")
        else:
            print(f"[ERROR] Error applying existing migrations:\n{res_upg_initial.stderr}")
            sys.exit(1)

    rev_msg = f"auto_sync_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    print("\n[2/3] Comparing database schema against SQLAlchemy models...")
    res_gen = subprocess.run(
        [str(alembic_exe), "revision", "--autogenerate", "-m", rev_msg], 
        capture_output=True, text=True
    )

    if res_gen.returncode != 0:
        print(f"[ERROR] Error generating migration:\n{res_gen.stderr}")
        sys.exit(1)

    output = res_gen.stdout + res_gen.stderr
    print(output.strip())

    if "No changes in schema detected" in output:
        print("\n[SUCCESS] Your database is already perfectly in sync with your models!")
        print("=" * 60)
        return

    print("\n[3/3] Applying newly generated schema changes to database...")
    res_upg_final = subprocess.run(
        [str(alembic_exe), "upgrade", "head"], 
        capture_output=True, text=True
    )

    if res_upg_final.returncode != 0:
        print(f"[ERROR] Error applying new migration:\n{res_upg_final.stderr}")
        sys.exit(1)

    print(res_upg_final.stdout.strip())
    print("\n[SUCCESS] Database schema synchronized successfully!")
    print("=" * 60)


if __name__ == "__main__":
    run_sync()
