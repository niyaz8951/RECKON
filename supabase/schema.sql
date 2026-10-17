-- =====================================================================
-- RECKON — Supabase schema (GitHub Pages + Supabase edition)
-- =====================================================================
-- Paste the whole file into Supabase → SQL Editor → Run. Re-runnable:
-- every table is CREATE IF NOT EXISTS, every function CREATE OR REPLACE,
-- every policy dropped and re-created, so running it again on a live
-- project adds what is missing and changes nothing else.
--
-- How the site is protected now that there is no server of its own:
--   * Every table has row-level security ON. A browser holding the public
--     anon key can read or write only what these policies allow.
--   * App rows belong to a person (user_id = auth.uid()) and are reachable
--     only while that person's account is ACTIVE (approved by an admin) and
--     the site is not in maintenance (admins excepted) — see is_active().
--   * Roles and approval live in public.profiles, one row per auth user,
--     created by a trigger at sign-up. Only an admin can change role or
--     status; a trigger enforces that even on a person's own row.
-- Money is integer minor units (fils/paise), time in minutes, dates
-- 'YYYY-MM-DD', times ISO 8601 UTC text, ids prefixed text made in the
-- browser (ktx_…, kemi_…, sday_…, dec_…).
-- =====================================================================

-- ------------------------------------------------------------ helpers
create or replace function public.now_iso() returns text
language sql stable as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- ============================================================ shared
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  name          text,
  role          text not null default 'user'    check (role in ('user', 'admin')),
  status        text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  avatar        text,                            -- data:image/jpeg;base64,… (≤ 200 KB) or null
  notes         text,
  created_at    text not null default public.now_iso(),
  updated_at    text not null default public.now_iso(),
  last_login_at text,
  constraint profiles_avatar_size check (avatar is null or length(avatar) <= 204800),
  constraint profiles_name_len check (name is null or length(name) <= 80)
);

-- Site-wide switches. Readable by anyone (the sign-up page needs the
-- sign-up mode before there is an account); written by admins.
create table if not exists public.settings (
  key        text primary key,
  value      text not null,
  updated_at text
);
insert into public.settings (key, value, updated_at) values
  ('signup_mode',  'approval', public.now_iso()),   -- approval | open | closed
  ('maintenance',  'off',      public.now_iso()),
  ('announcement', '',         public.now_iso())
on conflict (key) do nothing;

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid default auth.uid(),
  actor_email text,
  action      text not null,
  target      text,
  meta        text,
  created_at  text not null default public.now_iso()
);
create index if not exists idx_audit_created on public.audit_log(created_at);

-- Which schema files have run. Admin → Health compares this with what the
-- site expects.
create table if not exists public.migrations (
  name       text primary key,
  applied_at text not null default public.now_iso()
);

-- Who may do what. SECURITY DEFINER so they can read profiles without
-- tripping the policies on profiles itself.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and role = 'admin' and status = 'active')
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.status = 'active'
                    and (p.role = 'admin'
                         or coalesce((select value from public.settings where key = 'maintenance'), 'off') <> 'on'))
$$;

-- A new auth user gets a profile. Pending unless sign-ups are open; refused
-- outright when they are closed. The very first account becomes the active
-- admin, so a fresh project can be taken over by the person who set it up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  mode text;
  first_account boolean;
begin
  select value into mode from public.settings where key = 'signup_mode';
  select not exists (select 1 from public.profiles) into first_account;
  if coalesce(mode, 'approval') = 'closed' and not first_account then
    raise exception 'Sign-ups are closed.';
  end if;
  insert into public.profiles (id, email, name, role, status)
  values (new.id, new.email,
          nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), 80), ''),
          case when first_account then 'admin' else 'user' end,
          case when first_account or mode = 'open' then 'active' else 'pending' end);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only an admin changes role, status, email or notes — even on their own
