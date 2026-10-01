// Settings, opened from the header: categories, payment methods and fees, trips, term dates,
// the allowance, the time zone, backup and export, and the backend connection.
// Rarely touched, so it's a screen of its own rather than a tab. Every edit happens in a sheet.

import { h, fill, chips, field, sheet, toast, icon } from './dom.js';
import { liveSorted, runAction } from './format.js';
import { openRecurringSheet } from './plan.js';
import { exportBackup, exportCsv, importBackup } from './backup.js';
import {
  today, gbp, formatDay, formatMoney, syncedPhrase, moveCategory, nextSort, percentToBps, bpsToPercent, checkTerms,
  yearRange, termYearOf, yearTerms, replaceYearTerms, termLabel, partsInZone, validTimeZone, zoneName, DEFAULT_TIME_ZONE,
} from '../engine/index.js';
import { OfflineError } from '../errors.js';

const METHOD_KINDS = [{ value: 'card', label: 'Card' }, { value: 'cash', label: 'Cash' }, { value: 'transfer', label: 'Bank Transfer' }];

function dateSpan(from, to) {
  const [a, b] = [formatDay(from), formatDay(to)];
  return from.slice(0, 4) === to.slice(0, 4) ? `${a.replace(/ \d{4}$/, '')} to ${b}` : `${a} to ${b}`;
}

const lower = (message) => `${message.charAt(0).toLowerCase()}${message.slice(1)}`;

// Categories

function openCategorySheet(repo, category) {
  const S = repo.state;
  const name = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'sentences', value: category?.name ?? '' });
  const save = h('button', { type: 'button', class: 'button primary' });
  const renderSave = () => {
    const taken = S.categories.some((c) => !c.deletedAt && c.id !== category?.id && c.name.toLowerCase() === name.value.trim().toLowerCase());
    save.disabled = !name.value.trim() || taken;
    save.textContent = !name.value.trim() ? 'Enter a name' : taken ? 'That name is taken' : category ? 'Save changes' : `Add ${name.value.trim()}`;
  };
  name.addEventListener('input', renderSave);
  const used = category ? S.entries.filter((e) => !e.deletedAt && e.categoryId === category.id).length : 0;
  const s = sheet(category ? category.name : 'Add a category', h('div', { class: 'sheet-form' },
    field('Name', name, category ? 'Payments already in this category move with the new name.' : null),
    h('div', { class: 'sheet-actions' },
      save,
      category && h('button', {
        type: 'button', class: 'button danger',
        onclick: async () => {
          if (!(await runAction(() => repo.saveRow('categories', category.id, { archived: 1 })))) return;
          s.close();
          toast(`Removed ${category.name}`, { label: 'Undo', run: () => runAction(() => repo.saveRow('categories', category.id, { archived: 0 })) });
        },
      }, 'Remove category')),
    category && h('p', { class: 'field-hint' }, used
      ? `${used === 1 ? '1 payment keeps' : `${used} payments keep`} this category if you remove it. You can bring it back later.`
      : 'You can bring it back later.')));
  save.addEventListener('click', async () => {
    save.disabled = true;
    const fields = { name: name.value.trim() };
    const id = category?.id ?? crypto.randomUUID();
    if (!category) Object.assign(fields, { sort: nextSort(S.categories), archived: 0 });
    const before = category && { name: category.name };
    if (!(await runAction(() => repo.saveRow('categories', id, fields)))) return renderSave();
    s.close();
    toast(category ? 'Saved changes' : `Added ${fields.name}`, {
      label: 'Undo',
      run: () => runAction(() => (category ? repo.saveRow('categories', id, before) : repo.deleteRow('categories', id))),
    });
  });
  renderSave();
  name.focus();
}

