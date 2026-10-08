// Money is integer minor units (pence for GBP). These helpers convert text to minor units
// once, and minor units to display strings.

// Currencies written with no decimals. A fixed list (not Intl) so the phone and the Worker agree.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'ISK', 'HUF', 'IDR', 'VND', 'CLP', 'TWD', 'UGX', 'PYG']);

// Display prefixes. Anything not listed shows its code: "CHF 12.00".
const PREFIX = {
  GBP: '£', EUR: '€', USD: 'US$', SGD: 'S$', JPY: '¥', CNY: 'CN¥', HKD: 'HK$', AUD: 'A$',
  CAD: 'C$', NZD: 'NZ$', KRW: '₩', INR: '₹', THB: '฿', MYR: 'RM', ILS: '₪', PHP: '₱',
};

export const exponent = (currency) => (ZERO_DECIMAL.has(currency) ? 0 : 2);

/**
 * Decimal text ("12.5", "1234.56") to integer minor units, without floating point.
 * Returns null if the text isn't a plain decimal.
 */
export function toMinor(text, currency = 'GBP') {
  const s = String(text ?? '').trim();
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(s)) return null;
  const e = exponent(currency);
  const [whole, frac = ''] = s.split('.');
  const kept = (frac + '0'.repeat(e)).slice(0, e);
  let minor = Number(whole || '0') * 10 ** e + Number(kept || '0');
  // Round half up on the first dropped digit ("12.345" → 1235).
  if (Number(frac[e] ?? 0) >= 5) minor += 1;
  return minor;
}

/** Minor units back to a decimal string for inputs ("1250" → "12.50"). */
export function toDecimalText(minor, currency = 'GBP') {
  const e = exponent(currency);
  if (e === 0) return String(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 10 ** e)}.${String(abs % 10 ** e).padStart(e, '0')}`;
}

export const prefix = (currency) => PREFIX[currency] ?? `${currency} `;

/**
 * "£1,234.50", "S$12.50", "−£4.20" (a minus sign, not a hyphen, so "~−£4.20" reads right). With { whole: true }, whole amounts drop the pence ("£1,000"):
 * only for chart axis ticks, which mark a scale rather than an amount.
 */
export function formatMoney(minor, currency = 'GBP', { whole = false } = {}) {
  const e = exponent(currency);
  const value = Math.abs(minor) / 10 ** e;
  const digits = whole && Math.abs(minor) % 10 ** e === 0 ? 0 : e;
  const number = value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${minor < 0 ? '−' : ''}${prefix(currency)}${number}`;
}

/** Pounds, always with pence ("£108.00"); a fraction of a penny (an average) rounds to the nearest. */
export const gbp = (pence, options) => formatMoney(Math.round(pence), 'GBP', options);

// Symbols as they appear in payment text, longest first so "S$" wins over "$".
const SYMBOLS = ['US$', 'S$', 'HK$', 'AU$', 'A$', 'CA$', 'C$', 'NZ$', 'NT$', 'R$', 'CN¥', 'JP¥', 'CHF', 'zł', 'Kč', 'RM', 'Rp',
  '£', '€', '$', '¥', '₩', '₹', '฿', '₪', '₱', 'kr'];

/**
 * Reads amount text from a payment notification.
 * "£4.20" → { value: '4.20', symbol: '£', code: null, negative: false }
 * "4,20 €", "SGD 12.50", "-$3", "1.234,56 kr" are understood too. Returns null if there is no number.
 */
export function parseAmountText(text) {
  let s = String(text ?? '').replace(/[\u00a0\u202f]/g, ' ').trim();
  if (!s) return null;
  let negative = false;
  if (/^[-−–]|^\(.*\)$/.test(s) || /[-−–]$/.test(s)) negative = true;
  s = s.replace(/[-−–()]/g, '').trim();

  let code = null;
  const codeMatch = /(?<![A-Za-z])([A-Z]{3})(?![A-Za-z$])/.exec(s);
  if (codeMatch && !SYMBOLS.includes(codeMatch[1])) {
    code = codeMatch[1];
    s = s.replace(codeMatch[0], '');
  }
  let symbol = null;
  for (const sym of SYMBOLS) {
    if (s.includes(sym)) { symbol = sym; s = s.replace(sym, ''); break; }
  }
  const numberText = s.replace(/\s/g, '');
  if (!/^[\d.,]+$/.test(numberText) || !/\d/.test(numberText)) return null;
  const value = normaliseNumber(numberText);
  if (value === null) return null;
  return { value, symbol, code, negative };
}

// "1,234.56" → "1234.56"; "4,20" → "4.20"; "1.234,56" → "1234.56"; "1,234" → "1234".
function normaliseNumber(s) {
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decimalSep = null;
  if (lastComma >= 0 && lastDot >= 0) decimalSep = lastComma > lastDot ? ',' : '.';
  else if (lastComma >= 0) decimalSep = s.length - lastComma - 1 === 3 && s.indexOf(',') !== -1 && /^\d{1,3}(,\d{3})+$/.test(s) ? null : ',';
  else if (lastDot >= 0) decimalSep = /^\d{1,3}(\.\d{3}){2,}$/.test(s) ? null : '.';
  const thousandsSep = decimalSep === ',' ? '.' : ',';
  let out = s.split(thousandsSep).join('');
  if (decimalSep === null) out = out.replace(/[.,]/g, '');
  else if (decimalSep === ',') out = out.replace(',', '.');
  if ((out.match(/\./g) || []).length > 1) return null;
  return out;
}
