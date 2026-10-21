import { useState } from "react";
import axios from "../../lib/axios";
import {
  FolderSync, Database, Layers,
  Loader2, CheckCircle2, Clock
} from "lucide-react";
import { toast } from "sonner";

export function ManualSyncTab() {
  const [syncingNdc, setSyncingNdc] = useState(false);
  const [syncingFnf, setSyncingFnf] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);

  const [lastResults, setLastResults] = useState<{
    ndc?: string;
    fnf?: string;
    all?: string;
  }>({});

  // Poll a job until it finishes so buttons stay disabled until complete
  const pollJobUntilDone = (jobId: string, actionKey: "ndc" | "fnf" | "all", successMsg: string, setSyncingState: (val: boolean) => void) => {
    const startTime = Date.now();
    const maxWaitMs = 180000;
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
          setSyncingState(false);
          return;
        }

        if (st === "failed") {
          toast.error(job?.error || "Synchronization process failed");
          const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          setLastResults((prev) => ({
            ...prev,
            [actionKey]: `Failed at ${timeStr}: ${job?.error || "Unknown error"}`
          }));
          setSyncingState(false);
          return;
        }

        if (Date.now() - startTime < maxWaitMs) {
          setTimeout(poll, checkIntervalMs);
        } else {
          setSyncingState(false);
        }
      } catch {
        setSyncingState(false);
      }
    };

    setTimeout(poll, checkIntervalMs);
  };

  const handleSyncNdc = async () => {
    setSyncingNdc(true);
    try {
      const res = await axios.post("/api/admin/control/manual-sync/ndc");
      const jobId = res.data?.job_id;
      toast.info("NDC synchronization started in background...");
      if (jobId) {
        pollJobUntilDone(jobId, "ndc", "NDC data synchronization completed successfully!", setSyncingNdc);
      } else {
        setSyncingNdc(false);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "NDC sync failed");
      setSyncingNdc(false);
    }
  };

  const handleSyncFnf = async () => {
    setSyncingFnf(true);
    try {
      const res = await axios.post("/api/admin/control/manual-sync/fnf");
      const jobId = res.data?.job_id;
      toast.info("F&F synchronization started in background...");
      if (jobId) {
        pollJobUntilDone(jobId, "fnf", "F&F synchronization completed successfully!", setSyncingFnf);
      } else {
        setSyncingFnf(false);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "F&F sync failed");
      setSyncingFnf(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      const res = await axios.post("/api/admin/control/manual-sync/all");
      const jobId = res.data?.job_id;
      toast.info("Full system synchronization started in background...");
      if (jobId) {
        pollJobUntilDone(jobId, "all", "Full system synchronization completed successfully!", setSyncingAll);
      } else {
        setSyncingAll(false);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Full system sync failed");
      setSyncingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="p-4 rounded-[4px] border border-emerald-200 bg-emerald-50/70 text-emerald-900 flex items-start gap-3">
        <FolderSync className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-emerald-950">On-Demand Manual Data Synchronization</p>
          <p className="text-emerald-800 text-xs mt-0.5">
            Trigger an immediate manual synchronization at any time to pull fresh separation records from Oracle Fusion,
            sync separation exit sheets, or perform a full system update across the platform.
          </p>
        </div>
      </div>

      {/* Sync Action Grid - Clean 3 Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: NDC Data Synchronization */}
        <div className="bg-card rounded-[4px] border border-border p-6 flex flex-col justify-between space-y-4 hover:border-primary/40 transition-colors shadow-sm">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="p-2.5 rounded-lg bg-blue-50 text-blue-700">
                <Database className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-blue-100 text-blue-800">
                Oracle Fusion
              </span>
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">NDC Data Sync</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Connects to Oracle Fusion, downloads the latest NDC Process Request Status Report, and refreshes all employee separation statuses.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-border">
            {lastResults.ndc && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{lastResults.ndc}</span>
              </div>
            )}
            <button
              onClick={handleSyncNdc}
              disabled={syncingNdc || syncingAll}
              className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-[4px] flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              {syncingNdc ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Syncing NDC Data...</span>
                </>
              ) : (
                <>
                  <FolderSync className="w-4 h-4" />
                  <span>Sync NDC Records Now</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Card 2: F&F Documents Synchronization */}
        <div className="bg-card rounded-[4px] border border-border p-6 flex flex-col justify-between space-y-4 hover:border-emerald-500/40 transition-colors shadow-sm">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-700">
                <Clock className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-emerald-100 text-emerald-800">
                OpenText DMS
              </span>
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">F&F Exit Documents Sync</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Scans active F&F separation records, verifies exit sheet presence in storage, and downloads documents from OpenText Content Server.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-border">
            {lastResults.fnf && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{lastResults.fnf}</span>
              </div>
            )}
            <button
              onClick={handleSyncFnf}
              disabled={syncingFnf || syncingAll}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-[4px] flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              {syncingFnf ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Syncing F&F Documents...</span>
                </>
              ) : (
                <>
                  <FolderSync className="w-4 h-4" />
                  <span>Sync F&F Documents Now</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Card 3: Full System Synchronization */}
        <div className="bg-card rounded-[4px] border border-border p-6 flex flex-col justify-between space-y-4 hover:border-violet-500/40 transition-colors shadow-sm">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="p-2.5 rounded-lg bg-violet-50 text-violet-700">
                <Layers className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-violet-100 text-violet-800">
                Full Sync
              </span>
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">Full System Sync</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Runs an end-to-end refresh across all channels: pulls fresh NDC records, synchronizes exit documents, and re-indexes database tables.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-border">
            {lastResults.all && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{lastResults.all}</span>
              </div>
            )}
            <button
              onClick={handleSyncAll}
              disabled={syncingAll || syncingNdc || syncingFnf}
              className="w-full py-2.5 px-4 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-[4px] flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              {syncingAll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Running Full Sync...</span>
                </>
              ) : (
                <>
                  <Layers className="w-4 h-4" />
                  <span>Trigger Full System Sync</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
