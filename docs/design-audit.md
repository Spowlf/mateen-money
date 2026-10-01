# Design audit, 1 Oct 2026

The app checked against the design principles in `CLAUDE.md`, screen by screen in light and dark at 390 × 844, plus every rule in `styles.css`. Each item gives the file, the element, what was wrong and the fix. You asked for the fixes to go in straight away, so each one says **Fixed** or **Kept**, with the reason.

## 1. Our look is chosen, not defaulted

| File | Element | Problem | Fix |
|---|---|---|---|
| `styles.css` `.headline` | Headline card | 5px accent stripe along the top (red when negative). | **Fixed.** Stripe removed. The red figure already says "over". |
| `styles.css` `--shadow-raised` | Headline card shadow | Tinted with the accent: a blue glow in light, a light-blue glow in dark. | **Fixed.** Neutral shadow in both modes. It stays raised because it's the one answer on Log (stated in the CSS). |
| `styles.css` `.headline-quiet` | "Connect to your backend" card | Grey 5px top stripe and border. | **Fixed.** Removed. Plain surface, no shadow. |
| `styles.css` `.tabs` | Tab bar | Translucent with `backdrop-filter: blur(16px)` (glass). | **Fixed.** Solid `--paper` with the hairline. |
| `styles.css` `.pad-display .num.placeholder` | The "0" before you type | A colour mixed down to 40%, off the token set (and too faint, see 7). | **Fixed.** `--ink-2`. |
| `styles.css` `.select` | Dropdown arrow | Drawn with two `linear-gradient`s. | **Kept.** They draw a solid `--ink-2` chevron with hard stops, not a colour gradient. |

## 2. Motion only explains a change of state

