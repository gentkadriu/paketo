import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Calendar, ChevronDown, ChevronRight, Package, Plus, Settings } from "lucide-react";
import { api, formatDate } from "../api";
import { useI18n } from "../context/I18nContext";
import StatusPill from "../components/StatusPill";
import TodayCards from "../components/TodayCards";
import { Sheet } from "../components/BatchSheets";

export default function Dashboard() {
  const { t } = useI18n();
  const [kind, setKind] = useState("imported");
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [batches, setBatches] = useState([]);
  const [today, setToday] = useState(null);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [hasProducts, setHasProducts] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api("/settings")
      .then((res) => setHasProducts((res.products || []).length > 0))
      .catch(() => setHasProducts(true));
  }, [batches]);

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
    if (b.linked_count > 0) return { s: "sent", key: "phaseSent" };
    return { s: "registered", key: "phaseRegistered" };
  };

  const selectedDateLabel = selectedDate ? formatDate(selectedDate) : t("common.allDates");
  const recentDates = dates.slice(0, 8);

  const pickDate = (date) => {
    setSelectedDate(date);
    setDateSheetOpen(false);
  };

  const batchList = (
    <div className="space-y-2 sm:space-y-3">
      {batches.length === 0 ? (
        <div className="glass flex flex-col items-center justify-center py-12 sm:py-16 text-themed-muted px-4 text-center">
          <Package className="mb-3 h-10 w-10 opacity-40" />
          <p>{t("dashboard.noBatches")}</p>
          {!hasProducts && (
            <p className="mt-2 text-sm max-w-sm">{t("dashboard.onboardingNoProduct")}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            {!hasProducts && (
              <Link to="/settings" className="btn-secondary inline-flex items-center gap-2 min-h-[44px]">
                <Settings className="h-4 w-4" />
                {t("dashboard.addProductCta")}
              </Link>
            )}
            <button
              type="button"
              onClick={() => navigate("/new")}
              className="btn-primary inline-flex items-center gap-2 min-h-[44px]"
            >
              <Plus className="h-4 w-4" />
              {t("nav.newBatch")}
            </button>
          </div>
        </div>
      ) : (
        batches.map((b) => {
          const p = phase(b);
          return (
            <button
              key={b.id}
              type="button"
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
  );

  const dateSidebar = (
    <div className="glass p-3 sm:p-4 lg:sticky lg:top-20 lg:self-start">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-themed-subtle">
          <Calendar className="h-4 w-4" /> {t("common.selectDay")}
        </div>
        <div className="flex rounded-md border border-themed p-0.5 text-[10px] sm:text-[11px]">
          {["imported", "sent"].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { setKind(k); setSelectedDate(null); }}
              className={`rounded px-2 py-1 font-medium min-h-[32px] ${kind === k ? "bg-indigo-600 text-white" : "text-themed-muted"}`}
            >
              {k === "imported" ? t("dashboard.importDate") : t("dashboard.sentDate")}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-96 space-y-1 overflow-y-auto">
        <button
          type="button"
          onClick={() => setSelectedDate(null)}
          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm min-h-[44px] ${!selectedDate ? "bg-indigo-600/20 text-indigo-600 dark:text-indigo-200" : "text-themed-muted hover:bg-themed-hover"}`}
        >
          {t("common.allDates")}
        </button>
        {dates.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => setSelectedDate(d.date)}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm min-h-[44px] ${selectedDate === d.date ? "bg-indigo-600/20 text-indigo-600 dark:text-indigo-200" : "text-themed-muted hover:bg-themed-hover"}`}
          >
            <span>{formatDate(d.date)}</span>
            <span className="text-xs text-themed-subtle">{d.batch_count}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="animate-slide-up space-y-3 sm:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-themed">{t("dashboard.title")}</h1>
          <p className="mt-1 text-sm text-themed-muted hidden sm:block">{t("dashboard.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/new")}
          className="btn-primary inline-flex items-center gap-2 min-h-[44px] shrink-0"
        >
          <Plus className="h-4 w-4" />
          {t("nav.newBatch")}
        </button>
      </div>

      {/* Mobile: batches first with compact sticky filters */}
      <div className="lg:hidden space-y-3">
        <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-20 -mx-1 px-1 pb-1 bg-[color:var(--bg)]/95 backdrop-blur-md">
          <div className="glass p-2.5 space-y-2">
            <div className="flex gap-2">
              {["imported", "sent"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setKind(k); setSelectedDate(null); }}
                  className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold min-h-[40px] ${kind === k ? "bg-indigo-600 text-white" : "bg-themed-hover text-themed-muted"}`}
                >
                  {k === "imported" ? t("dashboard.importDate") : t("dashboard.sentDate")}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDateSheetOpen(true)}
                className="flex min-h-[40px] flex-1 items-center justify-between gap-2 rounded-lg border border-themed bg-themed-hover/50 px-3 py-2 text-sm text-themed"
              >
                <span className="flex items-center gap-2 truncate">
                  <Calendar className="h-4 w-4 shrink-0 text-indigo-500" />
                  <span className="truncate">{selectedDateLabel}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-themed-subtle" />
              </button>
              <span className="shrink-0 rounded-lg bg-indigo-600/15 px-2.5 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
                {batches.length}
              </span>
            </div>
            {recentDates.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium min-h-[32px] ${!selectedDate ? "bg-indigo-600 text-white" : "bg-themed-hover text-themed-muted"}`}
                >
                  {t("common.allDates")}
                </button>
                {recentDates.map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setSelectedDate(d.date)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium min-h-[32px] ${selectedDate === d.date ? "bg-indigo-600 text-white" : "bg-themed-hover text-themed-muted"}`}
                  >
                    {formatDate(d.date)}
                    <span className="ml-1 opacity-70">({d.batch_count})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {batchList}

        <button
          type="button"
          onClick={() => setSummaryOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-xl border border-themed bg-themed-hover/30 px-4 py-3 text-sm font-medium text-themed-muted min-h-[44px]"
        >
          {t("dashboard.todaySummary")}
          <ChevronDown className={`h-4 w-4 transition ${summaryOpen ? "rotate-180" : ""}`} />
        </button>
        {summaryOpen && <TodayCards data={today} />}
      </div>

      {/* Desktop: sidebar + batches, today cards on top */}
      <div className="hidden lg:block space-y-6">
        <TodayCards data={today} />
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          {dateSidebar}
          {batchList}
        </div>
      </div>

      <Sheet open={dateSheetOpen} onClose={() => setDateSheetOpen(false)} title={t("common.selectDay")}>
        <div className="mb-3 flex rounded-lg border border-themed p-0.5 text-xs">
          {["imported", "sent"].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { setKind(k); setSelectedDate(null); }}
              className={`flex-1 rounded-md px-2 py-2 font-medium min-h-[40px] ${kind === k ? "bg-indigo-600 text-white" : "text-themed-muted"}`}
            >
              {k === "imported" ? t("dashboard.importDate") : t("dashboard.sentDate")}
            </button>
          ))}
        </div>
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          <button
            type="button"
            onClick={() => pickDate(null)}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-sm min-h-[48px] ${!selectedDate ? "bg-indigo-600/20 text-indigo-600 dark:text-indigo-200" : "text-themed-muted hover:bg-themed-hover"}`}
          >
            {t("common.allDates")}
          </button>
          {dates.map((d) => (
            <button
              key={d.date}
              type="button"
              onClick={() => pickDate(d.date)}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-sm min-h-[48px] ${selectedDate === d.date ? "bg-indigo-600/20 text-indigo-600 dark:text-indigo-200" : "text-themed-muted hover:bg-themed-hover"}`}
            >
              <span>{formatDate(d.date)}</span>
              <span className="text-xs text-themed-subtle">{d.batch_count}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
