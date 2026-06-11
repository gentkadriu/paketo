import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, ChevronRight, Package } from "lucide-react";
import { api, formatDate } from "../api";
import { useI18n } from "../context/I18nContext";
import StatusPill from "../components/StatusPill";
import TodayCards from "../components/TodayCards";

export default function Dashboard() {
  const { t } = useI18n();
  const [kind, setKind] = useState("imported");
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [batches, setBatches] = useState([]);
  const [today, setToday] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api("/dashboard/today").then(setToday).catch(() => {});
  }, [batches]);

  useEffect(() => {
    api(`/dashboard/dates?kind=${kind}`).then(setDates);
  }, [kind]);

  useEffect(() => {
    const q = new URLSearchParams({ kind });
    if (selectedDate) q.set("date", selectedDate);
    api(`/dashboard/batches?${q}`).then(setBatches);
  }, [kind, selectedDate]);

  const phase = (b) => {
    if (b.status === "tracking") return { s: "in_transit", key: "phaseTracking" };
    if (b.sent_at) return { s: "sent", key: "phaseSent" };
    return { s: "registered", key: "phaseRegistered" };
  };

  return (
    <div className="animate-slide-up space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold text-themed">{t("dashboard.title")}</h1>
        <p className="mt-1 text-sm text-themed-muted">{t("dashboard.subtitle")}</p>
      </div>

      <TodayCards data={today} />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr] lg:gap-6">
        <div className="glass p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-themed-subtle">
              <Calendar className="h-4 w-4" /> {t("common.selectDay")}
            </div>
            <div className="flex rounded-md border border-themed p-0.5 text-[10px] sm:text-[11px]">
              {["imported", "sent"].map((k) => (
                <button
                  key={k}
                  onClick={() => { setKind(k); setSelectedDate(null); }}
                  className={`rounded px-2 py-1 font-medium min-h-[32px] ${kind === k ? "bg-indigo-600 text-white" : "text-themed-muted"}`}
                >
                  {k === "imported" ? t("dashboard.importDate") : t("dashboard.sentDate")}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-48 sm:max-h-96 space-y-1 overflow-y-auto">
            <button
              onClick={() => setSelectedDate(null)}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-3 sm:py-2.5 text-sm min-h-[44px] sm:min-h-0 ${!selectedDate ? "bg-indigo-600/20 text-indigo-600 dark:text-indigo-200" : "text-themed-muted hover:bg-themed-hover"}`}
            >
              {t("common.allDates")}
            </button>
            {dates.map((d) => (
              <button
                key={d.date}
                onClick={() => setSelectedDate(d.date)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-3 sm:py-2.5 text-sm min-h-[44px] sm:min-h-0 ${selectedDate === d.date ? "bg-indigo-600/20 text-indigo-600 dark:text-indigo-200" : "text-themed-muted hover:bg-themed-hover"}`}
              >
                <span>{formatDate(d.date)}</span>
                <span className="text-xs text-themed-subtle">{d.batch_count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3">
          {batches.length === 0 ? (
            <div className="glass flex flex-col items-center justify-center py-12 sm:py-16 text-themed-muted">
              <Package className="mb-3 h-10 w-10 opacity-40" />
              <p>{t("dashboard.noBatches")}</p>
            </div>
          ) : (
            batches.map((b) => {
              const p = phase(b);
              return (
                <button
                  key={b.id}
                  onClick={() => navigate(`/batch/${b.id}`)}
                  className="glass group flex w-full items-center justify-between gap-3 p-4 sm:p-5 text-left min-h-[72px] hover:bg-themed-hover active:scale-[0.99] transition"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-themed truncate">{b.name}</div>
                    <div className="mt-1 text-xs sm:text-sm text-themed-muted truncate">
                      {t("common.imported")} {formatDate(b.imported_date)}
                      {" · "}{t("dashboard.ordersCount", { count: b.lead_count, ids: b.linked_count })}
                    </div>
                    <div className="mt-2"><StatusPill status={p.s} label={t(`dashboard.${p.key}`)} /></div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-themed-subtle" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
