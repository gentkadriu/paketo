import { STATUS_STYLES } from "../api";

export default function StatusPill({ status, label }) {
  const cls = STATUS_STYLES[status] || STATUS_STYLES.unknown;
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label || status}
    </span>
  );
}
