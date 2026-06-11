import { ChevronLeft, ChevronRight } from "lucide-react";
import Select from "./Select";

export default function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);

  return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 p-4">
      <span className="text-sm text-slate-500">
        {total === 0 ? "No orders" : `${start}–${end} of ${total}`}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </button>
        <span className="min-w-[7rem] px-2 text-center text-sm text-slate-400">
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <Select
        value={String(pageSize)}
        onChange={(v) => onPageSizeChange(Number(v))}
        options={pageSizeOptions.map((n) => ({
          value: String(n),
          label: `${n} per page`,
          hint: "Orders shown on this page",
        }))}
      />
    </div>
  );
}
