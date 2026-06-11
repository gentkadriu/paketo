import { NavLink } from "react-router-dom";
import { LayoutDashboard, Plus, BarChart3 } from "lucide-react";
import { useI18n } from "../context/I18nContext";

export default function MobileNav() {
  const { t } = useI18n();
  const items = [
    { to: "/", icon: LayoutDashboard, label: t("nav.batches"), end: true },
    { to: "/new", icon: Plus, label: t("nav.newBatch") },
    { to: "/stats", icon: BarChart3, label: t("nav.stats") },
  ];

  return (
    <nav className="mobile-nav md:hidden">
      {items.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `mobile-nav-item ${isActive ? "active" : ""}`}
        >
          <Icon className="h-5 w-5" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
