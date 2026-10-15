# RECKON — the app hub

A private, sign-in-only site at https://niyaz8951.github.io/Reckon/
that hosts personal apps under one shell. Vanilla HTML/CSS/JS, no build step,
no AI.

- **Hosting:** GitHub Pages, deployed from the `main` branch (repo
  `niyaz8951/Reckon`). Every link is relative, so the site also
  works at the root of a domain without changes.
- **Data, sign-in, book files:** Supabase (Postgres with row-level security,
  Supabase Auth, a private Storage bucket).

| App | Where | What it is |
|---|---|---|
| **KEPT** | `/kept/` | Household money review: ledger, EMIs, recurring, budgets, the path to a keep-rate target, and an analysis worked out in code from your own numbers. Excel import/export. |
| **SPENT** | `/spent/` | The time ledger. Each day is 24 hours split across categories in four classes — committed (sleep, work, commute), upkeep, **yours by choice** (family, learning, exercise, friends, making), drift (screens). Keep-rate for time, "yours today" with what is still committed, the week side by side, a daily lesson, and your hours priced with KEPT's income. |
| **DECIDED** | `/decided/` | The decision journal. Log what you decided, what you expect and how sure you are; the app asks you back on the review date. Over time: calibration (does "80% sure" mean 80% for you?), Brier score, by-area accuracy, your own lessons. |

First time? Follow **SETUP.md**.

## How it fits together

There is no server code. Pages still call `TN.api('/api/...')` as before, but
those calls never leave the browser: `assets/js/db.js` keeps a small router, and
each app registers its routes there.

| File | Routes |
|---|---|
| `assets/js/routes-core.js` | `/api/auth/*`, `/api/admin/*` |
| `kept/kept-data.js` | `/api/kept/*` (maths in `kept/kept-core.js`) |
| `library/library-data.js` | `/api/library/*` |
| `spent/spent-data.js` | `/api/spent/*` (bootstrap, day, days, profile) — maths in `spent/spent-engine.js` |
| `decided/decided-data.js` | `/api/decided/*` (bootstrap, decisions, review, reopen) — maths in `decided/decided-engine.js` |

### Three apps, one shape

Each app is a folder with an engine (pure maths, tested on its own), a data
layer (the `/api/<app>/*` routes, tested against real Postgres through
PGlite), and a page that only renders and wires. KEPT and SPENT share the
same vocabulary on purpose — keep-rate, "safe to spend", a daily lesson in
your own numbers — and SPENT reads KEPT's salary to price an hour. DECIDED
is the third leg: money, time, judgement.

## Adding an app

One folder (`/<app>/`), one entry in `APPS` in `assets/js/global.js` (the home
page draws its tile from it), one `<app>-data.js` registering `/api/<app>/*`
routes, and its `<app>_*` tables added to `supabase/schema.sql` with RLS on and
an `_own` policy (the loop at the end of the schema does this for you if the
table has a `user_id` column).

## Working on it

```
npm install --no-save jsdom @electric-sql/pglite
npm test              # 19 suites: pages in jsdom, the real schema + RLS in PGlite
npm run versions      # after changing a CSS/JS file: refresh _dev/asset-versions.json
npm run serve         # http://localhost:8080 (talks to the Supabase project in config.js)
```

Every CSS/JS reference carries `?v=`. When you change a file, bump its `?v=`
everywhere it is referenced (and in `sw.js` PRECACHE), bump `VERSION` in
`sw.js`, then run `npm run versions` — the test suite fails if you forget.

Pushing to `main` publishes the site (GitHub Pages, from the branch) and runs
the tests (`.github/workflows/test.yml`); a red cross on the commit means a
test failed.

Links: write them relative in HTML (`../assets/…`), and in JS build them with
`TN.url('kept/settings/')` — never `'/kept/…'`, which would leave the
`/Reckon/` folder. The shell test fails on a root-absolute link.
