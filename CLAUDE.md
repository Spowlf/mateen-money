# Mateen Money

A personal spending tracker for one student, in GBP. Installable web app (PWA) on GitHub Pages, with a Cloudflare Worker + D1 backend that holds all the data. `SPEC.md` is the build spec; `HANDOVER.md` is the design language and engineering approach it follows.

## Ground rules

- Front end: plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no bundler, no CSS framework, no CDN scripts or web fonts.
- The backend (Worker + D1) is the single source of truth. The phone caches the last-synced data in IndexedDB and opens offline read-only, showing "Last synced …". There is no outbox and no merging. Saving needs a connection; the Log form keeps one draft while offline.
- Three layers, one direction: `ui → db → engine`. `src/engine/` is pure (no DOM, no storage, `today`/`now` passed in) and is shared by the front end and the Worker.
- Money is integer minor units everywhere (pence for GBP; `exponent()` in `src/engine/money.js` says how many decimals a currency has). Convert from text once, on save.
- Dates are `'YYYY-MM-DD'` strings; date maths in UTC; "today" from local getters. Instants are ms timestamps.
- Never commit the API token, backups or `.dev.vars`. The token is a Worker secret and is typed into Settings on the phone.
- Build in stages. Tests for the maths before any interface. Check in with the user after each stage. **Don't commit or push until asked.**
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

## Commands

- `npm test`: runs every test (`node --test`, no dependencies).
- `npm run dev`: the app on http://localhost:3000 and the Worker on http://localhost:8787 (Node SQLite, data in `.dev.db`, token `dev-token`). `APP_PORT`, `API_PORT` and `DEV_DB` change the defaults.

## Decisions

