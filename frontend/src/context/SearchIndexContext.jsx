import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "./AuthContext";

const SearchIndexContext = createContext(null);

async function fetchAllLeads() {
  try {
    const data = await api("/leads");
    if (Array.isArray(data)) return data;
  } catch {
    /* fall through — server may not have /api/leads yet */
  }

  const batches = await api("/batches");
  if (!Array.isArray(batches) || batches.length === 0) return [];

  const details = await Promise.all(batches.map((b) => api(`/batches/${b.id}`)));
  return details.flatMap((batch) =>
    (batch.leads || []).map((lead) => ({
      ...lead,
      batch_id: lead.batch_id ?? batch.id,
      batch_name: batch.name,
    })),
  );
}

export function SearchIndexProvider({ children }) {
  const { user } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setLeads([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllLeads();
      setLeads(data);
    } catch (err) {
      setError(err.message || "Failed to load orders");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => { if (user) refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [user, refresh]);

  return (
    <SearchIndexContext.Provider value={{ leads, loading, error, refresh }}>
      {children}
    </SearchIndexContext.Provider>
  );
}

export const useSearchIndex = () => useContext(SearchIndexContext);
