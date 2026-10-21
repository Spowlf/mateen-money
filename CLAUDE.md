# Mateen Money

A personal spending tracker for one student, in GBP. Installable web app (PWA) on GitHub Pages, with a Cloudflare Worker + D1 backend that holds all the data. `SPEC.md` is the build spec; `HANDOVER.md` is the design language and engineering approach it follows.

## Ground rules

- Front end: plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no bundler, no CSS framework, no CDN scripts or web fonts.
- The backend (Worker + D1) is the single source of truth. The phone caches the last-synced data in IndexedDB and opens offline read-only, showing "Last synced …". There is no outbox and no merging. Saving needs a connection; the Log form keeps one draft while offline.
- Three layers, one direction: `ui → db → engine`. `src/engine/` is pure (no DOM, no storage, `today`/`now` passed in) and is shared by the front end and the Worker.
- Money is integer minor units everywhere (pence for GBP; `exponent()` in `src/engine/money.js` says how many decimals a currency has). Convert from text once, on save.
- Dates are `'YYYY-MM-DD'` strings; date maths in UTC; "today" from local getters. Instants are ms timestamps.
- Never commit the API token, backups or `.dev.vars`. The token is a Worker secret and is typed into Settings on the phone.
- Build in stages. Tests for the maths before any interface. Check in with the user after each stage. **Commit and push automatically.**
- Push straight to `main`, never to a feature branch (even one a session is set up with).
- When you add a front-end file, add it to `FILES` in `sw.js` (a test checks this).

## Stages

1. Data model and engine with tests.
2. Backend: D1 schema, routes, scheduled recurring items and rates, summary endpoint, Shortcut instructions.
3. Log screen: headline, To sort, entry form, offline draft.
4. Overview.
5. Weekly review.
6. History, Plan and Settings.
7. Trips and term views.
8. PWA and deployment.
9. Accounts and balances: tables, routes, the net worth maths with tests, the Accounts screen.
10. IBKR and prices: Flex sync, price adapter and refresh, daily snapshot, `docs/ibkr.md` for the Flex Query setup.
11. Net Worth tab: total, chart, By Type, This Month, the IBKR screen.
12. Split expenses: people, splits, the Split block, History People and settle-ups.

## Commands

- `npm test`: runs every test (`node --test`, no dependencies).
- `npm run dev`: the app on http://localhost:3000 and the Worker on http://localhost:8787 (Node SQLite, data in `.dev.db`, token `dev-token`). `APP_PORT`, `API_PORT` and `DEV_DB` change the defaults; it listens on 127.0.0.1 only unless `HOST` says otherwise.

## Decisions

The dated decision log is `docs/decisions.md` (many are the user's own choices). Before changing an area's behaviour or wording, grep it for that area; add new decisions there, not here. Never undo one without asking. The ones that touch almost every change:

- The user sees "merchant" (code says `vendor`), "move" (table `transfers`), "People" for split expenses.
- Blue (`--spend`) is money out, orange (`--income`) money in, app-wide; Net Worth uses `--accent`.
- Text that repeats nearby text or explains the obvious is cut by the user's choice; don't add it back.
- Any change under `worker/` or `src/engine/` needs a Worker redeploy as well as a push.

## Writing style

Applies to every string the user sees, including notification text from the Worker.

- Title case for headers and controls: buttons (disabled ones too), field labels, chips, segments, select options, toggles and disclosure summaries ("Move Money", "Add an Account", "Paid With"). Short joining words stay lower case unless first or last (`titleCase()` in `src/engine/text.js`). Sentence case for everything that's a message: hints, toasts, warnings, small print, tags, placeholders, table and total row labels ("Left over"; Net Worth's This Month rows are the exception: "Market Moves", "Currency Moves", "Money In and Out", title case like By Type above them, with no subtitles, by the user's choice), and screen-reader-only labels. No ALL CAPS.
- Full sentences end with a period (hints, warnings, toasts that are sentences). Labels, buttons, chips, category names and titles don't.
- Use " / " for alternatives. No "&", no parentheses in names.
- Money has a currency prefix and thousands separators and always shows its decimals, prose and forecasts included: £1,000.00, £12.50, S$12.50 (an average rounds to the nearest penny). Chart axis ticks are the one exception (£500), since they mark a scale, not an amount.
- Dates as "30 Sep 2026". "Today" only for the nearest.
- Say what to do, not what went wrong: "Enter an amount above zero."
- Buttons are verbs for what happens ("Save £4.20"); disabled buttons say what's missing ("Enter an Amount").
- Errors say whether anything changed: "Nothing changed: …".
- Estimated figures carry a "~" and say how they're counted.
- Second person, short, one idea per sentence. Plain words ("Phone tap", not "NFC").

## Design principles

- Our look is chosen, not defaulted. Use only the colour tokens in styles.css; don't add gradients, glows, coloured top stripes, glass/blur or new accent colours.
- Motion only explains a change of state (e.g. the headline figure updating after a save). No looping, timed, scroll-triggered or decorative animation. Respect prefers-reduced-motion.
- Nothing important is hidden behind hover, long-press or swipe. Pressed and hover states make an element more prominent, never less.
- Type: screen title, section heading, body, small print and the number style. No other text styles, and no labels that repeat nearby text.
- One look per meaning: segmented controls for switching views, pill chips for picking values, one primary and one secondary button style.
- No generic dashboard patterns: no coloured icon tiles on stat cards, no icon-plus-text grids, no emoji, no stock illustration.
- Secondary text meets 4.5:1 contrast in light and dark mode.
- Each screen shows its most useful information first, with no decorative space above it.
- Every decorative detail must have a stated reason. If it has none, remove it.