function categoriesSection(repo) {
  const S = repo.state;
  const live = liveSorted(S.categories).filter((c) => !c.archived);
  const archived = liveSorted(S.categories).filter((c) => c.archived);
  const move = async (id, dir) => {
    for (const row of moveCategory(S.categories, id, dir)) {
      if (!(await runAction(() => repo.saveRow('categories', row.id, { sort: row.sort })))) return;
    }
  };
  return h('section', { class: 'section' },
    h('h2', { class: 'subhead' }, 'Categories'),
    h('p', { class: 'reason' }, 'The order here is the order in pickers. The ones you use most also come first when you log.'),
    h('ul', { class: 'list' }, live.map((c, i) => h('li', { class: 'reorder-row' },
      h('button', { type: 'button', class: 'list-row', onclick: () => openCategorySheet(repo, c) },
        h('span', { class: 'list-title' }, c.name)),
      h('button', { type: 'button', class: 'icon-button', 'aria-label': `Move ${c.name} up`, disabled: i === 0, onclick: () => move(c.id, -1) }, icon('up')),
      h('button', { type: 'button', class: 'icon-button', 'aria-label': `Move ${c.name} down`, disabled: i === live.length - 1, onclick: () => move(c.id, 1) }, icon('down'))))),
    h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => openCategorySheet(repo, null) }, 'Add a category')),
    archived.length > 0 && h('details', { class: 'table-view' },
      h('summary', {}, `Removed categories, ${archived.length}`),
      h('ul', { class: 'list' }, archived.map((c) => h('li', { class: 'total-row' },
        h('span', { class: 'list-title' }, c.name),
        h('button', { type: 'button', class: 'text-button', onclick: () => runAction(() => repo.saveRow('categories', c.id, { archived: 0 })).then((r) => r && toast(`Brought back ${c.name}`)) }, 'Bring back'))))));
}

// Payment methods

function methodSub(m) {
  return [
    METHOD_KINDS.find((k) => k.value === m.kind)?.label,
    m.feeBps ? `${bpsToPercent(m.feeBps)}% on foreign currency` : 'No foreign fee',
    m.walletCard && `Apple Pay card ${m.walletCard}`,
  ].filter(Boolean).join(', ');
}

function openMethodSheet(repo, method) {
  const f = {
    name: method?.name ?? '',
    kind: method?.kind ?? 'card',
    fee: method ? bpsToPercent(method.feeBps) : '0',
    walletCard: method?.walletCard ?? '',
    symbolMemory: { ...(method?.symbolMemory ?? {}) },
  };
  const name = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'words', value: f.name, oninput: () => { f.name = name.value; renderSave(); } });
  const fee = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.fee,
    oninput: () => { fee.value = fee.value.replace(/[^\d.]/g, ''); f.fee = fee.value; renderSave(); } });
  const wallet = h('input', { class: 'input', type: 'text', autocomplete: 'off', value: f.walletCard, oninput: () => { f.walletCard = wallet.value; } });
  const memory = h('div', { class: 'field' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });

  function renderSave() {
    const need = !f.name.trim() ? 'Enter a name' : percentToBps(f.fee) === null ? 'Enter a fee from 0 to 100%' : null;
    save.disabled = !!need;
    save.textContent = need ?? (method ? 'Save changes' : `Add ${f.name.trim()}`);
  }

  function renderMemory() {
    const pairs = Object.entries(f.symbolMemory);
    memory.hidden = !pairs.length;
    fill(memory, h('span', { class: 'field-label' }, 'Symbols it remembers'),
      h('ul', { class: 'list' }, pairs.map(([symbol, currency]) => h('li', { class: 'total-row' },
        h('span', { class: 'list-title' }, `${symbol} is read as ${currency}`),
        h('button', { type: 'button', class: 'text-button', onclick: () => { delete f.symbolMemory[symbol]; renderMemory(); } }, 'Forget')))),
      h('p', { class: 'field-hint' }, 'Forget one to be asked again the next time it arrives.'));
  }

  async function submit() {
    save.disabled = true;
    const fields = { name: f.name.trim(), kind: f.kind, feeBps: percentToBps(f.fee), walletCard: f.walletCard.trim() || null, symbolMemory: f.symbolMemory };
    const id = method?.id ?? crypto.randomUUID();
    const before = method && { name: method.name, kind: method.kind, feeBps: method.feeBps, walletCard: method.walletCard, symbolMemory: method.symbolMemory };
    if (!(await runAction(() => repo.saveRow('methods', id, fields)))) return renderSave();
    s.close();
    toast(method ? 'Saved changes' : `Added ${fields.name}`, {
      label: 'Undo', run: () => runAction(() => (method ? repo.saveRow('methods', id, before) : repo.deleteRow('methods', id))),
    });
  }

  const s = sheet(method ? method.name : 'Add a payment method', h('div', { class: 'sheet-form' },
    field('Name', name),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind'),
      chips({ label: 'Kind', options: METHOD_KINDS, value: f.kind, onChange: (v) => { f.kind = v; } })),
    field('Foreign currency fee, %', fee, 'Added to payments in other currencies. 2.99 for most UK cards, 0 for Monzo, Starling or Wise.'),
    field('Apple Pay card name', wallet, 'The card’s name in Wallet, as the Shortcut sends it. Leave blank if you don’t use it with Apple Pay.'),
    memory,
    h('div', { class: 'sheet-actions' },
      save,
      method && h('button', {
        type: 'button', class: 'button danger',
        onclick: async () => {
          if (!(await runAction(() => repo.deleteRow('methods', method.id)))) return;
          s.close();
          toast(`Deleted ${method.name}`, { label: 'Undo', run: () => runAction(() => repo.restoreRow('methods', method.id)) });
        },
      }, 'Delete payment method')),
    method && h('p', { class: 'field-hint' }, 'Payments made with it keep its name. Changing the fee reprices only new payments.')));
  renderMemory();
  renderSave();
}

