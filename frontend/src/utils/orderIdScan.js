/** AKS Order ID: 917 + 11 digits (14 total). */
export const AKS_ORDER_ID_RE = /^917\d{11}$/;

/** Thermal print streak — always the 12th digit (3rd from end): 917 + 8 digits + streak + 2 tail. */
export const STREAK_DIGIT_INDEX = 11;

/** Max IDs shown in the confirm picker. */
export const STREAK_CANDIDATE_LIMIT = 100;

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

function addSuffix(out, seen, suffix, front = false) {
  if (suffix.length !== 2 || !/^\d{2}$/.test(suffix) || seen.has(suffix)) return;
  seen.add(suffix);
  if (front) out.unshift(suffix);
  else out.push(suffix);
}

/**
 * All plausible last-2 readings from a noisy OCR tail (streak + suffix merged).
 * Handles reversed pairs, ghost digits, and dropped zeros without hardcoding endings.
 */
export function suffixCandidatesFromTail(tailRaw) {
  const ordered = [];
  const seen = new Set();

  const scanPairs = (text, front = false) => {
    for (let i = 0; i <= text.length - 2; i += 1) {
      const pair = text.slice(i, i + 2);
      addSuffix(ordered, seen, pair, front);
      addSuffix(ordered, seen, pair.split("").reverse().join(""), front);
    }
  };

  if (tailRaw.length < 2) return ordered;

  addSuffix(ordered, seen, tailRaw.slice(-2), true);
  addSuffix(ordered, seen, tailRaw.slice(0, 2), true);
  scanPairs(tailRaw);

  for (let i = 0; i < tailRaw.length; i += 1) {
    scanPairs(tailRaw.slice(0, i) + tailRaw.slice(i + 1));
  }

  for (let i = 0; i <= tailRaw.length; i += 1) {
    scanPairs(`${tailRaw.slice(0, i)}0${tailRaw.slice(i)}`);
  }

  return ordered;
}

function buildStreakCandidates(prefix, tailRaw) {
  const suffixes = suffixCandidatesFromTail(tailRaw);
  const out = [];
  const seen = new Set();

  for (const suffix of suffixes) {
    for (const id of streakDigitCandidates(prefix, suffix)) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }

  return out;
}

function collectPrefixTails(raw) {
  const tailsByPrefix = new Map();

  const add = (prefix, tailRaw) => {
    if (!prefix.startsWith("917") || prefix.length !== STREAK_DIGIT_INDEX) return;
    if (!tailRaw || tailRaw.length < 2) return;
    const bucket = tailsByPrefix.get(prefix) || new Set();
    bucket.add(tailRaw.slice(0, 5));
    tailsByPrefix.set(prefix, bucket);
  };

  const groups = String(raw || "").match(/\d+/g) || [];
  const headIdx = groups.findIndex((g) => g.startsWith("917") && g.length === STREAK_DIGIT_INDEX);
  if (headIdx >= 0 && groups[headIdx + 1]?.length >= 2) {
    add(groups[headIdx], groups[headIdx + 1]);
  }

  const spaced = String(raw || "").match(/917\d[\d\s]{8,18}/);
  if (spaced) {
    const parts = spaced[0].match(/\d+/g) || [];
    if (parts.length >= 2) {
      add(parts[0], parts.slice(1).join(""));
    }
  }

  let digits = String(raw || "").replace(/\D/g, "");
  const start = digits.indexOf("917");
  if (start >= 0) digits = digits.slice(start);

  if (digits.length >= 13 && digits.startsWith("917")) {
    add(digits.slice(0, STREAK_DIGIT_INDEX), digits.slice(STREAK_DIGIT_INDEX));
  }

  return tailsByPrefix;
}

function resolveFromPrefixTails(tailsByPrefix) {
  const out = [];
  const seen = new Set();

  for (const [prefix, tailSet] of tailsByPrefix) {
    for (const tailRaw of tailSet) {
      for (const id of buildStreakCandidates(prefix, tailRaw)) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    }
  }

  return out.slice(0, STREAK_CANDIDATE_LIMIT);
}

/**
 * Turn raw scan/OCR text into candidate IDs (never auto-pick — UI confirms).
 * @returns {{ exact: string | null, candidates: string[] }}
 */
export function resolveOrderId(raw) {
  const candidates = resolveFromPrefixTails(collectPrefixTails(raw));
  return { exact: null, candidates };
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
  return { exact: null, candidates: candidates.slice(0, STREAK_CANDIDATE_LIMIT) };
}
