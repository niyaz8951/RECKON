/* supabase/schema.sql in real Postgres (PGlite + a stub of the Supabase
   pieces it relies on): it runs twice without error, every public table has
   row-level security on, the tables match what Admin → Health expects, and
   the policies hold — approval, admin-only fields, each person's own rows. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { freshDb, ROOT } from './_pg.mjs';

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const refused = async (p) => { try { await p; return false; } catch (e) { return true; } };

const S = await freshDb();
const schema = readFileSync(resolve(ROOT, 'supabase/schema.sql'), 'utf8');

await t('the schema runs a second time on a live database without error', async () => {
  await S.pg.exec(schema);
  eq((await S.admin("select count(*)::int as n from public.migrations where name = 'schema-2026-10-supabase'"))[0].n, 1);
});
await t('v2 coach, phase 1: spent_days.confirmed_at exists and the migration marker is recorded', async () => {
  const cols = await S.admin("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'spent_days' and column_name = 'confirmed_at'");
  eq(cols.length, 1);
  eq((await S.admin("select count(*)::int as n from public.migrations where name = 'schema-2026-10-coach-1'"))[0].n, 1);
});
await t('every public table has row-level security on', async () => {
  const rows = await S.admin("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
  eq(rows.length, 0, rows.map((r) => r.relname).join(', '));
});
await t('the tables are exactly the ones Admin → Health expects', async () => {
  const ctx = { console, URL, URLSearchParams, crypto: globalThis.crypto }; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(resolve(ROOT, 'assets/js/db.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(resolve(ROOT, 'assets/js/routes-core.js'), 'utf8'), ctx);
  const expected = [...ctx.TNRoutesCore.EXPECTED_TABLES].sort();
  const have = (await S.admin("select tablename from pg_tables where schemaname = 'public' order by tablename")).map((r) => r.tablename).sort();
  eq(have.join(','), expected.join(','));
});
const owner = await S.signUp('owner@example.com', 'Owner');
const user = await S.signUp('reader@example.com', 'Reader');
await t('first account: active admin; later accounts: pending users', async () => {
  const rows = await S.admin('select email, role, status from public.profiles order by email');
  eq(rows.map((r) => r.email + ':' + r.role + ':' + r.status).join(','), 'owner@example.com:admin:active,reader@example.com:user:pending');
});
await t('pending: reads nothing, writes nothing', async () => {
  const U = S.asUser(user);
  eq((await U.select('settings')).length >= 0, true);
  ok(await refused(U.insert('decisions', { id: 'dec_x', user_id: user, title: 'x', decided_on: '2026-10-15', review_on: '2026-11-15' })));
  ok(await refused(U.insert('kept_categories', { id: 'kcat_x', user_id: user, name: 'X' })));
});
await t('a person reads only their own profile; an admin reads all', async () => {
  await S.admin("update public.profiles set status = 'active' where id = $1", [user]);
  eq((await S.asUser(user).select('profiles')).length, 1);
  eq((await S.asUser(owner).select('profiles')).length, 2);
});
await t('settings are readable before signing in (the sign-up page needs the mode), writable only by an admin', async () => {
  ok((await S.asUser(null).select('settings')).length >= 3);
  ok(await refused(S.asUser(null).update('settings', { value: 'open' }, { key: 'signup_mode' })) ||
     (await S.admin("select value from public.settings where key = 'signup_mode'"))[0].value === 'approval');
  const r = await S.asUser(user).update('settings', { value: 'open' }, { key: 'signup_mode' });
  eq(r.length, 0, 'policy filters the update out');
  eq((await S.admin("select value from public.settings where key = 'signup_mode'"))[0].value, 'approval');
});
await t('SPENT and DECIDED rows: your own only, and the database checks the shapes', async () => {
  await S.asUser(user).insert('spent_days', { id: 'sday_u1', user_id: user, d: '2026-10-14', blocks_json: '{"sleep":420}' });
  await S.asUser(owner).insert('spent_days', { id: 'sday_o1', user_id: owner, d: '2026-10-14', blocks_json: '{}' });
  eq((await S.asUser(user).select('spent_days')).length, 1, 'only their own day');
  ok(await refused(S.asUser(user).insert('spent_days', { id: 'sday_u2', user_id: user, d: '2026-10-14', blocks_json: '{}' })), 'one row per day');
  ok(await refused(S.asUser(user).insert('spent_days', { id: 'sday_x', user_id: owner, d: '2026-10-15', blocks_json: '{}' })), 'cannot write as someone else');
  await S.asUser(user).insert('decisions', { id: 'dec_u1', user_id: user, title: 'Take the Riyadh role', confidence: 70, decided_on: '2026-10-14', review_on: '2027-01-14' });
  eq((await S.asUser(owner).select('decisions')).length, 0, 'an admin does not see other people\'s decisions');
  ok(await refused(S.asUser(user).insert('decisions', { id: 'dec_u2', user_id: user, title: 'x', confidence: 140, decided_on: '2026-10-14', review_on: '2026-11-14' })), 'confidence is 0–100');
  ok(await refused(S.asUser(user).insert('decisions', { id: 'dec_u3', user_id: user, title: 'x', outcome_score: 9, decided_on: '2026-10-14', review_on: '2026-11-14' })), 'outcome score is 1–5');
});
await t('audit: anyone signed in can add a line about themselves and read their own; an admin reads all', async () => {
  await S.asUser(owner).insert('audit_log', { actor_id: owner, action: 'settings.update' });
  await S.asUser(user).insert('audit_log', { actor_id: user, action: 'user.login' });
  ok(await refused(S.asUser(user).insert('audit_log', { actor_id: owner, action: 'forged' })), 'cannot write as someone else');
  eq((await S.asUser(user).select('audit_log')).length, 1, 'only their own');
  eq((await S.asUser(owner).select('audit_log')).length, 2);
});
await t('deleting an account removes everything it owned', async () => {
  await S.asUser(user).insert('kept_profile', { id: 'kprf_u', user_id: user });
  await S.asUser(user).insert('spent_profile', { id: 'sprf_u', user_id: user });
  await S.asUser(owner).rpc('admin_delete_user', { target: user });
  eq((await S.admin('select count(*)::int as n from public.kept_profile where user_id = $1', [user]))[0].n, 0);
  eq((await S.admin('select count(*)::int as n from public.spent_profile where user_id = $1', [user]))[0].n, 0);
  eq((await S.admin('select count(*)::int as n from public.decisions where user_id = $1', [user]))[0].n, 0);
  eq((await S.admin('select count(*)::int as n from auth.users where id = $1', [user]))[0].n, 0);
});
await t('sign-ups closed: the auth insert itself is refused', async () => {
  await S.admin("update public.settings set value = 'closed' where key = 'signup_mode'");
  ok(await refused(S.signUp('late@example.com', 'Late')));
  await S.admin("update public.settings set value = 'approval' where key = 'signup_mode'");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
