const API = "/api";

export async function api(path, options = {}) {
  const token = localStorage.getItem("paketo_token");
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg || String(d)).join(", ")
      : detail || "Something went wrong.";
    throw new Error(message);
  }
  return data;
}

export const ORDER_ID_LENGTH = 14;
export const ORDER_ID_PLACEHOLDER = "917XXXXXXXXXXX";

export const TRACKING_SCHEDULE_TIMES = "08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00";
export const TRACKING_SCHEDULE_LABEL = `Every 2 hours (${TRACKING_SCHEDULE_TIMES}) · Belgrade time`;

export function validateOrderId(id) {
  if (!id) return null;
  if (!/^\d{14}$/.test(id)) return `Order ID must be exactly ${ORDER_ID_LENGTH} digits starting with 917.`;
  if (!id.startsWith("917")) return "Order ID must start with 917.";
  return null;
}

export function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const STATUS_STYLES = {
  registered: "bg-slate-500/20 text-slate-300",
  not_sent: "bg-zinc-500/15 text-zinc-400 ring-1 ring-zinc-500/25",
  sent: "bg-amber-500/20 text-amber-300",
  in_warehouse: "bg-slate-500/20 text-slate-300",
  in_transit: "bg-sky-500/20 text-sky-300",
  out_for_delivery: "bg-blue-500/20 text-blue-300",
  delivered: "bg-emerald-500/20 text-emerald-300",
  returned_to_warehouse: "bg-yellow-500/20 text-yellow-300",
  delivery_canceled: "bg-orange-500/20 text-orange-300",
  return_pending: "bg-rose-500/20 text-rose-300",
  rejected: "bg-rose-500/20 text-rose-300",
  returned: "bg-orange-500/20 text-orange-300",
  unknown: "bg-slate-600/20 text-slate-400",
};

export const TRACK_CARD_STYLES = {
  not_sent: "border-zinc-500/20 bg-white/[0.02] opacity-80",
  delivered: "border-emerald-500/35 bg-emerald-500/[0.06]",
  out_for_delivery: "border-blue-500/35 bg-blue-500/[0.06]",
  returned_to_warehouse: "border-yellow-500/35 bg-yellow-500/[0.06]",
  delivery_canceled: "border-orange-500/35 bg-orange-500/[0.06]",
  return_pending: "border-rose-500/35 bg-rose-500/[0.06]",
  in_transit: "border-sky-500/25 bg-sky-500/[0.04]",
  in_warehouse: "border-slate-500/25 bg-white/[0.03]",
  sent: "border-amber-500/25 bg-amber-500/[0.04]",
  rejected: "border-rose-500/35 bg-rose-500/[0.06]",
  returned: "border-orange-500/35 bg-orange-500/[0.06]",
  unknown: "",
};

export function trackCardClass(status) {
  return TRACK_CARD_STYLES[status] || "";
}

export function isLeadTrackable(lead) {
  return Boolean((lead?.order_id || "").trim());
}
