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
- 2026-10-01: Headline "£X left this month" = income this month (allowance share included) + recurring income still due this month − spending this month − recurring costs still due this month.
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
- 2026-10-01: To sort shows 3 payments, then "Show N more". Each has one sideways-scrolling row of choices: the likely vendor, the top 4 categories, "Other". A category tap names the new vendor with `tidyName()`.
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
- 2026-10-01: Category, payment method and income type names are title case by the user's choice ("Events and Societies", "Bank Transfer", "Friends / Family", "To Sort" in the History filter), an exception to sentence case.
- 2026-10-01: Overview has no headline card (it lives on Log only). "Left over" / "Overspent" is the stand-out row of the totals, so the big figure always matches the selected period. When the six months are all zero the chart is replaced by "Nothing logged in the last six months yet."
- 2026-10-01: Income types are Allowance / Stipend, Existing Cash, Friends / Family, Refund and Other. "Part-time work" (`work`) was dropped; `family` was renamed. Never reuse the `work` id.
- 2026-10-01: Income has no "Paid with": Log and the edit sheet hide it, the summary line leaves it out, and a manual income entry saves `methodId: null`. Apple Pay refunds keep their card.
- 2026-10-01: The service worker refreshes files with `cache: 'no-cache'` (Pages sends `max-age=600`), and the app asks it to check every file on coming back to the screen, at most once a minute, because a resumed home screen app fetches nothing.

## Writing style

Applies to every string the user sees, including notification text from the Worker.

- Sentence case everywhere. No ALL CAPS.
- Full sentences end with a period (hints, warnings, toasts that are sentences). Labels, buttons, chips, category names and titles don't.
- Use " / " for alternatives. No "&", no parentheses in names.
- Money has a currency prefix and thousands separators: £1,000, £12.50, S$12.50. Whole amounts in prose may drop the pence; amounts entered or charged keep them.
- Dates as "30 Sep 2026". "Today" only for the nearest.
- Say what to do, not what went wrong: "Enter an amount above zero."
- Buttons are verbs for what happens ("Save £4.20"); disabled buttons say what's missing ("Enter an amount").
- Errors say whether anything changed: "Nothing changed: …".
- Estimated figures carry a "~" and say how they're counted.
- Second person, short, one idea per sentence. Plain words ("Phone tap", not "NFC").
