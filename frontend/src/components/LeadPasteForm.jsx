import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatCityPostal } from "../leadFormat";
import { api } from "../api";
import { useI18n } from "../context/I18nContext";

export default function LeadPasteForm({
  batchId = null,
  onSubmit,
  busy = false,
  submitLabel,
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  useEffect(() => {
    if (!text.trim()) {
      setPreview(null);
      return undefined;
    }
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      api("/leads/parse-preview", {
        method: "POST",
        body: JSON.stringify({ leads_text: text.trim(), batch_id: batchId }),
      })
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [text, batchId]);

  const duplicateCount = preview
    ? (preview.duplicate_count ?? preview.duplicates?.length ?? 0)
    : 0;
  const newCount = preview
    ? (preview.new_count ?? Math.max(0, (preview.count ?? 0) - duplicateCount))
    : 0;

  useEffect(() => {
    if (duplicateCount > 0) {
      setSkipDuplicates(true);
    }
  }, [duplicateCount]);

  const importCount = skipDuplicates && preview ? newCount : (preview?.count ?? 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (skipDuplicates && preview && importCount === 0) return;
    onSubmit({ leadsText: text.trim(), skipDuplicates });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <p className="mb-2 text-xs text-themed-muted">{t("paste.hint")}</p>
        <textarea
          className="input-field min-h-[160px] font-mono text-xs leading-relaxed sm:min-h-[200px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("paste.placeholder")}
        />
      </div>

      {(previewLoading || preview) && (
        <div className="glass space-y-2 p-3 text-sm">
          {previewLoading && (
            <div className="flex items-center gap-2 text-themed-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("paste.checking")}
            </div>
          )}
          {preview && !previewLoading && (
            <>
              <p className="font-medium text-themed">
                {t("paste.recognized", { count: preview.count })}
                {preview.skipped?.length > 0 && (
                  <span className="text-themed-muted"> · {t("paste.skipped", { count: preview.skipped.length })}</span>
                )}
              </p>
              {duplicateCount > 0 && (
                <>
                  <p className="text-xs text-amber-500">
                    {t("paste.duplicates", { count: duplicateCount })}
                  </p>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-themed-muted hover:text-themed">
                      {t("paste.duplicateNames", { count: duplicateCount })}
                    </summary>
                    <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto pl-1">
                      {(preview.duplicates || []).slice(0, 30).map((d, i) => (
                        <li key={i} className="truncate text-amber-500/90">
                          {d.full_name}
                          {d.batch_name && (
                            <span className="text-themed-subtle"> · {d.batch_name}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-themed bg-themed-hover/50 px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                      className="mt-0.5 accent-indigo-500"
                    />
                    <span>
                      <span className="font-medium text-themed">{t("paste.skipDuplicates")}</span>
                      <span className="mt-0.5 block text-xs text-themed-muted">
                        {skipDuplicates
                          ? t("paste.willImportNew", { count: newCount })
                          : t("paste.willImportAll", { count: preview.count })}
                      </span>
                    </span>
                  </label>
                </>
              )}
              {preview.skipped?.slice(0, 3).map((s) => (
                <p key={s.block} className="text-xs text-rose-400 truncate">{s.preview} — {s.reason}</p>
              ))}
              {preview.recognized?.slice(0, 4).map((l, i) => (
                <p key={i} className="text-xs text-themed-muted truncate">
                  {l.full_name}
                  {(l.bundle_count > 1 || l.stock_units > 0) && (
                    <span className="text-indigo-400/90">
                      {" "}
                      · {t("paste.bundleHint", {
                        bundles: l.bundle_count,
                        pcs: l.display_stock_units ?? (l.stock_units || l.bundle_count * 2),
                      })}
                    </span>
                  )}
                  {l.notes && (
                    <span className="text-amber-500/90"> · {l.notes}</span>
                  )}
                  {" · "}
                  {[l.street, formatCityPostal(l)].filter(Boolean).join(" · ") || "—"}
                </p>
              ))}
            </>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !text.trim() || previewLoading || (skipDuplicates && preview && importCount === 0)}
        className="btn-primary w-full min-h-[48px]"
      >
        {busy ? t("common.loading") : (submitLabel || t("paste.submit"))}
        {!busy && skipDuplicates && duplicateCount > 0 && importCount > 0 && (
          <span className="ml-1 opacity-80">({importCount})</span>
        )}
      </button>
    </form>
  );
}
