/** AKS Order ID: 917 + 11 digits (14 total). */
export const AKS_ORDER_ID_RE = /^917\d{11}$/;

/** Thermal print streak — always the 12th digit (3rd from end): 917 + 8 digits + streak + 2 tail. */
export const STREAK_DIGIT_INDEX = 11;

export function extractOrderId(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (AKS_ORDER_ID_RE.test(digits)) return digits;
  const embedded = digits.match(/917\d{11}/);
  return embedded ? embedded[0] : "";
}

/**
 * Exactly 10 candidates: digits 1–11 fixed, digit 12 = 0–9, last 2 digits fixed.
 * Layout: prefix (11) + streak (1) + suffix (2) = 14.
 */
export function streakDigitCandidates(prefix, suffix) {
  if (!prefix.startsWith("917") || prefix.length !== STREAK_DIGIT_INDEX) return [];
  if (suffix.length !== 2) return [];

  const out = [];
  for (let d = 0; d <= 9; d += 1) {
    const candidate = `${prefix}${d}${suffix}`;
    if (AKS_ORDER_ID_RE.test(candidate)) out.push(candidate);
  }
  return out;
}

function suffixFromDigits(digits) {
  if (digits.length === 13) {
    return digits.slice(STREAK_DIGIT_INDEX, STREAK_DIGIT_INDEX + 2);
  }
  if (digits.length === 14) {
    // OCR may append a ghost copy of the misread streak digit: ...1 + 15 → ...151
    if (digits[13] === digits[STREAK_DIGIT_INDEX]) {
      return digits.slice(STREAK_DIGIT_INDEX, STREAK_DIGIT_INDEX + 2);
    }
    return digits.slice(12, 14);
  }
  return null;
}

function prefixSuffixFromDigits(digits) {
  if (!digits.startsWith("917")) return null;
  if (digits.length !== 13 && digits.length !== 14) return null;

  const suffix = suffixFromDigits(digits);
  if (!suffix || suffix.length !== 2) return null;
  return { prefix: digits.slice(0, STREAK_DIGIT_INDEX), suffix };
}

/** OCR split e.g. "91708000359" and "15" around the streak gap. */
function streakCandidatesFromSplitGroups(raw) {
  const groups = String(raw || "").match(/\d+/g) || [];
  const headIdx = groups.findIndex((g) => g.startsWith("917") && g.length === STREAK_DIGIT_INDEX);
  if (headIdx >= 0 && groups[headIdx + 1]?.length >= 2) {
    return streakDigitCandidates(groups[headIdx], groups[headIdx + 1].slice(0, 2));
  }

  const spaced = String(raw || "").match(/917\d[\d\s]{8,18}/);
  if (spaced) {
    const parts = spaced[0].match(/\d+/g) || [];
    if (parts.length >= 2) {
      const prefix = parts[0];
      const tail = parts.slice(1).join("");
      if (prefix.startsWith("917") && prefix.length === STREAK_DIGIT_INDEX && tail.length >= 2) {
        return streakDigitCandidates(prefix, tail.slice(0, 2));
      }
    }
  }

  return [];
}

function streakCandidatesFromDigits(digits) {
  const parts = prefixSuffixFromDigits(digits);
  if (!parts) return [];
  return streakDigitCandidates(parts.prefix, parts.suffix);
}

/**
 * Turn raw scan/OCR text into candidate IDs (never auto-pick — UI confirms).
 * @returns {{ exact: string | null, candidates: string[] }}
 */
export function resolveOrderId(raw) {
  const fromGroups = streakCandidatesFromSplitGroups(raw);
  if (fromGroups.length > 0) {
    return { exact: null, candidates: fromGroups };
  }

  let digits = String(raw || "").replace(/\D/g, "");
  const start = digits.indexOf("917");
  if (start >= 0) digits = digits.slice(start);

  if (digits.length >= 14 && digits.startsWith("917")) {
    const candidates = streakCandidatesFromDigits(digits.slice(0, 14));
    if (candidates.length > 0) return { exact: null, candidates };
  }

  if (digits.length === 13) {
    const candidates = streakCandidatesFromDigits(digits);
    if (candidates.length > 0) return { exact: null, candidates };
  }

  return { exact: null, candidates: [] };
}

export function mergeResolveResults(...results) {
  const seen = new Set();
  const candidates = [];
  for (const result of results) {
    if (result?.exact && !seen.has(result.exact)) {
      seen.add(result.exact);
      candidates.push(result.exact);
    }
    for (const id of result?.candidates || []) {
      if (!seen.has(id)) {
        seen.add(id);
        candidates.push(id);
      }
    }
  }
  return { exact: null, candidates: candidates.slice(0, 10) };
}
