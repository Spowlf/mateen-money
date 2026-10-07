// Vendor names, aliases and duplicate payments.

// Prefixes card processors add ("SQ *CORNER CAFE", "SUMUP *PRET").
const PROCESSOR_PREFIX = /^(sq|sumup|zettle|izettle|iz|paypal|pp|crv|sp|tst|dd|ccd|vpos)\s*[*_]+\s*/i;

// Words that don't tell vendors apart.
const NOISE = new Set(['ltd', 'limited', 'plc', 'llp', 'inc', 'co', 'uk', 'gb', 'gbr', 'the', 'store', 'stores', 'shop',
  'www', 'com', 'net', 'org', 'pte', 'sg', 'sgp', 'london', 'cambridge', 'singapore']);

/** "PRET A MANGER #1234 LONDON" → "pret a manger". */
export function normaliseMerchant(name) {
  let s = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(PROCESSOR_PREFIX, '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '');
  const words = s.split(/[^a-z0-9]+/).filter((w) => w && !/\d/.test(w) && !NOISE.has(w));
  return words.join(' ');
}

const bigrams = (s) => {
  const t = s.replace(/ /g, '');
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
};

function dice(a, b) {
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  let hits = 0;
  for (const x of b) {
    const n = counts.get(x);
    if (n) { hits++; counts.set(x, n - 1); }
  }
  return (2 * hits) / (a.length + b.length);
}

/** Similarity of two merchant names, 0 to 1. Order of arguments doesn't matter. */
export function similarity(a, b) {
  const na = normaliseMerchant(a);
  const nb = normaliseMerchant(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  // One name is the other with extra words ("pret" vs "pret a manger").
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.every((w, i) => long[i] === w) && short.join('').length >= 3) return 0.9;
  return Math.max(dice(ta, tb), dice(bigrams(na), bigrams(nb)));
}

export const SUGGEST_THRESHOLD = 0.6;

/**
 * Finds the vendor for an incoming merchant name.
 * - exact: its normalised name equals a vendor's name or one of its aliases. Safe to apply.
 * - suggestion: the most similar vendor at or above the threshold. Offer it, don't apply it.
 * aliases are { aliasNorm, vendorId }.
 */
export function matchVendor(merchant, vendors, aliases = []) {
  const norm = normaliseMerchant(merchant);
  const live = vendors.filter((v) => !v.deletedAt);
  if (!norm) return { exact: null, suggestion: null };
  const byId = new Map(live.map((v) => [v.id, v]));
  for (const v of live) if (normaliseMerchant(v.name) === norm) return { exact: v, suggestion: null };
  for (const a of aliases) {
    if (!a.deletedAt && a.aliasNorm === norm && byId.has(a.vendorId)) return { exact: byId.get(a.vendorId), suggestion: null };
  }
  let best = null;
  let bestScore = 0;
  const consider = (vendor, name) => {
    const score = similarity(name, merchant);
    // Ties go to the more-used vendor, then by name, so the suggestion never jumps around.
    if (score > bestScore || (score === bestScore && best && ((vendor.useCount ?? 0) > (best.useCount ?? 0)
      || ((vendor.useCount ?? 0) === (best.useCount ?? 0) && vendor.name < best.name)))) {
      best = vendor; bestScore = score;
    }
  };
  for (const v of live) consider(v, v.name);
  for (const a of aliases) if (!a.deletedAt && byId.has(a.vendorId)) consider(byId.get(a.vendorId), a.aliasNorm);
  return { exact: null, suggestion: bestScore >= SUGGEST_THRESHOLD ? best : null, score: bestScore };
}

export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/**
 * An incoming payment is a duplicate when a live entry has the same amount, currency and
 * merchant within 2 minutes (either side). 2 minutes exactly still counts.
 */
export function findDuplicate(incoming, entries) {
  const norm = normaliseMerchant(incoming.merchant);
  // A bill a friend paid never touched the user's card, so it's never the same payment.
  return entries.find((e) => !e.deletedAt && !e.paidBy
    && e.amountMinor === incoming.amountMinor
    && e.currency === incoming.currency
    && e.at != null && incoming.at != null
    && Math.abs(e.at - incoming.at) <= DUPLICATE_WINDOW_MS
    && normaliseMerchant(e.merchant) === norm) ?? null;
}
