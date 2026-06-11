/** Accent-insensitive search matching (mirrors backend _fold_text). */
export function foldText(value) {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function leadMatchesSearch(lead, term) {
  const first = lead.first_name || "";
  const last = lead.last_name || "";
  const full = lead.full_name || `${first} ${last}`.trim();
  const orderId = lead.order_id || "";
  const phone = lead.phone || "";
  const batchName = lead.batch_name || "";

  const haystack = foldText(`${full} ${first} ${last} ${orderId} ${phone} ${batchName}`);
  const foldedTerm = foldText(term);

  if (foldedTerm.length < 2) return false;
  if (haystack.includes(foldedTerm)) return true;

  const words = foldedTerm.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length >= 2) {
    const fn = foldText(first);
    const ln = foldText(last);
    const [w0, w1] = words;
    if ((fn.includes(w0) && ln.includes(w1)) || (fn.includes(w1) && ln.includes(w0))) return true;
    if (haystack.includes(w0) && haystack.includes(w1)) return true;
  }

  return false;
}

export function filterLeads(leads, term) {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];
  return leads.filter((lead) => leadMatchesSearch(lead, trimmed)).slice(0, 30);
}
