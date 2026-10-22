import { useState, useEffect } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "../../context/AuthContext";
import {
  Users, Key, Clock, Mail, Folder, FileText,
  Shield, 
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

// Tab Subcomponents
import { UserTab } from "./UserTab";
import { CredentialsTab } from "./CredentialsTab";
import { SchedulerTab } from "./SchedulerTab";
import { EmailConfigTab } from "./EmailConfigTab";
import { SharePointDocsTab } from "./SharePointDocsTab";
import { LogsTab } from "./LogsTab";

import { ENHANCEMENT_FEATURES } from "../../config/features";

const VALID_TABS = ENHANCEMENT_FEATURES
  ? ["users", "credentials", "scheduler", "email_config", "sharepoint_docs", "logs"]
  : ["users"];

export function UserManagement() {
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial tab from search params or localStorage, fallback to "users"
  const tabParam = searchParams.get("tab");
  const storedTab = localStorage.getItem("admin_active_tab");
  const initialTab =
    tabParam && VALID_TABS.includes(tabParam)
      ? tabParam
      : storedTab && VALID_TABS.includes(storedTab)
      ? storedTab
      : "users";

  const [activeTab, setActiveTab] = useState(initialTab);

  // Sync state if URL search param changes
  useEffect(() => {
    if (tabParam && VALID_TABS.includes(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  // Keep URL search param in sync on initial mount if not present
  useEffect(() => {
    if (!tabParam || !VALID_TABS.includes(tabParam)) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", initialTab);
        return next;
      }, { replace: true });
    }
  }, []);

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    localStorage.setItem("admin_active_tab", newTab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", newTab);
      return next;
    }, { replace: true });
  };

  // Deny access if not super_admin
  if (currentUser?.role !== "super_admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] p-6 text-center">
        <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-4">
          <Shield size={32} />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Access Denied</h2>
        <p className="text-muted-foreground max-w-md">
          Only Super Administrators have permission to access the Admin & System Control Center.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            {/* <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Sliders className="w-6 h-6" />
            </div> */}
            <div>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Admin & System Control Center</h1>
              <p className="text-muted-foreground text-xs mt-0.5">
                {ENHANCEMENT_FEATURES
                  ? "Centralized control for user accounts, background automation, service credentials, email notifications, SharePoint files, and system logs."
                  : "Manage user account approvals, roles, and administrative access permissions."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Container */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-6">
        {/* Navigation Tabs Bar */}
        <div className="border-b border-border bg-card rounded-[4px] p-1.5 shadow-sm overflow-x-auto w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 justify-start">
            <TabsTrigger
              value="users"
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[4px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              Users & Access
            </TabsTrigger>

            {ENHANCEMENT_FEATURES && (
              <>
                <TabsTrigger
                  value="credentials"
                  className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[4px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer"
                >
                  <Key className="w-3.5 h-3.5" />
                  Credentials & Alerts
                </TabsTrigger>

                <TabsTrigger
                  value="scheduler"
                  className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[4px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Automation & Sync
                </TabsTrigger>

                <TabsTrigger
                  value="email_config"
                  className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[4px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Email & CC Rules
                </TabsTrigger>

                <TabsTrigger
                  value="sharepoint_docs"
                  className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[4px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer"
                >
                  <Folder className="w-3.5 h-3.5" />
                  SharePoint Documents
                </TabsTrigger>

                <TabsTrigger
                  value="logs"
                  className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[4px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Audit Logs
                </TabsTrigger>
              </>
            )}
          </TabsList>
        </div>

        {/* Tab 1: User Management */}
        <TabsContent value="users" className="m-0 focus-visible:outline-none">
          <UserTab />
        </TabsContent>

        {ENHANCEMENT_FEATURES && (
          <>
            {/* Tab 2: Dynamic Credentials & Sync Failure Alerts */}
            <TabsContent value="credentials" className="m-0 focus-visible:outline-none">
              <CredentialsTab />
            </TabsContent>

            {/* Tab 3: Automation & Sync (Unified Scheduler and Manual Sync) */}
            <TabsContent value="scheduler" className="m-0 focus-visible:outline-none">
              <SchedulerTab />
            </TabsContent>

            {/* Tab 5: Dynamic Email Config, Timings & Immediate Dispatch */}
            <TabsContent value="email_config" className="m-0 focus-visible:outline-none">
              <EmailConfigTab />
            </TabsContent>

            {/* Tab 6: SharePoint Document Management & Re-Sync */}
            <TabsContent value="sharepoint_docs" className="m-0 focus-visible:outline-none">
              <SharePointDocsTab />
            </TabsContent>

            {/* Tab 7: System Audit Logs */}
            <TabsContent value="logs" className="m-0 focus-visible:outline-none">
              <LogsTab />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