function methodsSection(repo) {
  const methods = liveSorted(repo.state.methods, 'name');
  return h('section', { class: 'section' },
    h('h2', { class: 'subhead' }, 'Payment methods'),
    h('p', { class: 'reason' }, 'A card Apple Pay sends for the first time is added here by itself.'),
    methods.length
      ? h('ul', { class: 'list' }, methods.map((m) => h('li', {}, h('button', { type: 'button', class: 'list-row', onclick: () => openMethodSheet(repo, m) },
        h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, m.name), h('span', { class: 'list-sub' }, methodSub(m)))))))
      : h('p', { class: 'empty-line' }, 'Add the cards and accounts you pay with.'),
    h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => openMethodSheet(repo, null) }, 'Add a payment method')));
}

// Trips

/** Adds a trip (trip null) or edits one. Overview opens it too. */
export function openTripSheet(repo, trip) {
  const f = { name: trip?.name ?? '', start: trip?.start ?? today(), end: trip?.end ?? '' };
  const name = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'words', value: f.name, placeholder: 'Singapore', oninput: () => { f.name = name.value; renderSave(); } });
  const start = h('input', { class: 'input', type: 'date', value: f.start, onchange: () => { f.start = start.value; renderSave(); } });
  const end = h('input', { class: 'input', type: 'date', value: f.end, onchange: () => { f.end = end.value; renderSave(); } });
  const save = h('button', { type: 'button', class: 'button primary' });
  const renderSave = () => {
    const need = !f.name.trim() ? 'Name the trip' : !f.start ? 'Pick the first day' : !f.end ? 'Pick the last day' : f.end < f.start ? 'End it on or after the first day' : null;
    save.disabled = !!need;
    save.textContent = need ?? (trip ? 'Save changes' : `Add ${f.name.trim()}`);
  };
  const s = sheet(trip ? trip.name : 'Add a trip', h('div', { class: 'sheet-form' },
    field('Name', name),
    h('div', { class: 'row-2' }, field('First day', start), field('Last day', end)),
    h('p', { class: 'field-hint' }, 'Payments on these days are suggested for the trip. You can change any of them.'),
    h('div', { class: 'sheet-actions' },
      save,
      trip && h('button', {
        type: 'button', class: 'button danger',
        onclick: async () => {
          if (!(await runAction(() => repo.deleteRow('trips', trip.id)))) return;
          s.close();
          toast(`Deleted ${trip.name}`, { label: 'Undo', run: () => runAction(() => repo.restoreRow('trips', trip.id)) });
        },
      }, 'Delete trip'))));
  save.addEventListener('click', async () => {
    save.disabled = true;
    const fields = { name: f.name.trim(), start: f.start, end: f.end };
    const id = trip?.id ?? crypto.randomUUID();
    if (!(await runAction(() => repo.saveRow('trips', id, fields)))) return renderSave();
    s.close();
    // The backend files the payments on its days under it; say how many there are now.
    const n = repo.state.entries.filter((e) => !e.deletedAt && e.kind === 'spend' && e.tripId === id).length;
    const done = trip ? 'Saved changes' : `Added ${fields.name}`;
    toast(n ? `${done}. ${n === 1 ? '1 payment is' : `${n} payments are`} on it.` : done, {
      label: 'Undo', run: () => runAction(() => (trip ? repo.saveRow('trips', id, { name: trip.name, start: trip.start, end: trip.end }) : repo.deleteRow('trips', id))),
    });
  });
  renderSave();
}

