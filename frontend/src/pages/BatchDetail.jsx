import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, CheckSquare, ChevronDown, ListChecks, RefreshCw, Rocket, Save, Trash2, X, UserPlus, ClipboardList,
} from "lucide-react";
import {
  api, formatDate, isLeadTrackable, ORDER_ID_LENGTH, ORDER_ID_PLACEHOLDER, trackCardClass, TRACKING_SCHEDULE_LABEL, validateOrderId,
} from "../api";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../context/I18nContext";
import { useSearchIndex } from "../context/SearchIndexContext";
import StatusPill from "../components/StatusPill";
import ActionMenu from "../components/ActionMenu";
import PaginationBar from "../components/PaginationBar";
import { AddLeadsSheet, BulkIdsSheet, FILTER_CHIPS, filterLeadsByChip } from "../components/BatchSheets";

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
  const savingIds = useRef(new Set());
  const highlightRef = useRef(null);

  const load = useCallback(async () => {
    const data = await api(`/batches/${id}`);
    setBatch(data);
    setBatchName(data.name);
    const drafts = {};
    data.leads.forEach((l) => { drafts[l.id] = l.order_id || ""; });
    setDraftIds(drafts);
    refreshSearch();
  }, [id, refreshSearch]);

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

  const handlePageSizeChange = (size) => {
    setPageSize(size);
    setPage(1);
  };

  const bulk = async (action) => {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === "delete" && !confirm(`Delete ${ids.length} lead(s)?`)) return;
    try {
      const data = await api(`/batches/${id}/leads/bulk`, {
        method: "POST",
        body: JSON.stringify({ lead_ids: ids, action }),
      });
      setBatch(data);
      setSelected(new Set());
      show(t("batch.bulkDone"));
    } catch (err) {
      show(err.message, "error");
    }
  };

  const saveName = async () => {
    try {
      await api(`/batches/${id}`, { method: "PATCH", body: JSON.stringify({ name: batchName.trim() }) });
      show(t("batch.nameSaved"));
    } catch (e) {
      show(e.message, "error");
    }
  };

  const appendLeads = async (text) => {
    setAppendBusy(true);
    try {
      const data = await api(`/batches/${id}/leads`, {
        method: "POST",
        body: JSON.stringify({ leads_text: text }),
      });
      setBatch(data);
      const drafts = {};
      data.leads.forEach((l) => { drafts[l.id] = l.order_id || ""; });
      setDraftIds(drafts);
      setShowAddLeads(false);
      refreshSearch();
      show(t("batch.ordersAdded", { count: data.leads.length - leads.length }));
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
      show(t("batch.trackingEnabled", { schedule: TRACKING_SCHEDULE_LABEL }));
    } catch (e) {
      show(e.message, "error");
    }
  };

  const deleteBatch = async () => {
    if (!confirm(t("batch.deleteConfirm", { name: batch.name, count: total }))) return;
    try {
      await api(`/batches/${id}`, { method: "DELETE" });
      show(t("batch.batchDeleted"));
      navigate("/");
    } catch (e) {
      show(e.message, "error");
    }
  };

  const trackOrdersNow = async () => {
    const trackable = batch.leads.filter((l) => isLeadTrackable(l));
    if (!trackable.length) {
      show(t("batch.noIdsYet"), "error");
      return;
    }

    setTrackRun({ done: 0, total: trackable.length, current: t("batch.connectingAks"), failed: 0 });
    let failed = 0;
    let lastError = "";

    try {
      try {
        await api("/tracking/reset-session", { method: "POST" });
      } catch {
        /* session reset is best-effort */
      }

      const data = await api(`/batches/${id}/refresh-tracking`, { method: "POST" });
      const results = data.results || [];

      for (const result of results) {
        const lead = batch.leads.find((l) => l.id === result.lead_id);
        setTrackRun((r) => ({
          ...r,
          current: lead?.full_name || `Order #${result.lead_id}`,
          done: r.done + 1,
        }));

        if (result.ok === true && result.lead) {
          setBatch((b) => ({
            ...b,
            leads: b.leads.map((l) => (l.id === result.lead_id ? result.lead : l)),
          }));
        } else {
          failed += 1;
          lastError = result.error || "AKS lookup failed";
        }

        await new Promise((r) => setTimeout(r, 60));
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
    <div className="animate-slide-up space-y-6">
      <button onClick={() => navigate("/")} className="btn-secondary !py-2 text-themed-muted">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input-field max-w-md font-display text-xl font-bold"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
            />
            <button onClick={saveName} className="btn-secondary"><Save className="h-4 w-4" /></button>
          </div>
          <p className="mt-2 text-sm text-themed-muted">
            {t("common.imported")} {formatDate(batch.imported_date)}
            {batch.sent_date && ` · ${t("common.sent")} ${formatDate(batch.sent_date)}`}
            {" · "}{t("batch.ordersMeta", { total, linked })}
            {trackableCount > 0 && ` · ${t("batch.withIds", { count: trackableCount })}${notSentCount ? ` · ${t("batch.waiting", { count: notSentCount })}` : ""}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap gap-2">
            {unsavedCount > 0 && batch.status !== "tracking" && (
              <button onClick={saveAllIds} className="btn-secondary">
                <Save className="h-4 w-4" /> {t("batch.saveAllIds", { count: unsavedCount })}
              </button>
            )}
            <button onClick={deleteBatch} className="btn-danger">
              <Trash2 className="h-4 w-4" /> {t("batch.deleteBatch")}
            </button>
            <button
              onClick={startTracking}
              disabled={batch.status !== "tracking" && !hasTrackableOrders}
              title={trackingBlockReason() || undefined}
              className="btn-primary"
            >
              <Rocket className="h-4 w-4" />
              {batch.status === "tracking" ? t("batch.viewTracking") : t("batch.startTracking")}
            </button>
          </div>
          {batch.status !== "tracking" && trackingBlockReason() && (
            <p className="text-xs text-amber-500 dark:text-amber-400/90 max-w-sm text-right">{trackingBlockReason()}</p>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-themed pb-px overflow-x-auto">
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

      <div className="flex flex-wrap gap-2">
        {FILTER_CHIPS.map(({ id, key }) => (
          <button
            key={id}
            type="button"
            onClick={() => setLeadFilter(id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium min-h-[36px] sm:min-h-0 transition ${
              leadFilter === id ? "bg-indigo-600 text-white" : "border border-themed text-themed-muted hover:text-themed"
            }`}
          >
            {t(`batch.${key}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setShowAddLeads(true)} className="btn-secondary !py-2 min-h-[44px]">
          <UserPlus className="h-4 w-4" /> {t("batch.addOrders")}
        </button>
        {waitingForId > 0 && tab === "ids" && (
          <button type="button" onClick={() => setShowBulkIds(true)} className="btn-secondary !py-2 min-h-[44px]">
            <ClipboardList className="h-4 w-4" /> {t("batch.bulkIds")}
          </button>
        )}
      </div>

      {tab === "ids" && (
        <>
          <div className="glass relative z-10 flex flex-wrap items-center gap-3 p-4">
            <ActionMenu
              label={t("batch.select")}
              icon={CheckSquare}
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
            <button disabled={!selected.size} onClick={() => bulk("delete")} className="btn-danger">
              <Trash2 className="h-4 w-4" /> {t("common.delete")}
            </button>
            <span className="ml-auto text-xs text-themed-muted">{t("batch.idsSavedHint", { linked, total })}</span>
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
                className={`grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3 p-4 lg:grid-cols-[auto_minmax(0,1fr)_280px] ${selected.has(lead.id) ? "bg-indigo-500/5" : ""} ${isHighlighted ? "ring-2 ring-inset ring-indigo-500/50 bg-indigo-500/10" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(lead.id)}
                  onChange={(e) => {
                    const s = new Set(selected);
                    e.target.checked ? s.add(lead.id) : s.delete(lead.id);
                    setSelected(s);
                  }}
                  className="accent-indigo-500"
                />
                <div className="min-w-0">
                  <button
                    className="flex w-full min-w-0 items-center gap-2 text-left"
                    onClick={() => {
                      const e = new Set(expanded);
                      e.has(lead.id) ? e.delete(lead.id) : e.add(lead.id);
                      setExpanded(e);
                    }}
                  >
                    <span className="w-6 shrink-0 text-sm text-themed-subtle">{lead.sort_order}.</span>
                    <span className="truncate font-semibold text-themed">{lead.full_name}</span>
                    <StatusPill status={lead.lifecycle_status} label={ts(lead.display_status || lead.lifecycle_status)} />
                    <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-themed-subtle transition ${expanded.has(lead.id) ? "rotate-180" : ""}`} />
                  </button>
                  {expanded.has(lead.id) && (
                    <div className="mt-2 space-y-0.5 pl-8 text-sm text-themed-muted">
                      <div>{lead.street}</div>
                      <div>{lead.city} {lead.postal_code}</div>
                      <div>{lead.phone}</div>
                    </div>
                  )}
                </div>
                <div className="relative col-span-2 lg:col-span-1 lg:col-start-3">
                  <input
                    className="input-field !py-2.5 pr-[4.75rem] font-mono text-sm"
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
                  {isIdSaved && (
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-emerald-500/60 dark:text-emerald-400/45">
                      {t("batch.idSaved")}
                    </span>
                  )}
                </div>
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
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={trackOrdersNow}
              disabled={!!trackRun || !trackableCount}
              className="btn-primary"
            >
              <RefreshCw className={`h-4 w-4 ${trackRun ? "animate-spin" : ""}`} />
              {trackRun ? t("batch.trackingProgress") : t("batch.trackOrdersNow")}
            </button>
            <span className="text-sm text-themed-muted">
              {TRACKING_SCHEDULE_LABEL}
              {" · "}{t("batch.withIds", { count: trackableCount })}{notSentCount > 0 && ` · ${t("batch.waiting", { count: notSentCount })}`}
            </span>
          </div>

          {trackRun && (
            <div className="glass space-y-2.5 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-themed">{t("batch.fetchingAks")}</span>
                <span className="text-themed-muted">{trackRun.done}/{trackRun.total}</span>
              </div>
              {trackRun.current && (
                <p className="truncate text-xs text-indigo-500/80 dark:text-indigo-300/80">{trackRun.current}</p>
              )}
              <div className="h-2.5 overflow-hidden rounded-full bg-themed-hover">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
                  style={{ width: `${trackRun.total ? (trackRun.done / trackRun.total) * 100 : 0}%` }}
                />
              </div>
              {trackRun.failed > 0 && (
                <p className="text-xs text-rose-500 dark:text-rose-400">{t("batch.failedSoFar", { count: trackRun.failed })}</p>
              )}
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
    </div>
  );
}
