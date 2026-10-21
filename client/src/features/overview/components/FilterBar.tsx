import { Search } from "lucide-react";

const APPROVAL_DEPARTMENTS = [
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
  "Legatrix"
];

const APPROVAL_STATUSES = ["Pending", "Completed", "In Progress"];

interface FilterBarProps {
  departmentFilter?: string;
  setDepartmentFilter?: (value: string) => void;
  ndcStageFilter: string;
  setNdcStageFilter: (value: string) => void;
  approvalDepartmentFilter: string;
  setApprovalDepartmentFilter: (value: string) => void;
  approvalStatusFilter: string;
  setApprovalStatusFilter: (value: string) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  departments?: string[];
  ndcStages: string[];
}

export function FilterBar({
  ndcStageFilter,
  setNdcStageFilter,
  approvalDepartmentFilter,
  setApprovalDepartmentFilter,
  approvalStatusFilter,
  setApprovalStatusFilter,
  searchQuery,
  setSearchQuery,
  ndcStages,
}: FilterBarProps) {
  return (
    <div className="bg-card rounded-[4px] p-6 border border-border mb-6">
      <h3 className="text-lg font-bold mb-4 text-foreground">Filters</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">NDC Stage</label>
          <select
            value={ndcStageFilter}
            onChange={(e) => setNdcStageFilter(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md bg-input-background focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Stages</option>
            {ndcStages.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Approval Department</label>
          <select
            value={approvalDepartmentFilter}
            onChange={(e) => setApprovalDepartmentFilter(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md bg-input-background focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Select Approval Department</option>
            {APPROVAL_DEPARTMENTS.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Approval Status</label>
          <select
            value={approvalStatusFilter}
            onChange={(e) => setApprovalStatusFilter(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md bg-input-background focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Select Approval Status</option>
            {APPROVAL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-1">
          <label className="block text-sm font-medium text-foreground mb-2">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <input
              type="text"
              placeholder="Search by Employee Name or Person Number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-border rounded-md bg-input-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
