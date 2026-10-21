import { useAuth } from "../../context/AuthContext";
import { Clock, RefreshCw } from "lucide-react";
import { Navigate } from "react-router";

export function PendingApproval() {
  const { user, isLoading, ssoEnabled } = useAuth();

  if (!ssoEnabled && !isLoading) {
    return <Navigate to="/" replace />;
  }

  const handleRefresh = () => {
    // Reloading the page re-triggers the useAuth loadAuth profile check
    window.location.reload();
  };

  return (
    <div className="relative flex items-center justify-center min-h-screen overflow-hidden bg-slate-950 font-sans">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-[100px] animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px] animate-pulse delay-500"></div>

      <div className="relative z-10 w-full max-w-md p-8 mx-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl shadow-2xl backdrop-blur-xl transition-all duration-300">
        <div className="flex flex-col items-center text-center">
          {/* Pulsing Status Indicator */}
          <div className="relative flex items-center justify-center w-16 h-16 mb-6">
            <div className="absolute inset-0 bg-amber-500/20 rounded-full animate-ping"></div>
            <div className="relative flex items-center justify-center w-full h-full bg-slate-950 border border-amber-500/50 rounded-2xl shadow-lg">
              <Clock className="w-8 h-8 text-amber-500 animate-pulse" />
            </div>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-white">
            Approval Pending
          </h2>
          <p className="mt-3 text-sm text-slate-400">
            Your access request is pending super admin approval. You will receive an email notification at your corporate address once it has been processed.
          </p>

          {user?.email && (
            <div className="w-full mt-5 px-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl">
              <span className="text-xs text-slate-500 block mb-0.5">Logged in as</span>
              <span className="text-sm font-semibold text-slate-300 break-all">{user.email}</span>
            </div>
          )}

          <div className="w-full mt-8">
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="flex items-center justify-center w-full px-5 py-3 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-700 active:bg-slate-650 rounded-xl cursor-pointer shadow-md transition-all duration-200"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Check Status
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
