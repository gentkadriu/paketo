/** AKS Order ID: 917 + 11 digits (14 total). */
export const AKS_ORDER_ID_RE = /^917\d{11}$/;

export function extractOrderId(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (AKS_ORDER_ID_RE.test(digits)) return digits;
  const embedded = digits.match(/917\d{11}/);
  return embedded ? embedded[0] : "";
}

/** Insert one missing digit — printer dead-pixel gap (13 digits read). */
export function candidatesWithOneMissingDigit(digits) {
  if (!digits.startsWith("917") || digits.length !== 13) return [];
  const out = new Set();
  for (let pos = 0; pos <= digits.length; pos += 1) {
    for (let d = 0; d <= 9; d += 1) {
      const candidate = `${digits.slice(0, pos)}${d}${digits.slice(pos)}`;
      if (AKS_ORDER_ID_RE.test(candidate)) out.add(candidate);
    }
  }
  return [...out];
}

/** e.g. OCR lines "91796000359" and "87" from a streaked AKS label. */
function repairSplitDigitGroups(raw) {
  const groups = String(raw || "").match(/\d+/g) || [];
  const headIdx = groups.findIndex((g) => g.startsWith("917") && g.length >= 10);
  if (headIdx < 0) return [];

  const head = groups[headIdx];
  const tail = groups[headIdx + 1];
  if (tail && tail.length >= 1 && tail.length <= 4 && head.length + tail.length === 13) {
    return candidatesWithOneMissingDigit(head + tail);
  }

  // "91796000359 87" with only whitespace between
  const spaced = String(raw || "").match(/917\d[\d\s]{8,16}/);
  if (spaced) {
    const parts = spaced[0].match(/\d+/g) || [];
    if (parts.length >= 2) {
      const h = parts[0];
      const t = parts.slice(1).join("");
      if (h.startsWith("917") && h.length + t.length === 13) {
        return candidatesWithOneMissingDigit(h + t);
      }
    }
  }
  return [];
}

/** Swap one digit — OCR misreads on damaged labels. */
function candidatesWithOneWrongDigit(digits) {
  if (!digits.startsWith("917") || digits.length !== 14) return [];
  const out = new Set();
  for (let pos = 3; pos < digits.length; pos += 1) {
    for (let d = 0; d <= 9; d += 1) {
      if (d === Number(digits[pos])) continue;
      const chars = digits.split("");
      chars[pos] = String(d);
      const candidate = chars.join("");
      if (AKS_ORDER_ID_RE.test(candidate)) out.add(candidate);
    }
  }
  return [...out];
}

/**
 * Turn raw scan/OCR text into an exact ID or a short list of likely IDs.
 * @returns {{ exact: string | null, candidates: string[] }}
 */
export function resolveOrderId(raw) {
  const exact = extractOrderId(raw);
  if (exact) return { exact, candidates: [] };

  const splitCandidates = repairSplitDigitGroups(raw);
  if (splitCandidates.length === 1) {
    return { exact: splitCandidates[0], candidates: [] };
  }

  let digits = String(raw || "").replace(/\D/g, "");
  const start = digits.indexOf("917");
  if (start >= 0) digits = digits.slice(start);

  if (digits.length > 14 && digits.startsWith("917")) {
    const trimmed = digits.slice(0, 14);
    if (AKS_ORDER_ID_RE.test(trimmed)) return { exact: trimmed, candidates: [] };
  }

  const candidates = new Set([
    ...splitCandidates,
    ...candidatesWithOneMissingDigit(digits),
    ...candidatesWithOneWrongDigit(digits),
  ]);

  const list = [...candidates];
  if (list.length === 1) return { exact: list[0], candidates: [] };
  return { exact: null, candidates: list.slice(0, 10) };
}

export function mergeResolveResults(...results) {
  for (const result of results) {
    if (result?.exact) return result;
  }
  const seen = new Set();
  const candidates = [];
  for (const result of results) {
    for (const id of result?.candidates || []) {
      if (!seen.has(id)) {
        seen.add(id);
        candidates.push(id);
      }
    }
  }
  if (candidates.length === 1) return { exact: candidates[0], candidates: [] };
  return { exact: null, candidates: candidates.slice(0, 10) };
}
