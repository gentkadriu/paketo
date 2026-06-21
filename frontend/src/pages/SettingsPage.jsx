import { useCallback, useEffect, useState } from "react";
import { KeyRound, Package, Pencil, Plus, Store, Star, Trash2, User, X, Send, ExternalLink, Unlink } from "lucide-react";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import ConfirmDialog from "../components/ConfirmDialog";

const emptyProduct = {
  product_code: "",
  name: "",
  sale_price_rsd: "",
  units_per_offer: "",
  product_cost_eur: "",
  delivery_fee_rsd: "490",
  is_default: true,
};

export default function SettingsPage() {
  const { t } = useI18n();
  const { user, refreshUser } = useAuth();
  const { show } = useToast();
  const [data, setData] = useState(null);
  const [profileForm, setProfileForm] = useState({ username: "", name: "" });
  const [defaultForm, setDefaultForm] = useState(null);
  const [storeName, setStoreName] = useState("");
  const [form, setForm] = useState(emptyProduct);
  const [busy, setBusy] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current: "",
    newPassword: "",
    confirm: "",
  });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [telegram, setTelegram] = useState(null);
  const [telegramLink, setTelegramLink] = useState(null);
  const [telegramBusy, setTelegramBusy] = useState(false);

  const loadTelegram = useCallback(() => {
    api("/settings/telegram")
      .then(setTelegram)
      .catch(() => setTelegram({ configured: false, linked: false }));
  }, []);

  const load = useCallback(() => {
    api("/settings").then((res) => {
      setData(res);
      setProfileForm({
        username: res.username || "",
        name: res.name || "",
      });
      setStoreName(res.store_name || "");
      const def = res.default_product;
      if (def) {
        setDefaultForm({
          name: def.name,
          sale_price_rsd: String(def.sale_price_rsd),
          units_per_offer: String(def.units_per_offer),
          product_cost_eur: def.product_cost_eur != null ? String(def.product_cost_eur) : "",
          delivery_fee_rsd: String(def.delivery_fee_rsd ?? 490),
        });
      } else {
        setDefaultForm(null);
      }
      if ((res.products || []).length === 0) setShowAddForm(true);
    }).catch((e) => show(e.message, "error"));
  }, [show]);

  useEffect(() => { load(); loadTelegram(); }, [load, loadTelegram]);

  const connectTelegram = async () => {
    setTelegramBusy(true);
    try {
      const res = await api("/settings/telegram/link", { method: "POST" });
      setTelegramLink(res);
      loadTelegram();
      show(t("settings.telegramLinkReady"));
    } catch (err) {
      show(err.message, "error");
    } finally {
      setTelegramBusy(false);
    }
  };

  const unlinkTelegram = async () => {
    setTelegramBusy(true);
    try {
      await api("/settings/telegram/unlink", { method: "POST" });
      setTelegramLink(null);
      loadTelegram();
      show(t("settings.telegramUnlinked"));
    } catch (err) {
      show(err.message, "error");
    } finally {
      setTelegramBusy(false);
    }
  };

  const toggleTelegram = async (enabled) => {
    setTelegramBusy(true);
    try {
      await api("/settings/telegram", {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      loadTelegram();
      show(enabled ? t("settings.telegramEnabled") : t("settings.telegramDisabled"));
    } catch (err) {
      show(err.message, "error");
    } finally {
      setTelegramBusy(false);
    }
  };

  const testTelegram = async () => {
    setTelegramBusy(true);
    try {
      await api("/settings/telegram/test", { method: "POST" });
      show(t("settings.telegramTestSent"));
    } catch (err) {
      show(err.message, "error");
    } finally {
      setTelegramBusy(false);
    }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!profileForm.username.trim()) return show(t("settings.usernameRequired"), "error");
    if (!profileForm.name.trim()) return show(t("settings.displayNameRequired"), "error");
    setBusy(true);
    try {
      await api("/settings/profile", {
        method: "PATCH",
        body: JSON.stringify({
          username: profileForm.username.trim(),
          name: profileForm.name.trim(),
        }),
      });
      await refreshUser();
      show(t("settings.profileSaved"));
      load();
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const saveDefaultProduct = async (e) => {
    e.preventDefault();
    const def = data?.default_product;
    if (!def || !defaultForm?.name?.trim()) {
      return show(t("settings.productNameRequired"), "error");
    }
    setBusy(true);
    try {
      await api(`/products/${def.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: defaultForm.name.trim(),
          sale_price_rsd: parseFloat(defaultForm.sale_price_rsd),
          units_per_offer: parseInt(defaultForm.units_per_offer, 10),
          product_cost_eur: defaultForm.product_cost_eur ? parseFloat(defaultForm.product_cost_eur) : null,
          delivery_fee_rsd: parseFloat(defaultForm.delivery_fee_rsd || "490"),
        }),
      });
      show(t("settings.defaultProductSaved"));
      load();
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const saveStore = async (e) => {
    e.preventDefault();
    if (!storeName.trim()) return show(t("settings.storeNameRequired"), "error");
    setBusy(true);
    try {
      await api("/settings/store", {
        method: "PATCH",
        body: JSON.stringify({ store_name: storeName.trim() }),
      });
      await refreshUser();
      show(t("settings.storeSaved"));
      load();
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (passwordForm.newPassword.length < 8) {
      return show(t("settings.passwordTooShort"), "error");
    }
    if (passwordForm.newPassword !== passwordForm.confirm) {
      return show(t("settings.passwordMismatch"), "error");
    }
    setBusy(true);
    try {
      await api("/settings/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: passwordForm.current,
          new_password: passwordForm.newPassword,
        }),
      });
      setPasswordForm({ current: "", newPassword: "", confirm: "" });
      show(t("settings.passwordChanged"));
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const addProduct = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/products", {
        method: "POST",
        body: JSON.stringify({
          product_code: form.product_code.trim(),
          name: form.name.trim(),
          sale_price_rsd: parseFloat(form.sale_price_rsd),
          units_per_offer: parseInt(form.units_per_offer, 10),
          product_cost_eur: form.product_cost_eur ? parseFloat(form.product_cost_eur) : null,
          delivery_fee_rsd: parseFloat(form.delivery_fee_rsd || "490"),
          is_default: form.is_default,
        }),
      });
      setForm(emptyProduct);
      setShowAddForm(false);
      show(t("settings.productSaved"));
      load();
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (productId) => {
    try {
      await api(`/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_default: true }),
      });
      load();
    } catch (err) {
      show(err.message, "error");
    }
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setEditForm({
      name: p.name,
      sale_price_rsd: String(p.sale_price_rsd),
      units_per_offer: String(p.units_per_offer),
      product_cost_eur: p.product_cost_eur != null ? String(p.product_cost_eur) : "",
      delivery_fee_rsd: String(p.delivery_fee_rsd ?? 490),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editForm?.name?.trim()) return show(t("settings.productNameRequired"), "error");
    setBusy(true);
    try {
      await api(`/products/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          sale_price_rsd: parseFloat(editForm.sale_price_rsd),
          units_per_offer: parseInt(editForm.units_per_offer, 10),
          product_cost_eur: editForm.product_cost_eur ? parseFloat(editForm.product_cost_eur) : null,
          delivery_fee_rsd: parseFloat(editForm.delivery_fee_rsd || "490"),
        }),
      });
      show(t("settings.productUpdated"));
      cancelEdit();
      load();
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const deleteMessage = (p) => {
    if (p.batch_count > 0) {
      return p.batch_count === 1
        ? t("settings.deleteProductBodyOneBatch", { name: p.name, code: p.product_code })
        : t("settings.deleteProductBodyBatches", { name: p.name, code: p.product_code, count: p.batch_count });
    }
    return t("settings.deleteProductBody", { name: p.name, code: p.product_code });
  };

  const requestDeleteProduct = (p) => {
    setDeleteTarget(p);
  };

  const confirmDeleteProduct = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api(`/products/${deleteTarget.id}/remove`, { method: "POST" });
      if (editingId === deleteTarget.id) cancelEdit();
      show(t("settings.productDeleted"));
      setDeleteTarget(null);
      load();
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="text-themed-muted">{t("common.loading")}</div>;

  return (
    <div className="animate-slide-up space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold text-themed">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-themed-muted">{t("settings.subtitle")}</p>
      </div>

      <form onSubmit={saveProfile} className="glass p-4 sm:p-6 space-y-3">
        <h2 className="font-semibold text-themed flex items-center gap-2">
          <User className="h-5 w-5 text-sky-400" />
          {t("settings.account")}
        </h2>
        <p className="text-sm text-themed-muted">{t("settings.accountHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="input-field min-h-[48px]"
            placeholder={t("auth.username")}
            value={profileForm.username}
            onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
            autoComplete="username"
            required
          />
          <input
            className="input-field min-h-[48px]"
            placeholder={t("settings.displayName")}
            value={profileForm.name}
            onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
            autoComplete="name"
            required
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto min-h-[48px]">
          {t("common.save")}
        </button>
      </form>

      {data.default_product && defaultForm ? (
        <form onSubmit={saveDefaultProduct} className="glass p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold text-themed flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-400 fill-current" />
            {t("settings.defaultProduct")}
          </h2>
          <p className="text-sm text-themed-muted">{t("settings.defaultProductHint")}</p>
          <div className="text-xs font-mono text-themed-muted">{data.default_product.product_code}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input-field min-h-[48px] sm:col-span-2"
              placeholder={t("settings.productName")}
              value={defaultForm.name}
              onChange={(e) => setDefaultForm({ ...defaultForm, name: e.target.value })}
              required
            />
            <input
              className="input-field min-h-[48px]"
              type="number"
              min="1"
              placeholder={t("settings.priceRsd")}
              value={defaultForm.sale_price_rsd}
              onChange={(e) => setDefaultForm({ ...defaultForm, sale_price_rsd: e.target.value })}
              required
            />
            <input
              className="input-field min-h-[48px]"
              type="number"
              min="1"
              max="20"
              placeholder={t("settings.unitsPerOffer")}
              value={defaultForm.units_per_offer}
              onChange={(e) => setDefaultForm({ ...defaultForm, units_per_offer: e.target.value })}
              required
            />
            <input
              className="input-field min-h-[48px]"
              type="number"
              step="0.01"
              min="0"
              placeholder={t("settings.productCostEur")}
              value={defaultForm.product_cost_eur}
              onChange={(e) => setDefaultForm({ ...defaultForm, product_cost_eur: e.target.value })}
            />
            <input
              className="input-field min-h-[48px]"
              type="number"
              min="0"
              placeholder={t("settings.deliveryFeeRsd")}
              value={defaultForm.delivery_fee_rsd}
              onChange={(e) => setDefaultForm({ ...defaultForm, delivery_fee_rsd: e.target.value })}
            />
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto min-h-[48px]">
            {t("settings.saveDefaultProduct")}
          </button>
        </form>
      ) : (
        <div className="glass p-4 sm:p-6">
          <h2 className="font-semibold text-themed flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-400" />
            {t("settings.defaultProduct")}
          </h2>
          <p className="text-sm text-themed-muted mt-2">{t("settings.noDefaultProduct")}</p>
        </div>
      )}

      <div className="glass p-4 sm:p-6 space-y-3">
        <h2 className="font-semibold text-themed flex items-center gap-2">
          <Send className="h-5 w-5 text-sky-400" />
          {t("settings.telegram")}
        </h2>
        <p className="text-sm text-themed-muted">{t("settings.telegramHint")}</p>
        {!telegram?.configured ? (
          <p className="text-sm text-themed-muted">{t("settings.telegramNotConfigured")}</p>
        ) : telegram.linked ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-400">{t("settings.telegramLinked")}</p>
            {telegram.is_group && telegram.group_name && (
              <p className="text-xs text-themed-muted">{t("settings.telegramGroup", { name: telegram.group_name })}</p>
            )}
            <label className="flex items-center gap-2 text-sm text-themed">
              <input
                type="checkbox"
                checked={telegram.enabled}
                disabled={telegramBusy}
                onChange={(e) => toggleTelegram(e.target.checked)}
              />
              {t("settings.telegramNotifications")}
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={telegramBusy} onClick={testTelegram} className="btn-secondary !py-2 text-xs">
                {t("settings.telegramTest")}
              </button>
              <button type="button" disabled={telegramBusy} onClick={unlinkTelegram} className="btn-secondary !py-2 text-xs text-rose-400">
                <Unlink className="h-3.5 w-3.5 inline mr-1" />
                {t("settings.telegramDisconnect")}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <button type="button" disabled={telegramBusy} onClick={connectTelegram} className="btn-primary min-h-[44px]">
              {t("settings.telegramConnect")}
            </button>
            {(telegramLink?.link || telegram?.link_pending) && (
              <div className="rounded-xl border border-themed p-3 space-y-2">
                <p className="text-sm text-themed">{t("settings.telegramOpenBot")}</p>
                {telegramLink?.link && (
                  <a
                    href={telegramLink.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary inline-flex items-center gap-2 !py-2 text-xs"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("settings.telegramOpenLink")}
                  </a>
                )}
                <p className="text-xs text-themed-muted">{t("settings.telegramLinkExpires")}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={changePassword} className="glass p-4 sm:p-6 space-y-3" autoComplete="on">
        <h2 className="font-semibold text-themed flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-amber-400" />
          {t("settings.password")}
        </h2>
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={user?.username || ""}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="absolute w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap border-0"
          style={{ clip: "rect(0,0,0,0)" }}
        />
        <input
          type="password"
          className="input-field min-h-[48px]"
          placeholder={t("settings.currentPassword")}
          value={passwordForm.current}
          onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
          autoComplete="current-password"
          required
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="password"
            className="input-field min-h-[48px]"
            placeholder={t("settings.newPassword")}
            value={passwordForm.newPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <input
            type="password"
            className="input-field min-h-[48px]"
            placeholder={t("settings.confirmPassword")}
            value={passwordForm.confirm}
            onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto min-h-[48px]">
          {t("settings.changePassword")}
        </button>
      </form>

      <form onSubmit={saveStore} className="glass p-4 sm:p-6 space-y-3">
        <h2 className="font-semibold text-themed flex items-center gap-2">
          <Store className="h-5 w-5 text-indigo-400" />
          {t("settings.store")}
        </h2>
        <input
          className="input-field min-h-[48px]"
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          placeholder={t("settings.storeNamePlaceholder")}
        />
        <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto min-h-[48px]">
          {t("common.save")}
        </button>
      </form>

      <div className="glass p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold text-themed flex items-center gap-2">
            <Package className="h-5 w-5 text-emerald-400" />
            {t("settings.products")}
          </h2>
          {data.products.length > 0 && !showAddForm && (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="btn-secondary !py-2 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> {t("settings.addProduct")}
            </button>
          )}
        </div>
        {data.products.length === 0 ? (
          <p className="text-sm text-themed-muted">{t("settings.noProducts")}</p>
        ) : (
          <div className="space-y-2">
            {data.products.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-themed p-3 space-y-3"
              >
                {editingId === p.id && editForm ? (
                  <form onSubmit={saveEdit} className="space-y-3">
                    <div className="font-medium text-themed flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-themed-muted">{p.product_code}</span>
                      {p.is_default && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-amber-400">
                          <Star className="h-3 w-3 fill-current" /> {t("settings.default")}
                        </span>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        className="input-field min-h-[44px] sm:col-span-2"
                        placeholder={t("settings.productName")}
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        required
                      />
                      <input
                        className="input-field min-h-[44px]"
                        type="number"
                        min="1"
                        placeholder={t("settings.priceRsd")}
                        value={editForm.sale_price_rsd}
                        onChange={(e) => setEditForm({ ...editForm, sale_price_rsd: e.target.value })}
                        required
                      />
                      <input
                        className="input-field min-h-[44px]"
                        type="number"
                        min="1"
                        max="20"
                        placeholder={t("settings.unitsPerOffer")}
                        value={editForm.units_per_offer}
                        onChange={(e) => setEditForm({ ...editForm, units_per_offer: e.target.value })}
                        required
                      />
                      <input
                        className="input-field min-h-[44px]"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder={t("settings.productCostEur")}
                        value={editForm.product_cost_eur}
                        onChange={(e) => setEditForm({ ...editForm, product_cost_eur: e.target.value })}
                      />
                      <input
                        className="input-field min-h-[44px]"
                        type="number"
                        min="0"
                        placeholder={t("settings.deliveryFeeRsd")}
                        value={editForm.delivery_fee_rsd}
                        onChange={(e) => setEditForm({ ...editForm, delivery_fee_rsd: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={busy} className="btn-primary !py-2 text-xs">
                        {t("common.save")}
                      </button>
                      <button type="button" onClick={cancelEdit} className="btn-secondary !py-2 text-xs">
                        <X className="h-3.5 w-3.5" /> {t("common.cancel")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-themed flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-themed-muted">{p.product_code}</span>
                        {p.name}
                        {p.is_default && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-amber-400">
                            <Star className="h-3 w-3 fill-current" /> {t("settings.default")}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-themed-muted mt-0.5">{p.offer_label}</div>
                      {p.batch_count > 0 && (
                        <div className="text-xs text-themed-muted mt-1">
                          {p.batch_count === 1
                            ? t("settings.productInOneBatch")
                            : t("settings.productInBatches", { count: p.batch_count })}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        className="btn-secondary !py-2 text-xs"
                      >
                        <Pencil className="h-3.5 w-3.5" /> {t("settings.editProduct")}
                      </button>
                      {!p.is_default && (
                        <button
                          type="button"
                          onClick={() => setDefault(p.id)}
                          className="btn-secondary !py-2 text-xs"
                        >
                          {t("settings.makeDefault")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => requestDeleteProduct(p)}
                        disabled={busy}
                        className="btn-secondary !py-2 text-xs text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> {t("common.delete")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {(showAddForm || data.products.length === 0) && (
      <form onSubmit={addProduct} className="glass p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-themed flex items-center gap-2">
            <Plus className="h-5 w-5" />
            {t("settings.addProduct")}
          </h2>
          {data.products.length > 0 && (
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setForm(emptyProduct); }}
              className="btn-secondary !py-1.5 text-xs"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="input-field min-h-[48px]"
            placeholder={t("settings.productCode")}
            value={form.product_code}
            onChange={(e) => setForm({ ...form, product_code: e.target.value.toUpperCase() })}
            required
          />
          <input
            className="input-field min-h-[48px]"
            placeholder={t("settings.productName")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            className="input-field min-h-[48px]"
            type="number"
            min="1"
            placeholder={t("settings.priceRsd")}
            value={form.sale_price_rsd}
            onChange={(e) => setForm({ ...form, sale_price_rsd: e.target.value })}
            required
          />
          <input
            className="input-field min-h-[48px]"
            type="number"
            min="1"
            max="20"
            placeholder={t("settings.unitsPerOffer")}
            value={form.units_per_offer}
            onChange={(e) => setForm({ ...form, units_per_offer: e.target.value })}
            required
          />
          <input
            className="input-field min-h-[48px]"
            type="number"
            step="0.01"
            min="0"
            placeholder={t("settings.productCostEur")}
            value={form.product_cost_eur}
            onChange={(e) => setForm({ ...form, product_cost_eur: e.target.value })}
          />
          <input
            className="input-field min-h-[48px]"
            type="number"
            min="0"
            placeholder={t("settings.deliveryFeeRsd")}
            value={form.delivery_fee_rsd}
            onChange={(e) => setForm({ ...form, delivery_fee_rsd: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-themed-muted">
          <input
            type="checkbox"
            checked={form.is_default || data.products.length === 0}
            onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
          />
          {t("settings.setAsDefault")}
        </label>
        <button type="submit" disabled={busy} className="btn-primary w-full min-h-[48px]">
          {t("settings.addProduct")}
        </button>
      </form>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t("settings.deleteProductTitle")}
        message={deleteTarget ? deleteMessage(deleteTarget) : ""}
        confirmLabel={t("settings.deleteProductConfirm")}
        onConfirm={confirmDeleteProduct}
        onCancel={() => !busy && setDeleteTarget(null)}
        busy={busy}
      />
    </div>
  );
}
