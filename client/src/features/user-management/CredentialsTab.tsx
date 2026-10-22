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
    <form onSubmit={handleSave} className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
      {/* Container Header */}
      <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Service Account & Notification Alerts</h2>
            <p className="text-xs text-muted-foreground">Manage corporate service account credentials and background failure notification recipients.</p>
          </div>
        </div>
      </div>

      {/* Container Body */}
      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Card 1: Microsoft SSO Service Account */}
          <div className="rounded-lg border border-border bg-muted/10 p-5 flex flex-col justify-between h-full space-y-4">
            <div className="space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-border">
                <div className="w-9 h-9 rounded-md bg-muted/60 border border-border flex items-center justify-center shrink-0">
                  <MicrosoftLogo className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Automation Service Account
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Corporate Microsoft credentials
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Service Account Email / User ID <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={oracleEmail}
                    onChange={(e) => setOracleEmail(e.target.value)}
                    placeholder="Enter service account email"
                    className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Service Account Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={oraclePassword}
                    onChange={(e) => setOraclePassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-9 pr-10 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer transition-colors p-0.5"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground pt-1">
              Used securely for scheduled background downloads and document processing.
            </p>
          </div>

          {/* Card 2: Sync Failure Alerts */}
          <div className="rounded-lg border border-border bg-muted/10 p-5 flex flex-col justify-between h-full space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 shrink-0">
                    <BellRing className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Sync Failure Alerts
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Email notifications if background sync encounters errors
                    </p>
                  </div>
                </div>

                <Switch
                  checked={syncFailureAlertEnabled}
                  onCheckedChange={setSyncFailureAlertEnabled}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Alert Recipient Emails <span className="text-xs text-muted-foreground font-normal">(Comma-separated)</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    disabled={!syncFailureAlertEnabled}
                    value={syncFailureRecipients}
                    onChange={(e) => setSyncFailureRecipients(e.target.value)}
                    placeholder="Enter alert emails separated by comma"
                    className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-sm bg-background disabled:bg-muted/40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground pt-1">
              Receives error diagnostics immediately if an automation task or SSO login fails.
            </p>
          </div>
        </div>
      </div>

      {/* Action Footer */}
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
  );
}
