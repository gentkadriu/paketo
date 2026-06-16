import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, AlertTriangle, CheckCircle2, Truck, Hash, ChevronRight } from "lucide-react";
import { useI18n } from "../context/I18nContext";
import StatusPill from "./StatusPill";

export default function TodayCards({ data }) {
  const { t, ts } = useI18n();
  const navigate = useNavigate();
  const [problemsOpen, setProblemsOpen] = useState(false);

  if (!data) return null;

  const cards = [
    { key: "imported_today", value: data.imported_today, icon: Package, color: "text-indigo-500" },
    { key: "missing_id", value: data.missing_id, icon: Hash, color: "text-amber-500" },
    { key: "out_for_delivery", value: data.out_for_delivery, icon: Truck, color: "text-blue-500" },
    { key: "delivered_today", value: data.delivered_today ?? 0, icon: CheckCircle2, color: "text-emerald-500" },
    {
      key: "problems",
      value: data.problems,
      icon: AlertTriangle,
      color: "text-rose-500",
      clickable: data.problems > 0,
    },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 sm:gap-3">
        {cards.map(({ key, value, icon: Icon, color, clickable }) => {
          const active = key === "problems" && problemsOpen;
          const Tag = clickable ? "button" : "div";
          return (
            <Tag
              key={key}
              type={clickable ? "button" : undefined}
              onClick={clickable ? () => setProblemsOpen((o) => !o) : undefined}
              className={`glass p-3 sm:p-4 text-left transition ${
                clickable ? "cursor-pointer hover:bg-themed-hover active:scale-[0.98]" : ""
              } ${active ? "ring-2 ring-rose-500/50" : ""}`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-themed-subtle leading-tight">
                  {t(`today.${key}`)}
                </span>
              </div>
              <div className="mt-1 font-display text-2xl font-bold text-themed">{value}</div>
              {clickable && (
                <p className="mt-1 text-[10px] text-themed-subtle">{t("today.tapProblems")}</p>
              )}
            </Tag>
          );
        })}
      </div>

      {problemsOpen && data.problem_leads?.length > 0 && (
        <div className="glass divide-y divide-themed overflow-hidden">
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-themed-subtle">
            {t("today.problemsList", { count: data.problem_leads.length })}
          </div>
          {data.problem_leads.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => navigate(`/batch/${lead.batch_id}?filter=problems&lead=${lead.id}`)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left min-h-[56px] hover:bg-themed-hover active:bg-themed-hover transition"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-themed truncate">{lead.full_name}</div>
                <div className="mt-0.5 text-xs text-themed-muted truncate">
                  {lead.order_id || t("batch.noOrderId")} · {lead.batch_name}
                </div>
              </div>
              <StatusPill status={lead.lifecycle_status} label={ts(lead.lifecycle_status)} />
              <ChevronRight className="h-4 w-4 shrink-0 text-themed-subtle" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
