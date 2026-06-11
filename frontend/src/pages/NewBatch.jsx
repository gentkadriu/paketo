import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../context/I18nContext";
import { useSearchIndex } from "../context/SearchIndexContext";
import LeadPasteForm from "../components/LeadPasteForm";

export default function NewBatch() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { show } = useToast();
  const { refresh: refreshSearch } = useSearchIndex();

  const submit = async (leadsText) => {
    if (!name.trim()) return show(t("newBatch.enterName"), "error");
    setBusy(true);
    try {
      const batch = await api("/batches", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), leads_text: leadsText }),
      });
      show(t("newBatch.created", { name: batch.name, count: batch.lead_count }));
      await refreshSearch();
      navigate(`/batch/${batch.id}`);
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl animate-slide-up">
      <h1 className="font-display text-xl sm:text-2xl font-bold text-themed">{t("newBatch.title")}</h1>
      <p className="mt-1 mb-4 sm:mb-6 text-sm text-themed-muted">{t("newBatch.subtitle")}</p>

      <div className="glass space-y-5 p-4 sm:p-6">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-themed-subtle">
            {t("newBatch.batchName")} <span className="text-indigo-500">*</span>
          </label>
          <input
            className="input-field text-base font-medium min-h-[48px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("newBatch.namePlaceholder")}
          />
        </div>
        <LeadPasteForm onSubmit={submit} busy={busy} submitLabel={t("newBatch.create")} />
      </div>
    </div>
  );
}
