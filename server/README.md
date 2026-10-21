# NDC Tracking Service
## Backend API and Automation Engine Specification

### 1. System Overview

The `server` directory contains the core API, database engine, and automation service for the NDC Tracking Platform. Built with FastAPI, SQLAlchemy 2.0 (AsyncIO), PostgreSQL, and Playwright, it manages the complete data lifecycle of employee separation workflows.

The service provides:
* Automated Ingestion: Ingestion, parsing, and normalization of weekly Excel workbooks (.xlsb and .xlsx) from Microsoft SharePoint Online and Oracle Fusion.
* Clearance State Engine: Status tracking and reconciliation across 13 distinct approval departments with person-level historical record retention.
* Full and Final (F&F) Document Auditing: Automated inspection of SharePoint employee folders to verify required separation documents (Relieving Letters, Service Certificates, F&F Statements).
* Automated Notifications: Multi-tier outbound email communications for daily department digests, approaching last-working-day alerts, SLA breach escalations, and employee document dispatches.
* Python Playwright Automation: Headless Chromium browser automation using Python and Playwright to extract clearance reports from Oracle Fusion and OpenText DMS.
* Security Vault: AES-256 encrypted configuration storage using PBKDF2 key derivation for sensitive credentials in the database.
* Static SPA Delivery: Built-in Single Page Application server mode capable of delivering compiled frontend bundles from `client/dist`.

### 2. Technology Stack and Architecture

| Component | Technology | Specification |
| :--- | :--- | :--- |
| Application Framework | FastAPI | High-performance asynchronous REST API framework |
| ASGI Web Server | Uvicorn | Production-ready ASGI server with async loop integration |
| Persistence Engine | PostgreSQL 14+ | Relational persistence with JSONB and indexed query support |
| ORM Layer | SQLAlchemy 2.0 AsyncIO | Asynchronous session management and query construction |
| Database Driver | asyncpg | High-throughput asynchronous PostgreSQL driver |
| Migration Tooling | Alembic | Declarative schema synchronization and revision versioning |
| Browser Automation | Playwright | Headless Chromium automation for corporate portal reporting |
| SharePoint Client | Office365-REST-Python-Client | Microsoft Graph and SharePoint Online REST integration |
| Workbook Processing | pyxlsb, openpyxl, pandas | High-speed binary and open XML spreadsheet parsing |
| Cryptography & Auth | python-jose, passlib, cryptography | JWT HS256 tokens, bcrypt password hashing, AES-256 salting |

### 3. Prerequisites

The backend requires the following dependencies installed on the host system:

* Python: Version 3.12 or higher
* uv: High-performance Python package and virtual environment manager
* PostgreSQL: Version 14 or higher (local or managed instance)
* Chromium: Headless browser binary managed via Playwright

---

### 4. Installation and Environment Setup

#### Step 4.1: Installing `uv` (If Not Already Installed)

`uv` is an extremely fast package and environment manager built in Rust. If `uv` is not present on your system, install it using the command for your operating system:

* **Windows (PowerShell):**
  ```powershell
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```
* **macOS / Linux:**
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```
* **Cross-Platform Alternative (via standard pip):**
  ```bash
  pip install uv
  ```

Confirm installation:
```bash
uv --version
```

#### Step 4.2: Create and Activate Python Virtual Environment

Navigate to the `server/` directory:
```bash
cd server
```

Create a virtual environment:
```bash
uv venv --python 3.12
```
*(If Python 3.12 is your default interpreter, `uv venv` without flags is sufficient).*

Activate the environment:

* **Windows (PowerShell):**
  ```powershell
  .\.venv\Scripts\Activate.ps1
  ```
  *(Note: If PowerShell displays a script execution policy restriction, run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process`, then re-run the activation script).*
* **Windows (Command Prompt / CMD):**
  ```cmd
  .\.venv\Scripts\activate.bat
  ```
* **Linux / macOS (Bash / Zsh):**
  ```bash
  source .venv/bin/activate
  ```

