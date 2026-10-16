# Setting up RECKON on GitHub Pages + Supabase

The site lives at **https://niyaz8951.github.io/RECKON/**: the
`niyaz8951/RECKON` repository, published by GitHub Pages, with its
data in Supabase. Each step happens in a browser, except pushing files, which
you do in GitHub Desktop.

All links in the site are relative, and the service worker registers for its
own folder. So the same files work at `/RECKON/` today, and at the
root of a custom domain later.

## 1. Supabase project (done once)

1. On https://supabase.com, open your project. If you have none yet, click
   **New project**, give it a name, and pick the region closest to you.
2. Open **SQL Editor → New query**. Paste the whole of `supabase/schema.sql`
   and click **Run**. It should end with "Success. No rows returned". You can
   run it again later; it is safe to repeat.

## 2. Sign-in addresses

Go to **Authentication → URL Configuration**:

- **Site URL**: `https://niyaz8951.github.io/RECKON/`
- **Redirect URLs**: add `https://niyaz8951.github.io/RECKON/login/`.
  For testing on your PC, also add `http://localhost:8080/login/`.

Then go to **Authentication → Sign In / Providers → Email**. Keep Email on.
**Confirm email** is your choice:

- **On:** a new account must click the link in its email before signing in.
  Supabase's built-in mailer sends only a few emails an hour, which is fine
  for a private site.
- **Off:** new accounts can sign in at once. They still need your approval.

## 3. Keys

`assets/js/config.js` already holds your project URL and anon key. The anon
key is meant to be public, because the database policies do the protecting.
**Never** put the `service_role` (secret) key in this repository.

If you ever change project:

1. Edit `config.js`.
2. Bump its `?v=` in every page.
3. Run `npm run versions`.

## 4. Push to the repository

1. Unzip over your local copy of `RECKON`.
2. Delete the files listed under "Remove" in CHANGES.md.
3. Make sure the hidden files come along. Windows Explorer hides them by
   default: turn them on with View → Show → Hidden items.
   - `.nojekyll` — stops GitHub's Jekyll step from touching the files.
   - `.gitignore` and `.gitattributes`
   - `.github/workflows/test.yml` — runs the tests on every push.
4. In GitHub Desktop, commit and push.
5. On github.com, open **Settings → Pages**:
   - **Source**: Deploy from a branch.
   - **Branch**: `main`, folder **/ (root)**.
   - **Custom domain**: must be empty. Remove it if one is set.
6. After a minute or two the push appears under **Actions**:
   - "pages build and deployment" publishes the site.
   - "tests" runs the test suite. A red cross means a test failed, but the
     site still publishes.

## 5. First sign-in

1. Open https://niyaz8951.github.io/RECKON/ and click
   **Create account**. The first account ever made becomes the **admin** and
   is active at once.
2. Sign in. Open **Account → Admin → Health**. It should show
   "Supabase database ✓" and list no problems.

Later sign-ups wait in **Admin → Users** until you approve them. In
**Admin → Settings** you can open or close sign-up, switch maintenance on, or
post an announcement.

## 6. Bring your data back

- **KEPT:** export to Excel from the old app. Then, on the new site, go to
  **Account → KEPT settings → Upload Excel**, check the preview, and confirm.
- **SPENT countdowns and Focus (16 Oct 2026, later):** run `supabase/schema.sql` once more — it adds the `goals` and `focus_sessions` tables. Until then SPENT works as before and the Countdowns list says what to run.
- **SPENT check-in (16 Oct 2026):** run `supabase/schema.sql` once more — it adds `spent_days.confirmed_at` and nothing else. Until it is run, checking in shows a message saying exactly that.
- **SPENT and DECIDED:** their tables are in the same `supabase/schema.sql`; a project set up before 15 Oct 2026 just needs the file run again (it adds what is missing and changes nothing else). `supabase/drop-library.sql` removes the old Library/Dictionary tables if you want them gone.

## 7. Renaming the repository to RECKON

GitHub → repository Settings → rename `StarsShineDown` to `RECKON`. GitHub
Pages then serves the site at `/RECKON/` (the old address redirects). Two
things to update afterwards: the Supabase Auth **Site URL** and **Redirect
URLs** (section 2) to the new address, and any home-screen install, which
is tied to the old path — remove it and add the new one.

## 8. After that

**When you change a CSS or JS file:**

1. Bump its `?v=` wherever it is referenced, including `sw.js`.
2. Bump `VERSION` in `sw.js`.
3. Run `npm run versions`, then `npm test`.
4. Commit and push.

**When you change the database:** keep `supabase/schema.sql` re-runnable. Run
it in the SQL Editor, then commit.

**When you test locally:**

```
npm install --no-save jsdom @electric-sql/pglite
npm test
npm run serve        # http://localhost:8080
```

## Things to know

- **Your github.io address is shared.** Every Pages project in your account
  lives on the same `niyaz8951.github.io` origin, so other repos you publish
  there are same-site neighbours. The site handles this:
  - The service worker caches only `/RECKON/` and deletes only its own
    caches.
  - The sign-in return link must stay inside `/RECKON/`.
  - Sign-in is kept under its own key (`tn-auth`).
- **Security is in the database.** Anyone can download the pages, but
  signed-out, pending and suspended accounts get no rows and no book files.
- **The repository is public, so the code is public.** That includes
  `supabase/` and `_dev/` once the site is served from the branch. None of it
  contains data or secret keys.
- **The free Supabase plan pauses after about a week without use**, and
  waking it means pressing **Restore** in the dashboard. It also has no
  point-in-time backup, so export KEPT to Excel now and then.
- **Book files are not cached offline.**
