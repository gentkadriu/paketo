import { NavLink } from "react-router-dom";
import { LayoutDashboard, BarChart3, Wallet, Settings, Shield } from "lucide-react";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";

export default function MobileNav() {
  const { t } = useI18n();
  const { user } = useAuth();
  const items = [
    { to: "/", icon: LayoutDashboard, label: t("nav.batches"), end: true },
    { to: "/stats", icon: BarChart3, label: t("nav.stats") },
    { to: "/finance", icon: Wallet, label: t("nav.finance") },
    { to: "/settings", icon: Settings, label: t("nav.settings") },
  ];
  if (user?.role === "admin") {
    items.push({ to: "/admin", icon: Shield, label: t("nav.admin") });
  }

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