Your prompt will display `(.venv)` when active.

#### Step 4.3: Install Project Dependencies

Synchronize all packages defined in `pyproject.toml` and `uv.lock`:

```bash
uv sync
```
*(Alternative inside an activated environment: `uv pip install -e .` or `pip install -e .`)*

#### Step 4.4: Install Playwright Chromium Browser

Install the Chromium binary required for Playwright automation report downloads:

```bash
uv run playwright install chromium
```

#### Step 4.5: Provision and Maintain the Mandatory Environment File (`.env`)

Maintaining the `server/.env` file is strictly mandatory. The FastAPI runtime directly loads this file during boot (`app/helpers/startup/lifespan.py`). Without a properly configured `.env` file, database connection pooling fails, password hashing is disabled, and the server refuses to start.

Create your `.env` file from the sample template:

* **Windows (PowerShell):**
  ```powershell
  Copy-Item .env.sample .env
  ```
* **Linux / macOS:**
  ```bash
  cp .env.sample .env
  ```

#### Step 4.6: Configure Mandatory Environment Parameters

Open `server/.env` and supply your database connection and security parameters:

```ini
# PostgreSQL Database Connection (Mandatory)
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ndc_tracking_db
SSL_MODE=prefer

# Authentication & JWT Security (Mandatory)
JWT_SECRET=generate_a_random_32_character_secret_key_here
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=480
RESET_PASSWORD_EXPIRE_MINUTES=60
SUPER_ADMIN_EMAIL=admin@example.com

# Database Cryptographic Vault (Mandatory for credential security)
ENCRYPTION_KEY=replace_with_aes_passphrase_for_database_vault
ENCRYPTION_SALT=replace_with_hex_salt_for_key_derivation

# Outbound SMTP Configuration (Optional for local dev, required for alerts)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password
SMTP_FROM=your_email@gmail.com

# SharePoint Online Credentials (Optional for local dev, required for sync)
SHAREPOINT_TENANT_ID=your_azure_tenant_id
SHAREPOINT_SITE_URL=https://yourcompany.sharepoint.com/sites/hr-ndc
SHAREPOINT_CLIENT_ID=your_azure_client_id
SHAREPOINT_CLIENT_SECRET=your_azure_client_secret
SHAREPOINT_TARGET_FOLDER=Shared Documents/NDC_Reports
SHAREPOINT_REPORTS_SUBFOLDER=Weekly_Ingestion

# Python Playwright Browser Automation
ORACLE_URL=https://oracle-fusion.corporate.domain
CONTENT_SERVER_URL=https://dms.corporate.domain
HEADLESS=true
START_MAXIMIZED=true
```

---

### 5. Database Initialization and Schema Synchronization

The backend utilizes an automated synchronization utility (`scripts/sync_db.py`) that introspects your declarative SQLAlchemy models against the active PostgreSQL database, generates an Alembic migration revision, and applies it immediately:

```bash
uv run .\scripts\sync_db.py
```
*(On Linux/macOS: `uv run python ./scripts/sync_db.py`)*

### 6. Starting the Backend Service

Start the FastAPI application via Uvicorn:

```bash
uv run .\main.py
```
*(On Linux/macOS: `uv run python ./main.py`)*

The service binds to `http://127.0.0.1:8010`.
* Interactive OpenAPI Specification: `http://127.0.0.1:8010/docs`
* ReDoc API Specification: `http://127.0.0.1:8010/redoc`
* Service Health Diagnostic: `http://127.0.0.1:8010/health`

### 7. Automated Seeding and Security Lifecycle

During application startup, the lifespan service (`app/helpers/startup/lifespan.py`) automatically runs:

1. Table Verification: Confirms all declarative model tables exist in PostgreSQL.
2. Super Admin Seeding: Creates the administrative account configured under `SUPER_ADMIN_EMAIL` with default initial password `Adani@123` if not already present.
3. System Configurations Seeding: Initializes baseline scheduler timings, endpoint URLs, and department notification defaults.
4. Cryptographic Vault Migration: Automatically encrypts any legacy plaintext configuration secrets to AES-256 ciphertext.
5. In-Memory Cache Warm-Up: Loads dynamic system settings into memory for sub-millisecond route resolution.