| File | Element | Problem | Fix |
|---|---|---|---|
| `styles.css` `.headline` `settle` | Headline card | Faded and rose in on every redraw (each sync, each visit to Log), with a spring overshoot. | **Fixed.** Only the figure moves, and only when its value changes (`src/ui/headline.js` remembers the last figure). 0.3s ease-out, no overshoot. |
| `styles.css` `.chip`, `.key`, `.button`, `.text-button`, `.icon-button`, `.tabs svg`, `.toast-action` | Press feedback | Shrank on press (`scale(0.9)`–`0.97`) with a springy bounce. Decorative, and it makes the thing smaller (see 3). | **Fixed.** No scaling. Pressed gets a stronger background (`--accent-soft`, or `--accent-press` on primary). |
| `styles.css` `--spring` | Easing token | Overshoot curve, used only for the above. | **Fixed.** Removed. `--ease-out` replaces it. |
| `styles.css` `.sheet[open]` `rise` | Sheets | 40px rise with spring overshoot. | **Fixed.** 24px, 0.25s ease-out. It still explains where the sheet came from. |
| `styles.css` `#toast` | Toast | Spring on its slide-in. | **Fixed.** Ease-out. |
| `src/ui/log.js` `scrollIntoView` | "Go to To sort", opening the details | Smooth scrolling ignored `prefers-reduced-motion` (the CSS rule doesn't cover it). | **Fixed.** `scrollBehaviour()` in `src/ui/dom.js` jumps instead when less motion is asked for. |

Nothing loops, runs on a timer or reacts to scrolling. The global `prefers-reduced-motion` rule still turns off every animation and transition.

## 3. Nothing important hidden; pressed and hover never less prominent

| File | Element | Problem | Fix |
|---|---|---|---|
| `styles.css` `.sort-item .chips`, `src/ui/log.js` | To sort choices | One row that scrolled sideways, so "Leisure" and "Other" were off-screen behind a swipe. | **Fixed.** The row wraps; every choice is in view. The CLAUDE.md decision now says so. |
| `styles.css` `.list-row:active` | Every tappable row | Faded to 70% opacity on press. | **Fixed.** `--accent-soft` background. |
| `styles.css` `.chip:disabled` | Disabled chips | 50% opacity (text at 3.1:1). | **Fixed.** `--ink-2` text on `--paper` with a dashed border. |
| `src/ui/charts.js` | Chart tooltip | Shows on hover. | **Kept.** It also shows on tap and keyboard focus, and every value is in "Show as a table". |

## 4. Type: five styles, no repeated labels

| File | Element | Problem | Fix |
|---|---|---|---|
| `styles.css` `--t-xs` | `.synced`, `.field-hint`, `.tag`, `.chart-tip` | A second small-print size (13px) next to `--t-s` (15px). | **Fixed.** One small print, `--t-s`. The token is gone. |
| `styles.css` `.tabs a` | Tab labels | 10px, its own style. | **Fixed.** Small print. |
| `styles.css` `.badge` | To sort count on the Log tab | 11px. | **Fixed.** Small print in the number style. |
| `styles.css` `.chart .axis` | Chart axis labels | 12px. | **Fixed.** Small print. |
| `styles.css` `.day-head` (History), `.review-sub` (review card) | Day headers, "Largest purchases" | A third heading style (17px bold rounded). | **Fixed.** Body, semibold. |
| `styles.css` `.pad-display .num`, `.key` | Amount being typed, keypad | 64px and 28px, outside the scale. | **Fixed.** `--t-xxl` (56px) for the amount, section-heading size for the keys. |
| `src/ui/settings.js` `methodSub()` | Payment method sub-lines | Repeated the name: "Bank Transfer / Bank Transfer, No foreign fee", "Monzo / … Apple Pay card Monzo". | **Fixed.** The kind and the Apple Pay card are left out when they match the name. |

## 5. One look per meaning

| File | Element | Problem | Fix |
|---|---|---|---|
| `src/ui/log.js`, `src/ui/entry-sheet.js` | Spent / Received | Looked exactly like value chips. | **Fixed.** Segmented control. |
| `src/ui/overview.js` | Month / Year / Term, Academic / Calendar year | Same. | **Fixed.** Segmented control. |
| `src/ui/history.js` | Payments / Income / Merchants | Same. | **Fixed.** Segmented control. |
| `src/ui/plan.js` | Cost / Income (new recurring item) | Same. | **Fixed.** Segmented control. |
| `src/ui/log.js`, `styles.css` `.chip.suggestion` | Likely merchant in To sort | A third chip look (square corners, tinted). | **Fixed.** A normal pill chip, first in the row. |
| `styles.css` `.button.secondary`, `.button.danger`, `.text-button` | Secondary buttons | Three looks: outlined, red text, blue text. | **Fixed.** One secondary style (text, `--accent`). Danger is the same style in `--danger`. |

`segmented()` in `src/ui/dom.js` takes the same options as `chips()`, so view switches and value pickers can't drift apart again.

## 6. No generic dashboard patterns

Nothing found. There are no icon tiles, icon-plus-text grids, emoji or illustrations. Icons appear only in the tab bar, the Settings button and icon buttons, where they are the control.

## 7. Secondary text meets 4.5:1

Every text pair was measured in both modes. All passed except these:

| File | Element | Before | Fix |
|---|---|---|---|
| `styles.css` `.pad-display .num.placeholder` | "0" before you type | 1.7:1 light, 2.7:1 dark | **Fixed.** `--ink-2`: 5.9:1 light, 8.8:1 dark. |
| `styles.css` `.text-button:hover` and other `--accent` text on `--accent-soft` | Hovered or pressed text buttons, the pressed tab | 4.47:1 light | **Fixed.** Text turns `--accent-press`: 5.8:1 light, 5.0:1 dark. |
| `styles.css` `.chip:disabled` | Disabled chips | 3.1:1 light | **Fixed.** 5.9:1 light, 8.8:1 dark. |

`--ink-2` itself is 5.9–6.4:1 in light and 7.8–8.8:1 in dark on every background it sits on.

## 8. Most useful information first

| File | Element | Problem | Fix |
|---|---|---|---|
| `src/ui/overview.js` | "Leave trips out of these totals" | Sat above the totals it changes, pushing them down. | **Fixed.** Moved under the totals and the forecast. |
| `styles.css` `.empty` | Empty states (History, Plan, Overview without term dates) | 32px of empty space above the message. | **Fixed.** No space above. |

Log opens on the headline, History on its switch and search, and Plan on its totals. Overview opens on the period controls, because the figures below mean nothing without them.

## 9. Every decorative detail has a reason

| Detail | Status |
|---|---|
| Headline stripe | Removed. |
| Headline shadow | Kept, neutral: the one raised surface marks the answer. |
| "Left over" row fill (`.total-row.standout`) | Kept: it's the figure the period comes down to. Since 2026-10-01 its tint also gives its state (accent, `--warn-soft` at 80% of the budget, `--danger-soft` over), always written in its sub line. |
| Sheet, toast and tooltip shadows | Kept: they float above the page. |
| Tab bar blur | Removed. |
| Chip and button press springs | Removed. |
| Segmented control | No shadow. The chosen segment is a solid accent fill with `--on-accent` text (a spend / income switch uses `--spend` / `--income`); the others are muted `--ink-2`. Changed 2026-10-01 because the outlined surface was hard to tell apart. |

All 289 tests pass after the changes.
