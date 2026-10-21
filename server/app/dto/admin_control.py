"""Admin control DTO schemas for configuration, schedules, and automation jobs."""

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ConfigUpdateRequest(BaseModel):
    """Payload for updating dynamic configuration key-value pairs."""
    configs: Dict[str, str]


class MasterEmailToggleRequest(BaseModel):
    """Payload for enabling or disabling master email notification service."""
    enabled: bool


class SpecificAutomationToggleRequest(BaseModel):
    """Payload for toggling a specific or master automation job."""
    key: str  # 'master' | 'ndc' | 'fnf' | 'sharepoint_sync'
    enabled: bool


class DepartmentConfigCreateRequest(BaseModel):
    """Payload for registering a department email and CC configuration."""
    department: str
    is_enabled: bool = True
    main_recipient: Optional[str] = None
    main_recipient_name: Optional[str] = None
    cc_recipients: Optional[str] = ""
    scheduled_time: Optional[str] = "10:00"
    notification_types: Optional[str] = "daily_summary,tomorrow_alert,delayed_reminder"
    notes: Optional[str] = ""


class DepartmentConfigUpdateRequest(BaseModel):
    """Payload for updating department email configuration attributes."""
    is_enabled: Optional[bool] = None
    main_recipient: Optional[str] = None
    main_recipient_name: Optional[str] = None
    cc_recipients: Optional[str] = None
    scheduled_time: Optional[str] = None
    notification_types: Optional[str] = None
    notes: Optional[str] = None


class AutomationSchedulesUpdateRequest(BaseModel):
    """Payload for updating background automation schedules."""
    scheduler_enabled: bool
    ndc_schedule_times: str
    fnf_schedule_times: str
    sharepoint_sync_schedule_times: Optional[str] = "10:10,13:10,16:10,19:10"


class ImmediateEmailDispatchRequest(BaseModel):
    """Payload for triggering immediate email notifications."""
    department: Optional[str] = "ALL"


class EmailTimingUpdateRequest(BaseModel):
    """Payload for configuring email notification delivery times."""
    email_daily_timing: str
    email_timing_mode: str
    is_enabled: Optional[bool] = None


class PipelineTarget(str, Enum):
    """Target automation pipeline for SharePoint operations."""
    ALL = "all"
    NDC = "ndc"
    FF = "ff"
    PREJOINING = "prejoining"


class EmployeeDownloadRequest(BaseModel):
    """Payload containing employee IDs for on-demand document download."""
    employee_numbers: List[str] = Field(
        ...,
        description="List of employee IDs to download documents for",
        examples=[["10002440", "10002394"]],
    )


class SharePointUploadRequest(BaseModel):
    """Payload for triggering manual SharePoint uploads."""
    target_pipeline: PipelineTarget = Field(
        default=PipelineTarget.ALL,
        description="Target pipeline to upload ('all', 'ndc', 'ff', 'prejoining')",
        examples=[PipelineTarget.ALL],
    )


class HealthCheckResponse(BaseModel):
    """Response structure for health checks."""
    status: str = "healthy"
    timestamp: str


class AutomationJobResponse(BaseModel):
    """Response payload returned when an automation job is queued."""
    job_id: str
    pipeline: str
    status: str = "queued"
    message: str
    created_at: str


class AutomationJobStatus(BaseModel):
    """Status telemetry and progress details of an automation job."""
    job_id: str
    pipeline: str
    status: str
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_seconds: Optional[float] = None
    result: Optional[Any] = None
    error: Optional[str] = None


class EmployeeFnfEmailConfigRequest(BaseModel):
    """Payload to configure direct employee F&F document email dispatch."""
    enabled: bool
    timing_mode: str = "instant"  # 'instant' | 'scheduled'
    scheduled_time: str = "10:00"  # 'HH:MM'


class EmployeeExitTrackerConfigRequest(BaseModel):
    """Payload to configure employee exit clearance status tracker emails."""
    enabled: bool
    timing_mode: str = "scheduled"  # 'scheduled' | 'instant'
    scheduled_time: str = "10:00"  # 'HH:MM'



