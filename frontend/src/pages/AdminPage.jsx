import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Shield, UserPlus, Users } from "lucide-react";
import { api, formatDate } from "../api";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../context/I18nContext";

const SUBSCRIPTION_PRESETS = [30, 60, 90];
const SUBTRACT_PRESETS = [7, 30];

function subscriptionStatusClass(status) {
  if (status === "active") return "text-emerald-400";
  if (status === "trial") return "text-sky-400";
  if (status === "suspended") return "text-amber-400";
  return "text-rose-400";
}

function SubscriptionCell({ user, t, onAddDays, onSubtractDays, onSuspend, onUnsuspend }) {
  const [customDays, setCustomDays] = useState("");

  if (user.role === "admin") {
    return <span className="text-themed-muted text-xs">{t("admin.subUnlimited")}</span>;
  }

  const status = user.subscription_status;
  const daysLeft = user.subscription_days_remaining;
  const expiresLabel = user.subscription_expires_at
    ? formatDate(user.subscription_expires_at)
    : t("admin.subNoExpiry");

  const addDays = (days) => {
    onAddDays(user.id, days);
    setCustomDays("");
  };

  const subtractDays = (days) => {
    onSubtractDays(user.id, days);
    setCustomDays("");
  };

  return (
    <div className="space-y-2 min-w-[200px]">
      <div>
        <span className={`text-xs font-semibold uppercase ${subscriptionStatusClass(status)}`}>
          {t(`admin.sub${status.charAt(0).toUpperCase()}${status.slice(1)}`)}
        </span>
        <div className="text-xs text-themed-muted mt-0.5">
          {expiresLabel}
          {daysLeft != null && (
            <span className="block">
              {daysLeft > 0
                ? t("admin.subDaysLeft", { count: daysLeft })
                : t("admin.subExpiredShort")}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {SUBSCRIPTION_PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            className="btn-secondary !py-1 !px-2 text-[10px]"
            onClick={() => addDays(days)}
          >
            +{days}d
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          type="number"
          min="1"
          max="3650"
          className="input-field !py-1 !min-h-0 text-xs w-16"
          placeholder={t("admin.subCustomDays")}
          value={customDays}
          onChange={(e) => setCustomDays(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary !py-1 text-[10px] shrink-0"
          onClick={() => {
            const days = parseInt(customDays, 10);
            if (!days || days < 1) return;
            addDays(days);
          }}
        >
          <CalendarPlus className="h-3 w-3" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {SUBTRACT_PRESETS.map((days) => (
          <button
            key={`sub-${days}`}
            type="button"
            className="btn-secondary !py-1 !px-2 text-[10px] text-rose-400"
            onClick={() => subtractDays(days)}
          >
            −{days}d
          </button>
        ))}
      </div>
      {status === "suspended" ? (
        <button
          type="button"
          className="btn-secondary !py-1 text-[10px] w-full"
          onClick={() => onUnsuspend(user.id)}
        >
          {t("admin.subUnsuspend")}
        </button>
      ) : (
        <button
          type="button"
          className="btn-secondary !py-1 text-[10px] w-full text-amber-400"
          onClick={() => onSuspend(user.id)}
        >
          {t("admin.subSuspend")}
        </button>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { t } = useI18n();
  const { show } = useToast();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    username: "",
    password: "",
    name: "",
    store_name: "",
    subscription_days: "30",
  });
  const [busy, setBusy] = useState(false);
  const [resetPasswords, setResetPasswords] = useState({});

  const load = useCallback(() => {
    Promise.all([
      api("/admin/stats"),
      api("/admin/users"),
    ]).then(([s, u]) => {
      setStats(s);
      setUsers(u.users || []);
    }).catch((e) => show(e.message, "error"));
  }, [show]);

  useEffect(() => { load(); }, [load]);

  const createUser = async (e) => {
    e.preventDefault();
    const days = parseInt(form.subscription_days, 10);
    if (!days || days < 1) return show(t("admin.subDaysRequired"), "error");
    setBusy(true);
    try {
      await api("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: form.username,
          password: form.password,
          name: form.name,
          store_name: form.store_name,
          subscription_days: days,
        }),
      });
      setForm({
        username: "",
        password: "",
        name: "",
        store_name: "",
        subscription_days: "30",
      });
      show(t("admin.userCreated"));
      load();
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const updateUser = async (userId, patch) => {
    try {
      await api(`/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      load();
    } catch (err) {
      show(err.message, "error");
    }
  };

  const addSubscriptionDays = async (userId, days) => {
    try {
      await api(`/admin/users/${userId}/subscription/add`, {
        method: "POST",
        body: JSON.stringify({ days }),
      });
      show(t("admin.subTimeAdded", { count: days }));
      load();
    } catch (err) {
      show(err.message, "error");
    }
  };

  const subtractSubscriptionDays = async (userId, days) => {
    try {
      await api(`/admin/users/${userId}/subscription/subtract`, {
        method: "POST",
        body: JSON.stringify({ days }),
      });
      show(t("admin.subTimeRemoved", { count: days }));
      load();
    } catch (err) {
      show(err.message, "error");
    }
  };

  const resetPassword = async (userId) => {
    const password = (resetPasswords[userId] || "").trim();
    if (password.length < 8) return show(t("settings.passwordTooShort"), "error");
    try {
      await api(`/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ password }),
      });
      setResetPasswords((prev) => ({ ...prev, [userId]: "" }));
      show(t("admin.passwordReset"));
    } catch (err) {
      show(err.message, "error");
    }
  };

  if (!stats) return <div className="text-themed-muted">{t("common.loading")}</div>;

  return (
    <div className="animate-slide-up space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold text-themed flex items-center gap-2">
          <Shield className="h-7 w-7 text-indigo-400" />
          {t("admin.title")}
        </h1>
        <p className="mt-1 text-sm text-themed-muted">{t("admin.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {[
          ["users_total", t("admin.statUsers")],
          ["batches_total", t("admin.statBatches")],
          ["leads_total", t("admin.statOrders")],
          ["orders_paid", t("admin.statPaid")],
        ].map(([key, label]) => (
          <div key={key} className="glass p-4">
            <div className="text-xs text-themed-muted uppercase">{label}</div>
            <div className="mt-1 font-display text-2xl font-bold text-themed">{stats[key]}</div>
          </div>
        ))}
      </div>

      <form onSubmit={createUser} className="glass p-4 sm:p-6 space-y-3">
        <h2 className="font-semibold text-themed flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          {t("admin.createUser")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="input-field min-h-[48px]"
            placeholder={t("auth.username")}
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
            minLength={3}
          />
          <input
            className="input-field min-h-[48px]"
            type="password"
            placeholder={t("auth.password")}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
          />
          <input
            className="input-field min-h-[48px]"
            placeholder={t("admin.displayName")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="input-field min-h-[48px]"
            placeholder={t("settings.storeNamePlaceholder")}
            value={form.store_name}
            onChange={(e) => setForm({ ...form, store_name: e.target.value })}
          />
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-themed-muted">
              {t("admin.subInitialDays")}
            </label>
            <div className="flex flex-wrap gap-2 items-center">
              {SUBSCRIPTION_PRESETS.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`btn-secondary !py-2 text-xs ${form.subscription_days === String(days) ? "ring-2 ring-indigo-400" : ""}`}
                  onClick={() => setForm({ ...form, subscription_days: String(days) })}
                >
                  {t(`admin.subPreset${days}`)}
                </button>
              ))}
              <input
                type="number"
                min="1"
                max="3650"
                className="input-field min-h-[44px] w-24"
                value={form.subscription_days}
                onChange={(e) => setForm({ ...form, subscription_days: e.target.value })}
              />
              <span className="text-xs text-themed-muted">{t("admin.subDaysUnit")}</span>
            </div>
          </div>
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto min-h-[48px]">
          {t("admin.createUser")}
        </button>
      </form>

      <div className="glass p-4 sm:p-6">
        <h2 className="font-semibold text-themed flex items-center gap-2 mb-4">
          <Users className="h-5 w-5" />
          {t("admin.users")}
        </h2>
        <div className="hidden md:block overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-themed-muted text-xs uppercase">
                <th className="p-2">{t("auth.username")}</th>
                <th className="p-2">{t("admin.store")}</th>
                <th className="p-2">{t("admin.subscription")}</th>
                <th className="p-2">{t("admin.status")}</th>
                <th className="p-2">{t("admin.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-themed align-top">
                  <td className="p-2">
                    <div className="font-medium text-themed">{u.username}</div>
                    {u.role === "admin" && (
                      <span className="text-[10px] uppercase text-indigo-400 font-bold">Admin</span>
                    )}
                  </td>
                  <td className="p-2 text-themed-muted">{u.store_name || "—"}</td>
                  <td className="p-2">
                    <SubscriptionCell
                      user={u}
                      t={t}
                      onAddDays={addSubscriptionDays}
                      onSubtractDays={subtractSubscriptionDays}
                      onSuspend={(id) => updateUser(id, { subscription_status: "suspended" })}
                      onUnsuspend={(id) => updateUser(id, { subscription_status: "active" })}
                    />
                  </td>
                  <td className="p-2">
                    <span className={u.is_active ? "text-emerald-400" : "text-rose-400"}>
                      {u.is_active ? t("admin.active") : t("admin.inactive")}
                    </span>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-col sm:flex-row gap-1">
                      <button
                        type="button"
                        className="btn-secondary !py-1.5 text-xs"
                        onClick={() => updateUser(u.id, { is_active: !u.is_active })}
                      >
                        {u.is_active ? t("admin.deactivate") : t("admin.activate")}
                      </button>
                    </div>
                    <div className="mt-2 flex gap-1">
                      <input
                        type="password"
                        className="input-field !py-1.5 !min-h-0 text-xs flex-1 min-w-0"
                        placeholder={t("admin.newPassword")}
                        value={resetPasswords[u.id] || ""}
                        onChange={(e) => setResetPasswords((prev) => ({
                          ...prev,
                          [u.id]: e.target.value,
                        }))}
                      />
                      <button
                        type="button"
                        className="btn-secondary !py-1.5 text-xs shrink-0"
                        onClick={() => resetPassword(u.id)}
                      >
                        {t("admin.resetPassword")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-3">
          {users.map((u) => (
            <div key={u.id} className="rounded-xl border border-themed p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-themed">{u.username}</div>
                  {u.role === "admin" && (
                    <span className="text-[10px] uppercase text-indigo-400 font-bold">Admin</span>
                  )}
                  <div className="text-xs text-themed-muted mt-0.5">{u.store_name || "—"}</div>
                </div>
                <span className={u.is_active ? "text-emerald-400 text-xs" : "text-rose-400 text-xs"}>
                  {u.is_active ? t("admin.active") : t("admin.inactive")}
                </span>
              </div>
              <SubscriptionCell
                user={u}
                t={t}
                onAddDays={addSubscriptionDays}
                onSubtractDays={subtractSubscriptionDays}
                onSuspend={(id) => updateUser(id, { subscription_status: "suspended" })}
                onUnsuspend={(id) => updateUser(id, { subscription_status: "active" })}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary !py-1.5 text-xs flex-1"
                  onClick={() => updateUser(u.id, { is_active: !u.is_active })}
                >
                  {u.is_active ? t("admin.deactivate") : t("admin.activate")}
                </button>
              </div>
              <div className="flex gap-1">
                <input
                  type="password"
                  className="input-field !py-1.5 !min-h-0 text-xs flex-1 min-w-0"
                  placeholder={t("admin.newPassword")}
                  value={resetPasswords[u.id] || ""}
                  onChange={(e) => setResetPasswords((prev) => ({
                    ...prev,
                    [u.id]: e.target.value,
                  }))}
                />
                <button
                  type="button"
                  className="btn-secondary !py-1.5 text-xs shrink-0"
                  onClick={() => resetPassword(u.id)}
                >
                  {t("admin.resetPassword")}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
