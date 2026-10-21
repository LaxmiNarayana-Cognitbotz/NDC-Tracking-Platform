import { useState, useEffect } from "react";
import axios from "../../lib/axios";
import {
  Clock, Play, Loader2, CheckCircle2,
  FileText, Users, Database, Layers, FolderSync, Plus, X,
  Save, Power
} from "lucide-react";
import { toast } from "sonner";
import { Switch } from "../../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

const HOURS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

// Convert 24-hour comma-separated string to array of 12-hour AM/PM strings
function parseTo12HourList(times24Str: string): string[] {
  if (!times24Str) return [];
  return times24Str
    .split(",")
    .map((t) => {
      const trimmed = t.trim();
      if (!trimmed) return "";
      if (/am|pm/i.test(trimmed)) return trimmed.toUpperCase();
      const parts = trimmed.split(":");
      if (parts.length < 2) return trimmed;
      let h = parseInt(parts[0], 10);
      const m = parts[1].padStart(2, "0");
      if (isNaN(h)) return trimmed;
      const ampm = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
      return `${String(h).padStart(2, "0")}:${m} ${ampm}`;
    })
    .filter(Boolean);
}

// Convert 12-hour AM/PM string to minutes from midnight for chronological sorting
function time12ToMinutes(time12: string): number {
  const match = time12.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return 0;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = match[3]?.toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

// Convert array of 12-hour AM/PM strings back to 24-hour comma-separated string
function listTo24HourStr(times12List: string[]): string {
  return times12List
    .map((t) => {
      const match = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (!match) return t.trim();
      let h = parseInt(match[1], 10);
      const m = match[2];
      const ampm = match[3]?.toUpperCase();
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return `${String(h).padStart(2, "0")}:${m}`;
    })
    .filter(Boolean)
    .join(", ");
}

export function SchedulerTab() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Master Automation Scheduler state (persisted to DB + cached in localStorage)
  const [schedulerEnabled, setSchedulerEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("ndc_master_automation_enabled");
    return saved !== null ? saved === "true" : true;
  });
  const [isTogglingMaster, setIsTogglingMaster] = useState(false);

  // Specific automation toggles
  const [ndcEnabled, setNdcEnabled] = useState(true);
  const [fnfEnabled, setFnfEnabled] = useState(true);
  const [isTogglingSpecific, setIsTogglingSpecific] = useState<string | null>(null);

  const [ndcTimesList, setNdcTimesList] = useState<string[]>([
    "10:00 AM", "01:00 PM", "03:00 PM", "05:00 PM", "07:00 PM"
  ]);
  const [fnfTimesList, setFnfTimesList] = useState<string[]>([
    "11:00 AM", "04:00 PM"
  ]);

  // Time picker state for NDC (Hours & Minutes only)
  const [ndcHour, setNdcHour] = useState("10");
  const [ndcMinute, setNdcMinute] = useState("00");
  const [ndcAmPm, setNdcAmPm] = useState("AM");

  // Time picker state for F&F (Hours & Minutes only)
  const [fnfHour, setFnfHour] = useState("11");
  const [fnfMinute, setFnfMinute] = useState("00");
  const [fnfAmPm, setFnfAmPm] = useState("AM");

  // Manual Trigger & Sync States
  const [activeSyncAction, setActiveSyncAction] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<{
    ndc?: string;
    fnf?: string;
    all?: string;
    ids?: string;
  }>({});

  // Employee ID modal
  const [isFnfModalOpen, setIsFnfModalOpen] = useState(false);
  const [employeeInput, setEmployeeInput] = useState("");

  const fetchSchedules = async () => {
    try {
      const schedRes = await axios.get<any>("/api/admin/control/automation/schedules");
      const s = schedRes.data?.data || schedRes.data || {};
      const masterOn = Boolean(s.scheduler_enabled);
      setSchedulerEnabled(masterOn);
      localStorage.setItem("ndc_master_automation_enabled", String(masterOn));
      setNdcEnabled(s.ndc_enabled !== undefined ? Boolean(s.ndc_enabled) : true);
      setFnfEnabled(s.fnf_enabled !== undefined ? Boolean(s.fnf_enabled) : true);
      setNdcTimesList(parseTo12HourList(s.ndc_schedule_times || "10:00, 13:00, 15:00, 17:00, 19:00"));
      setFnfTimesList(parseTo12HourList(s.fnf_schedule_times || "11:00, 16:00"));
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to load schedules");
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleMasterAutomation = async (checked: boolean) => {
    setSchedulerEnabled(checked);
    localStorage.setItem("ndc_master_automation_enabled", String(checked));
    setIsTogglingMaster(true);
    try {
      await axios.put("/api/admin/control/automation/master-toggle", { enabled: checked });
      toast.success(checked ? "Master automation scheduler turned on." : "Master automation scheduler turned off.");
    } catch (err: any) {
      setSchedulerEnabled(!checked);
      localStorage.setItem("ndc_master_automation_enabled", String(!checked));
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to toggle master automation.");
    } finally {
      setIsTogglingMaster(false);
    }
  };

  const handleToggleSpecificAutomation = async (key: "ndc" | "fnf", checked: boolean) => {
    if (key === "ndc") setNdcEnabled(checked);
    if (key === "fnf") setFnfEnabled(checked);
    setIsTogglingSpecific(key);
    try {
      await axios.put("/api/admin/control/automation/toggles", { key, enabled: checked });
      toast.success(`${key === "ndc" ? "NDC Download" : "F&F Documents"} automation turned ${checked ? "on" : "off"}.`);
    } catch (err: any) {
      if (key === "ndc") setNdcEnabled(!checked);
      if (key === "fnf") setFnfEnabled(!checked);
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to toggle automation task.");
    } finally {
      setIsTogglingSpecific(null);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  // Time Chip management for NDC
  const handleAddNdcTime = () => {
    const cleanMin = (ndcMinute || "00").padStart(2, "0");
    const formatted = `${ndcHour.padStart(2, "0")}:${cleanMin} ${ndcAmPm}`;
    if (ndcTimesList.includes(formatted)) {
      toast.info(`Time ${formatted} is already scheduled.`);
      return;
    }
    const updated = [...ndcTimesList, formatted].sort((a, b) => time12ToMinutes(a) - time12ToMinutes(b));
    setNdcTimesList(updated);
  };

  const handleRemoveNdcTime = (timeToRemove: string) => {
    setNdcTimesList(ndcTimesList.filter((t) => t !== timeToRemove));
  };

  // Time Chip management for F&F
  const handleAddFnfTime = () => {
    const cleanMin = (fnfMinute || "00").padStart(2, "0");
    const formatted = `${fnfHour.padStart(2, "0")}:${cleanMin} ${fnfAmPm}`;
    if (fnfTimesList.includes(formatted)) {
      toast.info(`Time ${formatted} is already scheduled.`);
      return;
    }
    const updated = [...fnfTimesList, formatted].sort((a, b) => time12ToMinutes(a) - time12ToMinutes(b));
    setFnfTimesList(updated);
  };

  const handleRemoveFnfTime = (timeToRemove: string) => {
    setFnfTimesList(fnfTimesList.filter((t) => t !== timeToRemove));
  };

  // Save schedules to backend
  const handleSaveSchedules = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    try {
      const payload = {
        scheduler_enabled: schedulerEnabled,
        ndc_schedule_times: listTo24HourStr(ndcTimesList),
        fnf_schedule_times: listTo24HourStr(fnfTimesList),
      };

      await axios.put("/api/admin/control/automation/schedules", payload);
      toast.success("Automation execution schedules saved successfully!");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to update schedules");
    } finally {
      setIsSaving(false);
    }
  };

  // Poll a job until it finishes (completed or failed) so buttons stay disabled until complete
  const pollJobUntilDone = async (jobId: string, actionKey: "ndc" | "fnf" | "all" | "ids", successMsg: string) => {
    const startTime = Date.now();
    const maxWaitMs = 180000; // 3 minutes max
    const checkIntervalMs = 1500;

    const poll = async () => {
      try {
        const res = await axios.get<any>(`/api/admin/control/automation/jobs/${jobId}`);
        const job = res.data?.data || res.data;
        const st = (job?.status || "").toLowerCase().trim();

        if (st === "completed") {
          toast.success(successMsg);
          const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          setLastResults((prev) => ({
            ...prev,
            [actionKey]: `Completed at ${timeStr}`
          }));
          setActiveSyncAction(null);
          return;
        }

        if (st === "failed") {
          const rawErr = job?.error || "";
          let cleanReason = "Encountered an execution error";
          if (rawErr.includes("Timeout") || rawErr.includes("PlaywrightTimeout")) {
            cleanReason = "Timed out waiting for portal response";
          } else if (rawErr.includes("Exit code:")) {
            cleanReason = "Execution failed during background run";
          } else if (rawErr.trim()) {
            cleanReason = rawErr.length > 70 ? rawErr.substring(0, 70) + "..." : rawErr;
          }
          toast.error(cleanReason);
          const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          setLastResults((prev) => ({
            ...prev,
            [actionKey]: `Failed at ${timeStr}: ${cleanReason}`
          }));
          setActiveSyncAction(null);
          return;
        }

        // If still queued or running, continue polling
        if (Date.now() - startTime < maxWaitMs) {
          setTimeout(poll, checkIntervalMs);
        } else {
          setActiveSyncAction(null);
        }
      } catch {
        setActiveSyncAction(null);
      }
    };

    setTimeout(poll, checkIntervalMs);
  };

  // Manual Trigger Handlers
  const handleSyncNdc = async () => {
    setActiveSyncAction("ndc");
    try {
      const res = await axios.post("/api/admin/control/manual-sync/ndc");
      const jobId = res.data?.job_id;
      toast.info("NDC synchronization started in background...");
      if (jobId) {
        pollJobUntilDone(jobId, "ndc", "NDC data synchronization completed successfully!");
      } else {
        setActiveSyncAction(null);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "NDC sync failed");
      setActiveSyncAction(null);
    }
  };

  const handleSyncFnf = async () => {
    setActiveSyncAction("fnf");
    try {
      const res = await axios.post("/api/admin/control/manual-sync/fnf");
      const jobId = res.data?.job_id;
      toast.info("F&F synchronization started in background...");
      if (jobId) {
        pollJobUntilDone(jobId, "fnf", "F&F synchronization completed successfully!");
      } else {
        setActiveSyncAction(null);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "F&F sync failed");
      setActiveSyncAction(null);
    }
  };

  const handleSyncAll = async () => {
    setActiveSyncAction("all");
    try {
      const res = await axios.post("/api/admin/control/manual-sync/all");
      const jobId = res.data?.job_id;
      toast.info("Full system synchronization started in background...");
      if (jobId) {
        pollJobUntilDone(jobId, "all", "Full system synchronization completed successfully!");
      } else {
        setActiveSyncAction(null);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Full system sync failed");
      setActiveSyncAction(null);
    }
  };

  const handleTriggerFnfByIds = async (e: React.FormEvent) => {
    e.preventDefault();
    const ids = employeeInput
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      toast.error("Please enter at least one employee person number.");
      return;
    }
    setActiveSyncAction("ids");
    try {
      const res = await axios.post("/api/admin/control/automation/run/fnf_download_ids", { employee_numbers: ids });
      const jobId = res.data?.job_id || res.data?.data?.job_id;
      toast.info(`Download queued for ${ids.length} employee(s)...`);
      setIsFnfModalOpen(false);
      setEmployeeInput("");
      if (jobId) {
        pollJobUntilDone(jobId, "ids", `Downloaded documents for ${ids.length} employee(s) successfully!`);
      } else {
        setActiveSyncAction(null);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to trigger download by IDs");
      setActiveSyncAction(null);
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm font-medium">Loading automation schedules & sync status...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. On-Demand Execution & Manual Sync Cards */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: NDC Report & Clearance Sync */}
          <div className="bg-card rounded-lg border border-border p-5 flex flex-col justify-between space-y-4 hover:border-primary/40 transition-colors shadow-sm">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-md bg-primary/10 text-primary">
                  <Database className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                  Oracle Fusion
                </span>
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">NDC Report Sync</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Downloads latest clearance status report from Oracle Fusion and updates platform database.
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              {lastResults.ndc && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
                  <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                  <span className="truncate">{lastResults.ndc}</span>
                </div>
              )}
              <button
                onClick={handleSyncNdc}
                disabled={activeSyncAction !== null}
                className="w-full py-2 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {activeSyncAction === "ndc" ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Syncing NDC...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Run NDC Sync Now</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Card 2: F&F Exit Documents Sync */}
          <div className="bg-card rounded-lg border border-border p-5 flex flex-col justify-between space-y-4 hover:border-primary/40 transition-colors shadow-sm">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-md bg-primary/10 text-primary">
                  <FileText className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                  OpenText DMS
                </span>
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">F&F Documents Sync</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Scans active F&F separation records and downloads exit sheets directly from OpenText DMS.
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              {lastResults.fnf && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
                  <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                  <span className="truncate">{lastResults.fnf}</span>
                </div>
              )}
              <button
                onClick={handleSyncFnf}
                disabled={activeSyncAction !== null}
                className="w-full py-2 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {activeSyncAction === "fnf" ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Syncing F&F...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Run F&F Sync Now</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Card 3: Specific Employees F&F Download */}
          <div className="bg-card rounded-lg border border-border p-5 flex flex-col justify-between space-y-4 hover:border-primary/40 transition-colors shadow-sm">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-md bg-primary/10 text-primary">
                  <Users className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                  On-Demand
                </span>
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">Download by IDs</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Enter specific employee person numbers to retrieve their exit documents on demand.
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              {lastResults.ids && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
                  <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                  <span className="truncate">{lastResults.ids}</span>
                </div>
              )}
              <button
                onClick={() => { setEmployeeInput(""); setIsFnfModalOpen(true); }}
                disabled={activeSyncAction !== null}
                className="w-full py-2 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Download by IDs</span>
              </button>
            </div>
          </div>

          {/* Card 4: Full System Synchronization */}
          <div className="bg-card rounded-lg border border-border p-5 flex flex-col justify-between space-y-4 hover:border-primary/40 transition-colors shadow-sm">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-md bg-primary/10 text-primary">
                  <Layers className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                  Full Pipeline
                </span>
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">Full System Sync</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  End-to-end sync across Oracle Fusion, OpenText DMS, and SharePoint directories.
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              {lastResults.all && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
                  <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                  <span className="truncate">{lastResults.all}</span>
                </div>
              )}
              <button
                onClick={handleSyncAll}
                disabled={activeSyncAction !== null}
                className="w-full py-2 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {activeSyncAction === "all" ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Syncing All...</span>
                  </>
                ) : (
                  <>
                    <FolderSync className="w-3.5 h-3.5" />
                    <span>Full System Sync</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Configurable Automation Schedule Timings */}
      <form onSubmit={handleSaveSchedules} className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
        {/* Header with Master Automation Switch */}
        <div className="p-4 border-b border-border bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Power className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Master Automation Service</h2>
              <p className="text-xs text-muted-foreground">
                Automated background tasks run at scheduled times daily to fetch fresh reports
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={schedulerEnabled}
              onCheckedChange={handleToggleMasterAutomation}
              disabled={isTogglingMaster}
            />
          </div>
        </div>

        {/* Schedule Cards Grid */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Section A: NDC Report Download Timings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider block">
                NDC Report Download Schedule
              </span>
              <div className="flex items-center gap-2">
                <Switch
                  checked={schedulerEnabled && ndcEnabled}
                  disabled={!schedulerEnabled || isTogglingSpecific === "ndc"}
                  onCheckedChange={(val) => handleToggleSpecificAutomation("ndc", val)}
                  title={!schedulerEnabled ? "Master automation is currently paused" : undefined}
                />
              </div>
            </div>

            {/* Active Time Chips & Inline Radix Time Selector (Always opens top side, NO colons) */}
            <div className="p-4 rounded-lg border border-border bg-background space-y-3">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Active Execution Times:
              </span>
              <div className="flex flex-wrap gap-2 min-h-[34px] items-center">
                {ndcTimesList.length === 0 ? (
                  <span className="text-xs text-muted-foreground italic">No times scheduled. Select a time below.</span>
                ) : (
                  ndcTimesList.map((time) => (
                    <span
                      key={time}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary border border-primary/20 shadow-xs"
                    >
                      <Clock className="w-3 h-3 text-primary" />
                      {time}
                      <button
                        type="button"
                        onClick={() => handleRemoveNdcTime(time)}
                        className="text-primary hover:text-red-500 transition-colors ml-0.5 cursor-pointer"
                        title={`Remove ${time}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))
                )}
              </div>

              {/* Seamless Inline Time Picker (Always opens top, NO colons, hours & minutes only) */}
              <div className="pt-3 border-t border-border/70 flex flex-wrap items-center gap-2">
                {/* Hour Dropdown - Opens Top */}
                <Select value={ndcHour} onValueChange={setNdcHour}>
                  <SelectTrigger className="w-16 h-8 text-xs font-mono bg-card px-2 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus-visible:outline-none focus-visible:border-border">
                    <SelectValue placeholder="Hour" />
                  </SelectTrigger>
                  <SelectContent side="top" className="min-w-16 w-16 max-h-44 p-0.5">
                    {HOURS.map((h) => (
                      <SelectItem key={h} value={h} className="text-xs font-mono py-1 pr-5 pl-2">
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Minute Dropdown - Opens Top (No colons) */}
                <Select value={ndcMinute} onValueChange={setNdcMinute}>
                  <SelectTrigger className="w-16 h-8 text-xs font-mono bg-card px-2 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus-visible:outline-none focus-visible:border-border">
                    <SelectValue placeholder="Min" />
                  </SelectTrigger>
                  <SelectContent side="top" className="min-w-16 w-16 max-h-44 p-0.5">
                    {MINUTES.map((m) => (
                      <SelectItem key={m} value={m} className="text-xs font-mono py-1 pr-5 pl-2">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* AM / PM Segmented Control */}
                <div className="inline-flex rounded-md border border-border overflow-hidden bg-card p-0.5">
                  <button
                    type="button"
                    onClick={() => setNdcAmPm("AM")}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-colors cursor-pointer ${
                      ndcAmPm === "AM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => setNdcAmPm("PM")}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-colors cursor-pointer ${
                      ndcAmPm === "PM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    PM
                  </button>
                </div>

                {/* Add Time Button */}
                <button
                  type="button"
                  onClick={handleAddNdcTime}
                  className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md transition-colors cursor-pointer ml-auto sm:ml-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Time
                </button>
              </div>
            </div>
          </div>

          {/* Section B: F&F Document Download Timings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider block">
                F&F Document Download Schedule
              </span>
              <div className="flex items-center gap-2">
                <Switch
                  checked={schedulerEnabled && fnfEnabled}
                  disabled={!schedulerEnabled || isTogglingSpecific === "fnf"}
                  onCheckedChange={(val) => handleToggleSpecificAutomation("fnf", val)}
                  title={!schedulerEnabled ? "Master automation is currently paused" : undefined}
                />
              </div>
            </div>

            {/* Active Time Chips & Inline Radix Time Selector (Always opens top side, NO colons) */}
            <div className="p-4 rounded-lg border border-border bg-background space-y-3">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Active Execution Times:
              </span>
              <div className="flex flex-wrap gap-2 min-h-[34px] items-center">
                {fnfTimesList.length === 0 ? (
                  <span className="text-xs text-muted-foreground italic">No times scheduled. Select a time below.</span>
                ) : (
                  fnfTimesList.map((time) => (
                    <span
                      key={time}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary border border-primary/20 shadow-xs"
                    >
                      <Clock className="w-3 h-3 text-primary" />
                      {time}
                      <button
                        type="button"
                        onClick={() => handleRemoveFnfTime(time)}
                        className="text-primary hover:text-red-500 transition-colors ml-0.5 cursor-pointer"
                        title={`Remove ${time}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))
                )}
              </div>

              {/* Seamless Inline Time Picker (Always opens top, NO colons, hours & minutes only) */}
              <div className="pt-3 border-t border-border/70 flex flex-wrap items-center gap-2">
                {/* Hour Dropdown - Opens Top */}
                <Select value={fnfHour} onValueChange={setFnfHour}>
                  <SelectTrigger className="w-16 h-8 text-xs font-mono bg-card px-2 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus-visible:outline-none focus-visible:border-border">
                    <SelectValue placeholder="Hour" />
                  </SelectTrigger>
                  <SelectContent side="top" className="min-w-16 w-16 max-h-44 p-0.5">
                    {HOURS.map((h) => (
                      <SelectItem key={h} value={h} className="text-xs font-mono py-1 pr-5 pl-2">
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Minute Dropdown - Opens Top (No colons) */}
                <Select value={fnfMinute} onValueChange={setFnfMinute}>
                  <SelectTrigger className="w-16 h-8 text-xs font-mono bg-card px-2 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus-visible:outline-none focus-visible:border-border">
                    <SelectValue placeholder="Min" />
                  </SelectTrigger>
                  <SelectContent side="top" className="min-w-16 w-16 max-h-44 p-0.5">
                    {MINUTES.map((m) => (
                      <SelectItem key={m} value={m} className="text-xs font-mono py-1 pr-5 pl-2">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* AM / PM Segmented Control */}
                <div className="inline-flex rounded-md border border-border overflow-hidden bg-card p-0.5">
                  <button
                    type="button"
                    onClick={() => setFnfAmPm("AM")}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-colors cursor-pointer ${
                      fnfAmPm === "AM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => setFnfAmPm("PM")}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-colors cursor-pointer ${
                      fnfAmPm === "PM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    PM
                  </button>
                </div>

                {/* Add Time Button */}
                <button
                  type="button"
                  onClick={handleAddFnfTime}
                  className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md transition-colors cursor-pointer ml-auto sm:ml-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Time
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Clean Save Button (Single button, no reset, no verbose message) */}
        <div className="p-4 bg-muted/20 border-t border-border flex items-center justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs rounded-md shadow-sm transition-all cursor-pointer disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>Save</span>
          </button>
        </div>
      </form>

      {/* F&F Download Modal */}
      <Dialog open={isFnfModalOpen} onOpenChange={setIsFnfModalOpen}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <DialogTitle>Download F&F Documents by Employee IDs</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTriggerFnfByIds} className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Employee Person Numbers (Comma, space, or line-separated)
              </label>
              <textarea
                required
                rows={4}
                value={employeeInput}
                onChange={(e) => setEmployeeInput(e.target.value)}
                placeholder="30012345&#10;30067890&#10;30045678"
                className="w-full p-3 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsFnfModalOpen(false)}
                className="px-4 py-2 border border-border rounded-md text-xs font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={activeSyncAction === "ids"}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90"
              >
                {activeSyncAction === "ids" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Start Download
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
