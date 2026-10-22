import { useState, useEffect, useMemo } from "react";
import axios from "../../lib/axios";
import {
  Search, Trash2, RefreshCw, Loader2, Download,
  Folder, Info, ChevronLeft, ChevronRight, X
} from "lucide-react";
import { toast } from "sonner";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";

interface SpFolder {
  id: string;
  person_number: string;
  child_count: number;
  last_modified_date?: string;
  web_url?: string;
  folder_path?: string;
}

export function SharePointDocsTab() {
  const [folders, setFolders] = useState<SpFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [resyncingId, setResyncingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Pagination for SharePoint Folders (10 per page)
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const fetchDocuments = async () => {
    setIsLoading(true);
    try {
      const res = await axios.get<any>("/api/admin/control/sharepoint/documents");
      const data = res.data?.data || res.data || {};
      setFolders(data.folders || []);
      setCurrentPage(1);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to load SharePoint documents");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setCurrentPage(1);
  };

  const filteredFolders = useMemo(() => {
    if (!search.trim()) return folders;
    const q = search.trim().toLowerCase();
    return folders.filter((f) =>
      (f.person_number || "").toLowerCase().includes(q) ||
      (f.id || "").toLowerCase().includes(q) ||
      (f.folder_path || "").toLowerCase().includes(q)
    );
  }, [folders, search]);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleDelete = async () => {
    if (!folderToDelete) return;
    setIsDeleting(true);
    try {
      const res = await axios.delete(`/api/admin/control/sharepoint/documents/${folderToDelete}`);
      toast.success(res.data?.message || `Documents for ${folderToDelete} deleted from SharePoint`);
      setFolderToDelete(null);
      fetchDocuments();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "Failed to delete document folder");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResyncFromDms = async (personNumber: string) => {
    setResyncingId(personNumber);
    try {
      const res = await axios.post(`/api/admin/control/sharepoint/documents/${personNumber}/re-sync`);
      toast.success(res.data?.message || `DMS re-download initiated for employee ${personNumber}.`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.response?.data?.detail || "DMS re-sync failed");
    } finally {
      setResyncingId(null);
    }
  };

  const handleDownloadDocument = (personNumber: string) => {
    setDownloadingId(personNumber);
    toast.success(`Downloading documents for employee ${personNumber}...`);
    const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    window.location.href = `${baseUrl}/api/ff/download/${personNumber}`;
    setTimeout(() => {
      setDownloadingId(null);
    }, 2500);
  };

  const totalPages = Math.max(1, Math.ceil(filteredFolders.length / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const paginatedFolders = filteredFolders.slice(startIndex, startIndex + pageSize);

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="p-4 rounded-[4px] border border-sky-200 bg-sky-50/70 text-sky-900 flex items-start gap-3">
        <Folder className="w-5 h-5 text-sky-700 shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="flex items-center gap-1.5">
            <p className="font-semibold text-sky-950">SharePoint F&F Document Management</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex items-center justify-center text-sky-700 hover:text-sky-950 cursor-pointer transition-colors p-0.5 rounded-full hover:bg-sky-200/50"
                  title="Expiry: 7/29/2027"
                  aria-label="Expiry: 7/29/2027"
                >
                  <Info className="w-3.5 h-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs font-medium">
                Expiry: 7/29/2027
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-sky-800 text-xs mt-0.5">
            Identify employee F&F documents stored in SharePoint. For employees whose separation and settlement are fully closed,
            delete unnecessary files to free up storage space. If required in the future, click <strong>Re-Sync from DMS</strong> to restore them on demand.
          </p>
        </div>
      </div>

      <div className="bg-card rounded-[4px] border border-border overflow-hidden">
        {/* Controls */}
        <div className="p-4 border-b border-border bg-muted/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search by Employee ID / Person Number..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 pr-8 py-2 w-full border border-border rounded-[4px] bg-input-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchDocuments}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 border border-border bg-card hover:bg-muted text-foreground text-xs font-semibold rounded-[4px] transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh Folders
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto w-full">
          <table className="w-full text-sm table-fixed min-w-[750px]">
            <thead className="bg-muted/60 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-foreground w-40">Employee ID</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-foreground w-36">File Count</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-foreground w-52">Last Modified</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-foreground">SharePoint Path</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-foreground w-36">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground text-xs">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary mb-2" />
                    Querying SharePoint F&F Document Library...
                  </td>
                </tr>
              ) : filteredFolders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground text-xs">
                    <Info className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                    {search ? `No folders matching "${search}" in SharePoint F&F_Documents.` : "No employee folders found in SharePoint F&F_Documents."}
                  </td>
                </tr>
              ) : (
                paginatedFolders.map((f) => (
                  <tr key={f.id || f.person_number} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 font-semibold text-foreground text-xs font-mono">
                      {f.person_number}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <span className="px-2 py-0.5 rounded-[3px] bg-sky-50 text-sky-800 font-bold border border-sky-200">
                        {f.child_count} document(s)
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {f.last_modified_date ? new Date(f.last_modified_date).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground truncate" title={f.folder_path}>
                      {f.folder_path || `F&F_Documents/${f.person_number}`}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Download Document(s) - Direct single or ZIP if multiple */}
                        <button
                          type="button"
                          onClick={() => handleDownloadDocument(f.person_number)}
                          disabled={downloadingId === f.person_number}
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                          title="Download document(s)"
                        >
                          {downloadingId === f.person_number ? (
                            <Loader2 className="w-4 h-4 animate-spin text-foreground" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </button>

                        {/* Re-Sync from DMS - Neutral styling, no tooltip popover */}
                        <button
                          type="button"
                          onClick={() => handleResyncFromDms(f.person_number)}
                          disabled={resyncingId === f.person_number}
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                          title="Re-sync from DMS"
                        >
                          {resyncingId === f.person_number ? (
                            <Loader2 className="w-4 h-4 animate-spin text-foreground" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                        </button>

                        {/* Delete from SharePoint - Red styling, no tooltip popover */}
                        <button
                          type="button"
                          onClick={() => setFolderToDelete(f.person_number)}
                          className="p-1.5 rounded-md hover:bg-rose-50 text-rose-600 hover:text-rose-700 transition-colors cursor-pointer"
                          title="Delete folder"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer - Max 10 entries per page */}
        {filteredFolders.length > 0 && (
          <div className="px-4 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 bg-muted/10">
            <div className="text-xs text-muted-foreground">
              Showing <span className="font-semibold text-foreground">{filteredFolders.length > 0 ? startIndex + 1 : 0}</span> to{" "}
              <span className="font-semibold text-foreground">{Math.min(startIndex + pageSize, filteredFolders.length)}</span> of{" "}
              <span className="font-semibold text-foreground">{filteredFolders.length}</span> employee document folders
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={validCurrentPage <= 1}
                className="p-1.5 rounded-[4px] border border-border bg-card hover:bg-muted text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs text-foreground px-1.5 font-medium">
                Page {validCurrentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={validCurrentPage >= totalPages}
                className="p-1.5 rounded-[4px] border border-border bg-card hover:bg-muted text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                title="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={folderToDelete !== null} onOpenChange={(open) => !open && setFolderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Documents from SharePoint?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove F&F documents for employee <strong>{folderToDelete}</strong> from SharePoint?
              This will free up cloud storage. You can restore them anytime using the <strong>Re-Sync from DMS</strong> option.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? "Deleting..." : "Confirm Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

