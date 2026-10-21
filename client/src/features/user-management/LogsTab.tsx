import { useState, useEffect } from "react";
import axios from "../../lib/axios";
import {
  FileText, Download, Search, RefreshCw, Loader2, CheckCircle2,
  XCircle, AlertTriangle, ChevronLeft, ChevronRight, Eye, FileSpreadsheet,
  Calendar, Clock, Terminal, Building2, Mail, Copy, Check
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import * as XLSX from "xlsx";

interface LogEntry {
  id: number;
  category: "EMAIL" | "AUTOMATION" | "SYNC";
  action_type: string;
  department?: string;
  target_recipient?: string;
  cc_recipients?: string;
  admin_recipients?: string;
  status: "SUCCESS" | "FAILED" | "WARNING" | "RUNNING";
  details?: string;
  error_message?: string;
  duration_seconds?: number;
  created_at: string;
}

export function LogsTab() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  // Human-readable Action & Process label generator
  const formatActionType = (action?: string | null): string => {
    if (!action) return "—";
    const a = action.trim();
    const lower = a.toLowerCase();

    const actionMap: Record<string, string> = {
      // Configuration & System Control
      config_update: "System Configuration Update",
      master_email_toggle: "Master Email Service Toggle",
      employee_fnf_config_update: "Employee F&F Email Settings Update",
      smtp_test: "SMTP Connection Test",
      admin_login: "Administrator Login",
      user_access_approved: "User Access Approved",
      user_access_rejected: "User Access Rejected",
      user_access_requested: "New User Access Request",
      password_reset_email: "Password Reset Request",
      account_approval_token: "Access Approval Notification",

      // Automation Pipelines & Data Sync
      ndc_report_download: "NDC Report Download & Sync",
      fnf_process_closed_reports: "F&F Closed Documents Sync",
      download_ff_report: "F&F Report Download",
      download_prejoining_report: "Pre-Joining Report Download",
      upload_to_sharepoint: "SharePoint Document Upload",
      fnf_download_ids: "Employee Document Download",
      sharepoint_delete_documents: "SharePoint Document Deletion",
      dms_resync_documents: "DMS Document Re-Sync",
      sync_failure_alert: "Sync Failure Alert",

      // Email Dispatch & Alerts
      fnf_details_email: "Employee F&F Settlement Email",
      reminder_ndc_delayed: "Delayed Cases Reminder Email",
      daily_summary_email: "Daily Summary Notification",
      tomorrow_alert_email: "Tomorrow Alerts Notification",
      duplicate_managers_report: "Duplicate Reporting Managers Alert",
      fnf_revision_comment: "F&F Revision Comment Dispatched",
    };

    if (actionMap[lower]) {
      return actionMap[lower];
    }

    if (lower.endsWith("_notification")) {
      const dept = a.replace(/_notification$/i, "").replace(/_/g, " ");
      return `${dept.toUpperCase()} Notification`;
    }

    if (lower.startsWith("reminder_")) {
      const rem = a.replace(/^reminder_/i, "").replace(/_/g, " ");
      return `Reminder – ${rem.charAt(0).toUpperCase() + rem.slice(1)}`;
    }

    return a
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  // Format timestamp into DD/MM/YYYY with clean 12-hour AM/PM time
  const formatTimestamp = (dateStr?: string | null) => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, "0");
      const seconds = String(d.getSeconds()).padStart(2, "0");
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12;
      hours = hours ? hours : 12;
      const strHours = String(hours).padStart(2, "0");
      return `${day}/${month}/${year}, ${strHours}:${minutes}:${seconds} ${ampm}`;
    } catch {
      return dateStr;
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setHasCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setHasCopied(false), 2000);
  };

  const formatDetailsContent = (content?: string | null) => {
    if (!content) return "No execution telemetry details recorded.";
    const trimmed = content.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  };

  const formatDuration = (val: number | null | undefined) => {
    if (val == null) return "—";
    if (val <= 0) return "<0.1s";
    return `${val}s`;
  };

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const res = await axios.get<any>("/api/admin/control/logs", {
        params: {
          category: categoryFilter !== "ALL" ? categoryFilter : undefined,
          status: statusFilter !== "ALL" ? statusFilter : undefined,
          search: search.trim() || undefined,
          page,
          limit,
        },
      });
      const data = res.data?.data || res.data || {};
      setLogs(data.logs || []);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to load audit logs");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [categoryFilter, statusFilter, page]);



  const handleDownloadCsv = async () => {
    setIsDownloading(true);
    try {
      const response = await axios.get("/api/admin/control/logs/download", {
        params: {
          category: categoryFilter !== "ALL" ? categoryFilter : undefined,
          status: statusFilter !== "ALL" ? statusFilter : undefined,
        },
        responseType: "blob",
      });

      const blob = new Blob([response.data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `System_Audit_Logs_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("CSV log file downloaded successfully!");
    } catch {
      toast.error("Failed to download CSV logs");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadExcel = async () => {
    setIsDownloading(true);
    try {
      const res = await axios.get<any>("/api/admin/control/logs", {
        params: {
          category: categoryFilter !== "ALL" ? categoryFilter : undefined,
          status: statusFilter !== "ALL" ? statusFilter : undefined,
          search: search.trim() || undefined,
          page: 1,
          limit: 500,
        },
      });
      const data = res.data?.data?.logs || res.data?.logs || [];
      if (data.length === 0) {
        toast.error("No log records available to export.");
        return;
      }

      const exportRows = data.map((r: LogEntry) => ({
        "Log ID": r.id,
        "Timestamp": formatTimestamp(r.created_at),
        "Category": r.category,
        "Action Type": formatActionType(r.action_type),
        "Department": r.department || "",
        "Target Recipient": r.target_recipient || "",
        "CC Recipients": r.cc_recipients || "",
        "Status": r.status,
        "Duration (s)": formatDuration(r.duration_seconds),
        "Details": r.details || "",
        "Error Message": r.error_message || "",
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Audit Logs");
      XLSX.writeFile(workbook, `System_Audit_Logs_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Excel audit logs downloaded successfully!");
    } catch {
      toast.error("Failed to export Excel logs");
    } finally {
      setIsDownloading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> Success
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3 h-3" /> Failed
          </span>
        );
      case "RUNNING":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <Loader2 className="w-3 h-3 animate-spin" /> Running
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle className="w-3 h-3" /> {status}
          </span>
        );
    }
  };

  const getCategoryBadge = (category: string) => {
    const cat = (category || "").toUpperCase();
    if (cat === "EMAIL") {
      return <span className="text-xs text-foreground font-medium">Email</span>;
    }
    if (cat === "AUTOMATION") {
      return <span className="text-xs text-foreground font-medium">Automation</span>;
    }
    return <span className="text-xs text-foreground font-medium">Data Sync</span>;
  };

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="p-4 rounded-[4px] border border-violet-200 bg-violet-50/70 text-violet-900 flex items-start gap-3">
        <FileText className="w-5 h-5 text-violet-700 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-violet-950">Email Notifications & Automation System Logs</p>
          <p className="text-violet-800 text-xs mt-0.5">
            Transparently track when notification emails are dispatched, recipient delivery statuses, and background automation execution results.
            Inspect detailed diagnostic errors or export logs in Excel or CSV formats for offline review.
          </p>
        </div>
      </div>

      <div className="bg-card rounded-[4px] border border-border overflow-hidden shadow-sm">
        {/* Filter and Download Header */}
        <div className="p-4 border-b border-border bg-muted/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search recipient, pipeline, action..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchLogs()}
                className="pl-9 pr-4 py-1.5 w-full border border-border rounded-[4px] bg-input-background focus:outline-none focus:ring-1 focus:ring-primary text-xs"
              />
            </div>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              className="h-8 px-2.5 rounded-[4px] border border-border bg-card text-foreground text-xs focus:outline-none font-medium"
            >
              <option value="ALL">All Categories</option>
              <option value="EMAIL">Email Notifications</option>
              <option value="AUTOMATION">Automation Pipelines</option>
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="h-8 px-2.5 rounded-[4px] border border-border bg-card text-foreground text-xs focus:outline-none font-medium"
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">Success Only</option>
              <option value="FAILED">Failed Only</option>
              <option value="RUNNING">Running</option>
            </select>


          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={fetchLogs}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border bg-card hover:bg-muted text-foreground text-xs font-semibold rounded-[4px] transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={handleDownloadExcel}
              disabled={isDownloading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-[4px] transition-colors shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
              Export Excel
            </button>
            <button
              onClick={handleDownloadCsv}
              disabled={isDownloading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-[4px] transition-colors shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Export CSV
            </button>
          </div>
        </div>

        {/* Logs Table */}
        <div className="overflow-x-auto w-full">
          <table className="w-full text-xs table-fixed min-w-[850px]">
            <thead className="bg-muted text-foreground border-b border-border">
              <tr>
                <th className="px-4 py-2.5 text-left font-bold text-foreground whitespace-nowrap w-44">Timestamp</th>
                <th className="px-4 py-2.5 text-center font-bold text-foreground w-28">Category</th>
                <th className="px-4 py-2.5 text-left font-bold text-foreground w-64">Action / Process</th>
                <th className="px-4 py-2.5 text-left font-bold text-foreground w-36">Department</th>
                <th className="px-4 py-2.5 text-left font-bold text-foreground">Target / Recipient</th>
                <th className="px-4 py-2.5 text-center font-bold text-foreground w-28">Status</th>
                <th className="px-4 py-2.5 text-center font-bold text-foreground w-24">Duration</th>
                <th className="px-4 py-2.5 text-center font-bold text-foreground w-24">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card text-xs">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground text-xs">
                    No system log entries found matching the selected filters.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    {/* Timestamp in DD/MM/YYYY with clean time */}
                    <td className="px-4 py-2.5 text-left text-muted-foreground whitespace-nowrap font-mono text-[11px] tabular-nums">
                      {formatTimestamp(log.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      {getCategoryBadge(log.category)}
                    </td>
                    <td className="px-4 py-2.5 text-left font-medium text-foreground whitespace-nowrap">
                      {formatActionType(log.action_type)}
                    </td>
                    <td className="px-4 py-2.5 text-left text-muted-foreground">
                      {log.department || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-left text-muted-foreground max-w-[200px] truncate" title={log.target_recipient}>
                      {log.target_recipient || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      {getStatusBadge(log.status)}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatDuration(log.duration_seconds)}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary hover:text-primary-foreground border border-primary/20 rounded transition-all cursor-pointer shadow-2xs"
                        title="View details"
                      >
                        <Eye className="w-3.5 h-3.5 shrink-0" />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground bg-muted/10">
          <div className="flex items-center gap-3">
            <span>Showing page {page} ({logs.length} entries on page)</span>
            <div className="flex items-center gap-1.5">
              <span>Per page:</span>
              <select
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                className="h-7 px-2 rounded border border-border bg-card text-foreground text-xs focus:outline-none"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded border border-border hover:bg-muted disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-semibold px-2">Page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={logs.length < limit}
              className="p-1 rounded border border-border hover:bg-muted disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Log Detail Dialog - Highly Polished & Structured */}
      <Dialog open={Boolean(selectedLog)} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden rounded-lg border border-border shadow-xl">
          <DialogHeader className="p-5 pb-4 border-b border-border bg-muted/30 flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  Audit Log Entry #{selectedLog?.id}
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Execution telemetry and audit details
                </p>
              </div>
            </div>
            {selectedLog && (
              <div className="flex items-center gap-2 pr-6">
                {getCategoryBadge(selectedLog.category)}
                {getStatusBadge(selectedLog.status)}
              </div>
            )}
          </DialogHeader>

          {selectedLog && (
            <div className="p-6 space-y-5 text-xs max-h-[75vh] overflow-y-auto">
              {/* Telemetry Overview Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-lg bg-muted/40 border border-border">
                <div>
                  <span className="text-muted-foreground flex items-center gap-1 text-[10px] font-bold mb-1">
                    <Calendar className="w-3 h-3 text-muted-foreground" /> Timestamp
                  </span>
                  <span className="font-semibold text-foreground font-mono text-[11px]">
                    {formatTimestamp(selectedLog.created_at)}
                  </span>
                </div>

                <div>
                  <span className="text-muted-foreground flex items-center gap-1 text-[10px] font-bold mb-1">
                    <Clock className="w-3 h-3 text-muted-foreground" /> Duration
                  </span>
                  <span className="font-semibold text-foreground font-mono text-[11px]">
                    {formatDuration(selectedLog.duration_seconds)}
                  </span>
                </div>

                <div>
                  <span className="text-muted-foreground flex items-center gap-1 text-[10px] font-bold mb-1">
                    <Terminal className="w-3 h-3 text-muted-foreground" /> Action / Process
                  </span>
                  <span className="text-xs font-semibold text-primary">
                    {formatActionType(selectedLog.action_type)}
                  </span>
                </div>

                <div>
                  <span className="text-muted-foreground flex items-center gap-1 text-[10px] font-bold mb-1">
                    <Building2 className="w-3 h-3 text-muted-foreground" /> Department
                  </span>
                  <span className="font-semibold text-foreground">
                    {selectedLog.department || "—"}
                  </span>
                </div>
              </div>

              {/* Recipients Information (if available) */}
              {(selectedLog.target_recipient || selectedLog.cc_recipients || selectedLog.admin_recipients) && (
                <div className="space-y-3 p-4 rounded-lg bg-card border border-border">
                  <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-primary" /> Recipient Telemetry
                  </h4>

                  {selectedLog.target_recipient && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-[10px] font-bold">
                        Target Recipient (To)
                      </span>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {selectedLog.target_recipient.split(/[,;\s]+/).filter(Boolean).map((em) => (
                          <span key={em} className="px-2 py-0.5 rounded bg-muted font-mono text-[11px] text-foreground border border-border">
                            {em}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedLog.cc_recipients && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-[10px] font-bold">
                        CC Recipients
                      </span>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {selectedLog.cc_recipients.split(/[,;\s]+/).filter(Boolean).map((em) => (
                          <span key={em} className="px-2 py-0.5 rounded bg-muted font-mono text-[11px] text-foreground border border-border">
                            {em}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedLog.admin_recipients && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-[10px] font-bold">
                        Admin Recipients
                      </span>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {selectedLog.admin_recipients.split(/[,;\s]+/).filter(Boolean).map((em) => (
                          <span key={em} className="px-2 py-0.5 rounded bg-muted font-mono text-[11px] text-foreground border border-border">
                            {em}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Execution Details */}
              {selectedLog.details && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground text-xs font-bold flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary" /> Execution Details
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(selectedLog.details || "")}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded hover:bg-muted transition-colors cursor-pointer"
                    >
                      {hasCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{hasCopied ? "Copied" : "Copy Details"}</span>
                    </button>
                  </div>
                  <pre className="p-3.5 bg-muted/40 border border-border rounded-lg text-[11px] font-mono whitespace-pre-wrap max-h-56 overflow-y-auto text-foreground leading-relaxed">
                    {formatDetailsContent(selectedLog.details)}
                  </pre>
                </div>
              )}

              {/* Error Diagnostics (if present) */}
              {selectedLog.error_message && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-rose-700 text-xs font-bold flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5 text-rose-600" /> Error Diagnostics
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(selectedLog.error_message || "")}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] text-rose-700 hover:text-rose-800 border border-rose-300 rounded hover:bg-rose-100 transition-colors cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy Error</span>
                    </button>
                  </div>
                  <pre className="p-3.5 bg-rose-50/80 border border-rose-200 text-rose-900 rounded-lg text-[11px] font-mono whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
                    {formatDetailsContent(selectedLog.error_message)}
                  </pre>
                </div>
              )}

              {/* Dialog Footer */}
              <div className="flex items-center justify-end pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setSelectedLog(null)}
                  className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
