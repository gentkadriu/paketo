import { useEffect, useState } from "react";
import { CalendarDays, TrendingUp, Package, CheckCircle2, BarChart3 } from "lucide-react";
import { api, formatDate } from "../api";
import { useI18n } from "../context/I18nContext";
import StatusPill from "../components/StatusPill";
import Select from "../components/Select";
import TimelineChart from "../components/TimelineChart";

const PERIOD_OPTIONS = [
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

export default function StatsPage() {
  const { t, ts } = useI18n();
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [filterKind, setFilterKind] = useState("imported");
  const [periodDays, setPeriodDays] = useState("30");
  const [stats, setStats] = useState(null);
  const [timeline, setTimeline] = useState(null);

  useEffect(() => {
    api(`/dashboard/dates?kind=${filterKind}`).then(setDates).catch(() => setDates([]));
    setDate("");
  }, [filterKind]);

  useEffect(() => {
    api(`/statistics/timeline?days=${periodDays}`).then(setTimeline).catch(() => {});
  }, [periodDays]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (filterKind === "delivered") params.set("kind", "delivered");
    const q = params.toString() ? `?${params}` : "";
    api(`/statistics${q}`).then(setStats);
  }, [date, filterKind]);

  if (!stats) return <div className="text-themed-muted">{t("stats.loading")}</div>;

  const summary = timeline?.summary;
  const deliveredCount = stats.items.find((i) => i.status === "delivered")?.count || 0;
  const deliveryRate = stats.total
    ? Math.round(deliveredCount / stats.total * 100)
    : 0;

  const summaryCards = summary ? [
    { key: "totalDelivered", value: summary.total_delivered, icon: CheckCircle2, color: "text-emerald-500" },
    { key: "totalImported", value: summary.total_imported, icon: Package, color: "text-indigo-500" },
    { key: "avgDelivered", value: summary.avg_delivered_per_day, icon: TrendingUp, color: "text-sky-500" },
    {
      key: "peakDay",
      value: summary.peak_delivery_count || 0,
      sub: summary.peak_delivery_date ? formatDate(summary.peak_delivery_date) : "—",
      icon: BarChart3,
      color: "text-violet-500",
    },
  ] : [];

  return (
    <div className="animate-slide-up space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold text-themed">{t("stats.title")}</h1>
        <p className="mt-1 text-sm text-themed-muted">
          {t("stats.subtitle", { count: stats.total })}
          {stats.total > 0 && ` · ${t("stats.deliveryRate", { rate: deliveryRate })}`}
        </p>
      </div>

      {summaryCards.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {summaryCards.map(({ key, value, sub, icon: Icon, color }) => (
            <div key={key} className="glass p-3 sm:p-4">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-themed-subtle leading-tight">
                  {t(`stats.${key}`)}
                </span>
              </div>
              <div className="mt-1 font-display text-2xl font-bold text-themed">{value}</div>
              {sub && <p className="mt-0.5 text-[10px] text-themed-muted truncate">{sub}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="glass p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-themed-subtle">
              {t("stats.chartPeriod")}
            </label>
            <Select
              fullWidth
              compact
              value={periodDays}
              onChange={setPeriodDays}
              options={PERIOD_OPTIONS.map((o) => ({
                value: o.value,
                label: t(`stats.period${o.value}`),
              }))}
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-themed-subtle">
              {t("stats.filterKind")}
            </label>
            <Select
              fullWidth
              compact
              value={filterKind}
              onChange={setFilterKind}
              options={[
                { value: "imported", label: t("stats.filterImported") },
                { value: "delivered", label: t("stats.filterDelivered") },
              ]}
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-themed-subtle">
              {t("stats.filterDate")}
            </label>
            <Select
              fullWidth
              compact
              value={date}
              onChange={setDate}
              options={[
                { value: "", label: t("stats.allDates"), hint: t("common.allDates"), icon: CalendarDays },
                ...dates.map((d) => ({
                  value: d.date,
                  label: formatDate(d.date),
                  hint: filterKind === "delivered"
                    ? t("stats.ordersOnDay", { count: d.batch_count })
                    : `${d.batch_count} batches`,
                  icon: CalendarDays,
                })),
              ]}
            />
          </div>
        </div>
      </div>

      <TimelineChart timeline={timeline?.timeline} periodDays={Number(periodDays)} summary={summary} />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {stats.items.filter((i) => i.count > 0 || stats.total === 0).map((item) => (
          <div key={item.status} className="glass p-4 sm:p-5 text-center">
            <div className="font-display text-2xl sm:text-3xl font-bold text-themed">{item.count}</div>
            <div className="mt-2"><StatusPill status={item.status} label={ts(item.status)} /></div>
          </div>
        ))}
      </div>

      <div className="glass p-4 sm:p-6">
        <h2 className="mb-4 font-semibold text-themed">{t("stats.breakdown")}</h2>
        <div className="space-y-3">
          {stats.items.filter((i) => i.count > 0).map((item) => (
            <div key={item.status}>
              <div className="mb-1 flex justify-between text-sm gap-2">
                <span className="text-themed truncate">{ts(item.status)}</span>
                <span className="text-themed-muted shrink-0">{item.count} ({item.percent}%)</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-themed-hover">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${item.percent}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
