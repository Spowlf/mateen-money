// Term dates, kept per academic year, so entering next year's dates never loses this year's.
// The terms setting stores only dated terms: [{ id, name, year, start, end }], year being the
// year the academic year starts in (2026 for 2026–27). A year's terms are blank until entered.

import { parse } from './dates.js';
import { TERM_NAMES } from './defaults.js';

/** The academic year a date belongs to. It starts in October (the last term ends in June). */
export function termYearOf(date) {
  const [y, m] = parse(date);
  return m >= 10 ? y : y - 1;
}

/** Terms saved before terms had a year are placed by their first day. */
const yearOf = (t) => t.year ?? (t.start ? termYearOf(t.start) : null);

/** The three terms of a year, in order, with blank dates for any not entered. */
export function yearTerms(terms = [], year) {
  return TERM_NAMES.map((name) => {
    const saved = terms.find((t) => !t.deletedAt && t.start && t.name === name && yearOf(t) === year);
    return saved ? { ...saved, year } : { id: `${name.toLowerCase()}-${year}`, name, year, start: null, end: null };
  });
}

/** Every term with dates, earliest first. */
export function datedTerms(terms = []) {
  return terms.filter((t) => !t.deletedAt && t.start && t.end)
    .map((t) => ({ ...t, year: yearOf(t) }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

/** The terms setting with one year's terms replaced. Blank terms aren't stored. */
export function replaceYearTerms(terms = [], year, list) {
  return [...datedTerms(terms).filter((t) => t.year !== year), ...list.filter((t) => t.start && t.end).map((t) => ({ ...t, year }))]
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

/** "Michaelmas term 2026", "Lent term 2027": the calendar year the term falls in. */
export function termLabel(term) {
  const year = term.start ? parse(term.start)[0] : term.year + (term.name === TERM_NAMES[0] ? 0 : 1);
  return `${term.name} term ${year}`;
}

/** The term n terms away. term is { year, name }. */
export function shiftTerm({ year, name }, n) {
  const i = year * TERM_NAMES.length + TERM_NAMES.indexOf(name) + n;
  return { year: Math.floor(i / TERM_NAMES.length), name: TERM_NAMES[((i % TERM_NAMES.length) + TERM_NAMES.length) % TERM_NAMES.length] };
}

/** The term to show first: the one today is in, else the last one, else the next one, else this year's first. */
export function termNow(terms, todayDate) {
  const dated = datedTerms(terms);
  const pick = dated.find((t) => todayDate >= t.start && todayDate <= t.end)
    ?? dated.filter((t) => t.end < todayDate).at(-1) ?? dated[0];
  return pick ? { year: pick.year, name: pick.name } : { year: termYearOf(todayDate), name: TERM_NAMES[0] };
}
