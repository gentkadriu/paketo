import { X } from "lucide-react";
import { useI18n } from "../context/I18nContext";
import LeadPasteForm from "./LeadPasteForm";

export function Sheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold text-themed">{title}</h2>
          <button type="button" onClick={onClose} className="icon-btn !h-9 !w-9"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AddLeadsSheet({ open, onClose, batchId, onSubmit, busy }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={t("batch.addOrders")}>
      <LeadPasteForm
        batchId={batchId}
        onSubmit={onSubmit}
        busy={busy}
        submitLabel={t("batch.addOrdersSubmit")}
      />
    </Sheet>
  );
}

export function BulkIdsSheet({ open, onClose, text, onChange, onSubmit, busy, waitingCount }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={t("batch.bulkIdsTitle")}>
      <p className="mb-3 text-sm text-themed-muted">{t("batch.bulkIdsHint", { count: waitingCount })}</p>
      <textarea
        className="input-field min-h-[200px] font-mono text-sm"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="91760000346523&#10;91793000346521&#10;..."
      />
      <button type="button" disabled={busy || !text.trim()} onClick={onSubmit} className="btn-primary mt-4 w-full min-h-[48px]">
        {busy ? t("common.loading") : t("batch.bulkIdsApply")}
      </button>
    </Sheet>
  );
}

export const PROBLEM_STATUSES = ["returned_to_warehouse", "delivery_canceled", "return_pending", "rejected", "returned"];

export const FILTER_CHIPS = [
  { id: "all", key: "filterAll" },
  { id: "no_id", key: "filterNoId" },
  { id: "transit", key: "filterTransit" },
  { id: "delivered", key: "filterDelivered" },
  { id: "problems", key: "filterProblems" },
];

export function filterLeadsByChip(leads, filter) {
  if (filter === "no_id") return leads.filter((l) => !(l.order_id || "").trim());
  if (filter === "delivered") return leads.filter((l) => l.lifecycle_status === "delivered");
  if (filter === "problems") return leads.filter((l) => PROBLEM_STATUSES.includes(l.lifecycle_status));
  if (filter === "transit") {
    return leads.filter((l) => ["sent", "in_warehouse", "in_transit", "out_for_delivery"].includes(l.lifecycle_status));
  }
  return leads;
}
