import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSubmit(text.trim());
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
              {preview.duplicates?.length > 0 && (
                <p className="text-xs text-amber-500">{t("paste.duplicates", { count: preview.duplicates.length })}</p>
              )}
              {preview.skipped?.slice(0, 3).map((s) => (
                <p key={s.block} className="text-xs text-rose-400 truncate">{s.preview} — {s.reason}</p>
              ))}
              {preview.recognized?.slice(0, 4).map((l, i) => (
                <p key={i} className="text-xs text-themed-muted truncate">{l.full_name} · {l.city || l.street}</p>
              ))}
            </>
          )}
        </div>
      )}

      <button type="submit" disabled={busy || !text.trim() || previewLoading} className="btn-primary w-full min-h-[48px]">
        {busy ? t("common.loading") : (submitLabel || t("paste.submit"))}
      </button>
    </form>
  );
}
