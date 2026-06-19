import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Package, Plus, Minus, Wallet, TrendingUp, Tag, Coins, Pencil, Trash2, Upload, Banknote } from "lucide-react";
import { api, apiUpload, formatDate } from "../api";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../context/I18nContext";
import SelectMenu from "../components/SelectMenu";

const BALANCE_CURRENCY_OPTIONS = [
  { value: "EUR", label: "EUR" },
  { value: "RSD", label: "RSD" },
  { value: "USD", label: "USD" },
];

const CURRENCY_OPTIONS = [
  { value: "EUR", label: "EUR €", hint: "Euro" },
  { value: "RSD", label: "RSD", hint: "Serbian dinar" },
  { value: "USD", label: "USD $", hint: "US dollar" },
];

const HIDDEN_TX_CATEGORIES = new Set(["stock_use", "stock_return"]);

const TX_CATEGORY_KEYS = {
  stock: "catStock",
  ads: "catAds",
  other: "catOther",
  adjustment: "catAdjustment",
  stock_use: "catStockUse",
  stock_return: "catStockReturn",
  payout: "catPayout",
};

function formatTxnAmount(tx) {
  const hasCash = Math.abs(tx.amount_eur) >= 0.005;
  const showStock = tx.category === "stock" && tx.stock_delta !== 0;
  const parts = [];
  if (hasCash) {
    parts.push(`${tx.amount_eur >= 0 ? "+" : ""}€${tx.amount_eur.toFixed(2)}`);
  }
  if (showStock) {
    parts.push(`${tx.stock_delta > 0 ? "+" : ""}${tx.stock_delta} pcs`);
  }
  if (!parts.length) return "—";
  return parts.join(" · ");
}

const EDITABLE_CATEGORIES = new Set(["stock", "ads", "other", "adjustment"]);

const SETTLEMENT_FILE_RE = /\.(xls|xlsx|pdf)$/i;
const SETTLEMENT_MIME_OK = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function isSettlementFile(file) {
  if (!file) return false;
  if (SETTLEMENT_FILE_RE.test(file.name || "")) return true;
  return SETTLEMENT_MIME_OK.has(file.type || "");
}

const CATEGORIES = [
  { id: "stock", key: "catStock" },
  { id: "ads", key: "catAds" },
  { id: "other", key: "catOther" },
  { id: "adjustment", key: "catAdjustment" },
];

function balanceInCurrency(data, currency) {
  const eur = data.balance_eur;
  if (currency === "RSD") return data.balance_rsd;
  if (currency === "USD") {
    const eurRsd = data.config?.eur_rsd || 117;
    const usdRsd = data.config?.usd_rsd || 101;
    return eur * eurRsd / usdRsd;
  }
  return eur;
}

function formatBalance(amount, currency) {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (currency === "EUR") return `${sign}€${abs.toFixed(2)}`;
  if (currency === "USD") return `${sign}$${abs.toFixed(2)}`;
  return `${sign}${Math.round(abs).toLocaleString()} RSD`;
}

