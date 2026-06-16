import { useMemo } from "react";
import { formatDate } from "../api";
import { useI18n } from "../context/I18nContext";

const COLORS = {
  imported: { stroke: "#6366f1", fill: "rgba(99, 102, 241, 0.12)", dot: "#818cf8" },
  delivered: { stroke: "#10b981", fill: "rgba(16, 185, 129, 0.12)", dot: "#34d399" },
};

function buildPath(points) {
  if (!points.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function buildArea(points, baseline) {
  if (!points.length) return "";
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}

export default function TimelineChart({ timeline, periodDays = 30, summary }) {
  const { t } = useI18n();

  const chart = useMemo(() => {
    if (!timeline?.length) return null;

    const n = timeline.length;
    const maxY = Math.max(...timeline.map((d) => Math.max(d.imported, d.delivered)), 1);
    const yTicks = maxY <= 5
      ? Array.from({ length: maxY + 1 }, (_, i) => i)
      : [0, Math.ceil(maxY / 2), maxY];

    const W = Math.max(640, n * 10);
    const H = 200;
    const pad = { top: 20, right: 16, bottom: 36, left: 32 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const baseline = pad.top + chartH;

    const xAt = (i) => pad.left + (n <= 1 ? chartW / 2 : (i / (n - 1)) * chartW);
    const yAt = (v) => pad.top + chartH - (v / maxY) * chartH;

    const importedPts = timeline.map((d, i) => ({ x: xAt(i), y: yAt(d.imported), v: d.imported, date: d.date }));
    const deliveredPts = timeline.map((d, i) => ({ x: xAt(i), y: yAt(d.delivered), v: d.delivered, date: d.date }));

    const labelStep = n <= 14 ? 2 : n <= 31 ? 5 : 10;
    const xLabels = timeline
      .map((d, i) => ({ i, date: d.date }))
      .filter(({ i }) => i === 0 || i === n - 1 || i % labelStep === 0);

    return {
      W,
      H,
      pad,
      chartH,
      baseline,
      maxY,
      yTicks,
      importedPts,
      deliveredPts,
      xLabels,
      xAt,
      yAt,
    };
  }, [timeline]);

  if (!timeline?.length || !chart) {
    return <p className="text-sm text-themed-muted">{t("stats.noTimeline")}</p>;
  }

  const peakDate = summary?.peak_delivery_date;

  return (
    <div className="glass p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-semibold text-themed">
          {t("stats.ordersPerDay", { days: periodDays })}
        </h2>
        {summary?.delivered_in_period > 0 && (
          <p className="text-xs text-themed-muted">
            {t("stats.periodDelivered", { count: summary.delivered_in_period })}
          </p>
        )}
      </div>

      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <svg
          viewBox={`0 0 ${chart.W} ${chart.H}`}
          className="h-[200px] min-w-full"
          style={{ minWidth: `${chart.W}px` }}
          role="img"
          aria-label={t("stats.ordersPerDay", { days: periodDays })}
        >
          <defs>
            <linearGradient id="grad-imported" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.imported.fill} />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <linearGradient id="grad-delivered" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.delivered.fill} />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>

          {/* Baseline */}
          <line
            x1={chart.pad.left}
            y1={chart.baseline}
            x2={chart.W - chart.pad.right}
            y2={chart.baseline}
            stroke="currentColor"
            strokeOpacity={0.15}
          />

          {/* Grid */}
          {chart.yTicks.map((tick) => {
            const y = chart.yAt(tick);
            return (
              <g key={tick}>
                <line
                  x1={chart.pad.left}
                  y1={y}
                  x2={chart.W - chart.pad.right}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.08}
                  strokeDasharray="4 4"
                />
                <text
                  x={chart.pad.left - 6}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-themed-subtle text-[10px]"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Areas */}
          <path d={buildArea(chart.importedPts, chart.baseline)} fill="url(#grad-imported)" />
          <path d={buildArea(chart.deliveredPts, chart.baseline)} fill="url(#grad-delivered)" />

          {/* Lines */}
          <path
            d={buildPath(chart.importedPts)}
            fill="none"
            stroke={COLORS.imported.stroke}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={buildPath(chart.deliveredPts)}
            fill="none"
            stroke={COLORS.delivered.stroke}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Dots on non-zero points */}
          {chart.importedPts.filter((p) => p.v > 0).map((p) => (
            <circle key={`i-${p.date}`} cx={p.x} cy={p.y} r={3.5} fill={COLORS.imported.dot}>
              <title>{`${formatDate(p.date)} · ${t("stats.imported")}: ${p.v}`}</title>
            </circle>
          ))}
          {chart.deliveredPts.filter((p) => p.v > 0).map((p) => (
            <circle
              key={`d-${p.date}`}
              cx={p.x}
              cy={p.y}
              r={peakDate && p.date === peakDate ? 5 : 3.5}
              fill={COLORS.delivered.dot}
              stroke={peakDate && p.date === peakDate ? "#fff" : "none"}
              strokeWidth={1.5}
            >
              <title>{`${formatDate(p.date)} · ${t("stats.delivered")}: ${p.v}`}</title>
            </circle>
          ))}

          {/* X labels */}
          {chart.xLabels.map(({ i, date }) => (
            <text
              key={date}
              x={chart.xAt(i)}
              y={chart.H - 8}
              textAnchor="middle"
              className="fill-themed-subtle text-[9px]"
            >
              {formatDate(date).replace(/, \d{4}/, "").slice(0, 6)}
            </text>
          ))}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-themed-muted">
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: COLORS.imported.stroke }} />
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS.imported.dot }} />
          {t("stats.imported")}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: COLORS.delivered.stroke }} />
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS.delivered.dot }} />
          {t("stats.delivered")}
        </span>
        {peakDate && summary?.peak_delivery_count > 0 && (
          <span className="text-emerald-500/90">
            {t("stats.peakLegend", { count: summary.peak_delivery_count, date: formatDate(peakDate) })}
          </span>
        )}
      </div>
    </div>
  );
}
