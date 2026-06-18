import { useEffect, useState } from "react";
import { Pencil, Save, X } from "lucide-react";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../context/I18nContext";
import { formatCityPostal } from "../leadFormat";

const PIECE_FIELDS = ["first_name", "last_name", "street", "city", "postal_code", "phone", "notes", "stock_units"];

function displayPieces(lead) {
  if (lead.stock_units > 0) return lead.stock_units;
  return (lead.bundle_count || 1) * 2;
}

export default function LeadInlineEdit({ lead, onSaved }) {
  const { t } = useI18n();
  const { show } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    first_name: lead.first_name || "",
    last_name: lead.last_name || "",
    street: lead.street || "",
    city: lead.city || "",
    postal_code: lead.postal_code || "",
    phone: lead.phone || "",
    notes: lead.notes || "",
    stock_units: String(displayPieces(lead)),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft({
      first_name: lead.first_name || "",
      last_name: lead.last_name || "",
      street: lead.street || "",
      city: lead.city || "",
      postal_code: lead.postal_code || "",
      phone: lead.phone || "",
      notes: lead.notes || "",
      stock_units: String(displayPieces(lead)),
    });
  }, [
    lead.id,
    lead.first_name,
    lead.last_name,
    lead.street,
    lead.city,
    lead.postal_code,
    lead.phone,
    lead.notes,
    lead.stock_units,
    lead.bundle_count,
  ]);

  const resetDraft = () => {
    setDraft({
      first_name: lead.first_name || "",
      last_name: lead.last_name || "",
      street: lead.street || "",
      city: lead.city || "",
      postal_code: lead.postal_code || "",
      phone: lead.phone || "",
      notes: lead.notes || "",
      stock_units: String(displayPieces(lead)),
    });
  };

  const cancel = () => {
    resetDraft();
    setEditing(false);
  };

  const dirty = PIECE_FIELDS.some((k) => {
    if (k === "stock_units") {
      return parseInt(draft.stock_units, 10) !== displayPieces(lead);
    }
    return (draft[k] || "").trim() !== (lead[k] || "").trim();
  });

  const save = async () => {
    if (!draft.first_name.trim()) {
      show(t("newBatch.enterName"), "error");
      return;
    }
    const pieces = Math.max(0, parseInt(draft.stock_units, 10) || 0);
    setBusy(true);
    try {
      const updated = await api(`/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          first_name: draft.first_name.trim(),
          last_name: draft.last_name.trim(),
          street: draft.street.trim(),
          city: draft.city.trim(),
          postal_code: draft.postal_code.trim(),
          phone: draft.phone.trim(),
          notes: draft.notes.trim(),
          stock_units: pieces > 0 ? pieces : 2,
        }),
      });
      onSaved(updated);
      setEditing(false);
      show(t("batch.leadSaved"));
    } catch (e) {
      show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, className = "", type = "text") => (
    <div className={className}>
      <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-themed-subtle">{label}</label>
      <input
        type={type}
        className="input-field !py-1.5 text-sm min-h-[40px]"
        value={draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      />
    </div>
  );

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5 text-sm text-themed-muted">
          <div>{lead.street || "—"}</div>
          <div>{formatCityPostal(lead) || "—"}</div>
          <div>{lead.phone || "—"}</div>
          <div className="text-indigo-400/90 text-xs">
            {t("batch.bundleInfo", {
              bundles: lead.bundle_count || 1,
              pcs: displayPieces(lead),
            })}
            {lead.sale_product_rsd > 0 && (
              <span> · {t("batch.bundleProductRsd", { rsd: lead.sale_product_rsd })}</span>
            )}
          </div>
          {lead.notes && (
            <div className="text-amber-500/90 text-xs">{t("batch.notes")}: {lead.notes}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="icon-btn !h-9 !w-9 shrink-0 text-themed-muted hover:text-themed"
          title={t("batch.editOrder")}
          aria-label={t("batch.editOrder")}
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-themed bg-themed-hover/40 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-themed-subtle">{t("batch.editFields")}</p>
        <button
          type="button"
          onClick={cancel}
          className="icon-btn !h-8 !w-8 text-themed-muted hover:text-themed"
          title={t("common.cancel")}
          aria-label={t("common.cancel")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {field("first_name", t("batch.fieldFirst"))}
        {field("last_name", t("batch.fieldLast"))}
        {field("street", t("batch.fieldStreet"), "sm:col-span-2")}
        {field("city", t("batch.fieldCity"))}
        {field("postal_code", t("batch.fieldPostal"))}
        {field("phone", t("batch.fieldPhone"), "sm:col-span-2")}
        {field("stock_units", t("batch.fieldPieces"), "sm:col-span-2", "number")}
        <div className="sm:col-span-2">
          <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-themed-subtle">
            {t("batch.fieldNotes")}
          </label>
          <textarea
            className="input-field min-h-[72px] resize-y text-sm"
            value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            placeholder={t("batch.fieldNotesPlaceholder")}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy || !dirty} className="btn-primary !py-2 text-xs min-h-[40px]">
          <Save className="h-3.5 w-3.5" /> {t("common.save")}
        </button>
        <button type="button" onClick={cancel} disabled={busy} className="btn-secondary !py-2 text-xs min-h-[40px]">
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