export default function FinancePage() {
  const { t } = useI18n();
  const { show } = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [balanceCurrency, setBalanceCurrency] = useState(() => {
    try {
      const saved = localStorage.getItem("paketo_balance_currency");
      return BALANCE_CURRENCY_OPTIONS.some((o) => o.value === saved) ? saved : "EUR";
    } catch {
      return "EUR";
    }
  });
  const [editingTxId, setEditingTxId] = useState(null);
  const [settlementFile, setSettlementFile] = useState(null);
  const [settlementPreview, setSettlementPreview] = useState(null);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const [settlementDragging, setSettlementDragging] = useState(false);
  const settlementInputRef = useRef(null);
  const [form, setForm] = useState({
    direction: "expense",
    amount: "",
    currency: "EUR",
    category: "stock",
    note: "",
    stock_pieces: "",
  });
  const [configForm, setConfigForm] = useState(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const load = useCallback(() => {
    api("/finance/overview").then((res) => {
      setData(res);
      const c = res.config || {};
      setConfigForm({
        sale_price_rsd: String(c.sale_price_rsd ?? 1000),
        product_cost_eur: String(c.product_cost_eur ?? 2),
        shipping_cost_usd: String(c.shipping_cost_usd ?? 2),
        return_fee_rsd: String(c.return_fee_rsd ?? 500),
        units_per_order: String(c.units_per_order ?? 2),
        eur_rsd: String(c.eur_rsd ?? 117),
        usd_rsd: String(c.usd_rsd ?? 101),
      });
    }).catch((e) => show(e.message, "error"));
  }, [show]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    try {
      localStorage.setItem("paketo_balance_currency", balanceCurrency);
    } catch { /* ignore */ }
  }, [balanceCurrency]);

  const categoryOptions = useMemo(() => CATEGORIES.map(({ id, key }) => ({
    value: id,
    label: t(`finance.${key}`),
  })), [t]);

  const submitTxn = async (e) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) return show(t("finance.enterAmount"), "error");
    setBusy(true);
    try {
      const payload = {
        amount,
        currency: form.currency,
        direction: form.direction,
        category: form.category,
        note: form.note.trim(),
        stock_pieces: form.category === "stock" && form.stock_pieces
          ? parseInt(form.stock_pieces, 10)
          : null,
      };
      if (editingTxId) {
        await api(`/finance/transactions/${editingTxId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        show(t("finance.updated"));
      } else {
        await api("/finance/transactions", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        show(t("finance.saved"));
      }
      setForm({ direction: "expense", amount: "", currency: "EUR", category: "stock", note: "", stock_pieces: "" });
      setEditingTxId(null);
      load();
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const previewSettlement = useCallback(async (file) => {
    if (!file) return;
    setSettlementFile(file);
    setSettlementBusy(true);
    try {
      const preview = await apiUpload("/finance/settlements/preview", file);
      setSettlementPreview(preview);
    } catch (err) {
      setSettlementPreview(null);
      show(err.message, "error");
    } finally {
      setSettlementBusy(false);
    }
  }, [show]);

  const handleSettlementFile = useCallback((file) => {
    if (!file) return;
    if (!isSettlementFile(file)) {
      show(t("finance.settlementBadFile"), "error");
      return;
    }
    previewSettlement(file);
  }, [previewSettlement, show, t]);

  const onSettlementDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setSettlementDragging(true);
  }, []);

  const onSettlementDragLeave = useCallback((e) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setSettlementDragging(false);
    }
  }, []);

  const onSettlementDrop = useCallback((e) => {
    e.preventDefault();
    setSettlementDragging(false);
    handleSettlementFile(e.dataTransfer.files?.[0]);
  }, [handleSettlementFile]);

  const importSettlement = async () => {
    if (!settlementFile) return;
    if (settlementPreview?.already_imported) {
      return show(t("finance.settlementAlreadyImported"), "error");
    }
    if (!settlementPreview?.ready_count) {
      return show(t("finance.settlementNothingToApply"), "error");
    }
    setSettlementBusy(true);
    try {
      const result = await apiUpload("/finance/settlements/import", settlementFile);
      show(t("finance.settlementImported", {
        count: result.applied_count,
        rsd: Math.round(result.total_product_rsd).toLocaleString(),
      }));
      setSettlementFile(null);
      setSettlementPreview(null);
      load();
    } catch (err) {
      show(err.message, "error");
    } finally {
      setSettlementBusy(false);
    }
  };

  const settlementStatusLabel = (status) => {
    if (status === "ready") return t("finance.settlementReady");
    if (status === "already_paid") return t("finance.settlementAlreadyPaid");
    return t("finance.settlementNotFound");
  };

  const startEditTxn = (tx) => {
    setEditingTxId(tx.id);
    setForm({
      direction: tx.amount_eur >= 0 ? "income" : "expense",
      amount: String(Math.abs(tx.amount_eur)),
      currency: "EUR",
      category: EDITABLE_CATEGORIES.has(tx.category) ? tx.category : "other",
      note: tx.note || "",
      stock_pieces: tx.stock_delta > 0 ? String(tx.stock_delta) : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEditTxn = () => {
    setEditingTxId(null);
    setForm({ direction: "expense", amount: "", currency: "EUR", category: "stock", note: "", stock_pieces: "" });
  };

  const deleteTxn = async (tx) => {
    if (!confirm(t("finance.confirmDeleteTxn"))) return;
    try {
      await api(`/finance/transactions/${tx.id}`, { method: "DELETE" });
      if (editingTxId === tx.id) cancelEditTxn();
      load();
      show(t("finance.deleted"));
    } catch (err) {
      show(err.message, "error");
    }
  };

  const clearStockHistory = async () => {
    if (!confirm(t("finance.confirmClearStockHistory"))) return;
    try {
      await api("/finance/stock-entries/clear", { method: "POST" });
      if (editingTxId) cancelEditTxn();
      load();
      show(t("finance.stockHistoryCleared"));
    } catch (err) {
      show(err.message, "error");
    }
  };

  const saveConfig = async (e) => {
    e.preventDefault();
    if (!configForm) return;
    setConfigBusy(true);
    try {
      await api("/finance/config", {
        method: "PATCH",
        body: JSON.stringify({
          sale_price_rsd: parseFloat(configForm.sale_price_rsd),
          product_cost_eur: parseFloat(configForm.product_cost_eur),
          shipping_cost_usd: parseFloat(configForm.shipping_cost_usd),
          return_fee_rsd: parseFloat(configForm.return_fee_rsd),
          units_per_order: parseInt(configForm.units_per_order, 10),
          eur_rsd: parseFloat(configForm.eur_rsd),
          usd_rsd: parseFloat(configForm.usd_rsd),
        }),
      });
      show(t("finance.configSaved"));
      load();
    } catch (err) {
      show(err.message, "error");
    } finally {
      setConfigBusy(false);
    }
  };

  const { cashEntries, stockEntries } = useMemo(() => {
    const txs = (data?.transactions || []).filter((tx) => !HIDDEN_TX_CATEGORIES.has(tx.category));
    return {
      cashEntries: txs.filter((tx) => tx.category !== "stock"),
      stockEntries: txs.filter((tx) => tx.category === "stock"),
    };
  }, [data?.transactions]);

  const renderTxnRow = (tx) => (
    <div key={tx.id} className="flex items-center justify-between gap-2 py-2 border-b border-themed text-sm last:border-0">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-themed">{t(`finance.${TX_CATEGORY_KEYS[tx.category] || "catOther"}`)}</div>
        <div className="text-xs text-themed-muted truncate">{tx.note || formatDate(tx.created_at?.slice(0, 10))}</div>
      </div>
      <div className={`shrink-0 font-semibold text-right ${
        tx.stock_delta > 0 || tx.amount_eur > 0
          ? "text-emerald-500"
          : tx.stock_delta < 0 || tx.amount_eur < 0
            ? "text-rose-500"
            : "text-themed-muted"
      }`}>
        {formatTxnAmount(tx)}
      </div>
      {EDITABLE_CATEGORIES.has(tx.category) && (
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={() => startEditTxn(tx)} className="rounded-lg p-2 text-themed-muted hover:bg-themed-hover hover:text-themed" title={t("finance.editEntry")}>
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => deleteTxn(tx)} className="rounded-lg p-2 text-themed-muted hover:bg-rose-500/10 hover:text-rose-400" title={t("common.delete")}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );

  if (!data) return <div className="text-themed-muted">{t("common.loading")}</div>;

  const ordersLeft = Math.floor(data.stock_quantity / (data.units_per_order || 2));
  const balanceAmount = balanceInCurrency(data, balanceCurrency);

  return (
    <div className="animate-slide-up space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold text-themed">{t("finance.title")}</h1>
        <p className="mt-1 text-sm text-themed-muted">{t("finance.subtitle")}</p>
      </div>

      {configForm && (
        <div className="glass p-4 sm:p-6">
          <button
            type="button"
            onClick={() => setConfigOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div>
              <h2 className="font-semibold text-themed">{t("finance.configTitle")}</h2>
              <p className="text-sm text-themed-muted mt-0.5">{t("finance.configSubtitle")}</p>
            </div>
            <Pencil className={`h-4 w-4 shrink-0 text-themed-subtle transition ${configOpen ? "rotate-0" : ""}`} />
          </button>
          {configOpen && (
            <form onSubmit={saveConfig} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input className="input-field min-h-[44px]" type="number" step="1" min="1" placeholder={t("settings.priceRsd")} value={configForm.sale_price_rsd} onChange={(e) => setConfigForm({ ...configForm, sale_price_rsd: e.target.value })} />
              <input className="input-field min-h-[44px]" type="number" step="0.01" min="0" placeholder={t("settings.productCostEur")} value={configForm.product_cost_eur} onChange={(e) => setConfigForm({ ...configForm, product_cost_eur: e.target.value })} />
              <input className="input-field min-h-[44px]" type="number" step="0.01" min="0" placeholder={t("finance.shippingCostUsd")} value={configForm.shipping_cost_usd} onChange={(e) => setConfigForm({ ...configForm, shipping_cost_usd: e.target.value })} />
              <input className="input-field min-h-[44px]" type="number" step="1" min="0" placeholder={t("finance.returnFeeRsd")} value={configForm.return_fee_rsd} onChange={(e) => setConfigForm({ ...configForm, return_fee_rsd: e.target.value })} />
              <input className="input-field min-h-[44px]" type="number" step="1" min="1" placeholder={t("finance.unitsPerOrder")} value={configForm.units_per_order} onChange={(e) => setConfigForm({ ...configForm, units_per_order: e.target.value })} />
              <input className="input-field min-h-[44px]" type="number" step="0.01" min="1" placeholder={t("finance.eurRsd")} value={configForm.eur_rsd} onChange={(e) => setConfigForm({ ...configForm, eur_rsd: e.target.value })} />
              <input className="input-field min-h-[44px]" type="number" step="0.01" min="1" placeholder={t("finance.usdRsd")} value={configForm.usd_rsd} onChange={(e) => setConfigForm({ ...configForm, usd_rsd: e.target.value })} />
              <button type="submit" disabled={configBusy} className="btn-primary min-h-[44px] sm:col-span-2 lg:col-span-3">
                {configBusy ? t("common.loading") : t("common.save")}
              </button>
            </form>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <div className="glass p-4 col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between gap-2">
            <SelectMenu
              compact
              value={balanceCurrency}
              options={BALANCE_CURRENCY_OPTIONS}
              onChange={setBalanceCurrency}
            />
            <div className="flex items-center gap-1.5 text-themed-subtle text-xs font-semibold uppercase">
              <Wallet className="h-3.5 w-3.5" /> {t("finance.cashBalance")}
            </div>
          </div>
          <div className={`mt-2 font-display text-2xl font-bold ${balanceAmount >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
            {formatBalance(balanceAmount, balanceCurrency)}
          </div>
        </div>
        <div className="glass p-4">
          <div className="flex items-center gap-2 text-themed-subtle text-xs font-semibold uppercase">
            <Package className="h-4 w-4" /> {t("finance.stock")}
          </div>
          <div className="mt-1 font-display text-2xl font-bold tabular-nums text-themed">{data.stock_quantity}</div>
          <p className="text-xs text-themed-muted mt-1">
            {t("finance.stockCommitted", { count: data.stock_committed ?? 0 })}
          </p>
          <p className="text-xs text-themed-subtle">{t("finance.ordersPossible", { count: ordersLeft })}</p>
        </div>
        <div className="glass p-4">
          <div className="flex items-center gap-2 text-themed-subtle text-xs font-semibold uppercase">
            <TrendingUp className="h-4 w-4" /> {t("finance.avgMargin")}
          </div>
          <div className="mt-1 font-display text-lg font-bold text-themed">
            €{data.average_margin_eur?.toFixed(2) ?? "0.00"} · {data.average_margin_rsd?.toLocaleString() ?? 0} RSD
          </div>
          <p className="text-xs text-themed-muted mt-1">
            {t("finance.avgMarginHint", { count: data.average_margin_orders ?? 0 })}
          </p>
        </div>
      </div>

      {data.payment_summary && (
        <div className="glass p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-themed flex items-center gap-2">
                <Banknote className="h-5 w-5 text-emerald-500" />
                {t("finance.aksPayouts")}
              </h2>
              <p className="text-sm text-themed-muted mt-1">{t("finance.aksPayoutsHint")}</p>
            </div>
            <div className="text-right text-sm">
              <div className="text-themed-muted">{t("finance.paidFromAks")}</div>
              <div className="font-semibold text-emerald-500">
                {data.payment_summary.paid_orders} · {data.payment_summary.paid_rsd?.toLocaleString()} RSD
              </div>
              {data.payment_summary.delivered_awaiting_payment > 0 && (
                <div className="text-xs text-amber-400 mt-1">
                  {t("finance.awaitingBankPayment", { count: data.payment_summary.delivered_awaiting_payment })}
                </div>
              )}
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onDragOver={onSettlementDragOver}
            onDragLeave={onSettlementDragLeave}
            onDrop={onSettlementDrop}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                settlementInputRef.current?.click();
              }
            }}
            className={`rounded-xl border-2 border-dashed p-4 transition-colors ${
              settlementDragging
                ? "border-emerald-500 bg-emerald-500/10"
                : "border-themed hover:border-themed-muted"
            }`}
          >
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 text-center sm:text-left">
                <p className="text-sm text-themed">
                  {settlementDragging ? t("finance.settlementDropNow") : t("finance.settlementDropHint")}
                </p>
                {settlementFile && !settlementBusy && (
                  <p className="text-xs text-themed-muted mt-1 truncate">{settlementFile.name}</p>
                )}
              </div>
              <label className="btn-secondary shrink-0 min-h-[48px] cursor-pointer flex items-center justify-center gap-2 px-4">
                <Upload className="h-4 w-4" />
                {settlementBusy ? t("common.loading") : t("finance.browseSettlement")}
                <input
                  ref={settlementInputRef}
                  type="file"
                  accept=".xls,.xlsx,.pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    handleSettlementFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {settlementPreview && (
                <button
                  type="button"
                  disabled={settlementBusy || settlementPreview.already_imported || !settlementPreview.ready_count}
                  onClick={importSettlement}
                  className="btn-primary shrink-0 min-h-[48px] px-4"
                >
                  {t("finance.applySettlement", { count: settlementPreview.ready_count })}
                </button>
              )}
            </div>
          </div>

          {settlementPreview && (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-themed px-4 py-3 text-sm">
                <div className="font-medium text-themed">
                  {t("finance.settlementRef", { ref: settlementPreview.settlement_ref })}
                  {settlementPreview.settlement_date ? ` · ${settlementPreview.settlement_date}` : ""}
                </div>
                <div className="text-themed-muted mt-1">
                  {t("finance.settlementSummary", {
                    ready: settlementPreview.ready_count,
                    paid: settlementPreview.already_paid_count,
                    missing: settlementPreview.not_found_count,
                    rsd: Math.round(settlementPreview.total_product_rsd).toLocaleString(),
                  })}
                </div>
                {settlementPreview.already_imported && (
                  <div className="text-amber-400 text-xs mt-2">{t("finance.settlementAlreadyImported")}</div>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-themed">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="sticky top-0 bg-themed-surface text-themed-muted">
                    <tr>
                      <th className="text-left p-2">{t("finance.settlementOrderId")}</th>
                      <th className="text-left p-2 hidden sm:table-cell">{t("finance.settlementCustomer")}</th>
                      <th className="text-right p-2">{t("finance.settlementCredit")}</th>
                      <th className="text-left p-2">{t("finance.settlementStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlementPreview.lines.map((line) => (
                      <tr key={line.order_id} className="border-t border-themed">
                        <td className="p-2 font-mono text-[11px] sm:text-xs">{line.order_id}</td>
                        <td className="p-2 hidden sm:table-cell truncate max-w-[140px]">
                          {line.lead_name || line.payer_name || "—"}
                        </td>
                        <td className="p-2 text-right font-medium text-emerald-500">
                          {line.product_rsd?.toLocaleString()} RSD
                        </td>
                        <td className="p-2">
                          <span className={
                            line.status === "ready"
                              ? "text-emerald-400"
                              : line.status === "already_paid"
                                ? "text-themed-muted"
                                : "text-amber-400"
                          }>
                            {settlementStatusLabel(line.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-themed-subtle">{t("finance.settlementAmountHint")}</p>
            </div>
          )}
        </div>
      )}

      <div className="glass p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 className="font-semibold text-themed">{editingTxId ? t("finance.editEntry") : t("finance.addEntry")}</h2>
          {editingTxId && (
            <button type="button" onClick={cancelEditTxn} className="btn-secondary !py-1.5 text-xs">
              {t("common.cancel")}
            </button>
          )}
        </div>
        <form onSubmit={submitTxn} className="space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setForm((f) => ({ ...f, direction: "expense" }))}
              className={`flex-1 flex items-center justify-center gap-1 rounded-xl py-3 text-sm font-medium min-h-[44px] ${form.direction === "expense" ? "bg-rose-600 text-white" : "border border-themed text-themed-muted"}`}>
              <Minus className="h-4 w-4" /> {t("finance.expense")}
            </button>
            <button type="button" onClick={() => setForm((f) => ({ ...f, direction: "income" }))}
              className={`flex-1 flex items-center justify-center gap-1 rounded-xl py-3 text-sm font-medium min-h-[44px] ${form.direction === "income" ? "bg-emerald-600 text-white" : "border border-themed text-themed-muted"}`}>
              <Plus className="h-4 w-4" /> {t("finance.income")}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input-field min-h-[48px]" type="number" step="0.01" min="0" placeholder={t("finance.amount")}
              value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            <SelectMenu
              value={form.currency}
              options={CURRENCY_OPTIONS}
              onChange={(currency) => setForm((f) => ({ ...f, currency }))}
              icon={Coins}
              fullWidth
            />
          </div>
          <SelectMenu
            value={form.category}
            options={categoryOptions}
            onChange={(category) => setForm((f) => ({ ...f, category }))}
            icon={Tag}
            fullWidth
          />
          {form.category === "stock" && form.direction === "expense" && (
            <input className="input-field min-h-[48px]" type="number" min="1" placeholder={t("finance.stockPieces")}
              value={form.stock_pieces} onChange={(e) => setForm({ ...form, stock_pieces: e.target.value })} />
          )}
          <input className="input-field min-h-[48px]" placeholder={t("finance.noteOptional")}
            value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button type="submit" disabled={busy} className="btn-primary w-full min-h-[48px]">
            {busy ? t("common.loading") : (editingTxId ? t("common.save") : t("finance.addEntry"))}
          </button>
        </form>
      </div>

      <div className="glass p-4 sm:p-6">
        <h2 className="font-semibold text-themed mb-4">{t("finance.campaigns")}</h2>
        {data.campaigns.length === 0 ? (
          <p className="text-sm text-themed-muted">{t("finance.noCampaigns")}</p>
        ) : (
          <div className="space-y-3">
            {data.campaigns.map((c) => (
              <div key={c.batch_id} className="rounded-xl border border-themed p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-themed">{c.batch_name}</div>
                    <div className="text-xs text-themed-muted mt-1">
                      {c.imported_orders} {t("finance.imported")}
                      {c.imported_bundles > c.imported_orders && (
                        <span> · {t("finance.importedBundles", { count: c.imported_bundles })}</span>
                      )}
                      {c.pending_aks > 0 ? ` · ${c.pending_aks} ${t("finance.pendingAks")}` : ""}
                      {c.linked_orders > 0 ? ` · ${c.linked_orders} ${t("finance.linkedAks")}` : ""}
                      {c.boost_days ? ` · ${c.boost_days} ${t("finance.boostDays")}` : ""}
                      {c.ad_spend_usd > 0 ? ` · $${c.ad_spend_usd} USD` : ""}
                    </div>
                    {c.pending_orders > 0 && c.delivered_orders === 0 && (
                      <p className="text-xs text-themed-subtle mt-0.5">{t("finance.expectedHint")}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4 sm:shrink-0 sm:flex-col sm:items-end sm:text-right">
                    {c.imported_orders > 0 && (c.expected_net_profit_rsd ?? c.projected_net_profit_rsd) > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-themed-subtle">
                          {t("finance.expectedProfit")}
                        </div>
                        <div className={`font-display text-xl font-bold ${(c.expected_net_profit_eur ?? c.projected_net_profit_eur) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                          €{(c.expected_net_profit_eur ?? c.projected_net_profit_eur).toFixed(2)}
                        </div>
                        <div className="text-xs text-themed-muted">
                          {(c.expected_net_profit_rsd ?? c.projected_net_profit_rsd)?.toLocaleString()} RSD
                        </div>
                        <div className="text-[10px] text-themed-subtle mt-0.5">{t("finance.ifAllDeliver")}</div>
                      </div>
                    )}
                    {(c.delivered_orders > 0 || c.returned_orders > 0) && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-themed-subtle">
                          {t("finance.earnedSoFar")}
                        </div>
                        <div className={`font-display text-lg font-bold ${c.net_profit_eur >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                          €{c.net_profit_eur}
                        </div>
                        <div className="text-xs text-themed-muted">
                          {c.net_profit_rsd?.toLocaleString()} RSD · {c.delivered_orders} {t("finance.delivered").toLowerCase()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {c.imported_orders > 0 && (
                  <div className="mt-2 rounded-lg bg-themed-hover px-3 py-2 text-sm">
                    <span className="text-themed-muted">{t("finance.netPerOrder")}: </span>
                    <strong className="text-themed">€{c.net_profit_per_order_eur}</strong>
                    <span className="text-themed-muted"> · {c.net_profit_per_order_rsd?.toLocaleString()} RSD</span>
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-lg bg-themed-hover/60 px-3 py-2.5">
                    <div className="text-themed-muted">{t("finance.pending")}</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums text-themed">{c.pending_orders}</div>
                  </div>
                  <div className="rounded-lg bg-themed-hover/60 px-3 py-2.5">
                    <div className="text-themed-muted">{t("finance.delivered")}</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-500">{c.delivered_orders ?? c.successful_orders ?? 0}</div>
                  </div>
                  <div className="rounded-lg bg-themed-hover/60 px-3 py-2.5">
                    <div className="text-themed-muted">{t("finance.paidFromAks")}</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums text-sky-400">{c.paid_orders ?? 0}</div>
                  </div>
                  <div className="rounded-lg bg-themed-hover/60 px-3 py-2.5">
                    <div className="text-themed-muted">{t("finance.returned")}</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums text-rose-400">{c.returned_orders}</div>
                  </div>
                  {(c.return_in_progress_orders ?? 0) > 0 && (
                    <div className="rounded-lg bg-themed-hover/60 px-3 py-2.5">
                      <div className="text-themed-muted">{t("finance.returnInProgress")}</div>
                      <div className="mt-0.5 text-lg font-semibold tabular-nums text-amber-400">{c.return_in_progress_orders}</div>
                    </div>
                  )}
                  <div className="rounded-lg bg-themed-hover/60 px-3 py-2.5 col-span-2 sm:col-span-1">
                    <div className="text-themed-muted">{t("finance.adCostPerOrder")}</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums text-themed">${c.cost_per_order_usd?.toFixed(2)}</div>
                  </div>
                </div>
                {c.gross_profit_eur !== c.net_profit_eur && (
                  <div className="mt-2 text-xs text-themed-muted">
                    {t("finance.beforeAds")}: €{c.gross_profit_eur}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-semibold text-themed">{t("finance.recent")}</h2>
          {(cashEntries.length > 0 || stockEntries.length > 0) && (
            <button
              type="button"
              onClick={clearStockHistory}
              className="text-xs font-medium text-themed-muted hover:text-rose-400 transition shrink-0"
            >
              {t("finance.clearStockHistory")}
            </button>
          )}
        </div>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {cashEntries.length === 0 && stockEntries.length === 0 ? (
            <p className="text-sm text-themed-muted">{t("finance.noTransactions")}</p>
          ) : (
            <>
              {cashEntries.length > 0 && cashEntries.map(renderTxnRow)}
              {stockEntries.length > 0 && (
                <div className={cashEntries.length > 0 ? "mt-4 border-t border-themed pt-3" : ""}>
                  <div className="mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-themed-subtle">
                      {t("finance.stockPurchases")}
                    </h3>
                  </div>
                  {stockEntries.map(renderTxnRow)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
