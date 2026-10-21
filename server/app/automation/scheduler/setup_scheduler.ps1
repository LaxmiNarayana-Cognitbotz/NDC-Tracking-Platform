# Setup scheduled tasks for NDC and F&F automation pipelines

param(
    [switch]$Uninstall
)

# ==== Resolve paths ====
$SCHEDULER_DIR = $PSScriptRoot
$AUTOMATION_DIR = Split-Path -Parent $SCHEDULER_DIR
$APP_DIR        = Split-Path -Parent $AUTOMATION_DIR
$SERVER_ROOT    = Split-Path -Parent $APP_DIR

# Locate Python environment
$PYTHON  = Join-Path $SERVER_ROOT ".venv\Scripts\python.exe"
$PYTHONW = Join-Path $SERVER_ROOT ".venv\Scripts\pythonw.exe"

if (-not (Test-Path $PYTHON)) {
    $WORKSPACE_ROOT = Split-Path -Parent $SERVER_ROOT
    $wsPy = Join-Path $WORKSPACE_ROOT ".venv\Scripts\python.exe"
    $wsPyw = Join-Path $WORKSPACE_ROOT ".venv\Scripts\pythonw.exe"
    if (Test-Path $wsPy) {
        $PYTHON  = $wsPy
        $PYTHONW = $wsPyw
    } else {
        $cmdPy = Get-Command python -ErrorAction SilentlyContinue
        if ($cmdPy) {
            $PYTHON = $cmdPy.Source
            $cmdPyw = Get-Command pythonw -ErrorAction SilentlyContinue
            $PYTHONW = if ($cmdPyw) { $cmdPyw.Source } else { $PYTHON }
        }
    }
}

$NDC_MODULE = "app.automation.scripts.automation_scripts.download_ndc_report"
$FNF_MODULE = "app.automation.scripts.processing_scripts.process_fnf_closed_reports"

