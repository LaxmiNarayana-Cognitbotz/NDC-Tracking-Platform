import { useState, useEffect } from "react";
import axios from "../../lib/axios";
import {
  Lock, Mail, Eye, EyeOff, Save,
  Loader2, BellRing, Key
} from "lucide-react";
import { toast } from "sonner";
import { Switch } from "../../components/ui/switch";

// Official Microsoft 4-Color Tile Logo
const MicrosoftLogo = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="9" height="9" fill="#F25022" rx="0.5" />
    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" rx="0.5" />
    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" rx="0.5" />
    <rect x="11" y="11" width="9" height="9" fill="#FFB900" rx="0.5" />
  </svg>
);

export function CredentialsTab() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Form State - Service Account / Microsoft SSO Credentials
  const [oracleEmail, setOracleEmail] = useState("");
  const [oraclePassword, setOraclePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Sync failure alerts
  const [syncFailureAlertEnabled, setSyncFailureAlertEnabled] = useState(true);
  const [syncFailureRecipients, setSyncFailureRecipients] = useState("");

  const fetchConfigs = async () => {
    setIsLoading(true);
    try {
      const res = await axios.get<any>("/api/admin/control/config");
      const data = res.data?.data || res.data || {};
      
      const creds = data.credentials || {};
      const emailCfg = data.email || {};

      setOracleEmail(creds.ORACLE_EMAIL?.value || "");
      setOraclePassword(creds.ORACLE_PASSWORD?.value || "");

      setSyncFailureAlertEnabled(emailCfg.sync_failure_email_enabled?.value !== "false");
      setSyncFailureRecipients(emailCfg.sync_failure_email_recipients?.value || "");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to load credentials");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload = {
        configs: {
          ORACLE_EMAIL: oracleEmail.trim(),
          ORACLE_PASSWORD: oraclePassword.trim(),
          sync_failure_email_enabled: String(syncFailureAlertEnabled),
          sync_failure_email_recipients: syncFailureRecipients.trim(),
        }
      };

      await axios.put("/api/admin/control/config", payload);
      toast.success("Credentials and failure alerts saved successfully!");
      fetchConfigs();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to save configurations");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm font-medium">Loading credentials...</span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <form onSubmit={handleSave} className="w-full bg-card rounded-lg border border-border p-6 md:p-7 shadow-sm space-y-6">
        {/* Container Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Service Account & Notification Alerts</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Corporate credentials for automated downloads and background error alerts.
              </p>
            </div>
          </div>
        </div>

        {/* Two Columns Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Column 1: Automation Service Account */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-border/70">
              <div className="w-8 h-8 rounded-md bg-muted/60 border border-border flex items-center justify-center shrink-0">
                <MicrosoftLogo className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-foreground">Automation Service Account</h3>
                <p className="text-[11px] text-muted-foreground">Microsoft SSO credentials</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Service Account Email / User ID <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  required
                  value={oracleEmail}
                  onChange={(e) => setOracleEmail(e.target.value)}
                  placeholder="e.g. svc-ndc-automation@adani.com"
                  className="w-full pl-9 pr-3 h-10 border border-border rounded-md text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Service Account Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={oraclePassword}
                  onChange={(e) => setOraclePassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-10 h-10 border border-border rounded-md text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer transition-colors p-1"
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>

          {/* Column 2: Sync Failure Alerts */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border/70 min-h-[44px]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 shrink-0">
                  <BellRing className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-foreground">Sync Failure Alerts</h3>
                  <p className="text-[11px] text-muted-foreground">Automated error notifications</p>
                </div>
              </div>
              <Switch
                checked={syncFailureAlertEnabled}
                onCheckedChange={setSyncFailureAlertEnabled}
              />
            </div>

            <div className={`space-y-1.5 transition-opacity ${!syncFailureAlertEnabled ? "opacity-50 pointer-events-none" : ""}`}>
              <label className="text-xs font-medium text-foreground">
                Alert Recipient Emails <span className="text-[11px] text-muted-foreground font-normal">(Comma-separated)</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  disabled={!syncFailureAlertEnabled}
                  value={syncFailureRecipients}
                  onChange={(e) => setSyncFailureRecipients(e.target.value)}
                  placeholder="admin@adani.com, alerts@adani.com"
                  className="w-full pl-9 pr-3 h-10 border border-border rounded-md text-xs bg-background disabled:bg-muted/40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="p-3.5 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground leading-relaxed min-h-[72px] flex items-center">
              Dispatches diagnostic error summaries immediately whenever an automated sync fails or service account SSO login expires.
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="pt-5 border-t border-border flex items-center justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="h-9 px-6 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-md shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>Save</span>
          </button>
        </div>
      </form>
    </div>
  );
}
