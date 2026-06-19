/** AKS Order ID: 917 + 11 digits (14 total). */
export const AKS_ORDER_ID_RE = /^917\d{11}$/;

/** Thermal print streak — always the 12th digit (3rd from end): 917xxxxxxxx + streak + xx */
export const STREAK_DIGIT_INDEX = 11;

export function extractOrderId(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (AKS_ORDER_ID_RE.test(digits)) return digits;
  const embedded = digits.match(/917\d{11}/);
  return embedded ? embedded[0] : "";
}

/** 11+3 merge where tail looks like reversed pair + ghost digit — e.g. 151 instead of 215. */
function looksStreakCorrupted(digits) {
  if (!digits.startsWith("917") || digits.length !== 14) return false;
  const tail = digits.slice(11);
  if (tail.length !== 3) return false;
  const pair = tail.slice(0, 2);
  const reversed = pair.split("").reverse().join("");
  return tail.slice(1, 3) === reversed || tail[0] === tail[2];
}
/** Insert the missing streak digit at index 11 (13-digit read after the gap). */
function candidatesWithMissingStreakDigit(digits, wrongStreakHint) {
  if (!digits.startsWith("917") || digits.length !== 13) return [];

  const digitOrder = [];
  if (wrongStreakHint != null && wrongStreakHint >= 0 && wrongStreakHint <= 9) {
    for (const delta of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
      const d = (wrongStreakHint + delta + 10) % 10;
      if (!digitOrder.includes(d)) digitOrder.push(d);
    }
  } else {
    for (let d = 0; d <= 9; d += 1) digitOrder.push(d);
  }

  const out = [];
  for (const d of digitOrder) {
    const candidate = `${digits.slice(0, STREAK_DIGIT_INDEX)}${d}${digits.slice(STREAK_DIGIT_INDEX)}`;
    if (AKS_ORDER_ID_RE.test(candidate)) out.push(candidate);
  }
  return out;
}

/** Fix a misread streak digit on a full 14-digit OCR read. */
function candidatesWithWrongStreakDigit(digits) {
  if (!digits.startsWith("917") || digits.length !== 14) return [];
  const out = [];
  const read = Number(digits[STREAK_DIGIT_INDEX]);
  for (let d = 0; d <= 9; d += 1) {
    if (d === read) continue;
    const chars = digits.split("");
    chars[STREAK_DIGIT_INDEX] = String(d);
    const candidate = chars.join("");
    if (AKS_ORDER_ID_RE.test(candidate)) out.push(candidate);
  }
  return out;
}

/** Swap the last two digits — streak often corrupts the trailing pair (15 ↔ 51). */
function candidatesWithTailPairSwap(digits) {
  if (!digits.startsWith("917") || digits.length !== 14) return [];
  const chars = digits.split("");
  const pos = digits.length - 2;
  [chars[pos], chars[pos + 1]] = [chars[pos + 1], chars[pos]];
  const candidate = chars.join("");
  return AKS_ORDER_ID_RE.test(candidate) ? [candidate] : [];
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

function orderedTailVariants(tail) {
  if (!tail) return [];
  const seen = new Set();
  const ordered = [];
  const add = (value) => {
    if (value && !seen.has(value)) {
      seen.add(value);
      ordered.push(value);
    }
  };

  // Streak often drops one digit then OCR duplicates the tail — try shorter tails first.
  if (tail.length >= 3) {
    add(tail.slice(0, -1));
    add(tail.slice(0, 2));
    add(tail.slice(-2));
    for (let i = 0; i < tail.length; i += 1) {
      add(tail.slice(0, i) + tail.slice(i + 1));
    }
    add(tail.slice(1));
    add(tail.split("").reverse().join(""));
    add(tail);
    return ordered;
  }

  add(tail);
  if (tail.length >= 2) {
    add(tail.slice(1));
    add(tail.slice(0, -1));
    add(tail.slice(0, 2));
    add(tail.slice(-2));
    add(tail.split("").reverse().join(""));
  }
  return ordered;
}

/** Head + tail split repair — streak drops one digit and OCR may add extras after the gap. */
function repairHeadTail(head, tail, wrongStreakHint) {
  if (!head.startsWith("917") || head.length < 10 || !tail) return [];

  const out = [];
  const seen = new Set();
  const deferred14 = [];
  const add = (id) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };

  for (const t of orderedTailVariants(tail)) {
    const combined = head + t;
    if (combined.length === 13) {
      candidatesWithMissingStreakDigit(combined, wrongStreakHint).forEach(add);
    } else if (combined.length === 14) {
      if (AKS_ORDER_ID_RE.test(combined)) deferred14.push(combined);
      else candidatesWithWrongStreakDigit(combined).forEach(add);
    }
  }

  deferred14.forEach(add);
  return out;
}