# Helper function to dynamically uninstall tasks matching a pattern
function Remove-PipelineTasks {
    param(
        [string]$Pattern,
        [switch]$ShowSkip
    )
    
    $foundTasks = Get-ScheduledTask -TaskName $Pattern -ErrorAction SilentlyContinue
    if ($foundTasks) {
        foreach ($t in $foundTasks) {
            $name = $t.TaskName
            try {
                if ($t.State -eq "Running") {
                    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
                }
                Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
                Write-Host "  [CLEAN] Removed: $name" -ForegroundColor Gray
            } catch {
                Write-Host "  [FAIL]  $name : $_" -ForegroundColor Red
            }
        }
    } elseif ($ShowSkip) {
        Write-Host "  [INFO]  No active tasks matching '$Pattern' found." -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "+------------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|         NDC & F&F AUTOMATION - TASK SCHEDULER                          |" -ForegroundColor Cyan
Write-Host "+------------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|  Server Root  : $SERVER_ROOT" -ForegroundColor Gray
Write-Host "|  Interpreter  : $PYTHONW" -ForegroundColor Gray
Write-Host "|  NDC Module   : $NDC_MODULE" -ForegroundColor Gray
Write-Host "|  F&F Module   : $FNF_MODULE" -ForegroundColor Gray
Write-Host "+------------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

# ==== Uninstall mode ====
if ($Uninstall) {
    Write-Host "[ACTION] Uninstalling all automation pipeline tasks..." -ForegroundColor Yellow
    Remove-PipelineTasks -Pattern "*_Pipeline_*" -ShowSkip
    Write-Host "`n[DONE] All tasks uninstalled successfully.`n" -ForegroundColor Green
    exit 0
}

# ==== Check Python exists ====
if (-not (Test-Path $PYTHON)) {
    Write-Host "[ERROR] Python interpreter not found." -ForegroundColor Red
    exit 1
}

# Automatically clean up any existing tasks matching the pattern first
Write-Host "[1/3] Cleaning up previous scheduled tasks..." -ForegroundColor Yellow
Remove-PipelineTasks -Pattern "*_Pipeline_*"

# ==== Query Centralized Schedule Timings Dynamically from Database ====
Write-Host "`n[2/3] Reading dynamic schedule timings from database..." -ForegroundColor Cyan

$ndcTimesRaw = & $PYTHON -c "from app.helpers.config.system_config_service import SystemConfigService; print(SystemConfigService.get_from_db_sync('ndc_schedule_times', ''))"
$fnfTimesRaw = & $PYTHON -c "from app.helpers.config.system_config_service import SystemConfigService; print(SystemConfigService.get_from_db_sync('fnf_schedule_times', ''))"

$ndcTimesRaw = ($ndcTimesRaw | Out-String).Trim()
$fnfTimesRaw = ($fnfTimesRaw | Out-String).Trim()

# Helper to normalize 12-hour or 24-hour into standard trigger time and clean tag
function Convert-ScheduleTime {
    param([string]$RawTime)

    $trimmed = $RawTime.Trim()
    $parsedDate = $null

    # Normalize dot separators between digits (e.g. "10.00" -> "10:00")
    $normalized = $trimmed -replace '(\d{1,2})\.(\d{2})', '$1:$2'

    # Try 12-hour AM/PM formats
    $formats12 = @("h:mm tt", "hh:mm tt", "h tt", "hh tt", "h:mmtt", "hh:mmtt")
    foreach ($fmt in $formats12) {
        try {
            $parsedDate = [datetime]::ParseExact($normalized, $fmt, [System.Globalization.CultureInfo]::InvariantCulture)
            break
        } catch { }
    }

    # Try 24-hour formats
    if (-not $parsedDate) {
        $formats24 = @("H:mm", "HH:mm")
        foreach ($fmt in $formats24) {
            try {
                $parsedDate = [datetime]::ParseExact($normalized, $fmt, [System.Globalization.CultureInfo]::InvariantCulture)
                break
            } catch { }
        }
    }

    # General DateTime parse
    if (-not $parsedDate) {
        try {
            $parsedDate = [datetime]::Parse($normalized, [System.Globalization.CultureInfo]::InvariantCulture)
        } catch {
            $parsedDate = [datetime]::Parse($trimmed)
        }
    }

    $time24 = $parsedDate.ToString("HH:mm", [System.Globalization.CultureInfo]::InvariantCulture)
    $cleanTag = $parsedDate.ToString("HHmm", [System.Globalization.CultureInfo]::InvariantCulture)
    $display12 = $parsedDate.ToString("h:mm tt", [System.Globalization.CultureInfo]::InvariantCulture)
    $triggerDate = Get-Date -Hour $parsedDate.Hour -Minute $parsedDate.Minute -Second 0

    return [PSCustomObject]@{
        TriggerDateTime = $triggerDate
        TriggerTime     = $time24
        CleanTag        = $cleanTag
        DisplayTime     = $display12
    }
}

$ndcTasks = @()
if ($ndcTimesRaw) {
    $ndcScheduleList = $ndcTimesRaw.Trim().Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    foreach ($timeStr in $ndcScheduleList) {
        $converted = Convert-ScheduleTime -RawTime $timeStr
        $ndcTasks += @{
            Pipeline        = "NDC Report"
            Name            = "NDC_Pipeline_$($converted.CleanTag)"
            Time            = $converted.TriggerTime
            TriggerDateTime = $converted.TriggerDateTime
            DisplayTime     = $converted.DisplayTime
        }
    }
} else {
    Write-Host "  [INFO] No NDC_SCHEDULE_TIMES configured in environment." -ForegroundColor Yellow
}

$fnfTasks = @()
if ($fnfTimesRaw) {
    $fnfScheduleList = $fnfTimesRaw.Trim().Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    foreach ($timeStr in $fnfScheduleList) {
        $converted = Convert-ScheduleTime -RawTime $timeStr
        $fnfTasks += @{
            Pipeline        = "F&F Closed"
            Name            = "FNF_Pipeline_$($converted.CleanTag)"
            Time            = $converted.TriggerTime
            TriggerDateTime = $converted.TriggerDateTime
            DisplayTime     = $converted.DisplayTime
        }
    }
} else {
    Write-Host "  [INFO] No FNF_SCHEDULE_TIMES configured in environment." -ForegroundColor Yellow
}

# ==== Task settings ====
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -RestartCount             3 `
    -RestartInterval          (New-TimeSpan -Minutes 5) `
    -MultipleInstances        IgnoreNew `
    -ExecutionTimeLimit       (New-TimeSpan -Hours 2) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

$ndcAction = New-ScheduledTaskAction `
    -Execute   $PYTHONW `
    -Argument  "-m $NDC_MODULE" `
    -WorkingDirectory $SERVER_ROOT

$fnfAction = New-ScheduledTaskAction `
    -Execute   $PYTHONW `
    -Argument  "-m $FNF_MODULE" `
    -WorkingDirectory $SERVER_ROOT

# ==== Register tasks ====
$failed = 0
$registeredTasks = @()

Write-Host "`n[3/3] Registering tasks into Windows Task Scheduler..." -ForegroundColor Cyan

foreach ($t in $ndcTasks) {
    try {
        $trigger = New-ScheduledTaskTrigger -Daily -At $t.TriggerDateTime
        Register-ScheduledTask `
            -TaskName $t.Name `
            -Action   $ndcAction `
            -Trigger  $trigger `
            -Settings $settings `
            -RunLevel Limited `
            -Force -ErrorAction Stop | Out-Null
        
        $registeredTasks += [PSCustomObject]@{
            Pipeline  = $t.Pipeline
            TaskName  = $t.Name
            Schedule  = "$($t.DisplayTime) Daily"
            CatchUp   = "Yes (On Boot)"
            Status    = "READY"
        }
    } catch {
        Write-Host "  [FAIL] $($t.Name): $_" -ForegroundColor Red
        $failed++
    }
}

foreach ($t in $fnfTasks) {
    try {
        $trigger = New-ScheduledTaskTrigger -Daily -At $t.TriggerDateTime
        Register-ScheduledTask `
            -TaskName $t.Name `
            -Action   $fnfAction `
            -Trigger  $trigger `
            -Settings $settings `
            -RunLevel Limited `
            -Force -ErrorAction Stop | Out-Null

        $registeredTasks += [PSCustomObject]@{
            Pipeline  = $t.Pipeline
            TaskName  = $t.Name
            Schedule  = "$($t.DisplayTime) Daily"
            CatchUp   = "Yes (On Boot)"
            Status    = "READY"
        }
    } catch {
        Write-Host "  [FAIL] $($t.Name): $_" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""

# ==== Display Clean Tabular Output ====
if ($registeredTasks.Count -gt 0) {
    Write-Host "+-----------------+----------------------+------------------+-----------------+----------+" -ForegroundColor Green
    Write-Host "| PIPELINE        | TASK NAME            | SCHEDULE         | CATCH-UP (BOOT) | STATUS   |" -ForegroundColor Green
    Write-Host "+-----------------+----------------------+------------------+-----------------+----------+" -ForegroundColor Green
    foreach ($row in $registeredTasks) {
        $col1 = $row.Pipeline.PadRight(15)
        $col2 = $row.TaskName.PadRight(20)
        $col3 = $row.Schedule.PadRight(16)
        $col4 = $row.CatchUp.PadRight(15)
        $col5 = $row.Status.PadRight(8)
        Write-Host "| $col1 | $col2 | $col3 | $col4 | $col5 |" -ForegroundColor White
    }
    Write-Host "+-----------------+----------------------+------------------+-----------------+----------+" -ForegroundColor Green
}

if ($failed -eq 0 -and $registeredTasks.Count -gt 0) {
    Write-Host ""
    Write-Host "[OK] STATUS   : All $($registeredTasks.Count) tasks registered successfully." -ForegroundColor Green
    Write-Host "[OK] POLICY   : Tasks run silently in background via pythonw.exe." -ForegroundColor Green
    Write-Host "[OK] FAILOVER : Missed triggers fire automatically on next boot." -ForegroundColor Green
    Write-Host "[OK] RETRY    : If a run fails for any reason, Task Scheduler retries up to 3 times (5m interval)." -ForegroundColor Green
    Write-Host ""
} elseif ($registeredTasks.Count -eq 0) {
    Write-Host "[INFO] No tasks registered because no schedule times are configured in environment variables." -ForegroundColor Yellow
} else {
    Write-Host "`n[WARNING] $failed task(s) failed to register." -ForegroundColor Yellow
}
