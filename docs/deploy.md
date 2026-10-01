# Deploying

Three parts, in this order: the backend (Cloudflare, about 15 minutes), the app (GitHub Pages, about 5 minutes), then your iPhone. Everything fits in the free plans. The Shortcuts come last: [shortcuts.md](shortcuts.md).

# Part 1: the backend

You need this before the app can save anything.

## 1. Make a Cloudflare account

Sign up at dash.cloudflare.com. You don't need a domain or a card.

## 2. Log in from the project folder

```sh
npx wrangler login
```

This opens a browser window where you approve access. `npx` downloads Wrangler when it's needed, so the project gets no new dependencies.

## 3. Create the database

```sh
npx wrangler d1 create mateen-money
```

Copy the `database_id` it prints into `wrangler.toml`, replacing `paste-the-id-from-wrangler-d1-create`. Then create the tables:

```sh
npx wrangler d1 execute mateen-money --remote --file worker/schema.sql
```

You can run the schema again safely. It only creates what's missing.

## 4. Set the API token

Make a long random token and store it as a secret:

```sh
openssl rand -hex 32
npx wrangler secret put API_TOKEN
```

Paste the token when Wrangler asks for it. Keep a copy in your password manager. You'll type it into the app's Settings and into the two Shortcuts. Don't put it in any file in the project.

## 5. Deploy

```sh
npx wrangler deploy
```

Wrangler prints the Worker's address, like `https://mateen-money.<your-subdomain>.workers.dev`. That's the backend address for Settings and the Shortcuts.

## 6. Check it works

```sh
curl -H "Authorization: Bearer <token>" https://mateen-money.<your-subdomain>.workers.dev/summary
```

You should get a line like "Week of 28 Sep: £0.00. Nothing to sort." The first request also adds the default categories and payment methods.

# Part 2: the app on GitHub Pages

The app is plain files with no build step, so the files in the repo are the files that are served. Every path is relative, so it works under `https://spowlf.github.io/<repo>/`.

## 1. Check nothing private goes up

Free GitHub Pages needs a public repo. `.gitignore` already leaves out `.dev.vars`, the local database and backup or CSV files. Before your first push, run `git status` and check that none of those are listed. The token is never in the repo; it lives in the Worker and on your phone.

## 2. Make the repo and push

On github.com, make a new public repo, for example `mateen-money`, with nothing in it. Then, in the project folder:

```sh
git init -b main
git add .
git commit -m "Mateen Money"
git remote add origin https://github.com/spowlf/mateen-money.git
git push -u origin main
```

## 3. Turn on Pages

In the repo on GitHub, go to **Settings → Pages**. Under "Build and deployment", pick **Deploy from a branch**, then branch `main` and folder `/ (root)`. Save.

After a minute or two the app is at `https://spowlf.github.io/mateen-money/`. The `.nojekyll` file tells Pages to serve the files as they are.

## 4. Check the backend accepts the app

`wrangler.toml` sets `ALLOWED_ORIGIN = "https://spowlf.github.io"`. That's the address without the repo folder. If your GitHub username isn't `spowlf`, change it and run `npx wrangler deploy` again. Otherwise the app can't reach the backend.

# Part 3: your iPhone

1. Open the app's address in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open Mateen Money from the home screen, not from Safari. The home-screen app keeps its own copy of your data, separate from Safari's.
4. Tap the gear icon, enter the backend address and the token, and tap **Connect**.
5. In Settings, enter your term dates and plan your yearly allowance.

To check it works offline: open the app once while online, turn on Airplane Mode, close the app fully and open it again. It should open with "Last synced …" under the title. You can't save while offline, but the Log screen keeps what you typed until you're back online.

## Updating the app

Push to `main`. Pages publishes the new files within a few minutes. The next time you open the app, or come back to it after a minute away, it shows "Updated, tap to reload". Tap it to switch to the new version; otherwise it switches the time after.

If you delete or rename a file, also change the `CACHE` name at the top of `sw.js` (for example `mateen-money-v4`), so phones drop the old copy.

Backend changes go out separately, with `npx wrangler deploy`.

# Running it on your Mac

The quickest way is `npm run dev`: the app on http://localhost:3000 and a local backend on http://localhost:8787 (token `dev-token`), with no Cloudflare account needed.

To run the real Worker locally instead:

1. Create `.dev.vars` with `API_TOKEN=any-local-token`. Git ignores this file.
2. Set up a local database:

   ```sh
   npx wrangler d1 execute mateen-money --local --file worker/schema.sql
   npx wrangler dev
   ```

3. To test the scheduled job locally, run `npx wrangler dev --test-scheduled` and open `http://localhost:8787/__scheduled`.

The tests don't need any of this. `npm test` runs the Worker against Node's built-in SQLite.

# Changing the schema later

Add new columns with `ALTER TABLE` statements in a new file, for example `worker/migrations/002-….sql`. Run it with `d1 execute --remote --file`. Also add the column to `worker/src/tables.js`. A test checks the two match.
