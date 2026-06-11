import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Sparkles, User, Lock, ArrowRight, Sun, Moon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../context/I18nContext";
import { useTheme } from "../context/ThemeContext";
import { LANGUAGES } from "../locales/translations";

export default function AuthPage() {
  const { user, loading, login, register } = useAuth();
  const { show } = useToast();
  const { t, lang, setLang } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") await login(username, password);
      else await register(username, password);
      show(mode === "login" ? t("common.welcomeBack") : t("common.accountCreated"));
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <div className="flex rounded-lg border border-themed overflow-hidden">
          {LANGUAGES.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={`px-2 py-1 text-[11px] font-bold transition ${lang === code ? "bg-indigo-600 text-white" : "text-themed-muted hover:text-themed bg-themed-hover"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={toggleTheme} className="icon-btn">
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      <div className="w-full max-w-md animate-slide-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-2xl shadow-indigo-900/50">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <h1 className="font-display text-4xl font-bold text-themed">Paketo</h1>
          <p className="mt-2 text-themed-muted">{t("tagline")}</p>
        </div>

        <div className="glass p-8">
          <div className="mb-6 flex rounded-xl bg-themed-hover p-1">
            {["login", "register"].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                  mode === m ? "bg-indigo-600 text-white shadow" : "text-themed-muted hover:text-themed"
                }`}
              >
                {t(`auth.${m}`)}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-themed-subtle">{t("auth.username")}</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-themed-subtle" />
                <input
                  className="input-field pl-10"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="yourname"
                  autoComplete="username"
                  required
                  minLength={3}
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-themed-subtle">{t("auth.password")}</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-themed-subtle" />
                <input
                  type="password"
                  className="input-field pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  minLength={6}
                />
              </div>
            </div>
            <button type="submit" disabled={busy} className="btn-primary w-full mt-2">
              {t(`auth.${mode}`)}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