- 2026-10-01: Allowance is one lump sum a year, entered net of rent, spread evenly over Oct–Sep. Rent is never logged. Savings are not tracked.
- 2026-10-01: The Log headline is one figure. With a monthly budget it's what's left of the budget ("£X left in this month's budget" = budget − spending − recurring costs still due, or "£X over budget this month"), the number the user is trying to stick to. Without one it's "£X left this month" = income this month (allowance share included) + recurring income still due this month − spending this month − recurring costs still due this month. With a budget, the month's income gets a warning line only when it runs out first ("Only £X of this month's income is left…") or nothing has come in yet (`incomeCheckLine`). Every other "left" figure is named for what it is (Overview: "Left over").
- 2026-10-01: The Overview "leave trips out" toggle affects Overview totals only; the headline always counts everything.
- 2026-10-01: Term dates start blank; the user enters them in Settings.
- 2026-10-01: Rates come from Frankfurter (ECB), fetched by the Worker, never by the phone. An entry's GBP value is "estimated" until its date has passed and that date's rate is stored.
- 2026-10-01: Foreign-currency fee is basis points per payment method (299 = 2.99%), applied to foreign-currency payments only (income is converted with no fee), stored separately as `feePence` and included in `gbpPence`.
- 2026-10-01: Field names are camelCase in JS, JSON and D1 columns alike, so rows need no mapping.
- 2026-10-01: The currency symbol table and default categories live in `src/engine/` (not config JSON) because the Worker imports them too and they rarely change.
- 2026-10-01: Zero-decimal currencies come from a fixed list in `money.js`, not `Intl`, so the phone and the Worker always agree.
- 2026-10-01: The review week is this week on Sunday and last week Monday to Saturday. The weekly summary endpoint and the review card use the same week.
- 2026-10-01: A recurring item's `nextDate` advances only when its entry is added, so the "still due" figures never double count.
- 2026-10-01: Every write bumps one `rev` counter in the same D1 batch as the rows, so `GET /sync?since=rev` can never skip a change. Writes reply `{ rev, changes }`.
- 2026-10-01: The Worker prices every entry (it holds the rates) and fetches a missing rate on save. Worker tests use a D1 stand-in on `node:sqlite`, so no Cloudflare account is needed until deployment.
- 2026-10-01: A Wallet card seen for the first time becomes a payment method, so ambiguous symbols can be remembered per card. A negative Apple Pay amount is logged as a refund (income).
- 2026-10-01: An ambiguous symbol's first guess is a currency that can hold the amount's decimals ("¥12.50" guesses CNY, "¥1,200" JPY), so re-reading it as another currency never loses pence. An ambiguous refund waits in To sort for its currency only.
- 2026-10-01: Sorting one To sort item also sorts the other waiting items from the same merchant.
- 2026-10-01: A manual entry counts for duplicate detection too, so logging by hand before the Apple Pay payment arrives doesn't double count.
- 2026-10-01: Settings holds only the backend address and token until the Settings stage, because nothing saves without them. Connecting checks them with a full sync first; a different address replaces the local copy.
- 2026-10-01: On Log, the category question appears under the vendor only for a new vendor (or one with no category). A known vendor's choices show in the summary line. The details (date, time, currency, paid with, category, trip) stay folded under it until "Change" (or "More" in the category question) opens them, and fold again after saving.
- 2026-10-01: To sort shows 3 payments, then "Show N more". Each has one short row of choices that fits a phone line: the likely vendor and 1 category, or 2 categories, then "More" (the sort sheet). Categories follow the merchant (`suggestCategories` in `src/engine/sort.js`): similar known merchants' categories, then a hint from words in its name (`MERCHANT_HINTS`, "Stagecoach" → Transport), then the most used. A category tap names the new vendor with `tidyName()`.
- 2026-10-01: Undo after saving deletes the entry and puts what was typed back under a new id (the old id is now a deleted row).
- 2026-10-01: Overview periods are a month, a year (academic or calendar, the synced `yearMode`) or a term. A year or term in progress runs to the end of this month, not today, so spread income counts this month's full share as the month view does.
- 2026-10-01: "Change vs last month" for the month in progress compares with the same days of last month ("12% more than by this point in September"), never with all of it.
- 2026-10-01: The weekly review card sits between the headline and To sort. It starts folded (one line and "Review the week"), so it never pushes the keypad far down. Its steps are sort (only while To sort isn't empty, skippable), the week, anything unusual, then "Done", which saves a review row with the week's Monday as its id.
- 2026-10-01: Chart colours: spending `--series-1` (blue), income `--series-2` (orange), To sort grey. Checked with the dataviz validator in both modes. Every chart value is also text (the category table, or "Show as a table").
- 2026-10-01: Settings is a screen (`#settings`, from the header icon), not a sheet or a tab: too long for a sheet, too rarely used for a tab. Each item is edited in its own sheet.
- 2026-10-01: History has a Payments / Income / Merchants switch. Payments is spending only (category, paid with and trip filters); Income is income only, filtered by type. The search is shared. A To sort payment opens the sort sheet; any other opens the edit sheet. Vendor aliases are edited in the vendor sheet.
- 2026-10-01: Editing a payment teaches its vendor only the choices that changed, so fixing an old payment never brings back an old category. Renaming a vendor keeps the old name as an alias; deleting one deletes its aliases, and Undo brings them back.
- 2026-10-01: Removing a category archives it (kept for old payments, "Bring back" in Settings). Category order is the `sort` field, moved with ↑ / ↓.
- 2026-10-01: Backup is JSON of every live row, made after a sync. Restore is `POST /restore`: one D1 batch deletes every live row and writes the backup's rows under one rev, so the phone's next sync pulls it and it's all-or-nothing. It asks first with `confirm()`.
- 2026-10-01: A recurring item with a past date is not added on save; the Plan sheet warns that the next run (within 6 hours) catches it up.
- 2026-10-01: Term dates are kept per academic year (`{ id, name, year, start, end }`, only dated terms stored; the academic year starts in October and its last term ends in June; Michaelmas 2026 starts 7 Oct, entered by the user, not pre-filled). Settings edits one year at a time; Overview steps term by term across years and shows "£X a week".
- 2026-10-01: Teaching ends in June, but the allowance spread and the Overview academic year stay Oct–Sep: the summer counts in the year before it.
- 2026-10-01: The icon is a white £ drawn as paths on accent blue, full bleed, so one 512 PNG also serves as the maskable icon. PNGs are exported from `icons/icon.svg` with headless Chrome.
- 2026-10-01: Front end on GitHub Pages from the repo root of `main` (`.nojekyll`, all paths relative). Deploy steps are in `docs/deploy.md`.
- 2026-10-01: "Plan your yearly allowance" leaves the date blank: only the user knows when it arrives.
- 2026-10-01: Cash on hand before the allowance arrives is logged once as income, type "Existing Cash" (`cash`, one-off: never a recurring item). It counts in full in the month it's logged and doesn't carry over; savings are still not tracked. While nothing has come in this month, the headline says so and suggests logging it.
- 2026-10-01: The user sees "merchant", never "vendor" (labels, hints, Worker notifications, CSV header). Code, tables and fields keep the `vendor` names, so no migration.
- 2026-10-01: Only spending joins a trip (never income). Adding, redating, deleting or restoring a trip re-files the payments on its days in the same write; ones whose trip was set by hand never move. A payment still pointing at a deleted trip counts as ordinary spending.
- 2026-10-01: Default categories are the user's own list, alphabetical with Other last. Old default ids are never reused.
- 2026-10-01: Short confirmation toasts start with a past-tense verb and have no period ("Saved term dates", "Deleted Pret"). Toasts with a full sentence end with one.
- 2026-10-01: "Today" on the Worker is in the synced `timeZone` setting (default Europe/London, one-tap "Use this phone's time zone" in Settings): it adds recurring items and sets the app's review week. The weekly summary Shortcut POSTs the phone's ISO time with its offset, and that date picks the week. Payment dates still come from the phone.
- 2026-10-01: Log asks for an optional "Description" right under the merchant (the `note` field; "Description" in the edit sheet and CSV too).
- 2026-10-01: Category, payment method and income type names are title case by the user's choice ("Events and Societies", "Bank Transfer", "Friends / Family", "To Sort" wherever it's named, "Monthly Budget"), an exception to sentence case. So are headers: screen titles, section headings and sheet titles ("Spending by Category", "At This Pace", "Edit Payment", "No Payments Yet"), with short joining words lower case (a, and, by, for, in, of, the, to). Term names follow Cambridge style too: "Michaelmas Term 2026", "Lent Term", "Easter Term".
- 2026-10-01: Overview has no headline card (it lives on Log only). "Left over" / "Overspent" is the stand-out row of a finished period's totals, so the big figure always matches the selected period. The income and spending chart covers the selected period: a month or a term week by week (a month's weeks start on the 1st, 8th, 15th, 22nd and 29th; a term has 8 Cambridge weeks, Thursday to Wednesday, from its first Thursday, with any term days before or after them in week 1 or week 8), a year month by month, with steps still to come left empty (`periodSeries` in `src/engine/overview.js`). When it's all zero it's replaced by "Nothing logged in … yet."
- 2026-10-01: Overview period labels never say "so far" ("2026–27", "Michaelmas Term 2026"), and neither do the "Spent" rows (period or trip, running or not). The income and spending chart has no "Week by week." / "Month by month." caption: its axis and table say the steps.
- 2026-10-01: Category bars are meters: the track is all the period's spending and the fill the category's share (a share of the budget was dropped: under "Spending by Category" a share reads as a share of spending), so 1% looks like 1%. A pie was asked about and turned down: 15 categories would need 15 new colours.
- 2026-10-01: Income types are Allowance / Stipend, Existing Cash, Friends / Family, Refund and Other. "Part-time work" (`work`) was dropped; `family` was renamed. Never reuse the `work` id.
- 2026-10-01: Income has no "Paid with": Log and the edit sheet hide it, the summary line leaves it out, and a manual income entry saves `methodId: null`. Apple Pay refunds keep their card.
- 2026-10-01: The service worker refreshes files with `cache: 'no-cache'` (Pages sends `max-age=600`), and the app asks it to check every file on coming back to the screen, at most once a minute, because a resumed home screen app fetches nothing.
- 2026-10-01: Safe to spend today = the headline (budget left, or income left without a budget) ÷ days left, today included, so it always counts trips. It's worded as a limit ("To stay within budget, spend no more than £X a day."), never as the pace or a target ("Spend up to £X" read as an invitation to spend it). "Over by £X this month." shows only without a budget (a budget headline already says "over budget"). The Overview trips toggle only keeps trip spending out of the forecast's daily rate; trip spending still counts in its "spent so far". Logic in `src/engine/forecast.js`.
- 2026-10-01: The forecast projects day-to-day spending (no recurring items) over the days after today, since today's spending is already counted. Days 1–7 blend this month's average with the 8 weeks before the month, weighted d/7, so day 7 is this month alone.
- 2026-10-01: A trip booking (spending filed under a live trip but dated outside it) never sets the forecast or budget pace, whatever the trips toggle: a one-off isn't a daily rate. It still counts in spent so far, the headline and its own month.
- 2026-10-01: One overall monthly budget, no category budgets (the user's choice, replacing per-category budgets): the part of the month's money they mean to spend. It is the Log headline when set; it shows on Overview and in the review too. When the pace goes over it, every place says so the same way: "£X over at this pace", "At this pace: £X over your £650.00 budget for October.", and At This Pace compares with the budget ("£X over budget" / "£X under budget"), never "On track for" or "to spare". A `budgets` row sets it from `fromMonth` on (id `month:YYYY-MM`, `categoryId` `'month'`, so no migration; old category rows are ignored); a change writes this month's row so past months keep theirs; `amountPence` 0 removes it. Logic in `src/engine/budgets.js`.
- 2026-10-01: Everything counts against the budget: recurring costs (still due ones as used), trips and trip bookings. The trips toggle only keeps them out of the pace, as for the month forecast.
- 2026-10-01: No home-screen widget, by the user's choice. A Scriptable widget can't open the home-screen app (iOS gives it no link) or handle a tap itself, and opening Safari instead was not wanted.
- 2026-10-01: Statement import (not built yet) gets presets for the user's banks: DBS and Revolut (Singapore), HSBC (UK). It waits for the user's sample CSVs; build it all in one go then, presets included, and don't guess a bank's format without its sample.
- 2026-10-01: The design principles below win over HANDOVER.md where they differ: no spring or press-scale motion (pressed = a stronger background), a neutral raised shadow with no top stripe, no tab bar blur, one small-print size (`--t-s`), segmented controls for view switches (Spent / Received, Cost / Income, Month / Year / Term, Academic Year / Calendar Year, Payments / Income / Merchants), and text-style secondary buttons (danger is the same in red). The audit is in `docs/design-audit.md`.
- 2026-10-01: 2026–27 is the user's last year at Cambridge, so only Easter 2026 to Easter 2027 are offered (`FIRST_TERM` / `LAST_TERM` in `src/engine/terms.js`). Overview's term arrows stop there, and Settings edits 2025–26 (Easter Term only) and 2026–27.
- 2026-10-01: Blue is money out and orange money in, app-wide, not just in charts. `--spend` / `--income` are the exact `--series-1` / `--series-2` colours and are used for fills, meters and segment fills, with `--on-spend` / `--on-income` ink that meets 4.5:1 on them (dark ink, white on the light-mode blue). Amounts use `--spend-text` / `--income-text`, the same hues shifted to meet 4.5:1 as text (light #2B63D9 / #B9461A, dark #6AA6F2 / #EE7D4A). The `-soft` versions (~15%) are washes for pressed and hover states. Income amounts keep their "+" and spending its label, so colour is never the only signal. The Spent / Received and Cost / Income switches (`segmented({ className: 'kind-switch' })`) fill the chosen side in its colour, and Log tints the typed amount, with a 150 ms colour transition.
- 2026-10-01: The chosen segment of every other segmented control is a solid accent fill with `--on-accent` text; the rest are muted (`--ink-2`).
- 2026-10-01: Categories get line icons, not colours (`categoryIcon()` in `src/ui/dom.js`, one per default id, a tag for added categories, plus `to-sort` and `income`). They're neutral (`--ink-2`, or the chip's text colour when it's chosen) and show on History rows, inside the History category filter (beside the picked category, since a native select can't draw icons per option) and in every category picker.
- 2026-10-01: Spending by Category on Overview shows the top five categories, then one row for the real Other plus the rest ("Other + 3 more categories", `foldCategories` in `src/ui/charts.js`), with every category under "Show all categories". To Sort keeps its own grey row. Every meter is the one spending blue: no shades, since each row is labelled.
- 2026-10-01: Overview's stand-out row is income minus spending for a finished period: "Left over", or "Overspent" (`--danger-soft`, solid) when spending is over income. A period in progress has no such row (it was "Income not yet spent", a second "left" figure beside the Log headline), so its totals are Spent and Income. It never shows the budget's state ("Within budget" beside an over-budget pace contradicted it); the Budget section does.
- 2026-10-01: The iOS status bar is `black-translucent`, whose text is always white. A fixed strip `env(safe-area-inset-top)` tall (`body::before`, `--status-bar`) sits behind it: the page colour in dark mode, dark ink in light mode, so the white text is always readable and nothing scrolls under it. Switching the meta from a script by colour scheme was turned down without a device test: the CSP blocks inline scripts, and iOS is understood to read the meta when the home screen app launches, not after a script changes it.
- 2026-10-01: A category is unusual in the review when it's more than 50% and at least £15.00 above its usual week (`UNUSUAL_MIN_EXTRA`), so a tiny usual doesn't flag every week. The line says pounds, not a percentage ("Gifts: £35.00, £31.00 more than your usual £4.00.").
- 2026-10-01: Warnings (`.warning`) sit on the surface they're in with a 3px `--warn` rule at the start, not an amber fill: the fill looked muddy on the dark card. The design principles' "no coloured top stripes" is about cards; this rule marks a warning.
- 2026-10-01: Cut-back tips are facts the engine finds (`findHabits` in `src/engine/habits.js`): over the 4 weeks to the review week's Sunday, a merchant 8 times or more, or 8 or more buys under £5.00 in one category, either adding up to £20.00. Recurring costs and live trips don't count. They show in the review's "anything unusual" step, and the biggest one goes in the weekly summary. The app never claims a saving (it can't see prices); an optional "Use Model" step in the Sunday Shortcut adds a suggestion on the phone. No AI runs in the app or the Worker.

## Writing style

Applies to every string the user sees, including notification text from the Worker.

- Sentence case everywhere except headers (title case, see Decisions) and the names listed there. No ALL CAPS.
- Full sentences end with a period (hints, warnings, toasts that are sentences). Labels, buttons, chips, category names and titles don't.
- Use " / " for alternatives. No "&", no parentheses in names.
- Money has a currency prefix and thousands separators and always shows its decimals, prose and forecasts included: £1,000.00, £12.50, S$12.50 (an average rounds to the nearest penny). Chart axis ticks are the one exception (£500), since they mark a scale, not an amount.
- Dates as "30 Sep 2026". "Today" only for the nearest.
- Say what to do, not what went wrong: "Enter an amount above zero."
- Buttons are verbs for what happens ("Save £4.20"); disabled buttons say what's missing ("Enter an amount").
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
