import { AlertTriangle } from "lucide-react";
import { useI18n } from "../context/I18nContext";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy = false,
  danger = true,
}) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onCancel}>
      <div
        className="sheet-panel sm:max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          {danger && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="font-display text-lg font-bold text-themed">
              {title}
            </h2>
            {message && (
              <p className="mt-2 text-sm text-themed-muted leading-relaxed">{message}</p>
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-secondary min-h-[44px] w-full sm:w-auto"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel || t("common.cancel")}
          </button>
          <button
            type="button"
            className={`min-h-[44px] w-full sm:w-auto rounded-xl px-4 font-medium transition ${
              danger
                ? "bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50"
                : "btn-primary"
            }`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t("common.loading") : (confirmLabel || t("common.delete"))}
          </button>
        </div>
      </div>
    </div>
  );
}
