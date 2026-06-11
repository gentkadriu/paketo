import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Search, X } from "lucide-react";
import { useI18n } from "../context/I18nContext";
import { useSearchIndex } from "../context/SearchIndexContext";
import { filterLeads } from "../searchUtil";
import StatusPill from "./StatusPill";

export default function SearchBar({ className = "" }) {
  const { t, ts } = useI18n();
  const { leads, loading: indexLoading, error: indexError, refresh } = useSearchIndex();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef(null);

  const trimmed = query.trim();

  const results = useMemo(
    () => (trimmed.length >= 2 ? filterLeads(leads, trimmed) : []),
    [leads, trimmed],
  );

  const showDropdown = focused && trimmed.length > 0;

  useEffect(() => {
    const onDocClick = (e) => {
      if (!wrapRef.current?.contains(e.target)) setFocused(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (item) => {
    setFocused(false);
    setQuery("");
    navigate(`/batch/${item.batch_id}?lead=${item.id}`);
  };

  const busy = indexLoading && leads.length === 0;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-themed-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { setFocused(true); if (!leads.length) refresh(); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setFocused(false);
            if (e.key === "Enter" && results[0]) pick(results[0]);
          }}
          placeholder={t("common.search")}
          className="input-field !py-2 !pl-9 !pr-9 text-sm"
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); setFocused(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-themed-muted hover:text-themed"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="search-dropdown absolute left-0 right-0 top-[calc(100%+4px)] z-[9999] max-h-72 overflow-y-auto overscroll-contain rounded-xl border shadow-2xl">
          {trimmed.length < 2 && (
            <p className="px-4 py-3 text-sm text-themed-muted">{t("common.searchMin")}</p>
          )}
          {trimmed.length >= 2 && busy && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-themed-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          )}
          {trimmed.length >= 2 && indexError && !busy && (
            <div className="px-4 py-3 text-sm text-rose-400">
              <p>{indexError}</p>
              <button type="button" onClick={refresh} className="mt-1 text-xs text-indigo-400 underline">
                Retry
              </button>
            </div>
          )}
          {trimmed.length >= 2 && !busy && !indexError && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-themed-muted">
              <p>{t("common.noResults")}</p>
              <p className="mt-1 text-xs text-themed-subtle">
                {leads.length === 0
                  ? t("common.searchNoIndex")
                  : t("common.searchHint")}
              </p>
            </div>
          )}
          {trimmed.length >= 2 && !busy && results.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pick(item)}
              className="flex w-full items-start justify-between gap-3 border-b border-themed px-4 py-3 text-left transition last:border-0 hover:bg-themed-hover"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-themed">{item.full_name}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-themed-muted">
                  {item.order_id || t("batch.noOrderId")}
                </div>
                <div className="mt-1 truncate text-xs text-themed-subtle">{item.batch_name}</div>
              </div>
              <StatusPill
                status={item.display_status || item.lifecycle_status}
                label={ts(item.display_status || item.lifecycle_status)}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
