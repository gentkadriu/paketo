import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { api, formatDate } from "../api";
import { useI18n } from "../context/I18nContext";
import StatusPill from "../components/StatusPill";
import Select from "../components/Select";
import TimelineChart from "../components/TimelineChart";

export default function StatsPage() {
  const { t, ts } = useI18n();
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [stats, setStats] = useState(null);
  const [timeline, setTimeline] = useState(null);

  useEffect(() => {
    api("/dashboard/dates?kind=imported").then(setDates);
    api("/statistics/timeline?days=14").then(setTimeline).catch(() => {});
  }, []);

  useEffect(() => {
    const q = date ? `?date=${date}` : "";
    api(`/statistics${q}`).then(setStats);
  }, [date]);

  if (!stats) return <div className="text-themed-muted">{t("stats.loading")}</div>;

  const deliveryRate = stats.total
    ? Math.round((stats.items.find((i) => i.status === "delivered")?.count || 0) / stats.total * 100)
    : 0;

  return (
    <div className="animate-slide-up space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold text-themed">{t("stats.title")}</h1>
        <p className="mt-1 text-sm text-themed-muted">
          {t("stats.subtitle", { count: stats.total })}
          {stats.total > 0 && ` · ${t("stats.deliveryRate", { rate: deliveryRate })}`}
        </p>
      </div>

      <TimelineChart timeline={timeline?.timeline} />

      <div className="glass max-w-full sm:max-w-xs p-4">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-themed-subtle">{t("stats.filterDate")}</label>
        <Select
          value={date}
          onChange={setDate}
          options={[
            { value: "", label: t("stats.allDates"), hint: t("common.allDates"), icon: CalendarDays },
            ...dates.map((d) => ({ value: d.date, label: formatDate(d.date), icon: CalendarDays })),
          ]}
        />
      </div>

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
