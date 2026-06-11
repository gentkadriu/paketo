import { formatDate } from "../api";
import { useI18n } from "../context/I18nContext";

export default function TimelineChart({ timeline }) {
  const { t } = useI18n();
  if (!timeline?.length) {
    return <p className="text-sm text-themed-muted">{t("stats.noTimeline")}</p>;
  }

  const max = Math.max(...timeline.map((d) => Math.max(d.imported, d.delivered)), 1);

  return (
    <div className="glass p-4 sm:p-6">
      <h2 className="mb-4 font-semibold text-themed">{t("stats.ordersPerDay")}</h2>
      <div className="flex items-end gap-1 sm:gap-2 overflow-x-auto pb-2">
        {timeline.map((day) => (
          <div key={day.date} className="flex min-w-[36px] sm:min-w-[44px] flex-col items-center gap-1">
            <div className="flex h-24 sm:h-32 w-full items-end justify-center gap-0.5">
              <div
                className="w-2.5 sm:w-3 rounded-t bg-indigo-500/80 transition-all"
                style={{ height: `${(day.imported / max) * 100}%`, minHeight: day.imported ? 4 : 0 }}
                title={`${t("today.imported_today")}: ${day.imported}`}
              />
              <div
                className="w-2.5 sm:w-3 rounded-t bg-emerald-500/80 transition-all"
                style={{ height: `${(day.delivered / max) * 100}%`, minHeight: day.delivered ? 4 : 0 }}
                title={`${t("stats.delivered")}: ${day.delivered}`}
              />
            </div>
            <span className="text-[9px] sm:text-[10px] text-themed-subtle whitespace-nowrap">
              {formatDate(day.date).replace(/, \d{4}/, "")}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-themed-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-indigo-500/80" /> {t("stats.imported")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-500/80" /> {t("stats.delivered")}</span>
      </div>
    </div>
  );
}
