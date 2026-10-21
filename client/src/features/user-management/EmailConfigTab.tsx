import { useState, useEffect } from "react";
import axios from "../../lib/axios";
import {
  Pencil, Trash2, Power,
  Loader2, Mail, Save,
  SendHorizontal, Clock, Search, X, Plus
} from "lucide-react";
import { toast } from "sonner";
import { Switch } from "../../components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

interface DeptConfig {
  id: number;
  department: string;
  is_enabled: boolean;
  cc_recipients: string;
  scheduled_time: string;
  notification_types?: string;
  notes?: string;
  main_recipient?: string;
  main_recipient_name?: string;
}

interface EmailRecipientItem {
  id: string | number;
  name?: string;
  email: string;
  department: string;
  role?: string;
}

function cleanAndDedupeEmails(raw: string): string {
  if (!raw) return "";
  const parts = raw
    .split(/[\n,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const unique = Array.from(new Set(parts));
  return unique.join(", ");
}

const HOURS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

const CANONICAL_APPROVAL_DEPARTMENTS = [
  "RM",
  "IT",
  "Abex",
  "Telecom",
  "Store",
  "Safety",
  "Administration",
  "Security",
  "HR",
  "GCC HR",
  "Business Specific",
  "Final Abex",
  "Legatrix",
  "F&F Team",
];

// Format department name into proper title case while preserving platform acronyms
function formatDeptName(dept: string): string {
  if (!dept) return "";
  const d = dept.trim();
  const upper = d.toUpperCase();
  if (upper === "IT" || upper === "HR" || upper === "RM" || upper === "GCC HR") {
    return upper;
  }
  if (upper === "ABEX") return "Abex";
  if (upper === "FINAL ABEX") return "Final Abex";
  if (upper === "F&F TEAM" || upper === "F&F") return "F&F Team";
  if (upper === "BUSINESS SPECIFIC") return "Business Specific";
  if (upper === "LEGATRIX") return "Legatrix";

  return d
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

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

// Helper to suggest the next natural available hour when a time is added
function getNextHourSuggestion(currentList: string[]): { hour: string; minute: string; ampm: string } {
  const commonSequence = [
    { hour: "10", minute: "00", ampm: "AM" },
    { hour: "11", minute: "00", ampm: "AM" },
    { hour: "12", minute: "00", ampm: "PM" },
    { hour: "01", minute: "00", ampm: "PM" },
    { hour: "02", minute: "00", ampm: "PM" },
    { hour: "03", minute: "00", ampm: "PM" },
    { hour: "04", minute: "00", ampm: "PM" },
    { hour: "05", minute: "00", ampm: "PM" },
    { hour: "06", minute: "00", ampm: "PM" },
    { hour: "07", minute: "00", ampm: "PM" },
    { hour: "08", minute: "00", ampm: "AM" },
    { hour: "09", minute: "00", ampm: "AM" },
  ];
  for (const item of commonSequence) {
    const formatted = `${item.hour}:${item.minute} ${item.ampm}`;
    if (!currentList.includes(formatted)) {
      return item;
    }
  }
  return { hour: "10", minute: "00", ampm: "AM" };
}
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

export function EmailConfigTab() {
  const [isLoading, setIsLoading] = useState(true);
  const [departments, setDepartments] = useState<DeptConfig[]>([]);
  const [platformDepartments, setPlatformDepartments] = useState<string[]>([]);
  const [availableRecipients, setAvailableRecipients] = useState<EmailRecipientItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Master Email Service Toggle (persisted directly to database + cached in localStorage)
  const [masterEmailEnabled, setMasterEmailEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("ndc_master_email_enabled");
    return saved !== null ? saved === "true" : true;
  });
  const [isTogglingMaster, setIsTogglingMaster] = useState(false);

  // Email Timing Settings (Common vs Department-Wise)
  const [clearanceRemindersEnabled, setClearanceRemindersEnabled] = useState(true);
  const [timingMode, setTimingMode] = useState<"app_wide" | "department_wise">("app_wide");
  const [commonTimesList, setCommonTimesList] = useState<string[]>(["10:00 AM"]);
  const [commonHour, setCommonHour] = useState("10");
  const [commonMinute, setCommonMinute] = useState("00");
  const [commonAmPm, setCommonAmPm] = useState("AM");
  const [isSavingTiming, setIsSavingTiming] = useState(false);

  // Dynamic Sender From Email
  const [smtpFrom, setSmtpFrom] = useState("");
  const [isSavingFrom, setIsSavingFrom] = useState(false);

  // Direct Employee F&F Document Email
  const [employeeFnfEnabled, setEmployeeFnfEnabled] = useState(true);
  const [employeeFnfTimingMode, setEmployeeFnfTimingMode] = useState<"instant" | "scheduled">("instant");
  const [empFnfTimesList, setEmpFnfTimesList] = useState<string[]>(["10:00 AM"]);
  const [empFnfHour, setEmpFnfHour] = useState("10");
  const [empFnfMinute, setEmpFnfMinute] = useState("00");
  const [empFnfAmPm, setEmpFnfAmPm] = useState("AM");
  const [isSavingEmpFnf, setIsSavingEmpFnf] = useState(false);

  // Employee Exit Clearance Status Tracker Email
  const [exitTrackerEnabled, setExitTrackerEnabled] = useState(true);
  const [exitTrackerTimingMode, setExitTrackerTimingMode] = useState<"instant" | "scheduled">("scheduled");
  const [exitTrackerTimesList, setExitTrackerTimesList] = useState<string[]>(["10:00 AM"]);
  const [exitTrackerHour, setExitTrackerHour] = useState("10");
  const [exitTrackerMinute, setExitTrackerMinute] = useState("00");
  const [exitTrackerAmPm, setExitTrackerAmPm] = useState("AM");
  const [isSavingExitTracker, setIsSavingExitTracker] = useState(false);

  // Immediate Dispatch
  const [dispatchDepartment, setDispatchDepartment] = useState("ALL");
  const [isDispatchingNow, setIsDispatchingNow] = useState(false);

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedDept, setSelectedDept] = useState<DeptConfig | null>(null);
  const [deptToDelete, setDeptToDelete] = useState<DeptConfig | null>(null);

  // Form states for Add Department Modal (Dropdown from standard company departments)
  const [addDeptName, setAddDeptName] = useState("");
  const [isCustomDept, setIsCustomDept] = useState(false);
  const [customDeptName, setCustomDeptName] = useState("");
  const [addMainRecipient, setAddMainRecipient] = useState("");
  const [addCcRecipients, setAddCcRecipients] = useState("");
  const [addTimesList, setAddTimesList] = useState<string[]>(["10:00 AM"]);
  const [addHour, setAddHour] = useState("10");
  const [addMinute, setAddMinute] = useState("00");
  const [addAmPm, setAddAmPm] = useState("AM");
  const [isAddSubmitting, setIsAddSubmitting] = useState(false);

  // Form states for Edit Department Modal
  const [editMainRecipient, setEditMainRecipient] = useState("");
  const [editCcRecipients, setEditCcRecipients] = useState("");
  const [editTimesList, setEditTimesList] = useState<string[]>(["10:00 AM"]);
  const [editHour, setEditHour] = useState("10");
  const [editMinute, setEditMinute] = useState("00");
  const [editAmPm, setEditAmPm] = useState("AM");
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

  const fetchEmailData = async (showLoader = false) => {
    if (showLoader) setIsLoading(true);
    try {
      const [toggleRes, deptsRes, configRes, timingRes, availDeptsRes, empFnfRes, recipientsRes, trackerRes] = await Promise.all([
        axios.get<any>("/api/admin/control/email/master-toggle"),
        axios.get<any>("/api/admin/control/email/departments"),
        axios.get<any>("/api/admin/control/config"),
        axios.get<any>("/api/admin/control/email/timing"),
        axios.get<any>("/api/admin/control/email/available-departments"),
        axios.get<any>("/api/admin/control/email/employee-fnf-config"),
        axios.get<any>("/api/v1/email-recipients").catch(() => ({ data: [] })),
        axios.get<any>("/api/admin/control/email/employee-exit-tracker-config").catch(() => ({ data: {} })),
      ]);

      const toggleData = toggleRes.data?.data !== undefined ? toggleRes.data.data : toggleRes.data || {};
      const isMasterOn = toggleData.enabled !== undefined ? Boolean(toggleData.enabled) : true;
      setMasterEmailEnabled(isMasterOn);
      localStorage.setItem("ndc_master_email_enabled", String(isMasterOn));
      setDepartments(deptsRes.data?.data || deptsRes.data || []);
      setPlatformDepartments(availDeptsRes.data?.departments || []);
      const rawRecipients = recipientsRes.data?.data || recipientsRes.data || [];
      setAvailableRecipients(Array.isArray(rawRecipients) ? rawRecipients : []);

      const cfgData = configRes.data?.data || configRes.data || {};
      const emailCfg = cfgData.email || {};
      setSmtpFrom(emailCfg.SMTP_FROM?.value || "");

      const t = timingRes.data?.data || timingRes.data || {};
      const mode = t.email_timing_mode === "department_wise" ? "department_wise" : "app_wide";
      setTimingMode(mode);
      setClearanceRemindersEnabled(t.is_enabled !== undefined ? Boolean(t.is_enabled) : true);
      const rawTiming = t.email_daily_timing || "10:00";
      setCommonTimesList(parseTo12HourList(rawTiming));

      const empCfg = empFnfRes?.data?.data || empFnfRes?.data || {};
      setEmployeeFnfEnabled(Boolean(empCfg.enabled ?? true));
      setEmployeeFnfTimingMode(empCfg.timing_mode === "scheduled" ? "scheduled" : "instant");
      const schedTimes = parseTo12HourList(empCfg.scheduled_time || "10:00");
      setEmpFnfTimesList(schedTimes.length > 0 ? schedTimes : ["10:00 AM"]);

      const trkCfg = trackerRes?.data?.data || trackerRes?.data || {};
      setExitTrackerEnabled(Boolean(trkCfg.enabled ?? true));
      setExitTrackerTimingMode(trkCfg.timing_mode === "instant" ? "instant" : "scheduled");
      const schedTrackerTimes = parseTo12HourList(trkCfg.scheduled_time || "10:00");
      setExitTrackerTimesList(schedTrackerTimes.length > 0 ? schedTrackerTimes : ["10:00 AM"]);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to load email configurations.");
    } finally {
      if (showLoader) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEmailData(true);
  }, []);

  const handleToggleMaster = async (checked: boolean) => {
    // Optimistic instant toggle so UI responds immediately with 0ms delay
    setMasterEmailEnabled(checked);
    localStorage.setItem("ndc_master_email_enabled", String(checked));
    setIsTogglingMaster(true);
    try {
      await axios.put("/api/admin/control/email/master-toggle", { enabled: checked });
      toast.success(checked ? "Master email service turned on." : "Master email service turned off.");
    } catch (err: any) {
      // Revert if API fails
      setMasterEmailEnabled(!checked);
      localStorage.setItem("ndc_master_email_enabled", String(!checked));
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to toggle master email service.");
    } finally {
      setIsTogglingMaster(false);
    }
  };

  const handleSaveSmtpFrom = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!smtpFrom.trim()) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setIsSavingFrom(true);
    try {
      await axios.put("/api/admin/control/config", {
        configs: { SMTP_FROM: smtpFrom.trim() },
      });
      toast.success("Sender email address saved successfully.");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to save sender email.");
    } finally {
      setIsSavingFrom(false);
    }
  };

  // Add / Remove times for Common Schedule
  const handleAddCommonTime = () => {
    const cleanMin = (commonMinute || "00").padStart(2, "0");
    const formatted = `${commonHour.padStart(2, "0")}:${cleanMin} ${commonAmPm}`;
    if (commonTimesList.includes(formatted)) {
      toast.info(`Time ${formatted} is already scheduled. Change the hour or minute to add another time.`);
      return;
    }
    const updated = [...commonTimesList, formatted].sort((a, b) => time12ToMinutes(a) - time12ToMinutes(b));
    setCommonTimesList(updated);
    const next = getNextHourSuggestion(updated);
    setCommonHour(next.hour);
    setCommonMinute(next.minute);
    setCommonAmPm(next.ampm);
    toast.success(`Added ${formatted} to Clearance Reminders. Click "Save changes" below to apply.`);
  };

  const handleRemoveCommonTime = (timeToRemove: string) => {
    setCommonTimesList(commonTimesList.filter((t) => t !== timeToRemove));
  };

  // Add / Remove times for Employee F&F
  const handleAddEmpFnfTime = () => {
    const cleanMin = (empFnfMinute || "00").padStart(2, "0");
    const formatted = `${empFnfHour.padStart(2, "0")}:${cleanMin} ${empFnfAmPm}`;
    if (empFnfTimesList.includes(formatted)) {
      toast.info(`Time ${formatted} is already scheduled. Change the hour or minute to add another time.`);
      return;
    }
    const updated = [...empFnfTimesList, formatted].sort((a, b) => time12ToMinutes(a) - time12ToMinutes(b));
    setEmpFnfTimesList(updated);
    const next = getNextHourSuggestion(updated);
    setEmpFnfHour(next.hour);
    setEmpFnfMinute(next.minute);
    setEmpFnfAmPm(next.ampm);
    toast.success(`Added ${formatted} to Employee F&F schedule. Click "Save changes" below to apply.`);
  };

  const handleRemoveEmpFnfTime = (timeToRemove: string) => {
    setEmpFnfTimesList(empFnfTimesList.filter((t) => t !== timeToRemove));
  };

  // Add / Remove times for Exit Clearance Tracker
  const handleAddExitTrackerTime = () => {
    const cleanMin = (exitTrackerMinute || "00").padStart(2, "0");
    const formatted = `${exitTrackerHour.padStart(2, "0")}:${cleanMin} ${exitTrackerAmPm}`;
    if (exitTrackerTimesList.includes(formatted)) {
      toast.info(`Time ${formatted} is already scheduled. Change the hour or minute to add another time.`);
      return;
    }
    const updated = [...exitTrackerTimesList, formatted].sort((a, b) => time12ToMinutes(a) - time12ToMinutes(b));
    setExitTrackerTimesList(updated);
    const next = getNextHourSuggestion(updated);
    setExitTrackerHour(next.hour);
    setExitTrackerMinute(next.minute);
    setExitTrackerAmPm(next.ampm);
    toast.success(`Added ${formatted} to Exit Clearance Tracker schedule. Click "Save changes" below to apply.`);
  };

  const handleRemoveExitTrackerTime = (timeToRemove: string) => {
    setExitTrackerTimesList(exitTrackerTimesList.filter((t) => t !== timeToRemove));
  };

  const handleSaveEmployeeFnfConfig = async () => {
    setIsSavingEmpFnf(true);
    try {
      const time24 = listTo24HourStr(empFnfTimesList);
      await axios.put("/api/admin/control/email/employee-fnf-config", {
        enabled: employeeFnfEnabled,
        timing_mode: employeeFnfTimingMode,
        scheduled_time: time24 || "10:00",
      });
      toast.success("Employee F&F email configuration saved.");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to save employee F&F settings.");
    } finally {
      setIsSavingEmpFnf(false);
    }
  };

  const handleSaveExitTrackerConfig = async () => {
    setIsSavingExitTracker(true);
    try {
      const time24 = listTo24HourStr(exitTrackerTimesList);
      await axios.put("/api/admin/control/email/employee-exit-tracker-config", {
        enabled: exitTrackerEnabled,
        timing_mode: exitTrackerTimingMode,
        scheduled_time: time24 || "10:00",
      });
      toast.success("Exit Clearance Tracker email configuration saved.");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to save exit tracker settings.");
    } finally {
      setIsSavingExitTracker(false);
    }
  };

  const handleToggleClearanceReminders = async (checked: boolean) => {
    if (!masterEmailEnabled) {
      toast.error("Master Email Service is currently Muted. Turn on Master Email Service first.");
      return;
    }
    setClearanceRemindersEnabled(checked);
    try {
      await axios.put("/api/admin/control/email/timing", {
        email_timing_mode: timingMode,
        email_daily_timing: listTo24HourStr(commonTimesList),
        is_enabled: checked,
      });
      toast.success(`Clearance reminders turned ${checked ? "on" : "off"}.`);
    } catch (err: any) {
      setClearanceRemindersEnabled(!checked);
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to toggle clearance reminders.");
    }
  };

  const handleSaveTimingSettings = async () => {
    setIsSavingTiming(true);
    try {
      const payload = {
        email_timing_mode: timingMode,
        email_daily_timing: listTo24HourStr(commonTimesList),
        is_enabled: clearanceRemindersEnabled,
      };

      await axios.put("/api/admin/control/email/timing", payload);
      toast.success("Email schedules saved successfully.");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to save timing settings.");
    } finally {
      setIsSavingTiming(false);
    }
  };

  const handleImmediateDispatch = async () => {
    setIsDispatchingNow(true);
    try {
      await axios.post("/api/admin/control/email/dispatch-now", {
        department: dispatchDepartment,
      });
      const targetLabel = dispatchDepartment === "ALL" ? "All Departments" : formatDeptName(dispatchDepartment);
      toast.success(`Notifications dispatched successfully for ${targetLabel}.`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to dispatch emails.");
    } finally {
      setIsDispatchingNow(false);
    }
  };

  const handleToggleDept = async (dept: DeptConfig, checked: boolean) => {
    if (!masterEmailEnabled) {
      toast.error("Master Email Service is currently Muted. Turn on Master Email Service first.");
      return;
    }
    try {
      await axios.put(`/api/admin/control/email/departments/${dept.id}`, { is_enabled: checked });
      setDepartments((prev) =>
        prev.map((d) => (d.id === dept.id ? { ...d, is_enabled: checked } : d))
      );
      toast.success(`Notifications for ${formatDeptName(dept.department)} turned ${checked ? "on" : "off"}.`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to update department.");
    }
  };

  // Combine canonical approval departments with platform departments
  const allCandidateDepts = Array.from(
    new Set([
      ...CANONICAL_APPROVAL_DEPARTMENTS,
      ...(platformDepartments || []),
    ])
  );

  // Filter to only platform departments that have not been configured yet
  const availableDepartments = allCandidateDepts.filter(
    (dept) => !departments.some((d) => d.department?.trim().toUpperCase() === dept.trim().toUpperCase())
  );

  const getMatchingRecipients = (deptName: string): EmailRecipientItem[] => {
    if (!deptName) return [];
    const clean = deptName.trim().toUpperCase();
    return availableRecipients.filter(
      (r) => r.email && r.department && r.department.trim().toUpperCase() === clean
    );
  };

  // Open Add Modal
  const openAddModal = () => {
    let initialDept = "";
    if (availableDepartments.length > 0) {
      initialDept = availableDepartments[0];
      setAddDeptName(initialDept);
      setIsCustomDept(false);
    } else {
      setAddDeptName("");
      setIsCustomDept(true);
    }
    setCustomDeptName("");

    const matching = getMatchingRecipients(initialDept);
    if (matching.length > 0) {
      setAddMainRecipient(matching[0].email);
      setAddCcRecipients(cleanAndDedupeEmails(matching.map((r) => r.email).join(", ")));
    } else {
      setAddMainRecipient("");
      setAddCcRecipients("");
    }

    setAddTimesList(["10:00 AM"]);
    setAddHour("10");
    setAddMinute("00");
    setAddAmPm("AM");
    setIsAddOpen(true);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalDept = (isCustomDept ? customDeptName : addDeptName).trim();
    if (!finalDept) {
      toast.error("Please specify a department name.");
      return;
    }
    const cleanedMain = addMainRecipient.trim().toLowerCase();
    const dedupedCc = cleanAndDedupeEmails(addCcRecipients);
    const newSched = listTo24HourStr(addTimesList);
    setIsAddSubmitting(true);
    try {
      const res = await axios.post<any>("/api/admin/control/email/departments", {
        department: finalDept.toUpperCase(),
        is_enabled: true,
        main_recipient: cleanedMain,
        cc_recipients: dedupedCc,
        scheduled_time: newSched,
        notification_types: "daily_summary,tomorrow_alert,delayed_reminder",
        notes: "",
      });
      const created = res.data?.data || res.data;
      if (created && created.id) {
        setDepartments((prev) => [...prev, created].sort((a, b) => a.department.localeCompare(b.department)));
      }
      if (cleanedMain) {
        setAvailableRecipients((prev) => [
          ...prev.filter(
            (r) => (r.department || "").trim().toLowerCase() !== finalDept.trim().toLowerCase()
          ),
          { id: String(Date.now()), name: finalDept, department: finalDept.toUpperCase(), email: cleanedMain },
        ]);
      }
      fetchEmailData(false);
      toast.success(`Notification rule for ${formatDeptName(finalDept)} added successfully.`);
      setIsAddOpen(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to add department.");
    } finally {
      setIsAddSubmitting(false);
    }
  };

  // Add / Remove times for Add Modal
  const handleAddModalTime = () => {
    const cleanMin = (addMinute || "00").padStart(2, "0");
    const formatted = `${addHour.padStart(2, "0")}:${cleanMin} ${addAmPm}`;
    if (addTimesList.includes(formatted)) {
      toast.info(`Time ${formatted} is already scheduled. Change the hour or minute to add another time.`);
      return;
    }
    const updated = [...addTimesList, formatted].sort((a, b) => time12ToMinutes(a) - time12ToMinutes(b));
    setAddTimesList(updated);
    const next = getNextHourSuggestion(updated);
    setAddHour(next.hour);
    setAddMinute(next.minute);
    setAddAmPm(next.ampm);
    toast.success(`Added ${formatted} to delivery schedule.`);
  };

  const handleRemoveAddModalTime = (timeToRemove: string) => {
    setAddTimesList(addTimesList.filter((t) => t !== timeToRemove));
  };

  // Open Edit Modal for an existing department
  const openEditModal = (dept: DeptConfig) => {
    setSelectedDept(dept);
    const matching = getMatchingRecipients(dept.department);
    const primaryEmail = dept.main_recipient || (matching.length > 0 ? matching[0].email : "");
    setEditMainRecipient(primaryEmail);
    const existing = cleanAndDedupeEmails(dept.cc_recipients || "");
    setEditCcRecipients(existing);
    const parsedTimes = parseTo12HourList(dept.scheduled_time || "10:00");
    setEditTimesList(parsedTimes.length > 0 ? parsedTimes : ["10:00 AM"]);
    const next = getNextHourSuggestion(parsedTimes);
    setEditHour(next.hour);
    setEditMinute(next.minute);
    setEditAmPm(next.ampm);
    setIsEditOpen(true);
  };

  // Add / Remove times for Edit Modal
  const handleEditModalTime = () => {
    const cleanMin = (editMinute || "00").padStart(2, "0");
    const formatted = `${editHour.padStart(2, "0")}:${cleanMin} ${editAmPm}`;
    if (editTimesList.includes(formatted)) {
      toast.info(`Time ${formatted} is already scheduled. Change the hour or minute to add another time.`);
      return;
    }
    const updated = [...editTimesList, formatted].sort((a, b) => time12ToMinutes(a) - time12ToMinutes(b));
    setEditTimesList(updated);
    const next = getNextHourSuggestion(updated);
    setEditHour(next.hour);
    setEditMinute(next.minute);
    setEditAmPm(next.ampm);
    toast.success(`Added ${formatted} to delivery schedule.`);
  };

  const handleRemoveEditModalTime = (timeToRemove: string) => {
    setEditTimesList(editTimesList.filter((t) => t !== timeToRemove));
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDept) return;
    const dedupedCc = cleanAndDedupeEmails(editCcRecipients);
    const newSched = listTo24HourStr(editTimesList);
    const targetDept = selectedDept;
    const cleanedMain = editMainRecipient.trim().toLowerCase();

    setIsEditSubmitting(true);
    // Instant optimistic update: update table immediately and close modal
    setDepartments((prev) =>
      prev.map((d) =>
        d.id === targetDept.id
          ? { ...d, cc_recipients: dedupedCc, scheduled_time: newSched, main_recipient: cleanedMain }
          : d
      )
    );
    setAvailableRecipients((prev) => {
      const filtered = prev.filter(
        (r) => (r.department || "").trim().toLowerCase() !== targetDept.department.trim().toLowerCase()
      );
      if (cleanedMain) {
        return [...filtered, { id: String(Date.now()), name: targetDept.department, department: targetDept.department, email: cleanedMain }];
      }
      return filtered;
    });
    setIsEditOpen(false);
    setSelectedDept(null);
    toast.success(`Notification rule for ${formatDeptName(targetDept.department)} updated.`);

    try {
      await axios.put(`/api/admin/control/email/departments/${targetDept.id}`, {
        main_recipient: cleanedMain,
        cc_recipients: dedupedCc,
        scheduled_time: newSched,
        notes: "",
      });
      fetchEmailData(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to update department.");
      fetchEmailData(false);
    } finally {
      setIsEditSubmitting(false);
    }
  };

  const handleDeleteDept = async () => {
    if (!deptToDelete) return;
    const target = deptToDelete;
    // Close modal immediately and optimistically remove from local state
    setDeptToDelete(null);
    setDepartments((prev) => prev.filter((d) => d.id !== target.id));

    try {
      await axios.delete(`/api/admin/control/email/departments/${target.id}`);
      toast.success(`Notification rule for ${formatDeptName(target.department)} deleted successfully.`);
      // Background sync without full page loading flicker
      fetchEmailData(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to delete department.");
      fetchEmailData(false);
    }
  };

  // Helper to render Main Recipient auto-synced from Email Recipients tab cleanly without boxes
  const renderMainRecipients = (dept: DeptConfig) => {
    const directEmail = dept.main_recipient?.trim().toLowerCase();
    const matching = getMatchingRecipients(dept.department);
    const mainEmail = directEmail || (matching.length > 0 ? matching[0].email : "");
    const mainName = dept.main_recipient_name || (matching.length > 0 ? matching[0].name : "");

    if (!mainEmail) {
      return <span className="text-xs text-muted-foreground font-normal">Not configured</span>;
    }

    return (
      <span
        className="text-xs text-foreground font-normal truncate block max-w-[240px]"
        title={`${mainName ? `${mainName}: ` : ""}${mainEmail}`}
      >
        {mainEmail}
      </span>
    );
  };

  // Helper to render CC recipients cleanly and simply without boxes
  const renderCcRecipients = (rawCc: string) => {
    const emails = cleanAndDedupeEmails(rawCc)
      .split(/[,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);

    if (emails.length === 0) {
      return <span className="text-xs text-muted-foreground font-normal">Not configured</span>;
    }

    if (emails.length === 1) {
      return (
        <span className="text-xs text-foreground font-normal truncate block max-w-[260px]" title={emails[0]}>
          {emails[0]}
        </span>
      );
    }

    const firstTwo = emails.slice(0, 2).join(", ");
    const remaining = emails.length - 2;

    return (
      <span className="text-xs text-foreground font-normal truncate block max-w-[280px]" title={emails.join(", ")}>
        {firstTwo}
        {remaining > 0 && <span className="text-muted-foreground font-medium ml-1">+{remaining} more</span>}
      </span>
    );
  };

  const filteredDepartments = departments.filter((dept) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const mainRecipients = getMatchingRecipients(dept.department);
    const mainMatches = mainRecipients.some(
      (r) => r.email.toLowerCase().includes(q) || (r.name && r.name.toLowerCase().includes(q))
    );
    const directMatches = (dept.main_recipient || "").toLowerCase().includes(q) ||
      (dept.main_recipient_name || "").toLowerCase().includes(q);
    return (
      dept.department.toLowerCase().includes(q) ||
      (dept.cc_recipients || "").toLowerCase().includes(q) ||
      mainMatches ||
      directMatches
    );
  });

  if (isLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm font-medium">Loading email configuration & schedules...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Master Email Service Card (Sharp Rounded-lg Design) */}
      <div className="bg-card rounded-lg border border-border p-5 shadow-sm">
        {/* Top Row: Icon + Title + Switch */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Power className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Master email service</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                One switch for every scheduled broadcast and reminder.
              </p>
            </div>
          </div>
          <Switch
            checked={masterEmailEnabled}
            onCheckedChange={handleToggleMaster}
            disabled={isTogglingMaster}
          />
        </div>

        {/* Second Row: Sender address & Send a manual broadcast now */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5 pt-4 border-t border-border">
          {/* Left: Sender address with primary blue 'Save' button */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Sender address
            </label>
            <form onSubmit={handleSaveSmtpFrom} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Mail className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  required
                  value={smtpFrom}
                  onChange={(e) => setSmtpFrom(e.target.value)}
                  placeholder="cognitbotzgovernance@gmail.com"
                  className="w-full pl-9 pr-3 h-8.5 border border-border rounded-md text-xs bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                type="submit"
                disabled={isSavingFrom}
                className="h-8.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
              >
                {isSavingFrom ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Save</span>
              </button>
            </form>
          </div>

          {/* Right: Send a manual broadcast now */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Send a manual broadcast now
            </label>
            <div className="flex items-center gap-2">
              <Select value={dispatchDepartment} onValueChange={setDispatchDepartment}>
                <SelectTrigger className="flex-1 h-8.5 text-xs bg-background border border-border rounded-md">
                  <SelectValue placeholder="Target Department" />
                </SelectTrigger>
                <SelectContent side="top">
                  <SelectItem value="ALL" className="text-xs font-medium">All Departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.department} className="text-xs">
                      {formatDeptName(d.department)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={handleImmediateDispatch}
                disabled={isDispatchingNow || !masterEmailEnabled}
                title={!masterEmailEnabled ? "Master Email Service is currently Muted" : undefined}
                className="h-8.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50 whitespace-nowrap"
              >
                {isDispatchingNow ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <SendHorizontal className="w-3.5 h-3.5" />
                    <span>Send now</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Three Email Service Cards in a Single Row (Sharp Rounded-lg) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Card 1: Clearance reminders */}
        <div className="bg-card rounded-lg border border-border p-5 shadow-sm flex flex-col justify-between hover:border-primary/40 transition-colors">
          <div className="space-y-4">
            <div className="flex items-center justify-between min-h-[36px]">
              <div>
                <h4 className="font-semibold text-sm text-foreground">Clearance reminders</h4>
                <p className="text-xs text-muted-foreground mt-0.5">Daily nudge to pending approvers</p>
              </div>
              <Switch
                checked={clearanceRemindersEnabled}
                onCheckedChange={handleToggleClearanceReminders}
                disabled={!masterEmailEnabled}
                title={!masterEmailEnabled ? "Master Email Service is currently Muted" : undefined}
              />
            </div>

            <div className={`space-y-3 transition-opacity duration-200 ${(!clearanceRemindersEnabled || !masterEmailEnabled) ? "opacity-45 pointer-events-none select-none" : ""}`}>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Schedule
                </label>
                <div className="bg-muted/60 p-0.5 rounded-md border border-border grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => setTimingMode("app_wide")}
                    className={`py-1 text-xs rounded transition-all cursor-pointer text-center ${
                      timingMode === "app_wide"
                        ? "bg-card text-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground font-medium"
                    }`}
                  >
                    Common
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimingMode("department_wise")}
                    className={`py-1 text-xs rounded transition-all cursor-pointer text-center ${
                      timingMode === "department_wise"
                        ? "bg-card text-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground font-medium"
                    }`}
                  >
                    By department
                  </button>
                </div>
              </div>

              <div className="min-h-[105px] flex flex-col justify-center">
                {timingMode === "app_wide" ? (
                  <div className="p-3 rounded-lg border border-border bg-background space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                        Active Execution Times ({commonTimesList.length})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] items-center">
                      {commonTimesList.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">No times scheduled. Select a time below.</span>
                      ) : (
                        commonTimesList.map((time) => (
                          <span
                            key={time}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20 shadow-xs"
                          >
                            <Clock className="w-2.5 h-2.5 text-primary" />
                            {time}
                            <button
                              type="button"
                              onClick={() => handleRemoveCommonTime(time)}
                              className="text-primary hover:text-red-500 transition-colors ml-0.5 cursor-pointer"
                              title={`Remove ${time}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>

                    <div className="pt-2 border-t border-border/70 flex flex-wrap items-center gap-1.5">
                      <Select value={commonHour} onValueChange={setCommonHour}>
                        <SelectTrigger className="w-14 h-7 text-xs font-mono bg-card px-1.5 border border-border focus:ring-0 focus:outline-none">
                          <SelectValue placeholder="Hour" />
                        </SelectTrigger>
                        <SelectContent side="top" className="min-w-14 w-14 max-h-40 p-0.5">
                          {HOURS.map((h) => (
                            <SelectItem key={h} value={h} className="text-xs font-mono py-0.5 pr-4 pl-1.5">
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={commonMinute} onValueChange={setCommonMinute}>
                        <SelectTrigger className="w-14 h-7 text-xs font-mono bg-card px-1.5 border border-border focus:ring-0 focus:outline-none">
                          <SelectValue placeholder="Min" />
                        </SelectTrigger>
                        <SelectContent side="top" className="min-w-14 w-14 max-h-40 p-0.5">
                          {MINUTES.map((m) => (
                            <SelectItem key={m} value={m} className="text-xs font-mono py-0.5 pr-4 pl-1.5">
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="inline-flex h-7 rounded border border-border overflow-hidden bg-card p-0.5 items-center">
                        <button
                          type="button"
                          onClick={() => setCommonAmPm("AM")}
                          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-xs transition-colors cursor-pointer ${
                            commonAmPm === "AM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          AM
                        </button>
                        <button
                          type="button"
                          onClick={() => setCommonAmPm("PM")}
                          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-xs transition-colors cursor-pointer ${
                            commonAmPm === "PM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          PM
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleAddCommonTime}
                        className="h-7 flex items-center gap-1 px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded transition-colors cursor-pointer ml-auto"
                      >
                        <Plus className="w-3 h-3" />
                        Add time
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border border-border bg-background/50 flex flex-col justify-center min-h-[96px]">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Reminders are dispatched per individual department timings configured in the table below.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-border mt-4">
            <button
              type="button"
              onClick={handleSaveTimingSettings}
              disabled={isSavingTiming}
              className="w-full h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isSavingTiming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Save changes</span>
            </button>
          </div>
        </div>

        {/* Card 2: Exit clearance tracker */}
        <div className="bg-card rounded-lg border border-border p-5 shadow-sm flex flex-col justify-between hover:border-primary/40 transition-colors">
          <div className="space-y-4">
            <div className="flex items-center justify-between min-h-[36px]">
              <div>
                <h4 className="font-semibold text-sm text-foreground">Exit clearance tracker</h4>
                <p className="text-xs text-muted-foreground mt-0.5">Approval progress summary to the employee</p>
              </div>
              <Switch
                checked={exitTrackerEnabled}
                onCheckedChange={setExitTrackerEnabled}
                disabled={!masterEmailEnabled}
                title={!masterEmailEnabled ? "Master Email Service is currently Muted" : undefined}
              />
            </div>

            <div className={`space-y-3 transition-opacity duration-200 ${(!exitTrackerEnabled || !masterEmailEnabled) ? "opacity-45 pointer-events-none select-none" : ""}`}>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Send when
                </label>
                <div className="bg-muted/60 p-0.5 rounded-md border border-border grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => setExitTrackerTimingMode("scheduled")}
                    className={`py-1 text-xs rounded transition-all cursor-pointer text-center ${
                      exitTrackerTimingMode === "scheduled"
                        ? "bg-card text-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground font-medium"
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => setExitTrackerTimingMode("instant")}
                    className={`py-1 text-xs rounded transition-all cursor-pointer text-center ${
                      exitTrackerTimingMode === "instant"
                        ? "bg-card text-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground font-medium"
                    }`}
                  >
                    On approval
                  </button>
                </div>
              </div>

              <div className="min-h-[105px] flex flex-col justify-center">
                {exitTrackerTimingMode === "instant" ? (
                  <div className="p-3 rounded-lg border border-border bg-background/50 flex flex-col justify-center min-h-[96px]">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Dispatched immediately to the separated employee whenever any department clearance stage is approved.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border border-border bg-background space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                        Active Execution Times ({exitTrackerTimesList.length})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] items-center">
                      {exitTrackerTimesList.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">No times scheduled. Select a time below.</span>
                      ) : (
                        exitTrackerTimesList.map((time) => (
                          <span
                            key={time}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20 shadow-xs"
                          >
                            <Clock className="w-2.5 h-2.5 text-primary" />
                            {time}
                            <button
                              type="button"
                              onClick={() => handleRemoveExitTrackerTime(time)}
                              className="text-primary hover:text-red-500 transition-colors ml-0.5 cursor-pointer"
                              title={`Remove ${time}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>

                    <div className="pt-2 border-t border-border/70 flex flex-wrap items-center gap-1.5">
                      <Select value={exitTrackerHour} onValueChange={setExitTrackerHour}>
                        <SelectTrigger className="w-14 h-7 text-xs font-mono bg-card px-1.5 border border-border focus:ring-0 focus:outline-none">
                          <SelectValue placeholder="Hour" />
                        </SelectTrigger>
                        <SelectContent side="top" className="min-w-14 w-14 max-h-40 p-0.5">
                          {HOURS.map((h) => (
                            <SelectItem key={h} value={h} className="text-xs font-mono py-0.5 pr-4 pl-1.5">
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={exitTrackerMinute} onValueChange={setExitTrackerMinute}>
                        <SelectTrigger className="w-14 h-7 text-xs font-mono bg-card px-1.5 border border-border focus:ring-0 focus:outline-none">
                          <SelectValue placeholder="Min" />
                        </SelectTrigger>
                        <SelectContent side="top" className="min-w-14 w-14 max-h-40 p-0.5">
                          {MINUTES.map((m) => (
                            <SelectItem key={m} value={m} className="text-xs font-mono py-0.5 pr-4 pl-1.5">
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="inline-flex h-7 rounded border border-border overflow-hidden bg-card p-0.5 items-center">
                        <button
                          type="button"
                          onClick={() => setExitTrackerAmPm("AM")}
                          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-xs transition-colors cursor-pointer ${
                            exitTrackerAmPm === "AM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          AM
                        </button>
                        <button
                          type="button"
                          onClick={() => setExitTrackerAmPm("PM")}
                          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-xs transition-colors cursor-pointer ${
                            exitTrackerAmPm === "PM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          PM
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleAddExitTrackerTime}
                        className="h-7 flex items-center gap-1 px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded transition-colors cursor-pointer ml-auto"
                      >
                        <Plus className="w-3 h-3" />
                        Add time
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-border mt-4">
            <button
              type="button"
              onClick={handleSaveExitTrackerConfig}
              disabled={isSavingExitTracker}
              className="w-full h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isSavingExitTracker ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Save changes</span>
            </button>
          </div>
        </div>

        {/* Card 3: Employee F&F email */}
        <div className="bg-card rounded-lg border border-border p-5 shadow-sm flex flex-col justify-between hover:border-primary/40 transition-colors">
          <div className="space-y-4">
            <div className="flex items-center justify-between min-h-[36px]">
              <div>
                <h4 className="font-semibold text-sm text-foreground">Employee F&F email</h4>
                <p className="text-xs text-muted-foreground mt-0.5">Exit sheet sent straight to the employee</p>
              </div>
              <Switch
                checked={employeeFnfEnabled}
                onCheckedChange={setEmployeeFnfEnabled}
                disabled={!masterEmailEnabled}
                title={!masterEmailEnabled ? "Master Email Service is currently Muted" : undefined}
              />
            </div>

            <div className={`space-y-3 transition-opacity duration-200 ${(!employeeFnfEnabled || !masterEmailEnabled) ? "opacity-45 pointer-events-none select-none" : ""}`}>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Send when
                </label>
                <div className="bg-muted/60 p-0.5 rounded-md border border-border grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => setEmployeeFnfTimingMode("instant")}
                    className={`py-1 text-xs rounded transition-all cursor-pointer text-center ${
                      employeeFnfTimingMode === "instant"
                        ? "bg-card text-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground font-medium"
                    }`}
                  >
                    Instantly
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmployeeFnfTimingMode("scheduled")}
                    className={`py-1 text-xs rounded transition-all cursor-pointer text-center ${
                      employeeFnfTimingMode === "scheduled"
                        ? "bg-card text-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground font-medium"
                    }`}
                  >
                    Daily
                  </button>
                </div>
              </div>

              <div className="min-h-[105px] flex flex-col justify-center">
                {employeeFnfTimingMode === "instant" ? (
                  <div className="p-3 rounded-lg border border-border bg-background/50 flex flex-col justify-center min-h-[96px]">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Exit sheet sent straight to the employee as soon as F&F completion & documents are synced from SharePoint.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border border-border bg-background space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                        Active Execution Times ({empFnfTimesList.length})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] items-center">
                      {empFnfTimesList.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">No times scheduled. Select a time below.</span>
                      ) : (
                        empFnfTimesList.map((time) => (
                          <span
                            key={time}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20 shadow-xs"
                          >
                            <Clock className="w-2.5 h-2.5 text-primary" />
                            {time}
                            <button
                              type="button"
                              onClick={() => handleRemoveEmpFnfTime(time)}
                              className="text-primary hover:text-red-500 transition-colors ml-0.5 cursor-pointer"
                              title={`Remove ${time}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>

                    <div className="pt-2 border-t border-border/70 flex flex-wrap items-center gap-1.5">
                      <Select value={empFnfHour} onValueChange={setEmpFnfHour}>
                        <SelectTrigger className="w-14 h-7 text-xs font-mono bg-card px-1.5 border border-border focus:ring-0 focus:outline-none">
                          <SelectValue placeholder="Hour" />
                        </SelectTrigger>
                        <SelectContent side="top" className="min-w-14 w-14 max-h-40 p-0.5">
                          {HOURS.map((h) => (
                            <SelectItem key={h} value={h} className="text-xs font-mono py-0.5 pr-4 pl-1.5">
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={empFnfMinute} onValueChange={setEmpFnfMinute}>
                        <SelectTrigger className="w-14 h-7 text-xs font-mono bg-card px-1.5 border border-border focus:ring-0 focus:outline-none">
                          <SelectValue placeholder="Min" />
                        </SelectTrigger>
                        <SelectContent side="top" className="min-w-14 w-14 max-h-40 p-0.5">
                          {MINUTES.map((m) => (
                            <SelectItem key={m} value={m} className="text-xs font-mono py-0.5 pr-4 pl-1.5">
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="inline-flex h-7 rounded border border-border overflow-hidden bg-card p-0.5 items-center">
                        <button
                          type="button"
                          onClick={() => setEmpFnfAmPm("AM")}
                          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-xs transition-colors cursor-pointer ${
                            empFnfAmPm === "AM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          AM
                        </button>
                        <button
                          type="button"
                          onClick={() => setEmpFnfAmPm("PM")}
                          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-xs transition-colors cursor-pointer ${
                            empFnfAmPm === "PM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          PM
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleAddEmpFnfTime}
                        className="h-7 flex items-center gap-1 px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded transition-colors cursor-pointer ml-auto"
                      >
                        <Plus className="w-3 h-3" />
                        Add time
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-border mt-4">
            <button
              type="button"
              onClick={handleSaveEmployeeFnfConfig}
              disabled={isSavingEmpFnf}
              className="w-full h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isSavingEmpFnf ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Save changes</span>
            </button>
          </div>
        </div>
      </div>

{/* 3. Departments & CC rules Table */}
      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
        {/* Table Toolbar */}
        <div className="p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Departments & CC rules</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Who receives each department's emails, and when.</p>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full pl-9 pr-7 h-9 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <button
              onClick={openAddModal}
              className="h-9 flex items-center gap-1.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors shadow-xs shrink-0 cursor-pointer"
              title="Add Department"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add department</span>
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto w-full">
          <table className="w-full text-sm table-fixed min-w-[850px]">
            <thead className="bg-muted/60 border-b border-border">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-bold text-foreground w-40">Department</th>
                <th className="px-4 py-2.5 text-left text-xs font-bold text-foreground w-60">Main Recipient</th>
                <th className="px-4 py-2.5 text-left text-xs font-bold text-foreground">CC Recipients</th>
                <th className="px-4 py-2.5 text-left text-xs font-bold text-foreground w-64">
                  <div className="flex items-center gap-1.5">
                    <span>Scheduled Timing</span>
                    <span className="text-[10px] font-medium normal-case px-1.5 py-0.5 rounded bg-background text-muted-foreground border border-border">
                      {timingMode === "app_wide" ? "Common" : "Dept-wise"}
                    </span>
                  </div>
                </th>
                <th className="px-4 py-2.5 text-center text-xs font-bold text-foreground w-24">Status</th>
                <th className="px-4 py-2.5 text-right text-xs font-bold text-foreground w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {filteredDepartments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground text-xs">
                    {searchQuery ? "No departments matching your search query." : "No departmental configurations found."}
                  </td>
                </tr>
              ) : (
                filteredDepartments.map((dept) => {
                  const timesList = parseTo12HourList(dept.scheduled_time || "10:00");
                  return (
                    <tr key={dept.id} className="hover:bg-muted/40 transition-colors">
                      {/* Department Name - Normal weight, not bold */}
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="font-normal text-xs text-foreground tracking-wide">
                          {formatDeptName(dept.department)}
                        </span>
                      </td>

                      {/* Main Recipient - Auto-synced from Email Recipients */}
                      <td className="px-4 py-2.5">
                        {renderMainRecipients(dept)}
                      </td>

                      {/* CC Recipients */}
                      <td className="px-4 py-2.5">
                        {renderCcRecipients(dept.cc_recipients)}
                      </td>

                      {/* Scheduled Timing - Shows Common or Department-wise multiple timings */}
                      <td className="px-4 py-2.5">
                        {(() => {
                          const isCommon = timingMode === "app_wide";
                          const effectiveTimes = isCommon ? commonTimesList : timesList;

                          if (effectiveTimes.length === 0) {
                            return <span className="text-xs text-muted-foreground font-normal">Not configured</span>;
                          }

                          if (effectiveTimes.length <= 3) {
                            return (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {effectiveTimes.map((t) => (
                                  <span
                                    key={t}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-muted/70 text-foreground border border-border shrink-0"
                                  >
                                    <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                                    {t}
                                  </span>
                                ))}
                                {isCommon && (
                                  <span className="text-[10px] text-muted-foreground font-normal shrink-0" title="Inherited from Common Schedule configured above">
                                    (Common)
                                  </span>
                                )}
                              </div>
                            );
                          }

                          const firstTwo = effectiveTimes.slice(0, 2);
                          const remainingCount = effectiveTimes.length - 2;
                          return (
                            <div className="flex items-center gap-1.5" title={`All scheduled timings: ${effectiveTimes.join(", ")}`}>
                              {firstTwo.map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-muted/70 text-foreground border border-border shrink-0"
                                >
                                  <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                                  {t}
                                </span>
                              ))}
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0 cursor-help"
                                title={`All times: ${effectiveTimes.join(", ")}`}
                              >
                                +{remainingCount} more
                              </span>
                              {isCommon && (
                                <span className="text-[10px] text-muted-foreground font-normal shrink-0" title="Inherited from Common Schedule configured above">
                                  (Common)
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Active Status: Clean Switch without redundant badge, disabled when master email is muted */}
                      <td className="px-4 py-2.5 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center">
                          <Switch
                            checked={dept.is_enabled}
                            disabled={!masterEmailEnabled}
                            onCheckedChange={(checked) => handleToggleDept(dept, checked)}
                            className="disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            title={!masterEmailEnabled ? "Master Email Service is currently Muted. Turn on Master Email Service to toggle." : undefined}
                          />
                        </div>
                      </td>

                      {/* Actions: Edit & Delete buttons */}
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(dept)}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                            title="Edit Department"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeptToDelete(dept)}
                            className="p-1.5 rounded-md hover:bg-rose-50 text-rose-600 hover:text-rose-700 cursor-pointer transition-colors"
                            title="Delete Department"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Department Modal (Dropdown of standard company departments, NO text input) */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <DialogTitle>Add Department</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Configure delivery schedule and CC recipients for a department.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddSubmit} className="space-y-4 pt-3">
            {/* Department Selection */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                  Select Department <span className="text-red-500">*</span>
                </label>
                {availableDepartments.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomDept(!isCustomDept);
                      if (isCustomDept && availableDepartments.length > 0) {
                        setAddDeptName(availableDepartments[0]);
                      }
                    }}
                    className="text-[11px] text-primary hover:underline cursor-pointer"
                  >
                    {isCustomDept ? "Pick from list" : "Enter custom"}
                  </button>
                )}
              </div>

              {isCustomDept || availableDepartments.length === 0 ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={customDeptName}
                    onChange={(e) => setCustomDeptName(e.target.value)}
                    placeholder="Enter department name (e.g. Telecom, Safety, etc.)"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                    required
                  />
                  {availableDepartments.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      All standard approval departments are configured. You can enter any custom department above.
                    </p>
                  )}
                </div>
              ) : (
                <Select
                  value={addDeptName}
                  onValueChange={(val) => {
                    setAddDeptName(val);
                    const matching = getMatchingRecipients(val);
                    if (matching.length > 0) {
                      setAddMainRecipient(matching[0].email);
                    } else {
                      setAddMainRecipient("");
                    }
                  }}
                >
                  <SelectTrigger className="w-full text-xs h-9 bg-background">
                    <SelectValue placeholder="Select Department" />
                  </SelectTrigger>
                  <SelectContent side="bottom" className="max-h-56">
                    {availableDepartments.map((dept) => (
                      <SelectItem key={dept} value={dept} className="text-xs font-medium">
                        {formatDeptName(dept)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Scheduled Execution Times styled like Automation & Sync (NO Presets) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                Scheduled Delivery Times
              </label>

              <div className="p-3 rounded-lg border border-border bg-background space-y-2.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                  Active Times ({addTimesList.length}):
                </span>
                <div className="flex flex-wrap gap-1.5 min-h-[28px] items-center">
                  {addTimesList.length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">No times scheduled. Add one below.</span>
                  ) : (
                    addTimesList.map((time) => (
                      <span
                        key={time}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary border border-primary/20 shadow-xs"
                      >
                        <Clock className="w-3 h-3 text-primary" />
                        {time}
                        <button
                          type="button"
                          onClick={() => handleRemoveAddModalTime(time)}
                          className="text-primary hover:text-red-500 transition-colors ml-0.5 cursor-pointer"
                          title={`Remove ${time}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))
                  )}
                </div>

                {/* Inline Radix Dropdowns: Hour, Min (side="top"), AM/PM, Add Time */}
                <div className="pt-2 border-t border-border/70 flex flex-wrap items-center gap-1.5">
                  <Select value={addHour} onValueChange={setAddHour}>
                    <SelectTrigger className="w-16 h-7 text-xs font-mono bg-card px-2 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus-visible:outline-none focus-visible:border-border">
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

                  <Select value={addMinute} onValueChange={setAddMinute}>
                    <SelectTrigger className="w-16 h-7 text-xs font-mono bg-card px-2 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus-visible:outline-none focus-visible:border-border">
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

                  <div className="inline-flex rounded-md border border-border overflow-hidden bg-card p-0.5">
                    <button
                      type="button"
                      onClick={() => setAddAmPm("AM")}
                      className={`px-2 py-0.5 text-xs font-semibold rounded-sm transition-colors cursor-pointer ${
                        addAmPm === "AM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      AM
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddAmPm("PM")}
                      className={`px-2 py-0.5 text-xs font-semibold rounded-sm transition-colors cursor-pointer ${
                        addAmPm === "PM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      PM
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddModalTime}
                    className="flex items-center gap-1 px-2.5 py-1 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md transition-colors cursor-pointer ml-auto sm:ml-0"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Main Recipient */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                Main Recipient
              </label>
              <input
                type="email"
                value={addMainRecipient}
                onChange={(e) => setAddMainRecipient(e.target.value)}
                placeholder="primary.recipient@adani.com"
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              />
            </div>

            {/* CC Recipients */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  CC Recipients
                </label>
                {addCcRecipients && (
                  <button
                    type="button"
                    onClick={() => setAddCcRecipients(cleanAndDedupeEmails(addCcRecipients))}
                    className="text-[10px] text-primary hover:underline font-medium cursor-pointer"
                    title="Deduplicate emails"
                  >
                    Deduplicate
                  </button>
                )}
              </div>

              <textarea
                rows={3}
                value={addCcRecipients}
                onChange={(e) => setAddCcRecipients(e.target.value)}
                placeholder="Enter CC emails separated by comma (e.g. user1@adani.com, user2@adani.com)"
                className="w-full px-3 py-2 border border-border rounded-md text-xs bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="px-4 py-2 border border-border rounded-md text-xs font-medium hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isAddSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
              >
                {isAddSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Add Department
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Department Modal (NO Presets, identical Automation & Sync time chips and selectors) */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <DialogTitle>Department Configuration</DialogTitle>
            <DialogDescription className="sr-only">
              Department configuration
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4 pt-3">
            {timingMode === "app_wide" && (
              <div className="p-2.5 rounded-md bg-muted/60 border border-border text-xs text-muted-foreground flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>
                  Reminders currently run on the <strong>Common Schedule</strong> ({commonTimesList.join(", ")}). These department-specific timings will be saved and apply whenever switched to "By department" mode.
                </span>
              </div>
            )}

            {selectedDept && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                  Department
                </label>
                <div className="px-3 py-2 text-xs font-medium bg-muted/40 border border-border rounded-md text-foreground">
                  {formatDeptName(selectedDept.department)}
                </div>
              </div>
            )}

            {/* Scheduled Execution Times styled like Automation & Sync (NO Presets) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                Scheduled Delivery Times
              </label>

              <div className="p-3 rounded-lg border border-border bg-background space-y-2.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                  Active Times ({editTimesList.length}):
                </span>
                <div className="flex flex-wrap gap-1.5 min-h-[28px] items-center">
                  {editTimesList.length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">No times scheduled. Add one below.</span>
                  ) : (
                    editTimesList.map((time) => (
                      <span
                        key={time}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary border border-primary/20 shadow-xs"
                      >
                        <Clock className="w-3 h-3 text-primary" />
                        {time}
                        <button
                          type="button"
                          onClick={() => handleRemoveEditModalTime(time)}
                          className="text-primary hover:text-red-500 transition-colors ml-0.5 cursor-pointer"
                          title={`Remove ${time}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))
                  )}
                </div>

                {/* Inline Radix Dropdowns: Hour, Min (side="top"), AM/PM, Add Time */}
                <div className="pt-2 border-t border-border/70 flex flex-wrap items-center gap-1.5">
                  <Select value={editHour} onValueChange={setEditHour}>
                    <SelectTrigger className="w-16 h-7 text-xs font-mono bg-card px-2 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus-visible:outline-none focus-visible:border-border">
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

                  <Select value={editMinute} onValueChange={setEditMinute}>
                    <SelectTrigger className="w-16 h-7 text-xs font-mono bg-card px-2 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus-visible:outline-none focus-visible:border-border">
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

                  <div className="inline-flex rounded-md border border-border overflow-hidden bg-card p-0.5">
                    <button
                      type="button"
                      onClick={() => setEditAmPm("AM")}
                      className={`px-2 py-0.5 text-xs font-semibold rounded-sm transition-colors cursor-pointer ${
                        editAmPm === "AM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      AM
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditAmPm("PM")}
                      className={`px-2 py-0.5 text-xs font-semibold rounded-sm transition-colors cursor-pointer ${
                        editAmPm === "PM" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      PM
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleEditModalTime}
                    className="flex items-center gap-1 px-2.5 py-1 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md transition-colors cursor-pointer ml-auto sm:ml-0"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Main Recipient */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                Main Recipient
              </label>
              <input
                type="email"
                value={editMainRecipient}
                onChange={(e) => setEditMainRecipient(e.target.value)}
                placeholder="primary.recipient@adani.com"
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              />
            </div>

            {/* CC Recipients */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  CC Recipients
                </label>
                {editCcRecipients && (
                  <button
                    type="button"
                    onClick={() => setEditCcRecipients(cleanAndDedupeEmails(editCcRecipients))}
                    className="text-[10px] text-primary hover:underline font-medium cursor-pointer"
                    title="Deduplicate emails"
                  >
                    Deduplicate
                  </button>
                )}
              </div>

              <textarea
                rows={3}
                value={editCcRecipients}
                onChange={(e) => setEditCcRecipients(e.target.value)}
                placeholder="Enter CC emails separated by comma (e.g. user1@adani.com, user2@adani.com)"
                className="w-full px-3 py-2 border border-border rounded-md text-xs bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setIsEditOpen(false)}
                className="px-4 py-2 border border-border rounded-md text-xs font-medium hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isEditSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
              >
                {isEditSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={Boolean(deptToDelete)} onOpenChange={(open) => !open && setDeptToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Department Configuration?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete notification rules for{" "}
              <strong>{deptToDelete ? formatDeptName(deptToDelete.department) : ""}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault();
                handleDeleteDept();
              }}
              className="bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
