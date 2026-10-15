/* Accounts on Supabase: the account and admin routes (assets/js/routes-core.js)
   against real Postgres with row-level security (PGlite + supabase/schema.sql),
   a fake of Supabase Auth's few calls, and the Account page in jsdom running
   on those same routes. Invented data; the "photo" is a 1×1 JPEG. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { freshDb, ROOT } from './_pg.mjs';

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z';

const S = await freshDb();

/* A stand-in for the handful of Supabase Auth calls the site makes. It keeps
   accounts (email → password, uid), one current session, and a record of
   sign-outs so the one-device rule can be checked. */
function fakeAuth() {
  const accounts = new Map();
  const A = {
    current: null, signOuts: [],
    async session() { return A.current ? { user: { id: A.current } } : null; },
    async signIn(email, password) {
      const a = accounts.get(email);
      if (!a || a.password !== password) { const e = new Error('That email and password do not match.'); e.status = 401; throw e; }
      A.current = a.id; return { user: { id: a.id } };
    },
    async signUp(email, password, name) {
      if (accounts.has(email)) { const e = new Error('User already registered'); e.status = 400; throw e; }
      let id;
      try { id = await S.signUp(email, name); } catch (err) { const e = new Error(/closed/i.test(err.message) ? 'Sign-ups are closed.' : err.message); e.status = 400; throw e; }
      accounts.set(email, { id, password });
      A.current = id; return { session: { user: { id } } };
    },
    async signOut(scope) { A.signOuts.push(scope || 'local'); if (scope !== 'others') A.current = null; },
    async setPassword(p) { for (const a of accounts.values()) if (a.id === A.current) a.password = p; }
  };
  return A;
}

/* Node-side: the routes in a bare global scope. */
const ctx = { crypto: globalThis.crypto, URL, URLSearchParams, console, setTimeout, Promise };
ctx.window = ctx;
const vm = await import('node:vm');
vm.createContext(ctx);
for (const f of ['assets/js/db.js', 'assets/js/routes-core.js']) vm.runInContext(readFileSync(resolve(ROOT, f), 'utf8'), ctx);
const D = ctx.TNData;
const auth = fakeAuth();
// Every query runs as whoever is signed in at the moment it is made.
const dbFor = () => S.asUser(auth.current);
const liveDb = {};
for (const k of ['select', 'first', 'count', 'insert', 'update', 'upsert', 'remove', 'rpc']) liveDb[k] = (...a) => dbFor()[k](...a);
D._use({ db: liveDb, auth });
const call2 = async (method, path, body) => { try { return { status: 200, body: await D.handle(method, path, body) }; } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };

