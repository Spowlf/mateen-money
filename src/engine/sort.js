// One-tap choices for entries in "To sort".

import { addDays } from './dates.js';
import { matchVendor, similarity, SUGGEST_THRESHOLD } from './vendors.js';
import { isLive } from './totals.js';

export const TO_SORT_NUDGE = 10;
const RECENT_DAYS = 90;

/**
 * The n most-used categories: by count over the last 90 days, then all time, ties by the
 * categories' own order, topped up from that order so there are always n (if n exist).
 */
export function topCategories(entries, categories, { todayDate, n = 4 } = {}) {
  const live = categories.filter((c) => isLive(c) && !c.archived);
  const liveIds = new Set(live.map((c) => c.id));
  const since = todayDate ? addDays(todayDate, -RECENT_DAYS) : '0000-01-01';
  const recent = new Map();
  const ever = new Map();
  for (const e of entries) {
    if (!isLive(e) || e.kind !== 'spend' || !liveIds.has(e.categoryId)) continue;
    ever.set(e.categoryId, (ever.get(e.categoryId) ?? 0) + 1);
    if (e.date >= since) recent.set(e.categoryId, (recent.get(e.categoryId) ?? 0) + 1);
  }
  const ranked = [...live].sort((a, b) => (recent.get(b.id) ?? 0) - (recent.get(a.id) ?? 0)
    || (ever.get(b.id) ?? 0) - (ever.get(a.id) ?? 0)
    || a.sort - b.sort);
  return ranked.slice(0, n);
}

// Words in a merchant name that say what it sells, for a merchant with no history yet.
// Matched as whole words on the lower-cased name. Ids are the default categories; a removed one is skipped.
export const MERCHANT_HINTS = [
  ['transport', /\b(bus|buses|coach|coaches|rail|railway|railways|train|trains|trainline|tfl|uber(?! eats)|bolt|taxi|taxis|cab|cabs|stagecoach|arriva|whippet|greater anglia|thameslink|great northern|gwr|lner|avanti|crosscountry|national express|megabus|lime|voi|parking|petrol|esso|smrt|sbs transit|transitlink|grab(?!food| food))\b/],
  ['delivery', /\b(deliveroo|uber eats|just eat|justeat|grabfood|grab food|foodpanda)\b/],
  ['groceries', /\b(tesco|sainsbury|sainsburys|aldi|lidl|asda|morrisons|waitrose|co op|coop|ocado|iceland|marks and spencer|m and s|fairprice|ntuc|cold storage|sheng siong|supermarket)\b/],
  ['food', /\b(pret|costa|starbucks|nero|greggs|mcdonalds|kfc|nandos|wagamama|leon|itsu|wasabi|pizza|pizzeria|cafe|caffe|coffee|restaurant|kitchen|bakery|burger|burgers|sushi|grill|noodle|noodles|ramen|canteen|buttery)\b/],
  ['subscriptions', /\b(spotify|netflix|disney|icloud|apple com bill|amazon prime|youtube premium|chatgpt|openai|patreon|audible)\b/],
  ['health', /\b(boots|superdrug|pharmacy|chemist|dentist|dental|optician|opticians|specsavers|gym|puregym|watsons)\b/],
  ['school', /\b(heffers|blackwells|stationery|ryman|printing|university|college|faculty)\b/],
  ['leisure', /\b(waterstones|books|bookshop|cinema|vue|odeon|cineworld|picturehouse|theatre|museum|steam|playstation|nintendo|ticketmaster|eventbrite|skiddle)\b/],
  ['travel', /\b(airline|airlines|airways|easyjet|ryanair|airbnb|booking com|hotel|hotels|hostel|expedia|eurostar|trip com|agoda)\b/],
  ['utilities', /\b(vodafone|ee|o2|giffgaff|lebara|singtel|starhub|m1|octopus energy|british gas)\b/],
];

const hintText = (merchant) => ` ${String(merchant ?? '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** The category a merchant's name points to (MERCHANT_HINTS), or null. */
export function hintedCategory(merchant) {
  const text = hintText(merchant);
  return MERCHANT_HINTS.find(([, re]) => re.test(text))?.[0] ?? null;
}

/**
 * The n likeliest categories for a merchant: those of similar merchants already known (by name or
 * alias, closer and more used first), then the one its name points to, then the most-used.
 */
export function suggestCategories(merchant, { vendors = [], aliases = [], entries = [], categories = [], todayDate, n = 3 }) {
  const usable = new Set(categories.filter((c) => isLive(c) && !c.archived).map((c) => c.id));
  const score = new Map();
  const add = (id, points) => { if (id && usable.has(id)) score.set(id, (score.get(id) ?? 0) + points); };
  const live = vendors.filter((v) => isLive(v) && v.categoryId);
  const byId = new Map(live.map((v) => [v.id, v]));
  const best = new Map();
  const consider = (v, name) => {
    const sim = similarity(name, merchant);
    if (sim >= SUGGEST_THRESHOLD && sim > (best.get(v.id) ?? 0)) best.set(v.id, sim);
  };
  for (const v of live) consider(v, v.name);
  for (const a of aliases) if (isLive(a) && byId.has(a.vendorId)) consider(byId.get(a.vendorId), a.alias ?? a.aliasNorm);
  for (const [id, sim] of best) add(byId.get(id).categoryId, 1000 * sim + Math.min(byId.get(id).useCount ?? 0, 50));
  add(hintedCategory(merchant), 500);
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const out = ranked.map((id) => categories.find((c) => c.id === id));
  for (const c of topCategories(entries, categories, { todayDate, n: n + ranked.length })) {
    if (out.length >= n) break;
    if (!out.includes(c)) out.push(c);
  }
  return out.slice(0, n);
}

/**
 * Choices for one To sort entry: its most likely vendor (by alias similarity; never an exact
 * match, which would already have been applied) and the likeliest categories for its merchant:
 * 1 beside a vendor (its own category comes first), 2 without one, so the choices fit on one line
 * on a phone ("More" opens the rest).
 */
export function sortChoices(entry, { vendors = [], aliases = [], entries = [], categories = [], todayDate }) {
  const { exact, suggestion } = matchVendor(entry.merchant, vendors, aliases);
  const vendor = exact ?? suggestion ?? null;
  return {
    vendor,
    categories: suggestCategories(entry.merchant, { vendors, aliases, entries, categories, todayDate, n: vendor ? 1 : 2 }),
  };
}

/** "10 to sort. It takes about a minute." once more than 10 are waiting. */
export function toSortNudge(count) {
  return count > TO_SORT_NUDGE ? `${count} to sort. It takes about a minute.` : null;
}
