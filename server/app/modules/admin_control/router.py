"""Admin control API routes for configurations, scheduler, manual sync, and audit logs."""

import logging
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt_bearer import get_current_user
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
    ImmediateEmailDispatchRequest,
    MasterEmailToggleRequest,
    SpecificAutomationToggleRequest,
)
from app.modules.admin_control.service import AdminControlService
from app.modules.users.service import UsersService
from config.database import get_db

logger = logging.getLogger(__name__)


async def require_super_admin(current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Verify caller has super_admin privileges."""
    try:
        email = current_user.get("sub")
        return await UsersService.verify_super_admin(email, db)
    except Exception as e:
        logger.error(f"Super admin verification error: {e}")
        raise


router = APIRouter(prefix="/api/admin/control", tags=["Admin Portal Control"], dependencies=[Depends(require_super_admin)])


# Credentials & Configuration
@router.get("/config")
async def get_all_configurations(db: AsyncSession = Depends(get_db)):
    """Retrieve all dynamic system configurations grouped by category."""
    try:
        return await AdminControlService.get_all_configurations(db)
    except Exception as e:
        logger.error(f"Error fetching configurations: {e}")
        raise HTTPException(status_code=500, detail="Failed to load configurations.")


@router.put("/config")
async def update_configurations(payload: ConfigUpdateRequest, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Update runtime configurations without modifying files on disk."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.update_configurations(payload, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating configurations: {e}")
        raise HTTPException(status_code=500, detail="Failed to update configurations.")


@router.post("/config/test-smtp")
async def test_smtp_configuration(current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Send a test email to verify configured SMTP credentials."""
    try:
        user_email = current_user.get("sub")
        return await AdminControlService.test_smtp(user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error testing SMTP: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# Email & Department Configurations
@router.get("/email/master-toggle")
async def get_master_email_toggle(db: AsyncSession = Depends(get_db)):
    """Retrieve master application-wide email toggle directly from database."""
    try:
        return await AdminControlService.get_master_email_toggle(db)
    except Exception as e:
        logger.error(f"Error reading master email toggle from DB: {e}")
        return {"enabled": True}


@router.put("/email/master-toggle")
async def set_master_email_toggle(payload: MasterEmailToggleRequest, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Toggle the master application-wide email notification service."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.set_master_email_toggle(payload.enabled, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting master email toggle: {e}")
        raise HTTPException(status_code=500, detail="Failed to toggle master email service.")


@router.post("/email/sync-recipients-to-departments")
async def sync_recipients_to_departments(current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Auto-sync all department emails from Email Recipients tab into Email & CC rules table."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.sync_recipients_to_departments(user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error syncing recipients to departments: {e}")
        raise HTTPException(status_code=500, detail="Failed to sync email recipients to departments.")


@router.get("/email/departments")
async def list_department_email_configs(db: AsyncSession = Depends(get_db)):
    """List all department email and CC management settings."""
    try:
        return await AdminControlService.list_department_configs(db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing department configs: {e}")
        raise HTTPException(status_code=500, detail="Failed to list department configs.")


@router.get("/email/available-departments")
async def get_available_departments(db: AsyncSession = Depends(get_db)):
    """Dynamically get all canonical NDC approval departments."""
    try:
        return await AdminControlService.get_available_departments(db)
    except Exception as e:
        logger.error(f"Error getting departments: {e}")
        return {"departments": []}


@router.post("/email/departments")
async def create_department_email_config(payload: DepartmentConfigCreateRequest, db: AsyncSession = Depends(get_db)):
    """Add a new department email and CC configuration."""
    try:
        return await AdminControlService.create_department_config(payload, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating department config: {e}")
        raise HTTPException(status_code=500, detail="Failed to create department config.")


@router.put("/email/departments/{id}")
async def update_department_email_config(id: int, payload: DepartmentConfigUpdateRequest, db: AsyncSession = Depends(get_db)):
    """Update CC recipients, enabled status, timing, or notifications for a department."""
    try:
        return await AdminControlService.update_department_config(id, payload, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating department config: {e}")
        raise HTTPException(status_code=500, detail="Failed to update department config.")


@router.delete("/email/departments/{id}")
async def delete_department_email_config(id: int, db: AsyncSession = Depends(get_db)):
    """Delete a department email configuration."""
    try:
        return await AdminControlService.delete_department_config(id, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting department config: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete department config.")


# Email Timing
@router.get("/email/timing")
async def get_email_timing_settings():
    """Retrieve email notification delivery schedules."""
    try:
        return AdminControlService.get_email_timing_settings()
    except Exception as e:
        logger.error(f"Error fetching email timing: {e}")
        return {"email_daily_timing": "10:00", "email_timing_mode": "app_wide"}


@router.put("/email/timing")
async def update_email_timing_settings(payload: EmailTimingUpdateRequest, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Configure common or department-wise email notification timings."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.update_email_timing_settings(payload, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating email timing: {e}")
        raise HTTPException(status_code=500, detail="Failed to update email timing.")


# Direct Employee F&F Document Email Settings
@router.get("/email/employee-fnf-config")
async def get_employee_fnf_email_config():
    """Retrieve direct employee F&F document email dispatch settings."""
    try:
        return AdminControlService.get_employee_fnf_email_config()
    except Exception as e:
        logger.error(f"Error reading employee F&F email config: {e}")
        return {"enabled": True, "timing_mode": "instant", "scheduled_time": "10:00"}


@router.put("/email/employee-fnf-config")
async def set_employee_fnf_email_config(payload: EmployeeFnfEmailConfigRequest, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Update direct employee F&F document email dispatch settings."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.set_employee_fnf_email_config(payload, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving employee F&F email config: {e}")
        raise HTTPException(status_code=500, detail="Failed to update employee F&F email settings.")


# Employee Exit Clearance Tracker Email Settings
@router.get("/email/employee-exit-tracker-config")
async def get_employee_exit_tracker_config():
    """Retrieve employee exit clearance tracker email dispatch settings."""
    try:
        return AdminControlService.get_employee_exit_tracker_config()
    except Exception as e:
        logger.error(f"Error reading employee exit tracker config: {e}")
        return {"enabled": True, "timing_mode": "scheduled", "scheduled_time": "10:00"}


@router.put("/email/employee-exit-tracker-config")
async def set_employee_exit_tracker_config(payload: EmployeeExitTrackerConfigRequest, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Update employee exit clearance tracker email dispatch settings."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.set_employee_exit_tracker_config(payload, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving employee exit tracker config: {e}")
        raise HTTPException(status_code=500, detail="Failed to update employee exit tracker settings.")



@router.post("/email/dispatch-now")
async def dispatch_emails_now(payload: Optional[ImmediateEmailDispatchRequest] = None, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Trigger immediate email notifications for all or a specific department."""
    try:
        user_email = current_user.get("sub") or "admin"
        dept = payload.department if payload and payload.department else "ALL"
        return await AdminControlService.dispatch_emails_now(dept, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error dispatching emails: {e}")
        raise HTTPException(status_code=500, detail="Failed to dispatch emails.")


# Automation Schedules & Execution
@router.get("/automation/schedules")
async def get_automation_schedules(db: AsyncSession = Depends(get_db)):
    """Retrieve scheduler timings and individual toggles directly from database."""
    try:
        return await AdminControlService.get_automation_schedules(db)
    except Exception as e:
        logger.error(f"Error getting schedules: {e}")
        return {
            "scheduler_enabled": True,
            "ndc_schedule_times": "",
            "fnf_schedule_times": "",
            "sharepoint_sync_schedule_times": "",
            "ndc_enabled": True,
            "fnf_enabled": True,
            "sharepoint_sync_enabled": True,
        }


@router.put("/automation/schedules")
async def update_automation_schedules(payload: AutomationSchedulesUpdateRequest, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Modify automation execution times and scheduler status."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.update_automation_schedules(payload, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating schedules: {e}")
        raise HTTPException(status_code=500, detail="Failed to update automation schedules.")


@router.get("/automation/master-toggle")
async def get_automation_master_toggle(db: AsyncSession = Depends(get_db)):
    """Retrieve master application-wide automation scheduler toggle directly from database."""
    try:
        return await AdminControlService.get_automation_master_toggle(db)
    except Exception as e:
        logger.error(f"Error reading automation master toggle from DB: {e}")
        return {"enabled": True}


@router.put("/automation/master-toggle")
async def set_automation_master_toggle(payload: MasterEmailToggleRequest, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Toggle the master application-wide background automation scheduler."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.set_automation_master_toggle(payload.enabled, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting automation master toggle: {e}")
        raise HTTPException(status_code=500, detail="Failed to toggle master automation service.")


@router.get("/automation/toggles")
async def get_automation_toggles(db: AsyncSession = Depends(get_db)):
    """Retrieve all specific automation toggles (NDC, F&F, SharePoint sync, master)."""
    try:
        return await AdminControlService.get_automation_toggles(db)
    except Exception as e:
        logger.error(f"Error reading automation toggles: {e}")
        return {
            "master_enabled": True,
            "ndc_enabled": True,
            "fnf_enabled": True,
            "sharepoint_sync_enabled": True,
        }


@router.put("/automation/toggles")
async def set_automation_specific_toggle(payload: SpecificAutomationToggleRequest, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Toggle a specific automation pipeline (ndc, fnf, sharepoint_sync, or master)."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.set_automation_specific_toggle(payload.key, payload.enabled, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating specific automation toggle: {e}")
        raise HTTPException(status_code=500, detail="Failed to update automation toggle.")


@router.post("/automation/run/{pipeline}", response_model=AutomationJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_automation_on_demand(pipeline: str, request: Optional[EmployeeDownloadRequest] = None):
    """Trigger an automation pipeline on demand immediately."""
    try:
        return AdminControlService.run_automation_on_demand(pipeline, request)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error running automation on demand: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/automation/jobs", response_model=Dict[str, AutomationJobStatus])
async def get_all_automation_jobs(db: AsyncSession = Depends(get_db)):
    """Retrieve all active and completed background automation tasks."""
    try:
        return await AdminControlService.list_all_jobs_async(db)
    except Exception as e:
        logger.error(f"Error getting jobs: {e}")
        return {}


@router.get("/automation/jobs/{job_id}", response_model=AutomationJobStatus)
async def get_automation_job(job_id: str):
    """Retrieve execution status for a specific background job ID."""
    try:
        return AdminControlService.get_job_by_id(job_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting job '{job_id}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Manual Data Synchronization
@router.post("/manual-sync/ndc")
async def manual_sync_ndc(from_date: Optional[str] = None, business_unit: Optional[str] = None):
    """Trigger NDC report download, sync to SharePoint, and database ingestion."""
    try:
        job = AdminControlService.run_ndc_download(from_date=from_date, business_unit=business_unit)
        return {"status": "queued", "job_id": job.job_id, "message": "Manual NDC synchronization initiated in background."}
    except Exception as e:
        logger.error(f"Error initiating NDC sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/manual-sync/fnf")
async def manual_sync_fnf():
    """Trigger SharePoint F&F folder sync and exit report processing."""
    try:
        job = AdminControlService.run_fnf_sync_and_process()
        return {"status": "queued", "job_id": job.job_id, "message": "F&F sync initiated in background."}
    except Exception as e:
        logger.error(f"Error initiating F&F sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/manual-sync/sharepoint")
async def manual_sync_sharepoint():
    """Trigger SharePoint check and ingest new report files."""
    try:
        job = AdminControlService.run_sharepoint_sync()
        return {"status": "queued", "job_id": job.job_id, "message": "SharePoint file sync initiated in background."}
    except Exception as e:
        logger.error(f"Error initiating SharePoint sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/manual-sync/all")
async def manual_sync_all():
    """Trigger complete end-to-end synchronization pipeline."""
    try:
        job = AdminControlService.run_full_system_sync()
        return {"status": "queued", "job_id": job.job_id, "message": "Full synchronization initiated in background."}
    except Exception as e:
        logger.error(f"Error initiating full sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# SharePoint Documents
@router.get("/sharepoint/documents")
async def list_sharepoint_documents(search: Optional[str] = None):
    """List employee F&F folders stored in SharePoint."""
    try:
        return await AdminControlService.list_sharepoint_documents(search)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing SharePoint documents: {e}")
        raise HTTPException(status_code=500, detail="Failed to list SharePoint documents.")


@router.delete("/sharepoint/documents/{person_number}")
async def delete_sharepoint_document(person_number: str, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Delete an employee F&F folder from SharePoint."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.delete_sharepoint_document(person_number, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting SharePoint folder: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete folder.")


@router.post("/sharepoint/documents/{person_number}/re-sync")
async def resync_sharepoint_document_from_dms(person_number: str, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Re-download an employee's F&F documents from DMS to SharePoint."""
    try:
        user_email = current_user.get("sub") or "admin"
        return await AdminControlService.resync_sharepoint_document(person_number, user_email, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error re-syncing SharePoint document: {e}")
        raise HTTPException(status_code=500, detail="Failed to re-sync document.")


# System Logs & Export
@router.get("/logs")
async def list_audit_logs(
    category: Optional[str] = Query(None, description="Filter: 'ALL', 'EMAIL', 'AUTOMATION'"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter: 'SUCCESS', 'FAILED', 'WARNING'"),
    search: Optional[str] = Query(None, description="Search keyword in logs"),
    start_date: Optional[str] = Query(None, description="Start date filter (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date filter (YYYY-MM-DD)"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=10000),
    db: AsyncSession = Depends(get_db)
):
    """Query centralized execution and delivery logs."""
    try:
        return await AdminControlService.list_audit_logs(
            category,
            status_filter,
            search,
            start_date,
            end_date,
            page,
            limit,
            db
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching logs: {e}")
        raise HTTPException(status_code=500, detail="Failed to load logs.")


@router.get("/logs/download")
async def download_logs(
    category: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """Download system logs as a CSV file."""
    try:
        return await AdminControlService.export_audit_logs_csv(category, status_filter, start_date, end_date, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading logs: {e}")
        raise HTTPException(status_code=500, detail="Failed to download logs.")