await t('the first sign-up becomes the active admin; the next waits for approval', async () => {
  const a = await call2('POST', '/api/auth/signup', { email: 'owner@example.com', password: 'longpassword', name: 'Owner' });
  eq(a.status, 200); ok(/first account/.test(a.body.message), a.body.message);
  const b = await call2('POST', '/api/auth/signup', { email: 'asha@example.com', password: 'longpassword', name: 'Asha K' });
  ok(/approve/.test(b.body.message));
  eq((await call2('POST', '/api/auth/signup', { email: 'bad', password: 'longpassword' })).status, 400);
  eq((await call2('POST', '/api/auth/signup', { email: 'x@example.com', password: 'short' })).status, 400);
});
await t('a pending account cannot sign in, and is signed straight back out', async () => {
  const r = await call2('POST', '/api/auth/login', { email: 'asha@example.com', password: 'longpassword' });
  eq(r.status, 403); ok(/waiting for admin approval/.test(r.body.error)); eq(auth.current, null);
});
await t('the admin approves her; she signs in, and every other session of hers is ended', async () => {
  eq((await call2('POST', '/api/auth/login', { email: 'owner@example.com', password: 'longpassword' })).status, 200);
  const users = (await call2('GET', '/api/admin/users')).body.users;
  const asha = users.find((u) => u.email === 'asha@example.com');
  eq(asha.status, 'pending');
  eq((await call2('PATCH', '/api/admin/users/' + asha.id, { status: 'active' })).status, 200);
  await call2('POST', '/api/auth/logout');
  auth.signOuts.length = 0;
  const r = await call2('POST', '/api/auth/login', { email: 'asha@example.com', password: 'longpassword' });
  eq(r.status, 200); eq(r.body.user.name, 'Asha K');
  ok(auth.signOuts.includes('others'), 'one device at a time');
  ok((await S.admin('select last_login_at from public.profiles where id = $1', [asha.id]))[0].last_login_at, 'last sign-in stamped');
});
await t('a wrong password is refused with a plain sentence', async () => {
  const saved = auth.current;
  const r = await call2('POST', '/api/auth/login', { email: 'asha@example.com', password: 'nope-nope' });
  eq(r.status, 401); ok(/do not match/.test(r.body.error));
  auth.current = saved;
});
await t('profile: name trims and saves; an empty name is refused', async () => {
  const r = await call2('PUT', '/api/auth/profile', { name: '  Asha   Kapoor ' });
  eq(r.status, 200); eq(r.body.user.name, 'Asha Kapoor');
  eq((await call2('PUT', '/api/auth/profile', { name: '   ' })).status, 400);
  eq((await call2('PUT', '/api/auth/profile', {})).status, 400, 'nothing to change');
});
await t('profile: a JPEG photo is stored and comes back as avatar_url; non-images and oversized files are refused', async () => {
  const r = await call2('PUT', '/api/auth/profile', { avatar: JPEG });
  eq(r.status, 200); eq(r.body.user.avatar_url, JPEG);
  eq((await call2('GET', '/api/auth/me')).body.user.avatar_url, JPEG);
  eq((await call2('PUT', '/api/auth/profile', { avatar: 'data:text/html;base64,PGgxPg==' })).status, 400);
  eq((await call2('PUT', '/api/auth/profile', { avatar: 'data:image/jpeg;base64,' + 'A'.repeat(210 * 1024) })).status, 400);
  eq((await call2('PUT', '/api/auth/profile', { avatar: null })).body.user.avatar_url, null);
});
await t('a person cannot make themselves admin, not even by writing the row directly', async () => {
  const me = (await call2('GET', '/api/auth/me')).body.user;
  await S.asUser(me.id).update('profiles', { role: 'admin', status: 'active' }, { id: me.id });
  eq((await S.admin('select role from public.profiles where id = $1', [me.id]))[0].role, 'user');
  eq((await call2('GET', '/api/admin/users')).status, 403, 'admin routes refuse her');
});
await t('password change checks the current one, then signs out everywhere', async () => {
  auth.signOuts.length = 0;
  eq((await call2('POST', '/api/auth/password', { current_password: 'wrong-one', new_password: 'newlongpass' })).status, 403);
  // The failed check signed the fake out; sign back in for the real attempt.
  await call2('POST', '/api/auth/login', { email: 'asha@example.com', password: 'longpassword' });
  const r = await call2('POST', '/api/auth/password', { current_password: 'longpassword', new_password: 'newlongpass' });
  eq(r.status, 200); ok(auth.signOuts.includes('global')); eq(auth.current, null);
  eq((await call2('POST', '/api/auth/login', { email: 'asha@example.com', password: 'newlongpass' })).status, 200);
});
await t('admin: settings, closed sign-ups, the audit trail, and deleting an account', async () => {
  await call2('POST', '/api/auth/logout');
  await call2('POST', '/api/auth/login', { email: 'owner@example.com', password: 'longpassword' });
  eq((await call2('PATCH', '/api/admin/settings', { signup_mode: 'closed', announcement: 'Hello' })).status, 200);
  eq((await call2('GET', '/api/admin/settings')).body.settings.signup_mode, 'closed');
  eq((await call2('PATCH', '/api/admin/settings', { bogus: 1 })).status, 400);
  const saved = auth.current;
  auth.current = null;
  eq((await call2('POST', '/api/auth/signup', { email: 'late@example.com', password: 'longpassword' })).status, 403, 'closed means closed');
  auth.current = saved;
  const audit = (await call2('GET', '/api/admin/audit')).body.rows;
  ok(audit.some((a) => a.action === 'settings.update') && audit.some((a) => a.action === 'user.update'));
  const asha = (await call2('GET', '/api/admin/users')).body.users.find((u) => u.email === 'asha@example.com');
  eq((await call2('DELETE', '/api/admin/users/' + asha.id)).status, 200);
  eq((await call2('GET', '/api/admin/users')).body.users.length, 1);
  const me = (await call2('GET', '/api/auth/me')).body.user;
  eq((await call2('DELETE', '/api/admin/users/' + me.id)).status, 400, 'not yourself');
  eq((await call2('PATCH', '/api/admin/users/' + me.id, { role: 'user' })).status, 400);
  await call2('PATCH', '/api/admin/settings', { signup_mode: 'approval', announcement: '' });
});
await t('health: every expected table and both schema markers', async () => {
  const h = (await call2('GET', '/api/admin/health')).body;
  eq(h.ok, true, JSON.stringify(h.problems)); ok(h.counts.profiles >= 1); ok('decisions' in h.counts && 'spent_days' in h.counts);
});
await t('maintenance: a normal account is told, and the database gives it nothing', async () => {
  await call2('PATCH', '/api/admin/settings', { maintenance: 'on' });
  const uid = await S.signUp('maint@example.com', 'M');
  await S.admin("update public.profiles set status = 'active' where id = $1", [uid]);
  const r = await S.asUser(uid).select('kept_profile');
  eq(r.length, 0);
  let refused = false;
  try { await S.asUser(uid).insert('kept_profile', { id: 'kprf_x', user_id: uid }); } catch (e) { refused = e.status === 403; }
  ok(refused, 'writes refused during maintenance');
  await call2('PATCH', '/api/admin/settings', { maintenance: 'off' });
  await S.asUser(uid).insert('kept_profile', { id: 'kprf_x', user_id: uid });
});