### 8. Background Process Architecture

Upon service startup, five concurrent asynchronous worker tasks are scheduled:

1. `sharepoint_sync_loop`: Polls SharePoint Online document libraries for newly uploaded Excel workbooks and triggers automatic ingestion.
2. `fnf_completed_sync_loop`: Scans SharePoint employee directories to verify the presence of Relieving Letters, Service Certificates, and F&F Statements.
3. `fnf_closed_report_loop`: Reconciles closed separation statuses and manages automated settlement email delivery queues.
4. `email_automation_loop`: Evaluates scheduled notification criteria and dispatches morning summaries, due-date alerts, and SLA breach reminders.
5. `automation_scheduler_loop`: Manages the daily scheduling of Playwright report download jobs based on timestamps configured in the database.

### 9. Python Playwright Automation Engine

Located in `app/automation/`, the Python Playwright automation suite enables automated data retrieval:

* `download_ndc_report.py`: Authenticates into Oracle Fusion via corporate single sign-on, applies designated date range filters, and downloads active clearance workbooks.
* `download_f&f_report.py`: Interfaces with OpenText DMS and Oracle to retrieve completed F&F settlement reports.
* `upload_to_sharepoint.py`: Transports downloaded report artifacts directly into SharePoint Online document libraries.
* `setup_scheduler.ps1`: Optional Windows Task Scheduler configuration script for executing Playwright automation scripts outside the web server.

### 10. Directory Structure

```
server/
├── alembic/                   Database migration definitions and revision history
├── app/
│   ├── auth/                  JWT token encoding, decoding, and password verification
│   ├── automation/            Python Playwright automation engines, process runners, and download scripts
│   ├── cron_jobs/             Asynchronous background loop workers
│   ├── dto/                   Pydantic request and response schemas
│   ├── email_templates/       HTML email templates for notifications and settlement letters
│   ├── helpers/               Domain service logic (Excel parser, SharePoint client, seeding)
│   ├── models/                SQLAlchemy ORM declarative database models
│   ├── modules/               REST API endpoint routers and business logic
│   └── utils/                 Response wrappers, cryptographic helpers, and password utilities
├── config/
│   ├── database.py            SQLAlchemy async engine and sessionmaker configuration
│   └── logger.py              Logging configuration and file loggers
├── docs/
│   └── api_documentation.md   Detailed endpoint catalog and schema reference
├── logs/                      Active server runtime log output directory
├── scripts/
│   ├── manual_sync.py         Immediate one-shot SharePoint ingestion script
│   └── sync_db.py             Automated schema synchronization script
├── spa_server/
│   └── router.py              Production static file server for client/dist SPA assets
├── sql/                       Operational SQL maintenance scripts
├── uploads/                   Local storage directory for manual file uploads
├── .env.sample                Server configuration template
├── alembic.ini                Alembic configuration settings
├── main.py                    Application entry point and FastAPI factory
├── pyproject.toml             Python package dependencies and build definitions
└── uv.lock                    Locked dependency graph for uv package manager
```

### 11. Operational Scripts

#### Database Schema Synchronization
```bash
uv run .\scripts\sync_db.py
```
Applies all pending model changes to the database without manual migration scripting.

#### Manual SharePoint Synchronization
```bash
uv run .\scripts\manual_sync.py
```
Bypasses the background scheduler to immediately poll SharePoint, ingest new workbooks, and synchronize F&F document presence.

### 12. API Documentation and Diagnostics

* Interactive Swagger UI: `http://localhost:8010/docs`
* ReDoc UI: `http://localhost:8010/redoc`
* Health Check Endpoint: `http://localhost:8010/health` (returns `{"status": "ok"}`)
* Detailed API Specification Guide: [docs/api_documentation.md](docs/api_documentation.md)
