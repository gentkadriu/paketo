import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, BarChart3, LogOut, Sun, Moon, Wallet, Settings, Shield } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { useTheme } from "../context/ThemeContext";
import { LANGUAGES } from "../locales/translations";
import SearchBar from "./SearchBar";
import MobileNav from "./MobileNav";
import WelcomeBar from "./WelcomeBar";

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const nav = [
    { to: "/", icon: LayoutDashboard, label: t("nav.batches") },
    { to: "/stats", icon: BarChart3, label: t("nav.stats") },
    { to: "/finance", icon: Wallet, label: t("nav.finance") },
    { to: "/settings", icon: Settings, label: t("nav.settings") },
  ];
  if (user?.role === "admin") {
    nav.push({ to: "/admin", icon: Shield, label: t("nav.admin") });
  }

  return (
    <div className="min-h-screen overflow-x-hidden pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="header-bar overflow-visible">
        <div className="mx-auto max-w-6xl px-3 py-2 sm:px-6 sm:py-3">
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <button onClick={() => navigate("/")} className="flex items-center gap-2 group shrink-0 min-h-[44px]">
              <img
                src="/favicon.svg"
                alt=""
                className="h-9 w-9 rounded-xl shadow-md"
              />
              <span className="font-display text-base font-bold tracking-tight text-themed hidden sm:block">Paketo</span>
            </button>

            <nav className="hidden md:flex items-center gap-0.5">
              {nav.map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `nav-link !px-3 !py-2 ${isActive ? "active" : ""}`}>
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-1 shrink-0">
              <div className="flex rounded-lg border border-themed overflow-hidden">
                {LANGUAGES.map(({ code, label: langLabel }) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    className={`px-1.5 py-1.5 text-[10px] font-bold min-w-[28px] min-h-[32px] sm:min-w-[32px] ${lang === code ? "bg-indigo-600 text-white" : "text-themed-muted"}`}
                  >
                    {langLabel}
                  </button>
                ))}
              </div>
              <button type="button" onClick={toggleTheme} className="icon-btn !h-9 !w-9">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button onClick={logout} className="icon-btn !h-9 !w-9" title={`@${user?.username}`}>
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-2">
            <SearchBar />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-8 animate-fade-in">
        <WelcomeBar />
        <Outlet />
      </main>

      <MobileNav />
    </div>
  );
}