-- row a person can change just their name, photo and last sign-in. An admin
-- cannot demote or suspend themselves (the site would lose its last admin).
-- The SQL editor (no auth.uid()) is unrestricted.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if not public.is_admin() then
      new.role := old.role; new.status := old.status; new.email := old.email; new.notes := old.notes;
    elsif old.id = auth.uid() and (new.role <> 'admin' or new.status <> 'active') then
      raise exception 'You cannot remove your own admin role or deactivate yourself.';
    end if;
  end if;
  new.updated_at := public.now_iso();
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Delete an account and everything it owns (every app row cascades from
-- profiles, which cascades from auth.users). Admins only, never yourself.
create or replace function public.admin_delete_user(target uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if target = auth.uid() then raise exception 'You cannot delete your own account here.'; end if;
  delete from auth.users where id = target;
end $$;
revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ============================================================== KEPT
create table if not exists public.kept_transactions (
  id            text primary key,                 -- ktx_…
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  d             text not null,                    -- YYYY-MM-DD
  descr         text not null,
  amount_minor  bigint not null,                  -- negative = spending
  currency      text not null default 'AED',
  cat           text not null default 'Misc',
  merchant      text,
  remark        text,                             -- emi:<id> / recurring:<id> mark posted rows
  hash          text not null,                    -- dedupe key: date|amount|description
  source        text not null default 'user',     -- user | import | system
  status        text not null default 'approved',
  supersedes_id text,
  deleted_at    text,
  created_at    text not null default public.now_iso(),
  updated_at    text not null default public.now_iso()
);
create index if not exists idx_kept_tx_user_d    on public.kept_transactions(user_id, d);
create index if not exists idx_kept_tx_user_hash on public.kept_transactions(user_id, hash);

create table if not exists public.kept_categories (
  id         text primary key,                    -- kcat_…
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name       text not null,
  icon       text not null default 'kept-misc',
  flow       text not null default 'out',
  cls        text not null default 'disc',
  sort       integer not null default 0,
  source     text not null default 'system',
  created_at text not null default public.now_iso(),
  updated_at text not null default public.now_iso()
);
create index if not exists idx_kept_cat_user on public.kept_categories(user_id, sort);

create table if not exists public.kept_emis (
  id          text primary key,                   -- kemi_…
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name        text not null,
  lender      text,
  emi_minor   bigint not null,
  currency    text not null default 'AED',
  total_n     integer not null,
  due_day     integer not null default 1,
  start_month text not null,                      -- YYYY-MM of instalment 1
  apr_bp      integer not null default 0,
  auto_post   integer not null default 1,
  post_from   text,
  source      text not null default 'user',
  status      text not null default 'approved',
  deleted_at  text,
  created_at  text not null default public.now_iso(),
  updated_at  text not null default public.now_iso()
);
create index if not exists idx_kept_emis_user on public.kept_emis(user_id);

create table if not exists public.kept_recurring (
  id           text primary key,                  -- krec_…
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  descr        text not null,
  amount_minor bigint not null,                   -- signed
  currency     text not null default 'AED',
  cat          text not null default 'Misc',
  freq         text not null default 'monthly',   -- weekly | monthly | yearly
  start_d      text not null,
  end_d        text,
  source       text not null default 'user',
  status       text not null default 'approved',
  deleted_at   text,
  created_at   text not null default public.now_iso(),
  updated_at   text not null default public.now_iso()
);
create index if not exists idx_kept_recurring_user on public.kept_recurring(user_id);

create table if not exists public.kept_budgets (
  id            text primary key,                 -- kbud_…
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  month         text not null,
  cat           text not null,
  amount_minor  bigint not null,
  currency      text not null default 'AED',
  source        text not null default 'user',
  status        text not null default 'approved', -- approved | rejected
  supersedes_id text,
  created_at    text not null default public.now_iso(),
  updated_at    text not null default public.now_iso()
);
create index if not exists idx_kept_budgets_user_month on public.kept_budgets(user_id, month);

create table if not exists public.kept_profile (
  id             text primary key,                -- kprf_…
  user_id        uuid not null unique default auth.uid() references public.profiles(id) on delete cascade,
  currency       text not null default 'AED',
  target_keep_bp integer not null default 2000,
  ramp_months    integer not null default 6,
  profile_json   text not null default '{}',
  created_at     text not null default public.now_iso(),
  updated_at     text not null default public.now_iso()
);

-- ============================================================= SPENT
-- The time ledger: one row per person per day, minutes by category in
-- blocks_json ({"sleep":450,"work":540,…}); the person's categories, fixed
-- commitments (rules) and target in profile_json.
-- v2 (coach): blocks_json may also carry "_src", where each category's
-- minutes came from (assumed | confirmed | focus | ai), and confirmed_at is
-- when the day was checked in. A day with no "_src" predates v2 and counts
-- as confirmed.
create table if not exists public.spent_days (
  id          text primary key,                   -- sday_…
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  d           text not null,                      -- YYYY-MM-DD
  blocks_json text not null default '{}',
  note        text,
  created_at  text not null default public.now_iso(),
  updated_at  text not null default public.now_iso(),
  unique (user_id, d)
);
create index if not exists idx_spent_days_user_d on public.spent_days(user_id, d);
alter table public.spent_days add column if not exists confirmed_at text;   -- ISO time of the check-in, null = not checked in

create table if not exists public.spent_profile (
  id           text primary key,                  -- sprf_…
  user_id      uuid not null unique default auth.uid() references public.profiles(id) on delete cascade,
  profile_json text not null default '{}',
  created_at   text not null default public.now_iso(),
  updated_at   text not null default public.now_iso()
);

-- Countdowns (v2, phase 2): a goal with a date, optionally an hours target
-- and a SPENT category its time is counted from. Soft-deleted.
create table if not exists public.goals (
  id          text primary key,                   -- goal_…
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title       text not null,
  due_on      text not null,                      -- YYYY-MM-DD
  start_on    text not null,                      -- YYYY-MM-DD, counting starts here
  target_min  integer,                            -- hours target in minutes; null = a date only
  cat         text,                               -- SPENT category key; null = Focus time only
  pinned      integer not null default 0,         -- 1 = takes the Today hero
  done_at     text,
  deleted_at  text,
  created_at  text not null default public.now_iso(),
  updated_at  text not null default public.now_iso()
);
create index if not exists idx_goals_user on public.goals(user_id, due_on);

-- Focus: one timed stretch on a goal or a category. ended_at null = running;
-- on stop its minutes are added to that day in spent_days (source "focus").
create table if not exists public.focus_sessions (
  id          text primary key,                   -- foc_…
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  goal_id     text,
  cat         text not null,
  d           text not null,                      -- YYYY-MM-DD the minutes count towards
  started_at  text not null,
  ended_at    text,
  minutes     integer,
  created_at  text not null default public.now_iso()
);
create index if not exists idx_focus_user on public.focus_sessions(user_id, ended_at);

-- =========================================================== DECIDED
-- The decision journal: what was decided, what was expected and how sure
-- the person was; later, what happened. Never hard-deleted (deleted_at).
create table if not exists public.decisions (
  id            text primary key,                 -- dec_…
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title         text not null,
  context       text,
  options_json  text,                             -- ["…","…"] the alternatives considered
  choice        text,
  expected      text,                             -- what the person expects to happen
  confidence    integer not null default 70,      -- 0–100, that it turns out as expected
  domain        text not null default 'life',     -- money | work | health | family | learning | life
  stakes        text not null default 'medium',   -- low | medium | high
  reversible    integer not null default 1,
  decided_on    text not null,                    -- YYYY-MM-DD
  review_on     text not null,                    -- YYYY-MM-DD, when to look back
  status        text not null default 'open',     -- open | reviewed
  outcome       text,                             -- what actually happened
  outcome_score integer,                          -- 1 (much worse) … 5 (much better than expected)
  as_expected   integer,                          -- 1 if it went as expected
  lesson        text,
  reviewed_at   text,
  deleted_at    text,
  created_at    text not null default public.now_iso(),
  updated_at    text not null default public.now_iso(),
  check (confidence between 0 and 100),
  check (outcome_score is null or outcome_score between 1 and 5)
);
create index if not exists idx_decisions_user on public.decisions(user_id, status, review_on);

-- ======================================================== v2, phase 3
-- Patterns KEPT's recurrence detector found and the person answered once:
-- confirmed (yes, it repeats), dismissed (never ask again), or reserved
-- (confirmed, and money is being set aside for the next one from
-- reserve_from). key is the normalised payee. (kept_recurring is the
-- separate table of rules that post rows on a schedule.)
create table if not exists public.kept_patterns (
  id           text primary key,                  -- kpat_…
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  key          text not null,
  status       text not null default 'confirmed', -- confirmed | dismissed | reserved
  label        text,
  freq         text,                              -- monthly | quarterly | yearly
  amount_minor bigint,                            -- the usual amount, positive
  next_d       text,                              -- YYYY-MM-DD expected next
  reserve_from text,                              -- YYYY-MM-DD the set-aside starts
  created_at   text not null default public.now_iso(),
  updated_at   text not null default public.now_iso(),
  unique (user_id, key),
  check (status in ('confirmed', 'dismissed', 'reserved'))
);

-- What the person made of each card: shown, useful, not useful, acted on.
-- A card shown and never answered counts as ignored. CardEngine decays
-- card-type scores from this, so the deck learns what this person values.
create table if not exists public.card_feedback (
  id         text primary key,                    -- cfb_…
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  app        text not null,                       -- kept | spent | decided | hub
  type       text not null,                       -- heads-up | lookback | review | import | letter
  card_key   text not null,
  verdict    text not null,                       -- shown | useful | not | acted
  d          text not null,                       -- YYYY-MM-DD
  created_at text not null default public.now_iso(),
  check (verdict in ('shown', 'useful', 'not', 'acted'))
);
create index if not exists idx_card_feedback_user on public.card_feedback(user_id, created_at);

-- ============================================================ AI (phase 4)
-- Optional, off by default (profiles.ai_on). Only the Edge Function
-- (service role) writes these two; a person can read their own rows.
alter table public.profiles add column if not exists ai_on integer not null default 0;
create table if not exists public.ai_usage (
  id         text primary key,                    -- user_id|day|task
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        text not null,                       -- YYYY-MM-DD (UTC)
  task       text not null,                       -- lesson | letter
  n          integer not null default 0,
  updated_at text not null default public.now_iso()
);
create table if not exists public.ai_cache (
  id             text primary key,                -- aic_…
  user_id        uuid not null references public.profiles(id) on delete cascade,
  task           text not null,
  key            text not null,                   -- e.g. the week a letter covers
  prompt_version text not null,
  provider       text,
  output_json    text not null,
  created_at     text not null default public.now_iso(),
  unique (user_id, task, key)
);


-- ================================================================ RLS
alter table public.profiles             enable row level security;
alter table public.settings             enable row level security;
alter table public.audit_log            enable row level security;
alter table public.migrations           enable row level security;
alter table public.kept_transactions    enable row level security;
alter table public.kept_categories      enable row level security;
alter table public.kept_emis            enable row level security;
alter table public.kept_recurring       enable row level security;
alter table public.kept_budgets         enable row level security;
alter table public.kept_profile         enable row level security;
alter table public.spent_days           enable row level security;
alter table public.spent_profile        enable row level security;
alter table public.decisions            enable row level security;
alter table public.goals                enable row level security;
alter table public.focus_sessions       enable row level security;
alter table public.kept_patterns        enable row level security;
alter table public.card_feedback        enable row level security;
alter table public.ai_usage             enable row level security;
alter table public.ai_cache             enable row level security;

-- profiles: your own row, or every row for an admin. Rows are created by
-- the sign-up trigger and deleted through admin_delete_user, never directly.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to anon, authenticated using (true);
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated
  with check (actor_id = auth.uid());
drop policy if exists audit_read on public.audit_log;
-- Your own lines, or every line for an admin. (Writing a row also reads it
-- back, so without "your own" nobody but an admin could add one.)
create policy audit_read on public.audit_log for select to authenticated using (actor_id = auth.uid() or public.is_admin());

drop policy if exists migrations_read on public.migrations;
create policy migrations_read on public.migrations for select to authenticated using (public.is_admin());

-- Every per-person table: your own rows, while your account is active.
do $$
declare t text;
begin
  foreach t in array array['kept_transactions', 'kept_categories', 'kept_emis', 'kept_recurring', 'kept_budgets',
                           'kept_profile', 'spent_days', 'spent_profile', 'decisions', 'goals', 'focus_sessions',
                           'kept_patterns', 'card_feedback'] loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using (user_id = auth.uid() and public.is_active())
                      with check (user_id = auth.uid() and public.is_active())', t || '_own', t);
  end loop;
end $$;

-- AI rows: read your own; only the Edge Function (service role, which
-- bypasses RLS) writes them, so a person cannot reset their daily cap.
do $$
declare t text;
begin
  foreach t in array array['ai_usage', 'ai_cache'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated
                      using (user_id = auth.uid() and public.is_active())', t || '_read', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select on public.settings to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

insert into public.migrations (name) values ('schema-2026-10-supabase') on conflict (name) do nothing;
insert into public.migrations (name) values ('schema-2026-10-spent-decided') on conflict (name) do nothing;
insert into public.migrations (name) values ('schema-2026-10-coach-1') on conflict (name) do nothing;
insert into public.migrations (name) values ('schema-2026-10-coach-2') on conflict (name) do nothing;
insert into public.migrations (name) values ('schema-2026-10-coach-3') on conflict (name) do nothing;