/* ------------------------------------------------------------ the page */
await t('the Account page renders as a settings list on the real routes', async () => {
  const html = readFileSync(resolve(ROOT, 'account/index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://reckon.test/account/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  for (const f of ['assets/js/db.js', 'assets/js/routes-core.js']) w.eval(readFileSync(resolve(ROOT, f), 'utf8'));
  w.TNData._use({ db: liveDb, auth });
  for (const f of ['assets/js/global.js', 'assets/js/pwa.js', 'account/account.js']) w.eval(readFileSync(resolve(ROOT, f), 'utf8'));
  await tick(150);
  eq($('#hello').textContent, 'Owner'); eq($('#val-email').textContent, 'owner@example.com');
  ok($('a.list-row[href="../kept/settings/"]')); ok($('#theme-seg')); ok($('#row-pw')); ok($('#row-clear'));
  eq($('#admin-group').hidden, false, 'admin row for the admin');
  ok($('main [data-signout]'), 'sign out in Account'); ok(!$('.site-header [data-signout]'));
  eq($('#photo-slot .avatar').textContent, 'O');
  $('#row-name').click(); $('#name-in').value = 'Owner Two';
  $('#name-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(120);
  eq($('#hello').textContent, 'Owner Two'); eq((await S.admin("select name from public.profiles where email = 'owner@example.com'"))[0].name, 'Owner Two');
  eq(JSON.parse(w.localStorage.getItem('tn-user')).name, 'Owner Two', 'the header hint follows');
  for (const p of d.querySelectorAll('dialog.sheet .sheet__panel')) ok(p.firstElementChild.classList.contains('sheet__grab'));
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
