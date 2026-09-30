# Handover: design language and engineering approach

This document hands over the design language and engineering approach of a small offline phone app to a new project: a personal spending tracker with a small backend that syncs with the phone.

The source app is a single-user installable web app (PWA) that recommends which payment card to use at the till and logs each purchase. You will not see its repo. Everything you need is here, and some files will be copied across (see [Reusable files](#7-reusable-files)).

Read sections 1 to 5 before designing any screen, and section 6 before writing any code. Section 8 lists every problem we hit, so you don't hit them again.

## Contents

1. [Design philosophy](#1-design-philosophy)
2. [Design tokens](#2-design-tokens)
   - [Colour](#colour)
   - [Typography](#typography)
   - [Spacing, radii, depth, motion](#spacing-radii-depth-motion)
   - [Safe areas and the phone shell](#safe-areas-and-the-phone-shell)
   - [Light and dark](#light-and-dark)
   - [Proposed blue palette](#proposed-blue-palette)
3. [Components](#3-components)
4. [Screen patterns](#4-screen-patterns)
5. [Writing style](#5-writing-style)
6. [Architecture](#6-architecture)
   - [Ground rules](#ground-rules)
   - [File structure](#file-structure)
   - [Engine, storage, UI](#engine-storage-ui)
   - [IndexedDB schema and migrations](#indexeddb-schema-and-migrations)
   - [Money](#money)
   - [Dates](#dates)
   - [Service worker and "Updated, tap to reload"](#service-worker-and-updated-tap-to-reload)
   - [Backup, export and reminders](#backup-export-and-reminders)
   - [Config JSON](#config-json)
   - [Pre-fill merges that never overwrite user edits](#pre-fill-merges-that-never-overwrite-user-edits)
   - [Testing](#testing)
   - [Deployment](#deployment)
   - [Adding a backend: what still applies](#adding-a-backend-what-still-applies)
7. [Reusable files](#7-reusable-files)
8. [Lessons learned](#8-lessons-learned)
9. [How to start](#9-how-to-start)

---

## 1. Design philosophy

The app is used in one place: standing at a till, phone in one hand, often with no signal and someone waiting behind. Every decision below comes from that moment. A spending tracker has the same moment (logging a payment right after making it), so the same principles carry over.

### Design for the moment of use, not the desk

The main screens are judged by how many seconds they take at the till, not by how much they show. The logging screen opens straight to a big number pad; the amount is the first thing typed because it is the one thing the user always knows. Anything that can wait (category, date, notes) sits below the save button under a "Change" link.

*Why:* if logging takes more than a few seconds, people stop logging, and a tracker with gaps is worse than no tracker because it looks complete.

### One main action per screen

Each screen has exactly one primary button (filled accent colour). Everything else is secondary (outlined), a text button, or a chip. On the result screen the single primary button is on the top result ("Paid with this"); lower results get secondary buttons.

*Why:* at a glance, the eye goes to the one filled button. Two filled buttons mean the user has to read before acting.

### One raised surface: the answer

The page background is tinted "paper". Lists sit on flat white "surface" cards. Only one thing on any screen is raised with a coloured shadow and a thick accent top border: the answer the screen exists to give. Sheets and toasts float above everything.

*Why:* depth is reserved for meaning. If everything has a shadow, nothing stands out; if only the answer does, the user finds it without reading.

### Remember instead of asking

Choosing a known merchant fills in its category, the payment method and the card from last time. Choices the user changes on a screen are remembered for that merchant. After a save, the things likely to repeat (card, method, date) stay and the things that won't (amount, merchant) clear, so a run of purchases is fast.

*Why:* the fastest form field is one the user never touches. Being right from history beats being clever.

### Undo instead of confirm

Common actions (save, delete a purchase) happen at once and show a toast with Undo for five seconds. A confirm dialog is kept only for rare, destructive, hard-to-undo actions (removing a card from the wallet, replacing all data with a backup).

*Why:* confirm dialogs on frequent actions train people to tap "OK" without reading, and they cost a tap every time. Undo costs nothing when things are right.

### Show the reasoning next to every result

Every result has one plain line saying why, e.g. "S$212 of S$600 cap left" or "Pay by phone, not the plastic card". Warnings, fees and hints sit directly under the result they belong to, never in a separate panel.

*Why:* a number without a reason can't be trusted or checked, and the user learns the rules over time by reading the reasons. It also exposes bugs: a wrong reason is noticed faster than a wrong number.

### Conservative estimates

When the app estimates, it errs on the side that won't disappoint:

- Rewards are rounded down, and when a purchase is split (e.g. over a limit) both parts are rounded down.
- Usage is shown as "at least S$X used", because some spending may not have been logged.
- Estimated figures carry a "~".
- A warning appears at 85% of a limit, not at 100%.

*Why:* an estimate that is sometimes too high teaches the user to distrust all of them. One that is reliably a little low is still useful.

### Labels only when they change the outcome

Data the app isn't sure of is marked "Unconfirmed", but only when the uncertainty would change the answer. If every possible reading gives the same result, no label is shown.

*Why:* a label on everything is a label on nothing. Uncertainty is shown where it matters so the user checks exactly those cases.

### Be honest about gaps

The app shows the gap between what was logged and what a statement says, and offers one tap to add a catch-up entry. When data is missing (no statement day set, say), the app falls back to a sensible default and says so, rather than failing or silently guessing.

### Rules live in data, and user edits are sacred

Anything that changes outside the app's control (rates, limits, categories, merchant defaults) lives in JSON config files with sources and a "last verified" date, never in code. Anything the user edits wins over any later config update, forever.

### Offline, private, local

The app works with no signal from the first launch, loads no third-party scripts or fonts, and sends nothing anywhere. The new app adds a backend, but the phone should still work fully offline and treat the server as a sync target, not a dependency (see [Adding a backend](#adding-a-backend-what-still-applies)).

---

## 2. Design tokens

All visual values are CSS custom properties on `:root` in `styles.css`. Components never use raw colours; changing the theme means editing tokens only.

### Colour

Thirteen colour tokens, each with a light and dark value. The status names `kaya` (amber) and `chilli` (red) are local nicknames; rename them `--warn` and `--danger` in the new app if you prefer, as long as every use is renamed.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#FCF3F6` | `#1B1016` | Page background, sheet background, tab bar tint. Slightly tinted, never pure white. |
| `--surface` | `#FFFFFF` | `#27171F` | Lists, cards, inputs, keypad keys, the answer panel. |
| `--ink` | `#3B1D2A` | `#F8E9EF` | Body text. Also the toast background (inverted). |
| `--ink-2` | `#7A5364` | `#C9A7B6` | Secondary text: labels, hints, sub-lines, units, inactive tabs. |
| `--line` | `#F0D6E0` | `#3D2531` | Borders and dividers. Decorative only, never the only cue. |
| `--accent` | `#C8326E` | `#FF8AB5` | Primary buttons, selected chips, active tab, links, progress fill, focus rings. |
| `--accent-press` | `#AD2A5F` | `#F5739F` | Hover/press state of accent fills. |
| `--on-accent` | `#FFFFFF` | `#2B0A18` | Text on accent fills. Dark in dark mode because the accent is light there. |
| `--accent-soft` | `#FCE1EB` | `#4A1F32` | Hint boxes, tags, suggestion chips, progress track, hover tints, Undo text on the toast. |
| `--kaya` | `#8F5E0E` | `#EDBA62` | Amber: fallback tone, "Unconfirmed" tag text, near-limit bar. |
| `--kaya-soft` | `#FDF0D9` | `#3A2A14` | Warning boxes, amber reminders, "Unconfirmed" tag background. |
| `--chilli` | `#A3261B` | `#FF8F80` | Red: "avoid" tone, danger buttons, over-limit bar. |
| `--chilli-soft` | `#FBE3DF` | `#45201B` | Danger button hover. |

Contrast levels (WCAG ratio), which the blue palette below matches:

| Pair | Light | Dark |
|---|---|---|
| ink on paper | 13.8 | 15.8 |
| ink-2 on paper | 5.9 | 8.6 |
| accent on paper (links, active tab) | 4.7 | 8.4 |
| on-accent on accent (button text) | 5.1 | 8.2 |
| ink on accent-soft (hints) | 12.3 | 11.7 |
| kaya on kaya-soft (tag) | 4.9 | 7.8 |
| chilli on surface | 7.4 | 7.7 |
| line on surface | 1.36 | 1.23 (decorative) |

Colour meaning is fixed: accent means "do this / selected / good", amber means "careful, check this", red means "avoid / over the limit". Amber and red stay the same whatever the accent is.

Two derived colours use `color-mix()` so they follow the tokens: the tab bar (`color-mix(in srgb, var(--paper) 88%, transparent)` with a 16px backdrop blur) and hover tints (`color-mix(in srgb, var(--surface) 90%, var(--accent-soft))`). The sheet backdrop is `rgb(43 16 28 / 0.45)`, a darkened ink; change it with the palette.

### Typography

No web fonts. Two system stacks:

```css
--font-text: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
/* Rounded on Apple devices; elsewhere the system sans. */
--font-num: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

- **Text font:** the platform's own UI font (San Francisco on iPhone). Feels native, loads instantly, works offline.
- **Number font:** SF Pro Rounded on Apple devices, falling back to the system sans. Used for every figure (amounts, totals, keypad), plus screen and sheet titles, which gives the app its friendly character without a download.
- **Figures always line up.** Rounded fonts may default to proportional or old-style figures, and the fallback font may too, so every number element sets both:

```css
.num, .amount-input, .pad-display, .key, .list-amount, .total-num /* ...every figure */ {
  font-variant-numeric: lining-nums tabular-nums;
  font-feature-settings: "lnum" 1, "tnum" 1;
}
```

Type scale (rem, based on 16px):

| Token | px | Use |
|---|---|---|
| `--t-xs` | 13 | Small print, tags, units, cap sub-lines |
| `--t-s` | 15 | Labels, hints, warnings, list sub-lines, chips |
| `--t-m` | 17 | Body and inputs (17px stops iOS zooming on focus) |
| `--t-l` | 22 | Sheet titles, secondary figures, empty-state headings |
| `--t-xl` | 34 | Screen title |
| `--t-xxl` | 56 | The answer's figure |
| (literal) `4rem` | 64 | Number pad display and overview total |
| (literal) `0.625rem` | 10 | Tab bar labels |

Weights: 600 for labels, chips and list titles; 700 for buttons, titles and figures; 800 for the big figures. Big figures get `letter-spacing: -0.03em` and `line-height: 1`; titles `-0.02em` and `1.1`. Body `line-height: 1.5`.

### Spacing, radii, depth, motion

```css
/* Spacing (px): 4 / 8 / 12 / 16 / 24 / 32 */
--s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;

--r-control: 12px;   /* inputs, small boxes */
--r-panel: 22px;     /* answer panel, sheet top corners */
--touch: 48px;       /* minimum touch target */
--tabbar: 64px;
--spring: cubic-bezier(0.34, 1.4, 0.64, 1);  /* slight overshoot on press and appear */

/* Depth: base (paper) -> surface (lists) -> raised (the answer) -> floating (sheets, toast) */
--shadow-raised: 0 1px 2px rgb(59 29 42 / 0.06), 0 8px 24px -6px rgb(200 50 110 / 0.24);
--shadow-float: 0 2px 6px rgb(59 29 42 / 0.08), 0 20px 48px -12px rgb(59 29 42 / 0.32);
```

Other radii in use: 16px for lists, cards and keypad keys; 14px for buttons, toast and reminders; 10px for hint/warning boxes; 999px for chips, tags, bars and the update pill; 50% for icon buttons.

Touch targets: 48px for inputs and icon buttons, 52px for primary buttons, 56px for keypad keys, 60px for list rows, 40px minimum for chips and text buttons.

Motion: presses scale down (`0.93` to `0.97`) with the spring curve; the answer panel "settles" in (fade + 8px rise); sheets "rise" 40px; progress bars grow with `transform: scaleX()`. Everything is disabled under `prefers-reduced-motion: reduce`.

The raised shadow is tinted with the accent (`rgb(200 50 110 / 0.24)` light, `rgb(255 138 181 / 0.22)` dark). Change that tint with the palette.

### Safe areas and the phone shell

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FCF3F6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1B1016" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
```

`viewport-fit=cover` lets the page draw under the notch and home indicator; then every edge element adds the matching inset:

```css
.top  { padding: calc(env(safe-area-inset-top) + var(--s4)) var(--s4) var(--s3); }
main  { padding: 0 var(--s4) calc(var(--tabbar) + env(safe-area-inset-bottom) + var(--s6)); }
.tabs { padding-bottom: env(safe-area-inset-bottom); }
.sheet { padding: 0 var(--s4) calc(env(safe-area-inset-bottom) + var(--s4)); }
#toast { bottom: calc(var(--tabbar) + env(safe-area-inset-bottom) + var(--s3)); }
.update { top: calc(env(safe-area-inset-top) + var(--s2)); }
```

Content is capped at `max-width: 560px` and centred, so it reads well on a tablet or desktop without a separate layout. Use `100dvh`, not `100vh` (iOS toolbars change the viewport). The `theme-color` values must equal `--paper` in each scheme, and `manifest.webmanifest` `background_color`/`theme_color` must equal light `--paper`.

### Light and dark

The app follows the system setting with `@media (prefers-color-scheme: dark)` overriding the same tokens, and sets `color-scheme: light` / `dark` so form controls, scrollbars and date pickers match. There is no in-app toggle. Dark mode is not an inversion: surfaces get lighter as they rise (paper `#1B1016` < surface `#27171F`), the accent becomes a lighter tint with dark text on it, and shadows become mostly black with a faint accent glow on the raised panel.

### Proposed blue palette

Same roles, same contrast (within about 0.4 of each pink ratio, and every text pair passes the same WCAG level). Amber and red are unchanged. Replace the colour tokens and the accent-tinted values; nothing else changes.

```css
:root {
  --paper: #F3F6FC;
  --surface: #FFFFFF;
  --ink: #1B2638;
  --ink-2: #526079;
  --line: #D6E0F0;
  --accent: #2B63D9;
  --accent-press: #2353BA;
  --on-accent: #FFFFFF;
  --accent-soft: #E1EAFC;
  --kaya: #8F5E0E;       /* or --warn */
  --kaya-soft: #FDF0D9;
  --chilli: #A3261B;     /* or --danger */
  --chilli-soft: #FBE3DF;
  --shadow-raised: 0 1px 2px rgb(27 38 56 / 0.06), 0 8px 24px -6px rgb(43 99 217 / 0.24);
  --shadow-float: 0 2px 6px rgb(27 38 56 / 0.08), 0 20px 48px -12px rgb(27 38 56 / 0.32);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #0F141D;
    --surface: #172030;
    --ink: #E9EFF9;
    --ink-2: #A6B4CA;
    --line: #253247;
    --accent: #8AB4FF;
    --accent-press: #71A0F5;
    --on-accent: #0A1A33;
    --accent-soft: #1F3050;
    --kaya: #EDBA62;
    --kaya-soft: #3A2A14;
    --chilli: #FF8F80;
    --chilli-soft: #45201B;
    --shadow-raised: 0 1px 2px rgb(0 0 0 / 0.3), 0 10px 28px -8px rgb(138 180 255 / 0.22);
    --shadow-float: 0 2px 6px rgb(0 0 0 / 0.4), 0 20px 48px -12px rgb(0 0 0 / 0.6);
    color-scheme: dark;
  }
}
```

Also change: `.sheet::backdrop` to `rgb(15 20 29 / 0.45)`; the two `theme-color` metas to `#F3F6FC` / `#0F141D`; manifest colours to `#F3F6FC`.

Measured contrast, pink vs blue:

| Pair | Pink light | Blue light | Pink dark | Blue dark |
|---|---|---|---|---|
| ink on paper | 13.83 | 14.05 | 15.80 | 15.97 |
| ink on surface | 15.05 | 15.21 | 14.56 | 14.14 |
| ink-2 on paper | 5.94 | 5.86 | 8.55 | 8.79 |
| ink-2 on surface | 6.46 | 6.35 | 7.88 | 7.78 |
| accent on paper | 4.66 | 4.99 | 8.44 | 8.83 |
| accent on surface | 5.08 | 5.40 | 7.78 | 7.82 |
| on-accent on accent | 5.08 | 5.40 | 8.24 | 8.32 |
| on-accent on accent-press | 6.42 | 6.96 | 6.76 | 6.66 |
| ink on accent-soft | 12.26 | 12.58 | 11.67 | 11.38 |
| line on surface | 1.36 | 1.33 | 1.23 | 1.26 |

One thing to watch with blue: links and the accent are the same blue, which is the web's convention for "tappable". Keep accent text for tappable things only; don't use it for plain emphasis.

---

## 3. Components

All components are plain HTML elements built with a tiny `h()` helper (see [Reusable files](#7-reusable-files)); there is no framework. Each snippet below is from the source app, trimmed.

### Tab bar

**Purpose:** move between the four or five top-level screens with the thumb.
**Parts:** fixed bottom `<nav>`, one `<a href="#screen">` per tab with a 26px stroke icon (inline SVG, `stroke: currentColor`) and a 10px label.
**States:** inactive (`--ink-2`), current (`aria-current="page"`, accent), pressed (icon scales to 0.9), focus ring inset.
**Notes:** routing is by URL hash, so the back gesture and home-screen launches work without a router. The bar is translucent paper with backdrop blur, and pads for the home indicator. Labels `white-space: nowrap`: keep them to one or two short words.

```html
<nav class="tabs" aria-label="Screens">
  <a href="#add" data-screen="add">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
    <span>Add</span>
  </a>
  <!-- ... -->
</nav>
```

```css
.tabs {
  position: fixed; inset: auto 0 0 0;
  display: grid; grid-template-columns: repeat(5, 1fr);
  padding-bottom: env(safe-area-inset-bottom);
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  border-top: 1px solid var(--line);
  z-index: 10;
}
.tabs a { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  min-height: var(--tabbar); color: var(--ink-2); text-decoration: none; font-size: 0.625rem; font-weight: 600; white-space: nowrap; }
.tabs svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.tabs a[aria-current="page"] { color: var(--accent); }
```

### Raised result panel

**Purpose:** the answer the screen exists to give. Only one per screen.
**Parts:** a title (what to use) with optional tag, an instruction line in accent, a big figure with a small unit on the right, one reason line, then hint / warning / fee boxes, then the primary button.
**States (tones):** `tone-bonus` (accent top border), `tone-fallback` (amber border and instruction: the best option isn't great), `tone-avoid` (red: don't do this). A quiet variant (`.answer-quiet`, border instead of shadow) is used when there is no real answer ("any option is the same"). Alternatives below it use the same markup with `.answer-row` (flat, smaller figure, secondary button).

```js
h('article', { class: `answer answer-top tone-${tone}` },
  h('div', { class: 'answer-main' },
    h('div', {},
      h('p', { class: 'answer-card' }, title, unconfirmed ? unconfirmedTag() : null),
      h('p', { class: 'answer-method' }, instruction)),
    h('p', { class: 'answer-miles', 'aria-label': `${n} miles` },
      h('span', { class: 'num' }, `${estimated ? '~' : ''}${n}`), h('span', { class: 'unit' }, 'miles'))),
  h('p', { class: 'reason' }, reason),
  hint && h('p', { class: 'hint' }, hint),
  warnings.map((w) => h('p', { class: 'warning' }, w)),
  h('button', { type: 'button', class: 'button primary' }, 'Paid with this'));
```

```css
.answer-top {
  padding: var(--s5) var(--s4) var(--s4);
  background: var(--surface);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-raised);
  border-top: 5px solid var(--accent);
  animation: settle 0.45s var(--spring);
}
.answer-top .answer-method { font-size: var(--t-m); font-weight: 600; color: var(--accent); }
.answer-top .answer-miles .num { font-size: var(--t-xxl); }
.answer-top.tone-fallback { border-top-color: var(--kaya); }
.answer-top.tone-fallback .answer-method { color: var(--kaya); }
.answer-top.tone-avoid { border-top-color: var(--chilli); }
.answer-top.tone-avoid .answer-method { color: var(--chilli); }
@keyframes settle { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
```

The results container has `aria-live="polite"` so screen readers hear the new answer as the user types.

### Chips

**Purpose:** pick one of a few options with one tap (a radio group), or quick-pick a recent item.
**Parts:** a wrapping row of pill buttons. Selecting one re-renders the row.
**States:** unselected (surface, line border), selected (`aria-checked="true"`, accent fill), hover (darker border), pressed (scale 0.95), focus ring. `.chip-add` is dashed with accent text ("Add Corner bakery").
**Variants:** radio chips (`role="radio"` inside `role="radiogroup"`) for choices; toggle chips (`aria-pressed`) for "recent merchants", where the pressed one matches what's typed; `.suggestion` (soft accent, squarer) for suggestions.

```js
export function chips({ name, options, value, onChange, label }) {
  const group = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': label });
  const render = (current) => {
    group.replaceChildren(...options.map((o) => h('button', {
      type: 'button', class: 'chip', role: 'radio',
      'aria-checked': String(o.value === current),
      dataset: { name, value: o.value },
      onclick: () => { render(o.value); onChange(o.value); },
    }, o.label)));
  };
  render(value);
  group.set = render;   // lets other code change the selection
  return group;
}
```

```css
.chips { display: flex; flex-wrap: wrap; gap: var(--s2); }
.chip { min-height: 40px; padding: 0 var(--s4); border: 1px solid var(--line); border-radius: 999px;
  background: var(--surface); font-size: var(--t-s); font-weight: 600; cursor: pointer;
  transition: transform 0.25s var(--spring); }
.chip[aria-checked="true"], .chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.chip:active { transform: scale(0.95); }
.chip-add { border-style: dashed; color: var(--accent); }
```

### Number pad

**Purpose:** enter an amount fast, one-handed, without the system keyboard covering half the screen.
**Parts:** a centred display (`<output aria-live="polite">`, small currency prefix and a 64px figure), a 3×4 grid of keys (`1`–`9`, `.`, `0`, `⌫`), and the save button whose label reflects state.
**States:** keys scale to 0.93 and tint soft accent on press. Input rules: at most two decimals, at most seven digits, one decimal point, leading zero replaced. The save button reads "Enter an amount" (disabled), then "Pick a merchant" (disabled), then "Save S$12.50".

```js
function press(key) {
  let a = f.amount;
  if (key === 'back') a = a.slice(0, -1);
  else if (key === '.') a = a.includes('.') ? a : `${a || '0'}.`;
  else if (/\.\d{2}$/.test(a) || a.replace('.', '').length >= 7) return;
  else a = a === '0' ? key : a + key;
  f.amount = a;
  renderAmount();
}
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];
const pad = h('div', { class: 'keypad' }, keys.map((k) => h('button', {
  type: 'button', class: 'key',
  'aria-label': k === 'back' ? 'Delete' : k === '.' ? 'Decimal point' : k,
  onclick: () => press(k),
}, k === 'back' ? '⌫' : k)));
```

```css
.pad-display { display: flex; align-items: baseline; justify-content: center; gap: var(--s2); font-family: var(--font-num); }
.pad-display .currency { font-size: var(--t-l); color: var(--ink-2); font-weight: 700; }
.pad-display .num { font-size: 4rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
.keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s2); margin-top: var(--s3); }
.key { min-height: 56px; border: 0; border-radius: 16px; background: var(--surface);
  font-family: var(--font-num); font-size: 1.75rem; font-weight: 600; cursor: pointer; transition: transform 0.2s var(--spring); }
.key:active { transform: scale(0.93); background: var(--accent-soft); }
```

Keep the amount as a string while typing and convert once on save (then to integer cents; see [Money](#money)).

Where a keyboard is fine (the decide screen, edit sheets), use `<input type="text" inputmode="decimal">`, not `type="number"`: it gives the decimal keypad on iOS without number-input quirks (scroll-to-change, locale commas, `e`).

### Segmented option rows

**Purpose:** two or three related choices where one depends on the other ("Where": in store / online / transit, then "How": the payment methods for that place).
**Parts:** a `.field` with a label and a chip row per question. The second row's options are rebuilt when the first changes, and hidden entirely when there is only one possible answer. The first option can be a "let the app decide" choice ("Best way").
**States:** as chips. The dependent row resets to its default when the parent changes. Changes are remembered per merchant.

```js
function renderMethods() {
  howRow.hidden = form.channel === 'transit';          // only one way to pay: hide the question
  const methods = CHANNELS[form.channel].methods;
  const options = methods.length > 1
    ? [{ value: 'any', label: 'Best way' }, ...methods.map((m) => ({ value: m, label: METHOD_NAMES[m] }))]
    : [{ value: 'any', label: METHOD_NAMES[methods[0]] }];
  fill(methodChips, chips({ name: 'method', label: 'How', value: form.method, options, onChange: (v) => { form.method = v; remember(); update(); } }));
}
```

Rule of thumb: never show a question whose answer is already known.

### List rows

**Purpose:** a tappable item in a list (a purchase, a card, a merchant) that opens its edit sheet.
**Parts:** `<ul class="list">` on a surface card with hairline dividers; each `<li>` holds a full-width `<button class="list-row">` with a title (plus optional tag), a sub-line, and a right-aligned figure. Extra controls (reorder arrows) sit beside the button, not inside it.
**States:** hover tint, pressed (opacity 0.7), focus ring inset. Lists are grouped under `.subhead` headings ("Today", "30 Sep 2026").

```js
h('ul', { class: 'list' }, items.map((t) => h('li', {},
  h('button', { type: 'button', class: 'list-row', onclick: () => edit(t) },
    h('span', { class: 'list-main' },
      h('span', { class: 'list-title' }, t.merchant),
      h('span', { class: 'list-sub' }, `${cardName}, ${methodPhrase(t.method)}`)),
    h('span', { class: 'list-amount' }, money(t.amount))))));
```

```css
.list { list-style: none; margin: 0; padding: 0; background: var(--surface); border-radius: 16px; overflow: hidden; }
.list > li + li { border-top: 1px solid var(--line); }
.list-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s3);
  width: 100%; min-height: 60px; padding: var(--s3) var(--s4); border: 0; background: transparent; text-align: left; cursor: pointer; }
.list-main { display: grid; min-width: 0; }   /* min-width: 0 lets long titles wrap instead of pushing the amount off */
.list-title { font-weight: 600; display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); }
.list-sub { font-size: var(--t-s); color: var(--ink-2); }
.list-amount { font-family: var(--font-num); font-weight: 700; font-variant-numeric: tabular-nums; flex: none; }
```

Reordering uses ↑ / ↓ icon buttons (disabled at the ends) rather than drag and drop: reliable on touch, accessible, no library.

### Sheets

**Purpose:** edit or add something without leaving the screen. Every form except the main entry screen lives in a sheet.
**Parts:** a native `<dialog class="sheet">` opened with `showModal()`, a sticky head with the title (number font) and a ✕ icon button, then a `.sheet-form` of fields and a `.sheet-actions` stack (primary first, then secondary, then danger).
**States:** rises in with the spring; closes on ✕, backdrop tap, or Escape/back (`cancel` event). Removed from the DOM on close.

```js
export function sheet(title, content) {
  const dialog = h('dialog', { class: 'sheet', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', onclick: () => close() }, '✕')),
    content);
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });  // backdrop tap
  dialog.addEventListener('cancel', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { close, dialog };
}
```

```css
.sheet { width: 100%; max-width: 560px; max-height: 92dvh; margin: auto auto 0;
  padding: 0 var(--s4) calc(env(safe-area-inset-bottom) + var(--s4));
  border: 0; border-radius: var(--r-panel) var(--r-panel) 0 0;
  background: var(--paper); color: var(--ink); box-shadow: var(--shadow-float); overflow-y: auto; }
.sheet[open] { animation: rise 0.4s var(--spring); }
.sheet::backdrop { background: rgb(43 16 28 / 0.45); }
.sheet-head { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between;
  padding: var(--s4) 0 var(--s2); background: var(--paper); z-index: 1; }
.sheet-actions { display: grid; gap: var(--s2); margin-top: var(--s5); }
```

Validation uses the browser's own messages: `input.setCustomValidity('Enter an amount above zero.'); input.reportValidity();`.

### Undo toast

**Purpose:** confirm that something happened, and offer to reverse it.
**Parts:** one fixed `#toast` element (`role="status" aria-live="polite"`) above the tab bar, inverted colours (ink background, paper text), a message and an optional action button.
**States:** hidden (transparent, 12px down, no pointer events), shown for 5 seconds, replaced by a newer toast. Tapping the action hides it and runs the action; undo usually shows a second toast ("Removed").

```js
let toastTimer;
export function toast(message, action) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  fill(el, h('span', {}, message), action && h('button', {
    type: 'button', class: 'toast-action',
    onclick: async () => { el.classList.remove('show'); await action.run(); },
  }, action.label));
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

// Use:
toast(`Saved ${money(txn.amount)} at ${txn.merchant}`, { label: 'Undo', run: () => deleteTxn(txn.id) });
```

```css
#toast { position: fixed; left: var(--s4); right: var(--s4);
  bottom: calc(var(--tabbar) + env(safe-area-inset-bottom) + var(--s3));
  max-width: 528px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: var(--s3);
  padding: var(--s3) var(--s4); border-radius: 14px; background: var(--ink); color: var(--paper);
  font-size: var(--t-s); box-shadow: var(--shadow-float);
  opacity: 0; transform: translateY(12px); pointer-events: none;
  transition: opacity 0.2s, transform 0.35s var(--spring); z-index: 20; }
#toast.show { opacity: 1; transform: none; pointer-events: auto; }
.toast-action { min-height: 40px; padding: 0 var(--s3); border: 0; border-radius: 10px; background: transparent;
  color: var(--accent-soft); font-weight: 700; cursor: pointer; }
```

Undo must restore exactly what was there (for an edit, keep the old record; for a delete, keep the deleted record). After an undo on the entry screen, put the amount back in the field.

### Empty states

**Purpose:** a screen with nothing to show explains why and offers the one step that fixes it.
**Parts:** `section.empty` with a heading (what's missing), one sentence (why it matters), one primary button (the fix). Inside a list, a single muted line instead (`.empty-line`: "Purchases you log appear here.").

```js
fill(root, h('section', { class: 'empty' },
  h('h2', {}, 'No cards yet'),
  h('p', {}, 'Add a card before logging purchases on it.'),
  h('button', { type: 'button', class: 'button primary', onclick: () => go('cards') }, 'Add a card')));
```

```css
.empty { padding: var(--s6) 0; display: grid; gap: var(--s3); max-width: 34ch; }
.empty h2 { font-size: var(--t-l); }
.empty-line { color: var(--ink-2); padding: var(--s3) 0; }
```

The app starts empty; every screen must look intentional in that state.

### Warnings, hints, tags and bars

**Purpose:** attach context to the thing it's about.

- `.hint` (soft accent box): a tip that improves the result ("Pay by phone, not the plastic card.").
- `.warning` (amber box, ink text): something to check or that will happen ("After this, at least S$520 of the S$600 cap will be used.").
- `.fee` (paper box, secondary text): a cost worth knowing.
- `.tag` (small pill, soft accent) and `.tag-unconfirmed` (amber): a one- or two-word status after a title ("Unconfirmed", "Check on statement").
- `.bar` progress: soft-accent track, accent fill; `.bar-warn` amber at 85%+, `.bar-over` red over the limit. Uses `role="progressbar"` with `aria-valuenow` and an `aria-label` in words.
- `.reminder` rows on the overview: soft-accent box (amber for money-related ones) with a sentence and one text-button action ("Export backup").

```css
.hint, .warning, .fee { font-size: var(--t-s); padding: var(--s2) var(--s3); border-radius: 10px; }
.hint { background: var(--accent-soft); }
.warning { background: var(--kaya-soft); color: var(--ink); }
.fee { background: var(--paper); color: var(--ink-2); }
.tag { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft);
  color: var(--ink); font-size: var(--t-xs); font-weight: 600; line-height: 1.5; }
.tag-unconfirmed { background: var(--kaya-soft); color: var(--kaya); }
.bar { height: 10px; border-radius: 999px; background: var(--accent-soft); overflow: hidden; }
.bar-fill { display: block; height: 100%; background: var(--accent); border-radius: inherit;
  transform-origin: left; transition: transform 0.6s var(--spring); }
.bar-warn .bar-fill { background: var(--kaya); }
.bar-over .bar-fill { background: var(--chilli); }
```

Warning text is ink on amber, not amber on amber, so it stays readable; colour signals the kind, words carry the meaning.

### Update notice

**Purpose:** tell the user new app files or config arrived, so they never run on stale rules without knowing.
**Parts:** a pill button fixed at the top centre ("Updated, tap to reload"), accent fill, inside a `role="status"` region. Hidden until the service worker reports a change; tapping reloads.

```html
<div role="status" aria-live="polite">
  <button id="update" type="button" class="update" hidden>Updated, tap to reload</button>
</div>
```

```js
function showUpdate() {
  const button = document.getElementById('update');
  if (!button.hidden) return;
  button.onclick = () => location.reload();
  button.hidden = false;
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'updated') showUpdate(); });
  const hadController = !!navigator.serviceWorker.controller;   // first install is not an "update"
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdate(); });
}
```

```css
.update { position: fixed; top: calc(env(safe-area-inset-top) + var(--s2)); left: 50%;
  min-height: 40px; padding: 0 var(--s4); border: 0; border-radius: 999px;
  background: var(--accent); color: var(--on-accent); font: 600 var(--t-s) var(--font-text);
  box-shadow: var(--shadow-float); cursor: pointer; transform: translateX(-50%);
  animation: update-in 0.4s var(--spring); z-index: 30; }
```

The app never reloads by itself: the user might be mid-entry.

### Buttons and fields

- `.button.primary`: full width, 52px, accent fill. One per screen or sheet.
- `.button.secondary`: outlined accent, 44px.
- `.button.danger`: red text, no fill; soft red on hover. Always last in a sheet's actions.
- `.text-button`: accent text, 40px, soft accent on hover. For inline actions in cards and reminders; pulled left by `--s3` so its text aligns with the content above.
- `.icon-button`: 48px circle, `aria-label` required.
- `.link-button`: underlined inline text that acts like a link.
- `.field`: `<label>` wrapping a 15px `--ink-2` label, the control, and an optional 13px hint. Inputs and selects are 48px tall, `--surface` background, 17px text. Selects draw their own chevron with two gradients (no image). Toggles are a native checkbox with `accent-color: var(--accent)`.

```js
export const field = (label, control, hint) => h('label', { class: 'field' },
  h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'field-hint' }, hint));
```

Every interactive element has a visible `:focus-visible` ring (3px accent). `-webkit-tap-highlight-color: transparent` removes the grey flash on iOS because each control has its own pressed state.

---

## 4. Screen patterns

The shell is the same on every screen: a large title at the top (34px, number font, set per screen), the screen body in `<main>`, the tab bar at the bottom. Screens are functions `render(root, { go })` that rebuild their content; `go('name')` switches tab.

### Entry screen (log something)

Layout top to bottom: the amount display, the merchant field with recent-merchant chips under it, the number pad, a one-line summary of what will be saved ("On Card A, phone tap, like last time" with a "Change" link), the primary Save button, then a details section below (card, method, category, date, a toggle).

Why: the thumb works in the lower half, so the keypad and Save sit there. The summary line makes pre-filled choices visible without making the user look at them, and "Change" scrolls to the details instead of opening a new screen. Save is disabled with a label that says what's missing, instead of an error after tapping. After saving, the Undo toast appears and the form clears only what won't repeat.

For the spending tracker, this is the home screen: open the app, type the amount, tap a recent merchant, Save. Three to four taps.

### Decide screen (input, then a ranked answer)

Inputs at the top in a compact form (merchant, amount and category side by side, then the Where / How chip rows), results below, updating live as the user types. The top result is the raised panel; alternatives follow under "Other options" as flat rows. Before there's enough input, the results area shows one muted sentence saying what to enter.

Why: no "Calculate" button, because every keystroke refines the answer and the user sees it change. The form state persists between tab visits, so switching away and back doesn't lose work.

A spending tracker may not need this screen. If it has a "can I afford this?" or "which budget does this come from?" question, this is the pattern.

### Overview (dashboard)

Top to bottom: reminders (only the ones due now, soonest first, each with one action), the headline figure (64px, e.g. total this month) with a label and one line of small print about how it's counted, then one card per tracked thing (a heading, a figure, a progress bar with "S$X left" and "resets 1 Nov 2026", any warning), then secondary sections.

Why: reminders go first because they are time-sensitive and disappear once handled. One big number answers "how am I doing?" at a glance. Each card is self-contained, with its own action (e.g. "Check statement"), so the user never has to hunt for where to act on what they're reading. Nothing on the overview is editable in place; editing happens in sheets.

### History

A two-chip switch at the top when there are two kinds of record (e.g. purchases / merchants). Purchases are grouped by day under subheads ("Today", then "29 Sep 2026"), newest first, each a list row with the amount on the right. Tapping a row opens its edit sheet (all fields, Save, Delete). Tags on rows flag the ones that need checking.

Why: grouping by day matches how people remember spending. Editing in a sheet keeps the scroll position. Delete sits in the sheet, not as a swipe action, so it can't happen by accident; it still gets an Undo toast.

### List management (the user's items and a catalogue)

Two sections: "Your items" (the user's own, in their priority order, with ↑ / ↓ to reorder and a line explaining what the order does), then "All items" (the catalogue from config, to browse and add from). Tapping an item opens a sheet with its facts at the top (a two-column `<dl>`), then the user's own fields, then actions.

Why: the user's items are what they use daily, so they come first. The catalogue is a place to browse, not a settings list. The facts at the top of a sheet show what the app knows before asking what the user knows.

For the spending tracker this fits budgets, accounts or categories.

### Settings and backup

At the bottom of the list management screen, not a separate tab: a few fields (each with a hint saying what it changes), then "Export backup" and "Import backup" buttons, with a line saying when the last backup was made.

Why: settings are rarely touched, so they don't earn a tab. Backup lives near settings, and the overview reminds the user when it's overdue, so they rarely need to come here.

---

## 5. Writing style

This applies to every string the user sees: screens, sheets, toasts, reminders, results, reasons and warnings, and every text field in config JSON that the app shows (labels, notes, reminder text, condition text, questions). Developer-only detail in config files goes in a `dev_notes` field that the app never shows.

**Sentence case everywhere.** Capitalise only the first word and proper nouns (bank, brand and place names). No ALL CAPS for emphasis.

| Do | Don't |
|---|---|
| Add a purchase | Add a Purchase |
| Check statement | CHECK STATEMENT |
| Other cards | Other Cards |

**Full sentences end with a period**: hints, notes, warnings, reason lines, reminders, sentence bullets, toasts that are sentences. Labels, buttons, chips, category names, titles and single values don't.

| Do | Don't |
|---|---|
| Hint: "The day of the month your statement is issued. Caps and reminders use it." | "The day of the month your statement is issued" |
| Button: "Save balance" | "Save balance." |
| Toast: "Backup imported" (a label-like phrase) / "Copied. Paste it into Claude chat." (sentences) | "Backup imported!" |

**Use " / " for alternatives.** No "&" and no parentheses in names.

| Do | Don't |
|---|---|
| Pharmacy / health and beauty | Pharmacy & Health (Beauty) |
| MRT / bus | MRT/Bus |
| Online marketplaces | Online (marketplaces) |

**Money always has thousands separators and a currency prefix**: S$1,000, S$12.50. Whole amounts in prose can drop the cents (S$1,000 limit); amounts the user entered or will be charged keep them (Save S$12.50). Use `toLocaleString` with a fixed locale, not string building.

**Dates as "30 Sep 2026".** Relative words only for the nearest ("Today"). Never "09/30" or "2026-09-30" on screen.

**Plain words for technical terms.** The source app says "category code", never the industry acronym, and shows code numbers only inside the one field where they're entered. Pick the plain name for each concept once and use it everywhere.

**Sources are linked text**: "Mainly Miles review", never a raw URL.

Beyond the rules, the voice:

- **Say what to do, not what went wrong.** "Enter an amount above zero." rather than "Invalid amount".
- **Button labels are verbs for what happens**: "Save S$12.50", "Paid with this", "Export backup". Disabled buttons say what's missing: "Enter an amount", "Pick a merchant".
- **Errors say whether anything changed**: "Nothing changed: This isn't a backup file."
- **Empty states say why and what next**: "Add your cards first" / "Recommendations use only the cards you carry. Add each card as it arrives."
- **Numbers the user might doubt say how they're counted**: "at least S$520 used", "Estimated from logged purchases. Enter the balance from the bank app to make it exact."
- **Second person, short.** "your cards", not "the user's cards"; one idea per sentence.
- **Names as the user would say them**: "Phone tap", not "NFC mobile wallet".

Keep a writing style section in the new project's CLAUDE.md so every session applies it, including to config JSON.

---

## 6. Architecture

### Ground rules

- Plain HTML, CSS and JavaScript (ES modules) in several files. No framework, no build step, no bundler, no transpiler, no CSS framework.
- No CDN scripts, web fonts or third-party requests of any kind: the app must work offline from the first install, and nothing should leak.
- Installable PWA (manifest + service worker), hosted as static files.
- Never store secrets or full account/card numbers. Items are identified by name.
- Rules that change outside the app live in config JSON, never in code.
- Build in stages, with tests for the maths before any interface, and check in with the user after each stage.

### File structure

```
index.html              shell: title bar, <main id="view">, tab bar, toast, update pill
styles.css              all styles; tokens in :root
manifest.webmanifest    install metadata (relative paths)
sw.js                   service worker: precache + stale-while-revalidate + change notice
icons/                  192, 512 (also maskable), apple-touch-icon 180, favicon 32, source SVG
data/                   config JSON the app reads (rules, categories, pre-fill)
src/
  app.js                boot: load data, hash router, service worker registration, persist()
  engine/               pure logic, no DOM, no storage: maths, dates, rounding, ranking, dashboard
    index.js            re-exports the engine's public functions
  db/
    schema.js           store names, keys, indexes and JSDoc typedefs for every record
    idb.js              thin promise wrapper over IndexedDB
    repo.js             in-memory state + every read/write the UI may do
  ui/
    dom.js              h(), fill(), chips(), sheet(), toast(), field(), formatters
    <screen>.js         one file per screen: export function renderX(root, { go })
    backup.js           export/import UI
scripts/                developer-only Node scripts (data checks, migrations of config)
tests/                  node --test files; tests/engine/fixtures.js holds frozen test data
package.json            "type": "module", "test": "node --test \"tests/**/*.test.js\""
CLAUDE.md               project rules, decisions and writing style for every session
SPEC.md                 the build spec
```

### Engine, storage, UI

Three layers, one direction of dependency: `ui → db/repo → engine`, and `ui → engine` for pure helpers. The engine imports nothing from the other two.

- **Engine** (`src/engine/`): pure functions that take plain data and return plain data: `recommend({ purchase, cards, myCards, txns, settings })`, `overview(...)`, `reminders({ ..., today, now })`. No `document`, no `indexedDB`, no `Date.now()` without an injectable override (`today` and `now` are parameters with defaults). This is what makes it testable in Node and what the tests cover.
- **Storage** (`src/db/`): `idb.js` knows IndexedDB; `repo.js` loads config JSON and every store into a single in-memory `state` object at boot, and exposes named functions for every change (`saveTxn`, `deleteTxn`, `addMyCard`, `setSetting`...). Each function writes to IndexedDB, then updates `state`. Screens read `state` directly but change it only through `repo.js`.
- **UI** (`src/ui/`): builds DOM with `h()`, calls the engine for answers and `repo.js` for changes, then re-renders. Screens re-render whole sections rather than patching; at this data size it's instant and removes a class of stale-view bugs.

Loading everything into memory at boot is fine for a personal app (thousands of records). If the tracker grows to years of data, keep the pattern but index by month.

### IndexedDB schema and migrations

The schema is data, and the upgrade handler creates whatever is missing:

```js
export const DB_NAME = 'miles-card-app';
export const DB_VERSION = 1;

// store name -> { keyPath, indexes: { name: keyPath } }
export const STORES = {
  txns: { keyPath: 'id', indexes: { byCard: 'cardId', byDate: 'date', byMerchant: 'merchantId' } },
  merchants: { keyPath: 'id', indexes: { byName: 'nameLower' } },
  statements: { keyPath: ['cardId', 'cycleKey'], indexes: { byCard: 'cardId' } },
  settings: { keyPath: 'key', indexes: {} },   // rows: { key, value }
  // ...
};
```

```js
req.onupgradeneeded = () => {
  const db = req.result;
  for (const [name, def] of Object.entries(STORES)) {
    if (db.objectStoreNames.contains(name)) continue;
    const store = db.createObjectStore(name, { keyPath: def.keyPath });
    for (const [index, keyPath] of Object.entries(def.indexes)) store.createIndex(index, keyPath);
  }
};
req.onsuccess = () => {
  const db = req.result;
  // A newer copy of the app needs the database: let go of it. The next call reopens it.
  db.onversionchange = () => { db.close(); dbPromise = undefined; };
  resolve(db);
};
```

`schema.js` also holds a JSDoc `@typedef` for every record, with units and formats (`'YYYY-MM-DD'`, "ms timestamp", "SGD"). That comment block is the data model's documentation; keep it current.

Migrations, in order of preference:

1. **Additive fields: normalise on load.** New optional fields get defaults when records are read (`normalizeMerchant(m)` fills `aliases: []`, a `status`, a `useCount`...). No version bump, old records keep working, backups from older versions import cleanly.
2. **New store or index: bump `DB_VERSION`** and add it to `STORES`; the loop above creates it. For a new index on an existing store, extend the loop to call `req.transaction.objectStore(name).createIndex` when `!store.indexNames.contains(index)`.
3. **Reshaping data: bump the version and transform inside `onupgradeneeded`** using `req.transaction` (the upgrade transaction), switching on `event.oldVersion`. Never open a second transaction inside an upgrade.

The source app stayed at version 1 using only the first approach. Settings are key/value rows, so adding a setting never needs a migration.

### Money

**Recommendation for the new app: store money as integer cents** (`amountCents: 1250`) everywhere: IndexedDB, backups, the API and the server database. Convert to a display string only in the UI formatter, and from the keypad string once at save time (`Math.round(Number(str) * 100)`).

What the source app actually did: records store a decimal amount rounded to 2 dp (`Math.round(n * 100) / 100`), and the engine converts to integer cents before any maths (`toCents`, `roundTxn`, `floorTo` in `rounding.js`), then back for display. That works for one device, but a decimal is re-rounded at every boundary, and with a server in the picture (Postgres `numeric`, JSON, another client) integer cents are the only representation every layer agrees on.

Other money rules that carry over:

- Sums, splits and comparisons are done in cents. Never `0.1 + 0.2`.
- When splitting an amount across a limit, round each part down (conservative), and test the boundary.
- Format with one helper: `` `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` ``, plus a variant that drops `.00` for whole amounts in prose.
- If the tracker handles foreign currency, store the amount charged in the home currency (what the statement shows), with the original amount and currency as optional extra fields.

### Dates

- Store calendar dates as `'YYYY-MM-DD'` strings, not timestamps. A purchase "on 30 Sep" stays on 30 Sep in any time zone. Strings compare and sort correctly as text.
- Do date arithmetic in UTC (`Date.UTC(y, m - 1, d)`, `getUTC*`, `toISOString().slice(0, 10)`), so daylight saving and time zones never shift a day.
- "Today" is the one place local time is used: build it from `getFullYear/getMonth/getDate`. Never `new Date().toISOString().slice(0, 10)`, which gives yesterday's or tomorrow's date near midnight depending on the zone.
- Clamp to the month's last day when a day number doesn't exist (a cycle on the 31st in February).
- Store instants (created, updated, last export) as millisecond timestamps (`Date.now()`); they are for ordering and sync, not display.
- Pass `today` / `now` into engine functions so tests can pin them.

The source's `src/engine/cycles.js` has `today()`, `addDays`, `addMonths` (clamped), `daysBetween` and `formatDay` ("30 Sep 2026"); reuse them.

### Service worker and "Updated, tap to reload"

Strategy: **precache everything at install, then stale-while-revalidate for every same-origin GET**, and tell open pages when a revalidated file actually changed.

```js
const CACHE = 'miles-v1';
const FILES = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', /* icons, data/*.json, every src/ file */];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache so a new install gets fresh files.
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const before = cached?.clone();
    const fresh = fetch(req).then(async (res) => {
      if (!res.ok) return res;
      const changed = before && !(await sameBody(before, res.clone()));   // byte compare
      await cache.put(req, res.clone());
      if (changed) await announce(req.url);   // postMessage({ type: 'updated' }) to every window
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(fresh); return cached; }
    const res = await fresh;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  }));
});
```

How it behaves:

- The app always opens instantly from cache, online or not.
- Every open revalidates each file in the background. If one changed (new code or new config), the page gets a message and shows "Updated, tap to reload". The next launch uses the new files either way.
- `skipWaiting()` + `clients.claim()` let a new worker take over at once; the page shows the same notice on `controllerchange`, but only if a controller existed before (so a first install doesn't announce itself).
- Only bump `CACHE` to force old caches to be dropped (e.g. after removing files). Normal changes don't need it: revalidation picks them up.
- The page fetches config with `fetch(path, { cache: 'no-cache' })` so the browser's HTTP cache doesn't hide changes from the worker.
- A test parses `FILES` out of `sw.js` and fails if any file under `src/`, the manifest's icons or the data files are missing, or if a listed file doesn't exist. **When you add a file, add it to `FILES`.**

`app.js` also calls `navigator.storage?.persist?.()` to ask the browser not to evict the app's storage under pressure.

### Backup, export and reminders

**Export:** read every user store into `{ app, version, exportedAt, stores: { name: [...] } }`, make a `File`, and use the Web Share API where available (`navigator.canShare({ files: [file] })`), which gives the iOS share sheet ("Save to Files", AirDrop). Otherwise fall back to an `<a download>` link. Record `lastExportAt` only after success; a user closing the share sheet (`AbortError`) is not a failure and not an export.

**Import:** parse, check `app` matches and every store is an array, show a native `confirm()` naming the backup's date and record count ("Replace everything on this phone with the backup from 30 Sep 2026? It has 214 purchases."), then **replace every store in one IndexedDB transaction**, so it all lands or nothing does:

```js
export async function replaceAll(data) {
  const db = await openDb();
  const names = Object.keys(data);
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) {
    const s = tx.objectStore(name);
    s.clear();
    for (const v of data[name]) s.put(v);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Import was cancelled'));
  });
}
```

Then reload `state` from the database. On any error: "Nothing changed: ..." Backups never go in the repo (`.gitignore` them by filename pattern).

**Reminders** are not scheduled notifications. They are computed on every render of the overview by a pure engine function from the data and `today`, e.g. "due within 7 days", "unchecked for 10 days after", "within 30 days either side", "no backup for 7 days" (and never before any data exists). Each returns `{ kind, date, text }`; the list is sorted soonest first, and the UI adds one action per kind. A reminder disappears when the condition is met (the statement is entered, the backup is made), so there is nothing to dismiss or store.

### Config JSON

Rules that change outside the app live in `data/*.json`, loaded at boot. Each file has a `_meta` block:

```json
{
  "_meta": {
    "schema_version": 2,
    "description": "What this file is and what units it uses.",
    "last_verified": "2026-09-30",
    "primary_sources": ["Named source, with what and when"],
    "warnings": ["What to re-check and how often."],
    "version": 2
  },
  "items": [
    {
      "id": "stable_snake_case_id",
      "label": "Shown to the user, in the app's writing style",
      "last_verified": "2026-09-30",
      "sources": [{ "name": "Mainly Miles review", "url": "https://..." }],
      "needs_verification": true,
      "dev_notes": "Never shown. Why a value is what it is."
    }
  ]
}
```

- **`schema_version`**: one shape for every entry. The engine handles fields generically; no entry gets special-cased code.
- **`version`** (for pre-fill files): bumped when content changes, so the app knows to merge again.
- **`last_verified`** on the file and on each entry, so stale data is visible.
- **`sources`** as `{ name, url }`, shown as linked text.
- **`needs_verification: true`** marks guesses; the UI shows "Unconfirmed" where it changes an answer.
- **Time-limited entries** use `valid_from` / `valid_until`; the engine ignores them outside that window, so they can be added ahead of time.
- **`dev_notes`** for anything developer-only; all other text fields follow the writing style because the app shows them.
- Ids are stable and never reused; user data refers to config by id.
- A test (`tests/data.test.js`) validates every entry's shape, unique ids, known enum values and writing-style basics, so a typo in JSON fails `npm test` instead of breaking the app.
- If config fails to load or parse, the app shows an empty state with the error rather than a blank screen.

Engine tests use **frozen fixtures** shaped like the config (`tests/engine/fixtures.js`), not the real file, so updating a real value never breaks a maths test. Separate tests check facts about the real file.

### Pre-fill merges that never overwrite user edits

The app ships default data the user will personalise (in the source: merchants with categories). The rule: **a config update may add new entries and refresh untouched ones, but never changes anything the user edited or confirmed.**

- Each user record has `editedByHer` (call it `userEdited`) set to `true` by any edit from the UI, and a `status` saying where its data came from (in the source: `'code entered' | 'confirmed by statement' | 'reported' | 'guess'`).
- The pre-fill file has `_meta.version`. The app stores the last merged version in settings (`merchantsPrefillVersion`) and merges only when the file's version is higher.
- The merge (a pure engine function, tested):
  - entry not present → add it;
  - present and `userEdited` or a status the user owns → skip entirely;
  - present and untouched → replace the config-owned fields, keep the user's usage (counts, last used, usual choices), union list fields like aliases.
- If the pre-fill can't load (first open offline), skip and try next launch.
- A developer script can go the other way (take user answers from a backup and show a diff against config), but only prints the diff; applying it needs an explicit `--apply` after the developer approves it.

With a backend, the same rule becomes a sync rule: server-side defaults never overwrite a record the user edited.

### Testing

`node --test` with `node:assert/strict`, no test framework and no dependencies. `package.json`: `"type": "module"` and `"test": "node --test \"tests/**/*.test.js\""`. The engine is plain ES modules with no DOM, so tests import it directly.

Worth testing (in order of value):

1. **Money maths**: rounding at boundary values (4.99, 9.99, 10.00), splitting across a limit, pooled monthly totals vs per-item rounding, float drift.
2. **Dates**: cycles across month ends, 31st in February, year boundaries, "today" near midnight, days-between signs.
3. **Business rules**: each rule in the spec gets a named test, written before the UI (the spec listed them explicitly).
4. **Merges**: pre-fill never overwrites an edited record; new version adds new entries; old records normalise.
5. **Reminders and dashboard**: with `today` pinned, each window's edges (day 7 vs day 8).
6. **Config files**: shape, unique ids, enum values, cross-file references.
7. **Service worker**: the precache list covers every file (parse `FILES` from source and walk `src/`), and its behaviour: run `sw.js` in `node:vm` with fake `caches`, `clients` and `fetch`, then check a changed file is served from cache, stored, and announced, and an unchanged or first-fetched file is not.
8. **End-to-end expected outputs**: a JSON list of realistic inputs with expected results in `tests/expected/`, compared by a script, for regression.

Not worth unit testing: DOM building and CSS. Check those by running the app on a real phone.

### Deployment

GitHub Pages serving the repo root. Every path is relative (`src/app.js`, `./sw.js`, `data/cards.json`, manifest `start_url: "./"`, `scope: "./"`, `id: "./"`), so the app works under `https://<user>.github.io/<repo>/` with no config. No build step means the deployed files are the repo files. Service worker scope is the folder `sw.js` is in, so keep it at the root.

For the new app, the static front end can still deploy this way; the backend deploys separately (see below), and the front end needs its base URL in config.

### Adding a backend: what still applies

The source app has no server: IndexedDB is the only copy of the data, and backup files are the only way to move or save it. The tracker adds a small backend that syncs with the phone. Treat the phone as **local-first**: it keeps working fully offline, and sync is a background process that reconciles.

| Pattern | Status | What to do |
|---|---|---|
| IndexedDB as the app's working store, loaded into `state` at boot | Keep | Still the source of truth for the UI; the server is a sync peer. Screens never wait on the network. |
| `repo.js` as the only way to change data | Keep, extend | Every write also appends to an **outbox** store (`{ op, store, id, record, at }`) in the same transaction. A sync function drains it when online. |
| Record ids | Change if needed | Already client-generated UUIDs (`crypto.randomUUID()`), which is right for offline creation. Keep that; never let the server assign ids. |
| Timestamps | Extend | Add `updatedAt` (ms) to every record and a server-assigned revision or `serverUpdatedAt` for pulls ("give me changes since X"). |
| Deletes | Change | Hard deletes can't sync. Use soft deletes (`deletedAt`) or tombstones in the outbox; purge later. Undo becomes "clear `deletedAt`". |
| Conflicts | New | Single user, a few devices: last-write-wins per record by `updatedAt` is usually enough. Keep "user edits win over server defaults" (see pre-fill). |
| Money as integer cents | Keep, and adopt fully | Required across client, API and server DB. |
| Dates as `'YYYY-MM-DD'` strings | Keep | Store as `date` (not `timestamp`) on the server. |
| Settings as key/value rows | Split | Device settings (e.g. last export) stay local; shared preferences sync. |
| Service worker stale-while-revalidate | Keep for app files, exclude the API | Put the API on another origin or path and skip it in the fetch handler (the same-origin check already skips another origin). Never cache API responses in the app-shell cache; offline data comes from IndexedDB. |
| "Updated, tap to reload" | Keep | Also useful when the API version changes: have the API return a minimum client version and show the same notice. |
| Precache test | Keep | Unchanged. |
| No CDN, no third-party requests | Keep | The backend is yours; that's the only new origin. |
| Backup export / import | Keep, reframe | Still a user-owned copy and a way to move data. Import must go through sync (bump `updatedAt`, fill the outbox) or the server will overwrite it. The "no backup in 7 days" reminder can relax to "not synced in 7 days". |
| Import in one transaction | Keep | Same all-or-nothing rule, and include the outbox in the transaction. |
| `navigator.storage.persist()` | Keep | Less critical with a server copy, still worth asking. |
| Reminders computed from data | Keep | For push notifications, compute server-side from the same pure engine functions (share the module). |
| Engine as pure functions | Keep | Share the same files between front end and a Node backend; they have no DOM dependencies. |
| Config JSON loaded at boot | Keep, or serve from API | Static files still work and cache offline. If config moves to the API, cache it in IndexedDB so the app starts offline. |
| Auth | New | Store a long-lived token in IndexedDB, not `localStorage` (see iOS storage, below). Handle 401 by pausing sync, not by blocking the app. |
| Hosting | Split | Front end on GitHub Pages as before; API elsewhere with CORS limited to the Pages origin. |

---

## 7. Reusable files

Copy these, then make the listed edits. They contain no personal data.

| File | Reuse | Edits |
|---|---|---|
| `styles.css` | Almost all | Replace colour tokens with the blue palette (and the accent-tinted shadows and `.sheet::backdrop`). Change `.tabs` `grid-template-columns: repeat(5, 1fr)` to the new tab count. Delete the domain sections you don't use (`.answer-*`, `.cap-*`, `.pool*`, `.km`, `.disputes`, `.dispute`, `.signup`, `.statement-outcome`, `.wallet-row`, `.reorder` if unused), and update the tabular-figures selector list at the bottom to match your number classes. |
| `index.html` | Structure | App name in `<title>`, `apple-mobile-web-app-title`, description; `theme-color` values; the tab links and icons; `lang` attribute. |
| `manifest.webmanifest` | Structure | Name, short name, description, colours. |
| `sw.js` | Almost all | Rename `CACHE` (e.g. `'spend-v1'`); rewrite `FILES`. If the API is same-origin, skip its path in the fetch handler. |
| `src/app.js` | Almost all | `SCREENS` map and imports; the default screen; the load-error message; `document.title` suffix. |
| `src/ui/dom.js` | Most | Keep `h`, `fill`, `chips`, `sheet`, `toast`, `field`, `capitalize`, `money`, `sgd`. Remove `METHOD_NAMES`, `METHOD_VERBS`, `CHANNELS`, `channelsFor`, `methodPhrase`, `shortName`, `unconfirmedTag` (or keep the tag helper), `categorySelect` (rewrite for your categories). Change `money` if the currency or locale differs, and make it take cents. |
| `src/db/idb.js` | All | None. Extend `replaceAll` / `putMany` to take several stores if you add an outbox. |
| `src/db/schema.js` | Pattern | New `DB_NAME`, `STORES` and typedefs. Keep the `settings` store shape. |
| `src/db/repo.js` | Pattern only | Keep the shape: `state`, `load()`, `newId()`, `fetchJson()` with `cache: 'no-cache'`, `setSetting`, `exportData` / `importData`, the pre-fill merge flow. Replace every domain function. |
| `src/ui/backup.js` | Almost all | File name prefix, share title, toast text; the `app` value checked in `importData`. |
| `src/engine/cycles.js` | Date helpers | Keep `today`, `addDays`, `addMonths`, `daysBetween`, `formatDay`, `parse`/`format`. `cycleFor` fits monthly budgets with a custom start day; rename its fields. |
| `src/engine/rounding.js` | `toCents` / `toSgd` only | The rest is reward rounding. |
| `src/engine/dashboard.js` | `backupDue` and the `reminders` shape | Everything else is domain-specific. |
| `tests/sw.test.js` | All | The list of required shell files. |
| `tests/sw-update.test.js` | All | The test URL (`data/cards.json`) to one of your files. |
| `icons/icon.svg` | Pipeline | Redraw; export 192, 512 (also used as maskable, keep content in the centre 80%), 180 apple-touch-icon, 32 favicon. |
| `package.json` | All | `name`; drop the domain script. |
| `.gitignore` | All | Backup file pattern. |
| `CLAUDE.md` | Structure | Keep: ground rules, "check in after each stage, don't commit until asked", the service worker note, hosting note, writing style section. Replace every domain decision. |

Don't copy (specific to payment cards and rewards):

- `data/cards.json`, `data/categories.json`, `data/mcc-codes.json`, `data/merchant-mccs.json`, `data/merchants.prefill.json`, `data/last_sync.txt`
- `src/engine/earn.js`, `match.js`, `recommend.js`, `statement.js`, `merchants.js` (read the pre-fill merge in this document instead), the domain parts of `dashboard.js`
- `src/ui/which.js`, `add.js`, `overview.js`, `history.js`, `cards.js`, `merchants.js`, `statement.js` (use them only as layout references if they're sent across)
- `scripts/`, `tests/engine/*`, `tests/expected/`, `tests/purchases.json`, `tests/kiasumiles-*`, `tests/card-facts.test.js`, `tests/data.test.js`, `tests/merchant-data.test.js`
- `SPEC.md`, `docs/`
- Any backup file (`*-backup-*.json`): it holds personal data.

---

## 8. Lessons learned

### iOS and PWAs

- **Home-screen app and Safari have separate storage.** On iPhone, a site added to the home screen gets its own IndexedDB, separate from the same site in Safari. Data entered in Safari does not appear in the installed app, and vice versa. Tell the user to install first and use only the home-screen app; backup export/import is the only bridge (a server fixes this in the new app).
- **Safari can evict storage for sites not used for a while.** Home-screen apps are treated better, and `navigator.storage.persist()` helps where supported, but neither is a guarantee. This is why the backup reminder exists; with a server, sync is the real protection.
- **Safe areas need `viewport-fit=cover` and `env(safe-area-inset-*)` on every fixed or edge element**: title, main's bottom padding, tab bar, sheets, toast, update pill. Miss one and it sits under the notch or home indicator. Check on a real notched phone in both orientations.
- **Inputs under 16px make iOS zoom on focus.** Keep inputs at 17px (`--t-m`). Setting `maximum-scale=1` also works but blocks accessibility zoom; don't.
- **Use `100dvh`, not `100vh`.** Safari's toolbars change the visible height.
- **`inputmode="decimal"` on a text input, not `type="number"`** for amounts: the right keypad, no scroll-wheel changes, no locale surprises. Strip anything that isn't a digit or point on input.
- **`-webkit-tap-highlight-color: transparent`** and `-webkit-text-size-adjust: 100%`, or taps flash grey and text resizes on rotate.
- **`theme-color` metas must match `--paper`** in each scheme, and `apple-mobile-web-app-status-bar-style: default` keeps the status bar readable in both.
- **Web Share with files** is the good way to export on iOS (Save to Files, AirDrop). Closing the sheet throws `AbortError`, which is not a failure. Desktop browsers need the `<a download>` fallback.
- **Clipboard writes can be refused.** If `navigator.clipboard.writeText` throws, show the text in a sheet with it selected so the user can copy by hand.

### Service worker and updates

- **Stale app after deploy.** Without revalidation the phone runs old code indefinitely. Stale-while-revalidate plus the byte-compare notice fixed it: the user sees "Updated, tap to reload" within one launch of a deploy.
- **The browser's HTTP cache can hide new files from the worker.** Precache with `new Request(f, { cache: 'reload' })`, and fetch config with `cache: 'no-cache'`. GitHub Pages sends `max-age=600`, so without this a fresh install can pick up files up to ten minutes old.
- **Query strings break cache hits.** Match with `ignoreSearch: true`.
- **A first install is not an update.** Only show the notice on `controllerchange` if the page already had a controller, and don't announce a file that wasn't cached before.
- **Forgetting to add a new file to the precache list** means it's missing the first time the app opens offline. The precache test catches it; keep it.
- **Don't auto-reload.** The user may be mid-entry; offer the reload.
- **Offline navigation** to any in-scope URL should fall back to cached `index.html`.

### Money and rounding

- **Floating point.** `19.99 * 100` is `1998.9999999999998`. Always `Math.round` into cents first, then do integer maths.
- **Split then round, both parts down.** When an amount straddles a limit, round the whole amount the way the rule says, then split into the part under the limit and the part over, and round both down. Rounding each part "normally" can give more than the whole.
- **Pooled vs per-item rounding differ** (S$4.99 + S$9.99 + S$10.00 is S$23 rounded per item, S$24 rounded as a monthly total). If both exist, rank by the pooled figure and show the exact per-item one, and test both.
- **Money formatting needs a fixed locale** (`toLocaleString('en-SG', ...)`), or thousands separators vary by device.

### Dates and time zones

- **`new Date().toISOString().slice(0, 10)` is the UTC date**, which is yesterday for part of every morning east of UTC and tomorrow for part of every evening west of it. Build "today" from local getters.
- **`new Date('2026-09-30')` parses as UTC midnight**, and then local getters can give 29 Sep. Parse date strings by splitting and use `Date.UTC`.
- **Month-end clamping**: "the 31st" doesn't exist in most months; `addMonths('2027-01-31', 1)` must give `2027-02-28`.
- **Cycles that don't follow calendar months** (statement or pay-day cycles) need a key per cycle (`S2026-09-30`), start and end dates, and a reset date, all tested across year ends.
- **Posting delay.** Transactions can post a few days after they happen, so a purchase just before a reset may count in the next cycle. Make the delay a setting and warn inside that window.

### Data and config

- **A typo in config JSON breaks the whole app.** Validate it in tests, and show a readable error screen if loading fails.
- **Pre-fill updates overwrote user edits** until the merge got an explicit "edited by user" flag and a status. Set the flag on every UI edit, including indirect ones (changing a merchant's category while logging counts).
- **Old records lack new fields.** Normalise on load instead of assuming fields exist.
- **Copy display names into records** (a purchase stores the merchant name as well as its id) so history reads correctly after the linked record is renamed or deleted.
- **Keep a removed item selectable in edit forms** ("Card A, removed"), or saving an old record silently moves it to another item.
- **Ranking ties need a defined order** (most room left, then the user's own priority order), or results jump around between renders.
- **Uncertain data shown everywhere gets ignored.** Show "Unconfirmed" only when another plausible value would change the answer.
- **Frozen test fixtures**: engine tests broke every time real config changed until they used their own frozen copies.
- **Writing style drifts in config text.** Labels in JSON got title case and ampersands until the style guide explicitly covered config files and a test checked the basics.

### DOM without a framework

- **`element.replaceChildren(null)` inserts the text "null".** Use a `fill()` helper that drops `null`, `undefined` and `false`, and have `h()` skip them too.
- **`<dialog>` doesn't close on backdrop tap by default.** Listen for clicks whose target is the dialog itself. Remove the element on `close` and on `cancel`, or dialogs pile up in the DOM.
- **Double taps save twice.** Disable a "Paid with this"-style button on the first tap.
- **Re-rendering a whole screen resets scroll**; that's fine on tab change (the router scrolls to top on purpose) but don't re-render the screen while the user is typing in it: re-render only the results container.
- **Live results need `aria-live="polite"`** on their container, and big figures need an `aria-label` in words.

### Process

- **Write the maths tests before the interface.** Every rule in the spec had a test before any screen existed; most later bugs were in UI wiring, not maths.
- **Record decisions in CLAUDE.md as they're made**, dated, one line each, so later sessions don't re-litigate them.
- **Build in stages and check in after each one.** Don't commit or push until asked.
- **Never let a script change config automatically.** Scripts print a diff; a person approves before `--apply`.

---

## 9. How to start

1. Read this document fully.
2. Write `SPEC.md` with the user: what the tracker does, the moment of use, the screens, the data it stores, what syncs, and a list of named rules to test. Ask questions before writing code.
3. Write `CLAUDE.md`: ground rules (section 6), the stage plan, "check in after each stage, don't commit or push until asked", the writing style (section 5), and a dated "Decisions" list you add to as you go.
4. Copy the reusable files (section 7) and make their listed edits. Apply the blue palette. Update `sw.js` `FILES` and check the icons, manifest and `theme-color` values match.
5. Design the data model in `src/db/schema.js`: stores, ids (client UUIDs), money as integer cents, dates as `'YYYY-MM-DD'`, `updatedAt` and `deletedAt` on every record, an outbox store for sync. Get the user's agreement.
6. Stage 1: engine and `node --test` tests, no UI. Money, dates, budgets or cycles, reminders.
7. Stage 2: the entry screen (number pad, recent merchants, Save, Undo), then history and edit sheets. Test on a real iPhone installed to the home screen.
8. Stage 3: overview, reminders, settings, backup export and import.
9. Stage 4: the backend and sync (outbox, pull since revision, last-write-wins, soft deletes, auth token in IndexedDB), with the app still fully usable offline.
10. Stage 5: service worker, offline check (airplane mode, cold start), GitHub Pages deploy with relative paths, "Updated, tap to reload" after a second deploy.
11. Before each check-in: `npm test` passes, the precache test passes, every new string follows the writing style, and the screen works in light and dark mode on a notched phone.