/** e.g. OCR lines "91708000359" and "15" with streak on the "2". */
function repairSplitDigitGroups(raw) {
  const out = new Set();
  const groups = String(raw || "").match(/\d+/g) || [];
  const headIdx = groups.findIndex((g) => g.startsWith("917") && g.length >= 10);
  if (headIdx >= 0) {
    const head = groups[headIdx];
    const tail = groups[headIdx + 1];
    if (tail) {
      repairHeadTail(head, tail).forEach((id) => out.add(id));
    }
  }

  const spaced = String(raw || "").match(/917\d[\d\s]{8,18}/);
  if (spaced) {
    const parts = spaced[0].match(/\d+/g) || [];
    if (parts.length >= 2) {
      const h = parts[0];
      const t = parts.slice(1).join("");
      if (h.startsWith("917")) {
        repairHeadTail(h, t).forEach((id) => out.add(id));
      }
    }
  }

  return [...out];
}

/**
 * 14-digit OCR read with streak at digit 12 — e.g. 91708000359151 instead of 91708000359215.
 * Layout: 917 + 8 digits + [streak] + 2 tail digits.
 */
function repairStreaked14DigitRead(digits) {
  if (!digits.startsWith("917") || digits.length !== 14) return [];

  const ordered = [];
  const deferredExact = [];
  const add = (id) => {
    if (id && !ordered.includes(id)) ordered.push(id);
  };
  const wrongStreakHint = Number(digits[STREAK_DIGIT_INDEX]);

  repairHeadTail(
    digits.slice(0, STREAK_DIGIT_INDEX),
    digits.slice(STREAK_DIGIT_INDEX),
    wrongStreakHint,
  ).forEach(add);

  candidatesWithMissingStreakDigit(digits.slice(0, 13), wrongStreakHint).forEach(add);
  candidatesWithTailPairSwap(digits).forEach(add);
  candidatesWithWrongStreakDigit(digits).forEach(add);

  if (AKS_ORDER_ID_RE.test(digits)) deferredExact.push(digits);
  deferredExact.forEach(add);

  return ordered;
}

/**
 * Turn raw scan/OCR text into candidate IDs (never auto-pick — UI confirms).
 * @returns {{ exact: string | null, candidates: string[] }}
 */
export function resolveOrderId(raw) {
  const primary = [];
  const secondary = new Set();
  const addPrimary = (id) => {
    if (id && !primary.includes(id)) primary.push(id);
  };
  const addSecondary = (id) => {
    if (id) secondary.add(id);
  };

  repairSplitDigitGroups(raw).forEach(addPrimary);

  let digits = String(raw || "").replace(/\D/g, "");
  const start = digits.indexOf("917");
  if (start >= 0) digits = digits.slice(start);

  if (digits.length === 14) {
    repairStreaked14DigitRead(digits).forEach(addPrimary);
  }

  if (digits.length > 14 && digits.startsWith("917")) {
    const trimmed = digits.slice(0, 14);
    repairStreaked14DigitRead(trimmed).forEach(addPrimary);
    if (AKS_ORDER_ID_RE.test(trimmed)) addSecondary(trimmed);
  }

  if (digits.length === 13) {
    candidatesWithMissingStreakDigit(digits).forEach(addPrimary);
  }

  const exact = extractOrderId(raw);
  if (exact) {
    addSecondary(exact);
    if (exact.length === 14) {
      repairStreaked14DigitRead(exact).forEach(addPrimary);
      repairHeadTail(
        exact.slice(0, STREAK_DIGIT_INDEX),
        exact.slice(STREAK_DIGIT_INDEX),
        Number(exact[STREAK_DIGIT_INDEX]),
      ).forEach(addPrimary);
    }
  }

  const list = [...primary, ...[...secondary].filter((id) => !primary.includes(id))];
  if (list.length === 0) return { exact: null, candidates: [] };

  if (exact && AKS_ORDER_ID_RE.test(exact)) {
    const withoutExact = list.filter((id) => id !== exact);
    const ordered = looksStreakCorrupted(digits)
      ? [...withoutExact, exact]
      : [exact, ...withoutExact];
    return { exact: null, candidates: ordered.slice(0, 25) };
  }

  return { exact: null, candidates: list.slice(0, 25) };
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
  return { exact: null, candidates: candidates.slice(0, 25) };
}
