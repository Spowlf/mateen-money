// Calendar dates are 'YYYY-MM-DD' strings and months are 'YYYY-MM'.
// All arithmetic is done in UTC so daylight saving never shifts a day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');

export function parse(date) {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

export function format(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

const toUtc = (date) => {
  const [y, m, d] = parse(date);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Today in the device's local time. Never use toISOString() for this. */
export function today(now = new Date()) {
  return format(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Local wall-clock time as 'HH:MM'. */
export function nowTime(now = new Date()) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(date, n) {
  return fromUtc(toUtc(date) + n * 86400000);
}

/** Adds months, clamping to the month's last day (31 Jan + 1 month = 28 Feb). */
export function addMonths(date, n, anchorDay) {
  const [y, m, d] = parse(date);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return format(ny, nm, Math.min(anchorDay ?? d, daysInMonth(ny, nm)));
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(date) {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7;
}

/** The Monday of the week that contains date. */
export function weekStart(date) {
  return addDays(date, -weekday(date));
}

export const monthKey = (date) => date.slice(0, 7);
export const monthStart = (key) => `${key}-01`;

export function monthEnd(key) {
  const [y, m] = key.split('-').map(Number);
  return format(y, m, daysInMonth(y, m));
}

export function addMonthsKey(key, n) {
  return monthKey(addMonths(monthStart(key), n));
}

/** Months from key a to key b (positive when b is later). */
export function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Days in [start, end] that overlap [from, to], inclusive. 0 if none. */
export function overlapDays(start, end, from, to) {
  const s = start > from ? start : from;
  const e = end < to ? end : to;
  return s > e ? 0 : daysBetween(s, e) + 1;
}

/** "30 Sep 2026" */
export function formatDay(date) {
  const [y, m, d] = parse(date);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "30 Sep" */
export function formatDayShort(date) {
  const [, m, d] = parse(date);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "October 2026" */
export function formatMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/**
 * Local date and time from an ISO 8601 timestamp, keeping the offset it was written with,
 * so a payment in Singapore stays on its Singapore date. Returns null if it can't be read.
 * "2026-10-01T12:34:56+08:00" → { date: '2026-10-01', time: '12:34', at: <ms> }
 */
export function partsFromIso(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', zone] = m;
  let offsetMin = 0;
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
  }
  const at = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offsetMin * 60000;
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, at };
}

/** Date and time in a time zone (used by the Worker, which has no local zone). */
export function partsInZone(ms, timeZone = 'Europe/London') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, at: ms };
}