function tripsSection(repo) {
  const trips = repo.state.trips.filter((t) => !t.deletedAt).sort((a, b) => (a.start < b.start ? 1 : -1));
  return h('section', { class: 'section' },
    h('h2', { class: 'subhead' }, 'Trips'),
    trips.length
      ? h('ul', { class: 'list' }, trips.map((t) => h('li', {}, h('button', { type: 'button', class: 'list-row', onclick: () => openTripSheet(repo, t) },
        h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, t.name), h('span', { class: 'list-sub' }, dateSpan(t.start, t.end)))))))
      : h('p', { class: 'empty-line' }, 'Add a trip to see what it cost, and to leave it out of monthly totals if you like.'),
    h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => openTripSheet(repo, null) }, 'Add a trip')));
}

// Term dates

// The academic year being edited, kept while Settings redraws.
let termsYear = null;

function termsSection(repo) {
  const saved = repo.setting('terms', []);
  termsYear ??= termYearOf(today());
  const terms = yearTerms(saved, termsYear).map((t) => ({ ...t }));
  const problem = h('p', { class: 'warning', hidden: true });
  const save = h('button', { type: 'button', class: 'button secondary', disabled: true }, 'Save term dates');
  const next = () => replaceYearTerms(saved, termsYear, terms);
  const changed = () => {
    const issue = checkTerms(terms) ?? checkTerms(next());
    problem.hidden = !issue;
    problem.textContent = issue ? `${issue.charAt(0).toUpperCase()}${issue.slice(1)}` : '';
    save.disabled = !!issue;
  };
  save.addEventListener('click', async () => {
    save.disabled = true;
    if (await runAction(() => repo.setSetting('terms', next()))) {
      toast('Saved term dates', { label: 'Undo', run: () => runAction(() => repo.setSetting('terms', saved)) });
    } else changed();
  });
  const section = h('section', { class: 'section' });
  const step = (n) => {
    termsYear += n;
    section.replaceWith(termsSection(repo));
  };
  const input = (t, key) => {
    const el = h('input', { class: 'input', type: 'date', value: t[key] ?? '', onchange: () => { t[key] = el.value || null; changed(); } });
    return el;
  };
  const label = `${termsYear}–${String(termsYear + 1).slice(2)}`;
  return fill(section,
    h('h2', { class: 'subhead' }, 'Term dates'),
    h('p', { class: 'reason' }, 'Overview shows what each term cost once its dates are here. Leave a term blank until you know it.'),
    h('div', { class: 'period-nav' },
      h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Previous year', onclick: () => step(-1) }, icon('back')),
      h('p', { class: 'period-label period-label-small', 'aria-live': 'polite' }, label),
      h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Next year', onclick: () => step(1) }, icon('forward'))),
    terms.map((t) => h('fieldset', { class: 'term' },
      h('legend', { class: 'field-label' }, termLabel(t)),
      h('div', { class: 'row-2' }, field('First day', input(t, 'start')), field('Last day', input(t, 'end'))))),
    problem,
    save);
}

// Allowance

function allowanceSection(repo) {
  const S = repo.state;
  const todayDate = today();
  const year = yearRange(todayDate, 'academic');
  const items = S.recurring.filter((r) => !r.deletedAt && r.kind === 'income' && r.incomeType === 'allowance');
  const logged = S.entries.filter((e) => !e.deletedAt && e.kind === 'income' && e.incomeType === 'allowance'
    && (e.spreadStart ? e.spreadStart >= year.from.slice(0, 7) && e.spreadStart <= year.to.slice(0, 7) : e.date >= year.from && e.date <= year.to));
  const loggedPence = logged.reduce((s, e) => s + (e.gbpPence ?? 0), 0);
  const spread = logged.some((e) => e.spreadMonths > 1);
  return h('section', { class: 'section' },
    h('h2', { class: 'subhead' }, 'Allowance'),
    h('p', { class: 'reason' }, logged.length
      ? `${year.label}: ${gbp(loggedPence)} logged${spread ? `, about ${gbp(Math.floor(loggedPence / 12), { whole: true })} a month from October to September` : ''}.`
      : `No allowance logged for ${year.label} yet. Log it on the Log screen as income, or plan it below so it’s added on the day.`),
    items.length > 0 && h('ul', { class: 'list' }, items.map((r) => h('li', {}, h('button', { type: 'button', class: 'list-row', onclick: () => openRecurringSheet(repo, r) },
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, r.label),
        h('span', { class: 'list-sub' }, r.active === 0 ? 'Paused' : `Next ${formatDay(r.nextDate)}${r.spreadMonths > 1 ? ', spread over the year' : ''}`)),
      h('span', { class: 'list-amount' }, formatMoney(r.amountMinor, r.currency)))))),
    h('p', { class: 'field-hint' }, 'Enter it net of rent. Rent isn’t logged.'),
    !items.length && h('div', {}, h('button', {
      type: 'button', class: 'text-button',
      // No date: only you know when it arrives, so the sheet asks for it ("Pick the next date").
      onclick: () => openRecurringSheet(repo, { kind: 'income', incomeType: 'allowance', label: 'Allowance', frequency: 'yearly', spreadMonths: 12, nextDate: '' }),
    }, 'Plan your yearly allowance')));
}

