// The weekly review card on Log: from Sunday until done. Sort what's waiting, see the week,
// check anything unusual, then "Done".

import { h, fill, toast } from './dom.js';
import { money, whenPhrase, runAction } from './format.js';
import { categoryTable } from './charts.js';
import { partsInZone, DEFAULT_TIME_ZONE, gbp, formatDayShort, reviewCard, reviewSteps, unusualLine, comparePhrase, budgetWarningLine } from '../engine/index.js';

// Where the review is up to, kept between renders and tab visits.
let place = { weekStart: null, open: false, step: null };

const weeks = (n) => (n === 1 ? '1 week in a row' : `${n} weeks in a row`);

export function renderReview(el, { repo, showToSort }) {
  const S = repo.state;
  // The week follows the time zone setting, like the backend's weekly summary and recurring items.
  const todayDate = partsInZone(Date.now(), repo.setting('timeZone', DEFAULT_TIME_ZONE)).date;
  const excludeTrips = repo.setting('excludeTrips', false) === true && new Set(S.trips.filter((t) => !t.deletedAt).map((t) => t.id));
  const card = repo.connected() && reviewCard({
    entries: S.entries, categories: S.categories, reviews: S.reviews, todayDate,
    budgets: S.budgets, recurring: S.recurring, rates: S.rates, excludeTrips,
  });
  el.hidden = !card;
  if (!card) return fill(el);
  if (place.weekStart !== card.weekStart) place = { weekStart: card.weekStart, open: false, step: null };

  const s = card.summary;
  const compare = comparePhrase(s);
  const headline = `Week of ${formatDayShort(card.weekStart)}: ${gbp(s.totalPence)}${compare ? `, ${compare}` : ''}.`;
  const steps = reviewSteps(card);
  if (!steps.includes(place.step)) place.step = steps[0];
  const index = steps.indexOf(place.step);
  const go = (step) => { place.step = step; renderReview(el, { repo, showToSort }); };
  const next = () => go(steps[index + 1]);

  const head = h('div', { class: 'review-head' },
    h('h2', { class: 'subhead' }, 'Weekly review'),
    card.streak > 0 && h('span', { class: 'tag' }, weeks(card.streak)));

  if (!place.open) {
    fill(el, h('div', { class: 'review' }, head,
      h('p', { class: 'reason' }, headline),
      h('button', { type: 'button', class: 'button secondary', onclick: () => { place.open = true; renderReview(el, { repo, showToSort }); } }, 'Review the week')));
    return;
  }

  let body;
  if (place.step === 'sort') {
    body = [
      h('p', {}, card.toSort === 1 ? '1 payment is waiting in To sort. Sort it so the week adds up.' : `${card.toSort} payments are waiting in To sort. Sort them so the week adds up.`),
      h('div', { class: 'review-actions' },
        h('button', { type: 'button', class: 'button secondary', onclick: showToSort }, 'Go to To sort'),
        h('button', { type: 'button', class: 'text-button', onclick: next }, 'Skip for now')),
    ];
  } else if (place.step === 'week') {
    body = [
      h('p', { class: 'review-figure' }, h('span', { class: 'num' }, gbp(s.totalPence)), h('span', { class: 'unit' }, 'spent that week')),
      h('p', { class: 'reason' }, compare ? `${compare.charAt(0).toUpperCase()}${compare.slice(1)}, averaged over ${s.usualWeeks === 1 ? 'the week' : `the ${s.usualWeeks} weeks`} before.` : 'Your usual week shows here once there are earlier weeks to compare.'),
      s.rows.length > 0 && categoryTable(s.rows, { caption: `Spending by category, week of ${formatDayShort(card.weekStart)}` }),
      s.largest.length > 0 && h('h3', { class: 'review-sub' }, 'Largest purchases'),
      s.largest.length > 0 && h('ul', { class: 'list' }, s.largest.map((e) => h('li', { class: 'total-row' },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, S.vendors.find((v) => v.id === e.vendorId)?.name ?? e.merchant ?? 'Payment'),
          h('span', { class: 'list-sub' }, whenPhrase(e))),
        h('span', { class: 'list-amount' }, money(e))))),
      h('div', { class: 'review-actions' }, h('button', { type: 'button', class: 'button secondary', onclick: next }, 'Next')),
    ];
  } else {
    const done = async () => {
      const result = await runAction(() => repo.completeReview(card.weekStart));
      if (!result) return;
      place = { weekStart: null, open: false, step: null };
      toast(`Week reviewed. ${weeks(card.streak + 1)}.`);
    };
    body = [
      card.unusual.length
        ? h('div', { class: 'review-list' },
          h('p', {}, card.unusual.length === 1 ? 'One category ran more than 50% above usual:' : 'These ran more than 50% above usual:'),
          card.unusual.map((u) => h('p', { class: 'warning' }, unusualLine(u))))
        : h('p', {}, 'Nothing ran more than 50% above usual that week.'),
      card.budgetWarnings.length > 0 && h('div', { class: 'review-list' },
        h('p', {}, card.budgetWarnings.length === 1 ? 'One budget needs a look this month:' : 'These budgets need a look this month:'),
        card.budgetWarnings.map((r) => h('p', { class: 'warning' }, budgetWarningLine(r, card.month)))),
      h('div', { class: 'review-actions' }, h('button', { type: 'button', class: 'button secondary', onclick: done }, 'Done')),
    ];
  }

  fill(el, h('div', { class: 'review' }, head,
    h('p', { class: 'field-hint' }, `Step ${index + 1} of ${steps.length}: ${{ sort: 'sort what’s waiting', week: 'the week', unusual: 'anything unusual' }[place.step]}`),
    body));
}
