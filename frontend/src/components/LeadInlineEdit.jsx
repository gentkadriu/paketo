import { useEffect, useState } from "react";
import { Pencil, Save, X } from "lucide-react";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../context/I18nContext";
import { formatCityPostal } from "../leadFormat";

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
    });
  }, [lead.id, lead.first_name, lead.last_name, lead.street, lead.city, lead.postal_code, lead.phone]);

  const resetDraft = () => {
    setDraft({
      first_name: lead.first_name || "",
      last_name: lead.last_name || "",
      street: lead.street || "",
      city: lead.city || "",
      postal_code: lead.postal_code || "",
      phone: lead.phone || "",
    });
  };

  const cancel = () => {
    resetDraft();
    setEditing(false);
  };

  const dirty = ["first_name", "last_name", "street", "city", "postal_code", "phone"].some(
    (k) => (draft[k] || "").trim() !== (lead[k] || "").trim(),
  );

  const save = async () => {
    if (!draft.first_name.trim()) {
      show(t("newBatch.enterName"), "error");
      return;
    }
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

  const field = (key, label, className = "") => (
    <div className={className}>
      <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-themed-subtle">{label}</label>
      <input
        className="input-field !py-1.5 text-sm"
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
          {(lead.bundle_count > 1 || lead.stock_units > 0 || lead.sale_product_rsd > 0) && (
            <div className="text-indigo-400/90 text-xs">
              {t("batch.bundleInfo", {
                bundles: lead.bundle_count || 1,
                pcs: lead.stock_units || (lead.bundle_count || 1) * 2,
              })}
              {lead.sale_product_rsd > 0 && (
                <span> · {t("batch.bundleProductRsd", { rsd: lead.sale_product_rsd })}</span>
              )}
            </div>
          )}
          {lead.notes && (
            <div className="text-amber-500/90 text-xs">{t("batch.notes")}: {lead.notes}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="icon-btn !h-8 !w-8 shrink-0 text-themed-muted hover:text-themed"
          title={t("batch.editOrder")}
          aria-label={t("batch.editOrder")}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-themed-subtle">{t("batch.editFields")}</p>
        <button
          type="button"
          onClick={cancel}
          className="icon-btn !h-7 !w-7 text-themed-muted hover:text-themed"
          title={t("common.cancel")}
          aria-label={t("common.cancel")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {field("first_name", t("batch.fieldFirst"))}
        {field("last_name", t("batch.fieldLast"))}
        {field("street", t("batch.fieldStreet"), "sm:col-span-2")}
        {field("city", t("batch.fieldCity"))}
        {field("postal_code", t("batch.fieldPostal"))}
        {field("phone", t("batch.fieldPhone"), "sm:col-span-2")}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy || !dirty} className="btn-secondary !py-1.5 text-xs">
          <Save className="h-3.5 w-3.5" /> {t("common.save")}
        </button>
        <button type="button" onClick={cancel} disabled={busy} className="btn-secondary !py-1.5 text-xs">
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