// Time zone

const phoneZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

async function saveTimeZone(repo, timeZone) {
  const before = repo.setting('timeZone', DEFAULT_TIME_ZONE);
  if (!(await runAction(() => repo.setSetting('timeZone', timeZone)))) return false;
  toast(`Changed to ${zoneName(timeZone)} time`, { label: 'Undo', run: () => runAction(() => repo.setSetting('timeZone', before)) });
  return true;
}

function openTimeZoneSheet(repo) {
  const current = repo.setting('timeZone', DEFAULT_TIME_ZONE);
  const zones = [...new Set([current, ...(Intl.supportedValuesOf?.('timeZone') ?? [])])].filter(validTimeZone).sort();
  const select = h('select', { class: 'select', onchange: () => renderSave() },
    zones.map((z) => h('option', { value: z, selected: z === current }, z.replace(/_/g, ' '))));
  const save = h('button', { type: 'button', class: 'button primary' });
  const renderSave = () => {
    save.disabled = select.value === current;
    save.textContent = select.value === current ? 'Pick another time zone' : `Use ${zoneName(select.value)}`;
  };
  const s = sheet('Time zone', h('div', { class: 'sheet-form' },
    field('Time zone', select, 'Listed by region, then city.'),
    h('div', { class: 'sheet-actions' }, save)));
  save.addEventListener('click', async () => {
    save.disabled = true;
    if (await saveTimeZone(repo, select.value)) s.close();
    else renderSave();
  });
  renderSave();
}

function timeZoneSection(repo) {
  const current = repo.setting('timeZone', DEFAULT_TIME_ZONE);
  const phone = phoneZone();
  const differs = validTimeZone(phone) && phone !== current;
  return h('section', { class: 'section' },
    h('h2', { class: 'subhead' }, 'Time zone'),
    h('p', { class: 'reason' }, 'The date here decides when recurring items are added and which week you review.'),
    h('ul', { class: 'list' }, h('li', {}, h('button', { type: 'button', class: 'list-row', onclick: () => openTimeZoneSheet(repo) },
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, zoneName(current)),
        h('span', { class: 'list-sub' }, `${current.replace(/_/g, ' ')}, ${partsInZone(Date.now(), current).time} there now`))))),
    differs
      ? h('div', {}, h('button', { type: 'button', class: 'button secondary', onclick: () => saveTimeZone(repo, phone) }, 'Use this phone’s time zone'))
      : h('p', { class: 'field-hint' }, 'This phone is on the same time zone.'),
    differs && h('p', { class: 'field-hint' }, `This phone is on ${zoneName(phone)} time.`));
}

