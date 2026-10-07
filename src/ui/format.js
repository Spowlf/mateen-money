// Small display helpers shared by screens.

import { formatMoney, gbp, formatDay, today, toDecimalText, withShares } from '../engine/index.js';
import { OfflineError } from '../errors.js';
import { toast } from './dom.js';

/** An entry's amount as charged, with the GBP estimate for foreign ones: "S$12.50, ~£7.35". */
export function money(entry) {
  // An ambiguous symbol is shown as it arrived until the currency is picked.
  if (entry.needsCurrency && entry.symbol) return `${entry.symbol}${toDecimalText(entry.amountMinor, entry.currency)}`;
  const own = formatMoney(entry.amountMinor, entry.currency);
  if (entry.currency === 'GBP' || entry.gbpPence == null) return own;
  return `${own}, ${entry.gbpStatus === 'final' ? '' : '~'}${gbp(entry.gbpPence)}`;
}

/** "Today at 13:00" or "30 Sep 2026 at 13:00". */
export function whenPhrase(entry) {
  const day = entry.date === today() ? 'Today' : formatDay(entry.date);
  return entry.time ? `${day} at ${entry.time}` : day;
}

/** Live rows in their own order. */
export const liveSorted = (rows, key = 'sort') => rows.filter((r) => !r.deletedAt)
  .sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));

/** Runs a change that needs the backend; failures become a toast saying nothing changed. */
export async function runAction(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OfflineError) toast('You’re offline. Nothing changed.');
    else if (err.message?.startsWith('Nothing changed')) toast(err.message);
    else toast(`Nothing changed: ${err.message.charAt(0).toLowerCase()}${err.message.slice(1)}`);
    return null;
  }
}

/**
 * Chip or select options from live rows, keeping a removed choice selectable ("Monzo, removed"),
 * so saving an old record never quietly moves it to another one.
 */
export function withRemoved(rows, selectedId, all) {
  const out = rows.map((r) => ({ value: r.id, label: r.name }));
  const gone = selectedId && !rows.some((r) => r.id === selectedId) && all.find((r) => r.id === selectedId);
  if (gone) out.push({ value: gone.id, label: `${gone.name}, removed` });
  return out;
}

/**
 * The payments as spending sees them: a split bill counts only your share (see withShares in
 * src/engine/splits.js). Every spending figure reads these; Net Worth reads S.entries.
 */
export const spending = (S) => withShares(S.entries, S.splits ?? []);
