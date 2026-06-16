import { useMemo, useState } from "react";
import { ChevronDown, Save } from "lucide-react";
import { useI18n } from "../context/I18nContext";

export default function CampaignPanel({
  adSpendUsd,
  setAdSpendUsd,
  boostDays,
  setBoostDays,
  savedSpend = null,
  savedDays = null,
  onSave,
  showSave = true,
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const dirty = useMemo(() => {
    const spend = adSpendUsd !== "" ? parseFloat(adSpendUsd) : 0;
    const saved = savedSpend ?? 0;
    const days = boostDays !== "" ? parseInt(boostDays, 10) : null;
    const savedD = savedDays ?? null;
    if (Math.abs((Number.isNaN(spend) ? 0 : spend) - saved) > 0.001) return true;
    return days !== savedD;
  }, [adSpendUsd, boostDays, savedSpend, savedDays]);

  const summary = useMemo(() => {
    const spend = dirty && adSpendUsd !== "" ? parseFloat(adSpendUsd) : savedSpend;
    const days = dirty && boostDays !== "" ? parseInt(boostDays, 10) : savedDays;
    if ((!spend || Number.isNaN(spend)) && (!days || Number.isNaN(days))) {
      return t("batch.campaignNotSet");
    }
    const parts = [];
    if (spend && !Number.isNaN(spend)) {
      parts.push(`$${Number(spend).toFixed(spend % 1 ? 2 : 0)}`);
    }
    if (days && !Number.isNaN(days)) {
      parts.push(t("batch.campaignBoostSummary", { count: days }));
    }
    return parts.join(" · ");
  }, [adSpendUsd, boostDays, savedSpend, savedDays, dirty, t]);

  return (
    <div className="rounded-xl border border-themed bg-themed-hover/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left min-h-[44px] hover:bg-themed-hover/60 transition"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-themed-muted">{t("batch.campaignFinance")}</span>
            {dirty && showSave && (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                {t("batch.campaignUnsaved")}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-themed">{summary}</p>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-themed-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-themed px-3 pb-3 pt-3 space-y-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium text-themed-muted">{t("batch.campaignFinance")}</label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-themed-muted">$</span>
                <input
                  className="input-field min-h-[44px] w-full pl-7"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={adSpendUsd}
                  onChange={(e) => setAdSpendUsd(e.target.value)}
                />
              </div>
            </div>
            <div className="w-full sm:w-24 shrink-0">
              <label className="mb-1 block text-xs font-medium text-themed-muted">{t("batch.boostDays")}</label>
              <input
                className="input-field min-h-[44px] w-full"
                type="number"
                min="0"
                step="1"
                placeholder="4"
                value={boostDays}
                onChange={(e) => setBoostDays(e.target.value)}
              />
            </div>
            {showSave && onSave && (
              <button type="button" onClick={onSave} className="btn-secondary min-h-[44px] w-full sm:w-auto shrink-0 px-4">
                <Save className="h-4 w-4" /> {t("common.save")}
              </button>
            )}
          </div>
          <p className="text-xs text-themed-muted">{t("batch.adSpendHint")}</p>
        </div>
      )}
    </div>
  );
}
