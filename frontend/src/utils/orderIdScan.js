/** AKS Order ID: 917 + 11 digits (14 total). */
export const AKS_ORDER_ID_RE = /^917\d{11}$/;

export function extractOrderId(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (AKS_ORDER_ID_RE.test(digits)) return digits;
  const embedded = digits.match(/917\d{11}/);
  return embedded ? embedded[0] : "";
}

/** Insert one missing digit — covers printer dead-pixel gaps (e.g. 13 digits read). */
function candidatesWithOneMissingDigit(digits) {
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

/** Swap one digit — covers OCR misreads on damaged labels. */
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

  let digits = String(raw || "").replace(/\D/g, "");
  const start = digits.indexOf("917");
  if (start >= 0) digits = digits.slice(start);

  if (digits.length > 14 && digits.startsWith("917")) {
    const trimmed = digits.slice(0, 14);
    if (AKS_ORDER_ID_RE.test(trimmed)) return { exact: trimmed, candidates: [] };
  }

  const candidates = new Set([
    ...candidatesWithOneMissingDigit(digits),
    ...candidatesWithOneWrongDigit(digits),
  ]);

  const list = [...candidates];
  if (list.length === 1) return { exact: list[0], candidates: [] };
  return { exact: null, candidates: list.slice(0, 8) };
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
  return { exact: null, candidates: candidates.slice(0, 8) };
}