// Backup and export

function backupSection(repo) {
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: async () => { const f = file.files[0]; file.value = ''; if (f) await importBackup(repo, f); } });
  const last = repo.state.lastBackupAt;
  return h('section', { class: 'section' },
    h('h2', { class: 'subhead' }, 'Backup and export'),
    h('p', { class: 'reason' }, `Your backend keeps everything. A backup is your own copy, and can put it all back. ${last ? `Last backup ${formatDay(today(new Date(last)))} from this phone.` : 'No backup from this phone yet.'}`),
    h('div', { class: 'button-stack' },
      h('button', { type: 'button', class: 'button secondary', onclick: () => runAction(() => exportBackup(repo)) }, 'Export backup'),
      h('button', { type: 'button', class: 'button secondary', onclick: () => exportCsv(repo) }, 'Export payments as CSV'),
      h('button', { type: 'button', class: 'button danger', onclick: () => file.click() }, 'Restore from a backup'),
      file),
    h('p', { class: 'field-hint' }, 'Restoring replaces everything on your backend with the backup. You’re asked first.'));
}

// Backend connection

function backendSection(repo, onConnected) {
  const current = repo.state.connection ?? {};
  const address = h('input', { class: 'input', type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    value: current.apiBase ?? '', placeholder: 'https://mateen-money.you.workers.dev' });
  const token = h('input', { class: 'input', type: 'password', autocomplete: 'off', value: current.token ?? '' });
  const problem = h('p', { class: 'warning', hidden: true });
  const connect = h('button', { type: 'button', class: repo.connected() ? 'button secondary' : 'button primary' });
  const renderButton = (busy = false) => {
    const need = !address.value.trim() ? 'Enter the backend address' : !token.value.trim() ? 'Enter the token' : null;
    connect.disabled = busy || !!need;
    connect.textContent = busy ? 'Connecting' : need ?? (repo.connected() ? 'Save and sync' : 'Connect');
  };
  address.addEventListener('input', () => renderButton());
  token.addEventListener('input', () => renderButton());
  connect.addEventListener('click', async () => {
    renderButton(true);
    problem.hidden = true;
    try {
      await repo.connect({ apiBase: address.value, token: token.value });
      onConnected?.();
      toast('Connected and synced');
    } catch (err) {
      problem.textContent = err instanceof OfflineError
        ? 'Nothing changed: the backend couldn’t be reached. Check the address and your connection.'
        : err.message.startsWith('Nothing changed') ? err.message : `Nothing changed: ${lower(err.message)}`;
      problem.hidden = false;
      renderButton();
    }
  });
  renderButton();
  return h('section', { class: 'section' },
    h('h2', { class: 'subhead' }, 'Backend'),
    h('p', { class: 'reason' }, `${syncedPhrase(repo.state.lastSyncedAt)}.`),
    field('Backend address', address, 'The address Wrangler printed when you deployed.'),
    field('Token', token, 'The API token you set on the backend. It stays on this phone.'),
    problem,
    connect);
}

export function renderSettings(root, { repo, onConnected }) {
  function render() {
    const active = document.activeElement;
    // Don't redraw under someone typing a date or the token.
    if (root.contains(active) && active.matches('input')) return;
    if (!repo.connected()) {
      return fill(root, h('div', { class: 'screen' },
        h('p', { class: 'hint' }, 'Connect to your backend first. Everything you log is stored there, and the rest of Settings needs it.'),
        backendSection(repo, onConnected)));
    }
    fill(root, h('div', { class: 'screen settings' },
      categoriesSection(repo),
      methodsSection(repo),
      tripsSection(repo),
      termsSection(repo),
      allowanceSection(repo),
      timeZoneSection(repo),
      backupSection(repo),
      backendSection(repo, onConnected)));
  }
  render();
  return { refresh: render };
}
