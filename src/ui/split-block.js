// The Split block: who paid, who it's shared with, and how. One block for Log, the edit sheet and
// Sort Payment. Its state is the form's `split` (see the Split block in src/engine/splits.js).
// People are whoever's in the list (Settings › People); "Add person" saves a new one straight away.

import { h, fill, segmented, field } from './dom.js';
import { runAction } from './format.js';
import { formatMoney, splitParts, splitMissing, isSplitOn, emptySplit } from '../engine/index.js';

const ADD = '+add';
const MODES = [{ value: 'even', label: 'Evenly' }, { value: 'amount', label: 'By Amount' }];

/** People who can be picked: live and not removed, in their order. */
export const livePeople = (S) => (S.people ?? []).filter((p) => !p.deletedAt && !p.archived)
  .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));

/**
 * The block. get() returns { split, amountMinor, currency } as the form has them now. onChange(split,
 * { quiet }) saves a change; quiet means the block has already shown it (typing an amount), so the
 * caller needn't redraw it. locked: a reason the split can't change (a settled bill), shown instead.
 * waiting: a reason it can't be split yet (a payment still waiting for its currency). payer: false
 * leaves out "Who paid" (an Apple Pay payment was always the user's card).
 * Returns { el, render }.
 */
export function splitBlock({ repo, get, onChange, locked = null, waiting = null, payer: askPayer = true }) {
  const S = repo.state;
  const el = h('div', { class: 'split-block' });
  let adding = null;   // 'payer' | 'with' while the name box shows

  const name = (id) => (S.people ?? []).find((p) => p.id === id)?.name ?? 'Someone';
  const shareLine = h('p', { class: 'field-hint', 'aria-live': 'polite' });

  function renderShare() {
    const { split, amountMinor, currency } = get();
    if (!amountMinor) { shareLine.textContent = 'Enter the amount to see the shares.'; return; }
    const problem = splitMissing(split, amountMinor, currency);
    if (problem) { shareLine.textContent = `${problem}.`; return; }
    const { parts, shareMinor, paidBy } = splitParts(split, amountMinor, currency);
    if (!paidBy && split.mode === 'even' && parts.length) {
      shareLine.textContent = `${formatMoney(parts[0].amountMinor, currency)} each, your share ${formatMoney(shareMinor, currency)}.`;
    } else {
      shareLine.textContent = paidBy
        ? `You owe ${name(paidBy)} ${formatMoney(shareMinor, currency)}, your share.`
        : `Your share ${formatMoney(shareMinor, currency)}.`;
    }
  }

  const change = (patch) => {
    const { split } = get();
    onChange({ ...split, ...patch });
    render();
  };

  async function addPerson(text) {
    const nameText = text.trim();
    if (!nameText) return;
    const id = crypto.randomUUID();
    const sort = Math.max(-1, ...(S.people ?? []).map((p) => p.sort ?? 0)) + 1;
    const saved = await runAction(() => repo.saveRow('people', id, { name: nameText, sort, archived: 0 }));
    if (!saved) return;
    const { split } = get();
    const target = adding;
    adding = null;
    if (target === 'payer') change({ paidBy: id, with: split.with.filter((x) => x !== id) });
    else change({ with: [...split.with, id] });
  }

  function nameBox() {
    const input = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done', placeholder: 'Name',
      'aria-label': 'Name of the person to add',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addPerson(input.value); } } });
    const add = h('button', { type: 'button', class: 'button secondary', onclick: () => addPerson(input.value) }, 'Add');
    setTimeout(() => input.focus(), 0);
    return h('div', { class: 'split-add' }, input, add);
  }

  function amountInput(value, label, onInput) {
    const input = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: value ?? '', placeholder: '0.00',
      oninput: () => { input.value = input.value.replace(/[^\d.,]/g, ''); onInput(input.value); } });
    return field(label, input);
  }

  function render() {
    const { split, currency } = get();
    if (locked || waiting) {
      return fill(el, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Split'), h('p', { class: 'field-hint' }, locked || waiting)));
    }
    // Opened by "Split this bill" before anyone is picked; a split already set is always open.
    const on = isSplitOn(split) || split.open;
    if (!on) {
      return fill(el, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Split'),
        h('div', { class: 'split-off' }, h('span', {}, 'Not split'),
          h('button', { type: 'button', class: 'text-button', onclick: () => change({ open: true }) }, 'Split This Bill'))));
    }
    const people = livePeople(S);
    // Who paid is one choice: a native select, with "Add Person" as its last option.
    const payer = h('select', { class: 'select', onchange: () => {
      if (payer.value === ADD) { adding = 'payer'; render(); return; }
      const v = payer.value;
      change({ paidBy: v || null, with: split.with.filter((x) => x !== v) });
    } },
      h('option', { value: '', selected: !split.paidBy }, 'You'),
      people.map((p) => h('option', { value: p.id, selected: p.id === split.paidBy }, p.name)),
      h('option', { value: ADD }, 'Add Person'));
    // Several can share a bill, so Split With folds out a list of tick boxes. Whether it's folded out
    // is kept on the split (`listOpen`), since the form redraws the block on each tick.
    const picked = people.filter((p) => p.id !== split.paidBy && split.with.includes(p.id));
    const withList = h('details', { class: 'multi-select', open: !!split.listOpen,
      ontoggle: () => { if (withList.open !== !!get().split.listOpen) onChange({ ...get().split, listOpen: withList.open }, { quiet: true }); } },
      h('summary', { class: 'select', 'aria-label': `Split With: ${picked.map((p) => p.name).join(', ') || 'nobody yet'}` },
        picked.length ? picked.map((p) => p.name).join(', ') : h('span', { class: 'multi-empty' }, 'Pick People')),
      h('div', { class: 'multi-options' },
        people.filter((p) => p.id !== split.paidBy).map((p) => {
          const on = split.with.includes(p.id);
          return h('label', { class: 'toggle' },
            h('input', { type: 'checkbox', checked: on,
              onchange: () => change({ with: on ? split.with.filter((x) => x !== p.id) : [...split.with, p.id] }) }), p.name);
        }),
        h('button', { type: 'button', class: 'text-button', onclick: () => { adding = 'with'; render(); } }, 'Add Person')));
    const others = split.with.filter((id) => id !== split.paidBy);
    const amounts = split.mode !== 'amount' ? null
      : split.paidBy
        ? amountInput(split.share, `Your Share in ${currency}`, (v) => { onChange({ ...get().split, share: v }, { quiet: true }); renderShare(); })
        : others.map((id) => amountInput(split.amounts[id], `${name(id)} in ${currency}`, (v) => {
          const now = get().split;
          onChange({ ...now, amounts: { ...now.amounts, [id]: v } }, { quiet: true });
          renderShare();
        }));
    fill(el,
      askPayer && field('Who Paid', payer),
      askPayer && adding === 'payer' && nameBox(),
      field(split.paidBy ? 'Also Shared With' : 'Split With', withList),
      adding === 'with' && nameBox(),
      segmented({ label: 'How it’s split', options: MODES, value: split.mode, onChange: (v) => change({ mode: v }) }),
      amounts,
      shareLine,
      h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => { adding = null; change(emptySplit()); } }, 'Don’t Split')));
    renderShare();
  }

  render();
  return { el, render };
}

/** "Save £40.00, your share £10.00" when it's split; the plain label otherwise. */
export function saveLabel(split, amountMinor, currency) {
  const base = `Save ${formatMoney(amountMinor, currency)}`;
  if (!isSplitOn(split)) return base;
  return `${base}, Your Share ${formatMoney(splitParts(split, amountMinor, currency).shareMinor, currency)}`;
}

