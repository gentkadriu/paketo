import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft, Check, CheckSquare, ChevronDown, ClipboardList, Copy, Download, ListChecks, MoreVertical, Package, RefreshCw, Rocket, Save, Trash2, X, UserPlus, RotateCw,
} from "lucide-react";
import {
  api, formatDate, isLeadTrackable, ORDER_ID_LENGTH, ORDER_ID_PLACEHOLDER, trackCardClass, validateOrderId,
} from "../api";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../context/I18nContext";
import { useSearchIndex } from "../context/SearchIndexContext";
import StatusPill from "../components/StatusPill";
import StatusDot from "../components/StatusDot";
import CampaignPanel from "../components/CampaignPanel";
import SelectMenu from "../components/SelectMenu";
import LeadInlineEdit from "../components/LeadInlineEdit";
import ActionMenu from "../components/ActionMenu";
import PaginationBar from "../components/PaginationBar";
import { AddLeadsSheet, BulkIdsSheet, FILTER_CHIPS, filterLeadsByChip } from "../components/BatchSheets";
import ConfirmDialog from "../components/ConfirmDialog";
import { OrderIdScanButton, OrderIdScannerModal } from "../components/OrderIdScanner";

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function BatchDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const highlightLeadId = searchParams.get("lead");
  const urlFilter = searchParams.get("filter");
  const navigate = useNavigate();
  const { show } = useToast();
  const { t, ts } = useI18n();
  const { refresh: refreshSearch } = useSearchIndex();
  const [batch, setBatch] = useState(null);
  const [tab, setTab] = useState("ids");
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());
  const [batchName, setBatchName] = useState("");
  const [productId, setProductId] = useState(null);
  const [products, setProducts] = useState([]);
  const [adSpendUsd, setAdSpendUsd] = useState("");
  const [boostDays, setBoostDays] = useState("");
  const [draftIds, setDraftIds] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [trackRun, setTrackRun] = useState(null);
  const [leadFilter, setLeadFilter] = useState(() =>
    (urlFilter && FILTER_CHIPS.some((c) => c.id === urlFilter)) ? urlFilter : "all",
  );
  const [showAddLeads, setShowAddLeads] = useState(false);
  const [showBulkIds, setShowBulkIds] = useState(false);
  const [bulkIdsText, setBulkIdsText] = useState("");
  const [appendBusy, setAppendBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [scanLeadId, setScanLeadId] = useState(null);
  const savingIds = useRef(new Set());
  const highlightRef = useRef(null);

  const load = useCallback(async () => {
    const data = await api(`/batches/${id}`);
    setBatch(data);
    setBatchName(data.name);
    setProductId(data.product_id ?? data.product?.id ?? null);
    setAdSpendUsd(data.ad_spend_usd != null ? String(data.ad_spend_usd) : "");
    setBoostDays(data.boost_days != null ? String(data.boost_days) : "");
    const drafts = {};
    data.leads.forEach((l) => { drafts[l.id] = l.order_id || ""; });
    setDraftIds(drafts);
    refreshSearch();
  }, [id, refreshSearch]);

  useEffect(() => {
    api("/products")
      .then((res) => setProducts(res.products || []))
      .catch((e) => show(e.message, "error"));
  }, [show]);

  useEffect(() => {
    if (urlFilter && FILTER_CHIPS.some((c) => c.id === urlFilter)) {
      setLeadFilter(urlFilter);
    }
  }, [urlFilter]);

  useEffect(() => { load().catch((e) => show(e.message, "error")); }, [load, show]);

  useEffect(() => {
    if (!highlightLeadId || !batch) return;
    const leadId = Number(highlightLeadId);
    const idx = batch.leads.findIndex((l) => l.id === leadId);
    if (idx >= 0) {
      setPage(Math.floor(idx / pageSize) + 1);
      setExpanded((e) => new Set(e).add(leadId));
      setTimeout(() => highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
    }
  }, [highlightLeadId, batch, pageSize]);

  const persistOrderId = useCallback(async (leadId, orderId, { silent = false } = {}) => {
    const trimmed = orderId.trim();
    const err = validateOrderId(trimmed);
    if (err && trimmed) {
      if (!silent) show(err, "error");
      return false;
    }
    if (savingIds.current.has(leadId)) return false;

    savingIds.current.add(leadId);
    try {
      const updated = await api(`/leads/${leadId}/order-id`, {
        method: "PATCH",
        body: JSON.stringify({ order_id: trimmed }),
      });
      setBatch((b) => {
        if (!b) return b;
        const leads = b.leads.map((l) => (l.id === leadId ? updated : l));
        const hasLinked = leads.some((l) => l.order_id);
        return {
          ...b,
          leads,
          linked_count: leads.filter((l) => l.order_id).length,
          sent_at: b.sent_at || (hasLinked ? new Date().toISOString() : b.sent_at),
        };
      });
      setDraftIds((d) => ({ ...d, [leadId]: updated.order_id || "" }));
      if (!silent) show(trimmed ? t("batch.idSavedToast", { id: trimmed }) : t("batch.idCleared"));
      return true;
    } catch (e) {
      show(e.message, "error");
      return false;
    } finally {
      savingIds.current.delete(leadId);
    }
  }, [show, t]);

  const handleOrderIdChange = useCallback((leadId, savedOrderId, raw) => {
    const orderId = raw.replace(/\D/g, "").slice(0, ORDER_ID_LENGTH);
    const saved = (savedOrderId || "").trim();
    setDraftIds((d) => ({ ...d, [leadId]: orderId }));

    if (!orderId && saved) {
      persistOrderId(leadId, "");
      return;
    }

    if (
      orderId.length === ORDER_ID_LENGTH
      && !validateOrderId(orderId)
      && orderId !== saved
    ) {
      persistOrderId(leadId, orderId);
    }
  }, [persistOrderId]);

  const leads = batch?.leads ?? [];
  const productOptions = useMemo(() => {
    const opts = products.map((p) => ({
      value: p.id,
      label: `${p.product_code} — ${p.name}`,
      hint: p.offer_label,
    }));
    const current = batch?.product;
    if (current && !opts.some((o) => o.value === current.id)) {
      opts.unshift({
        value: current.id,
        label: `${current.product_code} — ${current.name}`,
        hint: `${t("settings.productArchived")} · ${current.offer_label}`,
      });
    }
    return opts;
  }, [products, batch?.product, t]);
  const batchProductArchived = batch?.product && batch.product.is_active === false;
  const savedProductId = batch?.product_id ?? batch?.product?.id ?? null;
  const filteredLeads = useMemo(
    () => filterLeadsByChip(leads, leadFilter),
    [leads, leadFilter],
  );
  const total = filteredLeads.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const currentPage = Math.min(page, totalPages);

  const paginatedLeads = useMemo(
    () => filteredLeads.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredLeads, currentPage, pageSize],
  );

  useEffect(() => { setPage(1); }, [leadFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const selectedLeads = useMemo(() => {
    if (!batch?.leads) return [];
    return batch.leads
      .filter((l) => selected.has(l.id))
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [batch, selected]);

  if (!batch) return <div className="text-themed-muted">{t("batch.loading")}</div>;

  const linked = leads.filter((l) => l.order_id).length;
  const trackableCount = leads.filter((l) => isLeadTrackable(l)).length;
  const notSentCount = total - trackableCount;

  const orderIdFor = (lead) => (draftIds[lead.id] ?? lead.order_id ?? "").trim();

  const unsavedCount = batch.leads.filter(
    (l) => orderIdFor(l) !== (l.order_id || "").trim(),
  ).length;

  const hasTrackableOrders = trackableCount > 0;

  const trackingBlockReason = () => {
    if (batch.status === "tracking") return null;
    if (!hasTrackableOrders) return t("batch.addIdHint");
    const invalid = batch.leads.find((l) => {
      const oid = orderIdFor(l);
      return oid && validateOrderId(oid);
    });
    if (invalid) return `${invalid.full_name}: ${validateOrderId(orderIdFor(invalid))}`;
    return null;
  };

  const selectAll = () => setSelected(new Set(batch.leads.map((l) => l.id)));

  const selectPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      paginatedLeads.forEach((l) => next.add(l.id));
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const toggleExpanded = (leadId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const handlePageSizeChange = (size) => {
    setPageSize(size);
    setPage(1);
  };

  const bulk = async (action) => {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === "delete") {
      setConfirmAction({ type: "bulkDelete", count: ids.length, ids, action });
      return;
    }
    try {
      const data = await api(`/batches/${id}/leads/bulk`, {
        method: "POST",
        body: JSON.stringify({ lead_ids: ids, action }),
      });
      setBatch(data);
      setSelected(new Set());
      if (action === "reparse") {
        show(t("batch.reparsedOk", { count: ids.length }));
      } else {
        show(t("batch.bulkDone"));
      }
      refreshSearch();
    } catch (err) {
      show(err.message, "error");
    }
  };

  const runConfirmAction = async () => {
    if (!confirmAction) return;
    if (confirmAction.type === "bulkDelete") {
      try {
        const data = await api(`/batches/${id}/leads/bulk`, {
          method: "POST",
          body: JSON.stringify({ lead_ids: confirmAction.ids, action: "delete" }),
        });
        setBatch(data);
        setSelected(new Set());
        show(t("batch.bulkDone"));
        refreshSearch();
      } catch (err) {
        show(err.message, "error");
      }
    } else if (confirmAction.type === "deleteBatch") {
      try {
        await api(`/batches/${id}`, { method: "DELETE" });
        show(t("batch.batchDeleted"));
        navigate("/");
      } catch (e) {
        show(e.message, "error");
      }
    }
    setConfirmAction(null);
  };

  const copyOrderId = async (orderId) => {
    if (!orderId) return;
    try {
      await navigator.clipboard.writeText(orderId);
      show(t("batch.orderIdCopied"));
    } catch {
      show(t("batch.copyFailed"), "error");
    }
  };

  const updateLeadInBatch = (updated) => {
    setBatch((b) => {
      if (!b) return b;
      return { ...b, leads: b.leads.map((l) => (l.id === updated.id ? updated : l)) };
    });
    refreshSearch();
  };

  const copySelectedLeads = async () => {
    const text = formatLeadsExport(selectedLeads);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      show(t("batch.copiedLeads", { count: selectedLeads.length }));
    } catch {
      show(t("batch.copyFailed"), "error");
    }
  };

  const exportSelectedLeads = () => {
    const text = formatLeadsExport(selectedLeads);
    if (!text) return;
    const safeName = (batch?.name || "batch").replace(/[^\w\-]+/g, "_").slice(0, 40);
    downloadTextFile(text, `${safeName}-orders.txt`);
    show(t("batch.exportedLeads", { count: selectedLeads.length }));
  };

  const saveBatchSettings = async () => {
    try {
      const body = { name: batchName.trim() };
      if (adSpendUsd !== "") {
        const spend = parseFloat(adSpendUsd);
        if (!Number.isNaN(spend) && spend >= 0) body.ad_spend_usd = spend;
      } else {
        body.ad_spend_usd = 0;
      }
      if (boostDays !== "") {
        const days = parseInt(boostDays, 10);
        if (!Number.isNaN(days) && days >= 0) body.boost_days = days;
      }
      if (productId && productId !== savedProductId) {
        body.product_id = productId;
      }
      const updated = await api(`/batches/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setBatch((b) => (b ? { ...b, ...updated } : b));
      if (updated.product_id) setProductId(updated.product_id);
      show(t("batch.nameSaved"));
    } catch (e) {
      show(e.message, "error");
    }
  };

  const changeProduct = async (newId) => {
    if (!newId || newId === savedProductId) return;
    const prev = productId;
    setProductId(newId);
    try {
      const updated = await api(`/batches/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ product_id: newId }),
      });
      setBatch((b) => (b ? { ...b, ...updated } : b));
      show(t("batch.productSaved"));
    } catch (e) {
      setProductId(prev);
      show(e.message, "error");
    }
  };

  const appendLeads = async ({ leadsText, skipDuplicates }) => {
    setAppendBusy(true);
    try {
      const data = await api(`/batches/${id}/leads`, {
        method: "POST",
        body: JSON.stringify({ leads_text: leadsText, skip_duplicates: !!skipDuplicates }),
      });
      setBatch(data);
      const drafts = {};
      data.leads.forEach((l) => { drafts[l.id] = l.order_id || ""; });
      setDraftIds(drafts);
      setShowAddLeads(false);
      refreshSearch();
      const added = data.added_count ?? (data.leads.length - leads.length);
      if (added > 0) setLeadFilter("no_id");
      if (data.skipped_duplicates > 0) {
        show(t("batch.ordersAddedSkipped", { count: added, skipped: data.skipped_duplicates }));
      } else {
        show(t("batch.ordersAdded", { count: added }));
      }
    } catch (e) {
      show(e.message, "error");
    } finally {
      setAppendBusy(false);
    }
  };

  const applyBulkIds = async () => {
    setBulkBusy(true);
    try {
      const data = await api(`/batches/${id}/bulk-order-ids`, {
        method: "POST",
        body: JSON.stringify({ text: bulkIdsText }),
      });
      setBatch(data.batch);
      const drafts = {};
      data.batch.leads.forEach((l) => { drafts[l.id] = l.order_id || ""; });
      setDraftIds(drafts);
      setShowBulkIds(false);
      setBulkIdsText("");
      refreshSearch();
      show(t("batch.bulkIdsDone", { count: data.applied }));
    } catch (e) {
      show(e.message, "error");
    } finally {
      setBulkBusy(false);
    }
  };

  const waitingForId = leads.filter((l) => !(l.order_id || "").trim()).length;

  const saveAllIds = async () => {
    const toSave = batch.leads.filter((l) => orderIdFor(l) !== (l.order_id || "").trim());
    if (!toSave.length) return true;
    for (const lead of toSave) {
      const orderId = orderIdFor(lead);
      if (orderId) {
        const err = validateOrderId(orderId);
        if (err) {
          show(`${lead.full_name}: ${err}`, "error");
          return false;
        }
      }
      const ok = await persistOrderId(lead.id, orderId, { silent: true });
      if (!ok) return false;
    }
    show(t("batch.idSavedToast", { id: toSave.length }));
    return true;
  };

  const startTracking = async () => {
    if (batch.status === "tracking") {
      setTab("track");
      return;
    }
    const block = trackingBlockReason();
    if (block) {
      show(block, "error");
      return;
    }
    try {
      if (unsavedCount > 0) {
        const saved = await saveAllIds();
        if (!saved) return;
      }
      await api(`/batches/${id}/start-tracking`, { method: "POST" });
      await load();
      setTab("track");
      show(t("batch.trackingEnabled"));
    } catch (e) {
      show(e.message, "error");
    }
  };

  const deleteBatch = () => {
    setConfirmAction({ type: "deleteBatch", name: batch.name, count: total });
  };

  const trackOrdersNow = async () => {
    const trackable = batch.leads.filter((l) => isLeadTrackable(l));
    if (!trackable.length) {
      show(t("batch.noIdsYet"), "error");
      return;
    }

    setTrackRun({
      done: 0,
      total: trackable.length,
      current: t("batch.fetchingAks"),
      failed: 0,
    });

    try {
      try {
        await api("/tracking/reset-session", { method: "POST" });
      } catch {
        /* session reset is best-effort */
      }

      const data = await api(`/batches/${id}/refresh-tracking`, { method: "POST" });
      const results = data.results || [];
      let failed = 0;
      let lastError = "";
      const updatedById = new Map();

      for (const result of results) {
        if (result.ok === true && result.lead) {
          updatedById.set(result.lead_id, result.lead);
        } else {
          failed += 1;
          lastError = result.error || "AKS lookup failed";
        }
      }

      if (updatedById.size) {
        setBatch((b) => ({
          ...b,
          leads: b.leads.map((l) => updatedById.get(l.id) || l),
        }));
      }

      setTrackRun(null);
      const ok = results.length - failed;
      show(
        failed
          ? t("batch.trackedPartial", { ok, failed }) + (lastError ? ` — ${lastError}` : "")
          : t("batch.trackedOk", { count: ok }),
        failed ? "error" : "success",
      );
    } catch (e) {
      setTrackRun(null);
      show(e.message, "error");
    }
  };

  return (
    <div className="animate-slide-up space-y-4 sm:space-y-6">
      {/* Mobile-first batch header */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="icon-btn !h-10 !w-10 shrink-0 text-themed-muted"
            aria-label={t("common.back")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <input
            className="input-field min-h-[44px] min-w-0 flex-1 font-display text-base font-semibold sm:text-lg"
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
          />
          <button type="button" onClick={saveBatchSettings} className="icon-btn !h-10 !w-10 shrink-0" title={t("common.save")}>
            <Save className="h-4 w-4" />
          </button>
          <ActionMenu
            compact
            align="end"
            label={t("batch.moreActions")}
            icon={MoreVertical}
            items={[
              {
                label: t("batch.deleteBatch"),
                hint: batch.name,
                icon: Trash2,
                onClick: deleteBatch,
                danger: true,
              },
            ]}
          />
        </div>

        <div className="glass p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <span className="batch-stat-chip">{total} {t("common.orders")}</span>
            <span className="batch-stat-chip">{linked}/{total} IDs</span>
            {waitingForId > 0 && (
              <span className="batch-stat-chip-warn">{waitingForId} {t("batch.filterNoId").toLowerCase()}</span>
            )}
          </div>
          <p className="text-xs text-themed-muted leading-relaxed">
            {t("common.imported")} {formatDate(batch.imported_date)}
            {batch.sent_date && linked > 0 && ` · ${t("common.sent")} ${formatDate(batch.sent_date)}`}
          </p>
          {unsavedCount > 0 && batch.status !== "tracking" && (
            <button type="button" onClick={saveAllIds} className="btn-secondary w-full min-h-[44px]">
              <Save className="h-4 w-4" /> {t("batch.saveAllIds", { count: unsavedCount })}
            </button>
          )}
          <button
            type="button"
            onClick={startTracking}
            disabled={batch.status !== "tracking" && !hasTrackableOrders}
            title={trackingBlockReason() || undefined}
            className="btn-primary w-full min-h-[48px] text-base"
          >
            <Rocket className="h-4 w-4" />
            {batch.status === "tracking" ? t("batch.viewTracking") : t("batch.startTracking")}
          </button>
          {batch.status !== "tracking" && trackingBlockReason() && (
            <p className="text-xs text-amber-500 dark:text-amber-400/90">{trackingBlockReason()}</p>
          )}
        </div>

        <details className="glass group overflow-hidden">
          <summary className="cursor-pointer list-none px-4 py-3 min-h-[48px] flex items-center justify-between gap-2 text-sm font-medium text-themed-muted hover:bg-themed-hover/40 transition [&::-webkit-details-marker]:hidden">
            <span>{t("batch.batchSettings")}</span>
            <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-themed px-4 pb-4 pt-3 space-y-3">
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-themed-muted">
                <Package className="h-3.5 w-3.5" />
                {t("newBatch.product")}
              </label>
              {productOptions.length > 0 ? (
                <>
                  <SelectMenu
                    value={productId}
                    onChange={changeProduct}
                    options={productOptions}
                    icon={Package}
                    fullWidth
                  />
                  {batchProductArchived && (
                    <p className="mt-1 text-xs text-amber-500">{t("settings.productArchivedBatchHint")}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-themed-muted">
                  {t("newBatch.noProducts")}{" "}
                  <Link to="/settings" className="text-indigo-400 hover:underline">{t("nav.settings")}</Link>
                </p>
              )}
            </div>
            <CampaignPanel
              adSpendUsd={adSpendUsd}
              setAdSpendUsd={setAdSpendUsd}
              boostDays={boostDays}
              setBoostDays={setBoostDays}
              savedSpend={batch.ad_spend_usd}
              savedDays={batch.boost_days}
              onSave={saveBatchSettings}
            />
          </div>
        </details>
      </div>

      <div className="sticky top-0 z-20 -mx-3 space-y-3 border-b border-themed bg-[var(--bg)]/95 px-3 pb-3 pt-1 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex gap-2 border-b border-themed pb-px overflow-x-auto -mb-px scrollbar-none">
        {["ids", "track"].map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`shrink-0 px-4 py-3 sm:py-2.5 text-sm font-medium transition border-b-2 -mb-px min-h-[44px] sm:min-h-0 ${
              tab === tabKey ? "border-indigo-500 text-themed" : "border-transparent text-themed-muted"
            }`}
          >
            {tabKey === "ids" ? t("batch.orders") : t("batch.tracking")}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none -mx-0.5 px-0.5">
        {FILTER_CHIPS.map(({ id, key }) => (
          <button
            key={id}
            type="button"
            onClick={() => setLeadFilter(id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium min-h-[36px] transition ${
              leadFilter === id ? "bg-indigo-600 text-white" : "border border-themed text-themed-muted hover:text-themed"
            }`}
          >
            {t(`batch.${key}`)}
            {id === "no_id" && waitingForId > 0 && (
              <span className="ml-1 opacity-80">({waitingForId})</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" onClick={() => setShowAddLeads(true)} className="btn-secondary !py-2 min-h-[44px] text-xs sm:text-sm sm:flex-initial">
          <UserPlus className="h-4 w-4 shrink-0" /> <span className="truncate">{t("batch.addOrders")}</span>
        </button>
        {waitingForId > 0 && tab === "ids" ? (
          <button type="button" onClick={() => setShowBulkIds(true)} className="btn-secondary !py-2 min-h-[44px] text-xs sm:text-sm sm:flex-initial">
            <ClipboardList className="h-4 w-4 shrink-0" /> <span className="truncate">{t("batch.bulkIdsWaiting", { count: waitingForId })}</span>
          </button>
        ) : (
          <div className="hidden sm:block" />
        )}
      </div>
      </div>

      {tab === "ids" && (
        <>
          <div className="glass relative z-10 p-3 sm:p-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <ActionMenu
                  label={t("batch.select")}
                  icon={CheckSquare}
                  align="start"
                  items={[
                    {
                      label: t("batch.selectAll"),
                      hint: `${total} ${t("common.orders")}`,
                      icon: CheckSquare,
                      onClick: selectAll,
                    },
                    {
                      label: t("batch.selectPage"),
                      hint: `${paginatedLeads.length} · ${currentPage}`,
                      icon: ListChecks,
                      onClick: selectPage,
                    },
                    ...(selected.size > 0 ? [{
                      label: t("batch.clearSelection"),
                      hint: t("batch.selected", { count: selected.size }),
                      icon: X,
                      onClick: clearSelection,
                    }] : []),
                  ]}
                />
                <span className="text-sm text-themed-muted">{t("batch.selected", { count: selected.size })}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <ActionMenu
                  label={t("batch.exportLeads")}
                  icon={Download}
                  align="end"
                  disabled={!selected.size}
                  items={[
                    {
                      label: t("batch.copyLeads"),
                      hint: t("batch.selected", { count: selected.size }),
                      icon: Copy,
                      onClick: copySelectedLeads,
                    },
                    {
                      label: t("batch.downloadLeads"),
                      hint: ".txt",
                      icon: Download,
                      onClick: exportSelectedLeads,
                    },
                    {
                      label: t("batch.reparseSelected"),
                      hint: t("batch.selected", { count: selected.size }),
                      icon: RotateCw,
                      onClick: () => bulk("reparse"),
                    },
                  ]}
                />
                <button disabled={!selected.size} onClick={() => bulk("delete")} className="btn-danger min-h-[44px]">
                  <Trash2 className="h-4 w-4" /> {t("common.delete")}
                </button>
              </div>
            </div>
            <p className="text-xs text-themed-muted">{t("batch.idsSavedHint", { linked, total })}</p>
          </div>

          <div className="glass divide-y divide-[var(--border-subtle)]">
            {paginatedLeads.map((lead) => {
              const draft = draftIds[lead.id] || "";
              const saved = (lead.order_id || "").trim();
              const isIdSaved = saved && draft.trim() === saved;
              const isHighlighted = Number(highlightLeadId) === lead.id;

              return (
              <div
                key={lead.id}
                ref={isHighlighted ? highlightRef : undefined}
                className={`${selected.has(lead.id) ? "bg-indigo-500/5" : ""} ${isHighlighted ? "ring-2 ring-inset ring-indigo-500/50 bg-indigo-500/10" : ""}`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpanded(lead.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleExpanded(lead.id);
                    }
                  }}
                  className="grid grid-cols-[auto_1fr] cursor-pointer items-center gap-x-3 gap-y-3 p-4 transition hover:bg-themed-hover/25 lg:grid-cols-[auto_minmax(0,1fr)_280px]"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const s = new Set(selected);
                      e.target.checked ? s.add(lead.id) : s.delete(lead.id);
                      setSelected(s);
                    }}
                    className="accent-indigo-500"
                  />
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-6 shrink-0 text-sm text-themed-subtle">{lead.sort_order}.</span>
                    <StatusDot status={lead.display_status || lead.lifecycle_status} label={ts(lead.display_status || lead.lifecycle_status)} />
                    <span className="truncate font-semibold text-themed">{lead.full_name}</span>
                    {lead.is_paid && (
                      <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        {t("batch.paidBadge")}
                      </span>
                    )}
                    <span className="hidden sm:inline-flex">
                      <StatusPill status={lead.lifecycle_status} label={ts(lead.display_status || lead.lifecycle_status)} />
                    </span>
                    <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-themed-subtle transition ${expanded.has(lead.id) ? "rotate-180" : ""}`} />
                  </div>
                  <div
                    className="col-span-2 space-y-1 lg:col-span-1 lg:col-start-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="relative">
                      <input
                        className="input-field !py-2.5 pr-[5.25rem] font-mono text-sm"
                        placeholder={ORDER_ID_PLACEHOLDER}
                        maxLength={ORDER_ID_LENGTH}
                        value={draft}
                        onChange={(e) => handleOrderIdChange(lead.id, lead.order_id, e.target.value)}
                        onBlur={() => {
                          const draftVal = (draftIds[lead.id] || "").trim();
                          const savedVal = (lead.order_id || "").trim();
                          if (draftVal !== savedVal && !draftVal && savedVal) {
                            persistOrderId(lead.id, "");
                          }
                        }}
                      />
                      <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
                        <OrderIdScanButton
                          onOpen={() => setScanLeadId(lead.id)}
                        />
                        {saved && (
                          <button
                            type="button"
                            onClick={() => copyOrderId(saved)}
                            className="icon-btn !h-8 !w-8 text-themed-muted hover:text-themed"
                            title={t("batch.copyOrderId")}
                            aria-label={t("batch.copyOrderId")}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {isIdSaved && (
                      <p className="flex items-center gap-1 pl-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400/90">
                        <Check className="h-3 w-3 shrink-0" aria-hidden />
                        {t("batch.idSaved")}
                      </p>
                    )}
                  </div>
                </div>
                {expanded.has(lead.id) && (
                  <div
                    className="border-t border-themed/50 px-4 pb-3 pt-2 pl-12 sm:pl-14"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <LeadInlineEdit lead={lead} onSaved={updateLeadInBatch} />
                  </div>
                )}
              </div>
              );
            })}
          </div>

          <PaginationBar
            page={currentPage}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        </>
      )}

      {tab === "track" && (
        <>
          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl border border-themed bg-themed-elevated/95 p-3 shadow-lg backdrop-blur-md sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
            <button
              onClick={trackOrdersNow}
              disabled={!!trackRun || !trackableCount}
              className="btn-primary min-h-[48px] flex-1 sm:flex-none"
            >
              <RefreshCw className={`h-4 w-4 ${trackRun ? "animate-spin" : ""}`} />
              {trackRun ? t("batch.trackingProgress") : t("batch.trackOrdersNow")}
            </button>
            <span className="w-full text-sm text-themed-muted sm:w-auto">
              {t("batch.withIds", { count: trackableCount })}{notSentCount > 0 && ` · ${t("batch.waiting", { count: notSentCount })}`}
            </span>
          </div>

          {trackRun && (
            <div className="glass space-y-2.5 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-themed">{t("batch.fetchingAks")}</span>
                <span className="text-themed-muted">{trackRun.total} {t("batch.ordersLabel")}</span>
              </div>
              <p className="text-xs text-themed-muted">{t("batch.trackingParallelHint")}</p>
              <div className="h-2.5 overflow-hidden rounded-full bg-themed-hover">
                <div className="h-full w-full animate-pulse rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" />
              </div>
            </div>
          )}

          <div className="space-y-3">
            {paginatedLeads.map((lead) => {
              const cardStatus = lead.is_trackable === false ? "not_sent" : lead.lifecycle_status;
              return (
              <div
                key={lead.id}
                className={`glass p-5 transition-colors duration-500 ${trackCardClass(cardStatus)}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className={`font-semibold ${lead.is_trackable === false ? "text-themed-muted" : "text-themed"}`}>
                      {lead.sort_order}. {lead.full_name}
                    </div>
                    <div className="mt-1 font-mono text-sm text-themed-muted">
                      {lead.order_id || t("batch.noOrderId")}
                    </div>
                  </div>
                  <StatusPill
                    status={lead.display_status || cardStatus}
                    label={ts(lead.display_status || cardStatus)}
                  />
                </div>
                {lead.is_trackable === false ? (
                  <p className="mt-2 text-sm text-themed-subtle">
                    {t("batch.noOrderIdHint")}
                  </p>
                ) : (
                  <>
                {lead.tracking_status && (
                  <p className="mt-2 text-sm text-themed-muted">
                    AKS: {lead.tracking_status}
                    {lead.tracking_location && ` · ${lead.tracking_location}`}
                  </p>
                )}
                {lead.tracking_history?.length > 0 && (
                  <details className="mt-3 text-sm text-themed-muted">
                    <summary className="cursor-pointer text-indigo-500 dark:text-indigo-400">History</summary>
                    <table className="mt-2 w-full text-xs">
                      <thead><tr className="text-themed-subtle"><th className="text-left py-1">Status</th><th className="text-left">Location</th><th className="text-left">Time</th></tr></thead>
                      <tbody>
                        {lead.tracking_history.map((h, i) => (
                          <tr key={i} className="border-t border-themed">
                            <td className="py-1.5">{h.status}</td>
                            <td>{h.location}</td>
                            <td>{h.time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
                  </>
                )}
              </div>
              );
            })}
          </div>

          <PaginationBar
            page={currentPage}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        </>
      )}

      <AddLeadsSheet
        open={showAddLeads}
        onClose={() => setShowAddLeads(false)}
        batchId={Number(id)}
        onSubmit={appendLeads}
        busy={appendBusy}
      />
      <BulkIdsSheet
        open={showBulkIds}
        onClose={() => setShowBulkIds(false)}
        text={bulkIdsText}
        onChange={setBulkIdsText}
        onSubmit={applyBulkIds}
        busy={bulkBusy}
        waitingCount={waitingForId}
      />
      <ConfirmDialog
        open={!!confirmAction}
        title={
          confirmAction?.type === "deleteBatch"
            ? t("batch.deleteBatchTitle")
            : t("batch.deleteLeadsTitle")
        }
        message={
          confirmAction?.type === "deleteBatch"
            ? t("batch.deleteConfirm", { name: confirmAction.name, count: confirmAction.count })
            : t("batch.deleteLeadsConfirm", { count: confirmAction?.count ?? 0 })
        }
        confirmLabel={t("common.delete")}
        onConfirm={runConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
      <OrderIdScannerModal
        open={scanLeadId != null}
        onClose={() => setScanLeadId(null)}
        onScan={(scanned) => {
          const lead = batch?.leads?.find((l) => l.id === scanLeadId);
          if (lead) handleOrderIdChange(lead.id, lead.order_id, scanned);
          setScanLeadId(null);
        }}
      />
    </div>
  );
}
