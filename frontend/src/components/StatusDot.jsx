const STATUS_DOT = {
  registered: "bg-slate-400",
  not_sent: "bg-zinc-500",
  sent: "bg-amber-400",
  in_warehouse: "bg-slate-400",
  in_transit: "bg-sky-400",
  out_for_delivery: "bg-blue-400",
  delivered: "bg-emerald-500",
  returned_to_warehouse: "bg-orange-400",
  delivery_canceled: "bg-orange-400",
  return_pending: "bg-orange-400",
  rejected: "bg-red-500",
  returned: "bg-red-500",
  unknown: "bg-slate-500",
};

export default function StatusDot({ status, label, className = "" }) {
  const color = STATUS_DOT[status] || STATUS_DOT.unknown;
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${color} ${className}`}
      title={label || status}
      aria-label={label || status}
    />
  );
}
