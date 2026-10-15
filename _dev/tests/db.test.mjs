/* assets/js/db.js over the real, vendored supabase-js: what it actually
   sends to Supabase. A recording fetch stands in for the network, answering
   like PostgREST. Checks the filter and order syntax, that long results are
   paged past PostgREST's 1,000-row cap, upsert/insert/update/delete shapes,
   and that errors come back as sentences with a status. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };

const sent = [];
let answer = () => ({ status: 200, body: [] });
async function fakeFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const headers = new Headers(init.headers || (input && input.headers) || {});
  const req = { method: (init.method || 'GET').toUpperCase(), url, path: url.pathname, params: url.searchParams, headers, body: init.body ? String(init.body) : null };
  sent.push(req);
  const a = answer(req);
  return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status, headers: { 'Content-Type': 'application/json', ...(a.headers || {}) } });
}
const ctx = { console, URL, URLSearchParams, Headers, Request, Response, FormData, Blob, AbortController, TextEncoder, TextDecoder,
  setTimeout, clearTimeout, setInterval, clearInterval, crypto: globalThis.crypto, fetch: fakeFetch, atob, btoa, structuredClone, WebSocket: globalThis.WebSocket,
  localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
  location: { origin: 'https://reckon.test', href: 'https://reckon.test/', hash: '', search: '' },
  navigator: { userAgent: 'node' } };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
ctx.TN_CONFIG = { supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'anon-test-key' };
vm.runInContext(readFileSync(resolve(ROOT, 'assets/vendor/supabase.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(resolve(ROOT, 'assets/js/db.js'), 'utf8'), ctx);
const db = ctx.TNData.db;

await t('select: filters, null checks, ranges and order become PostgREST parameters', async () => {
  sent.length = 0; answer = () => ({ status: 200, body: [{ id: 'ktx_1' }] });
  const rows = await db.select('kept_transactions', { where: { user_id: 'u1', deleted_at: null, status: { neq: 'rejected' }, d: { gte: '2026-01-01', lte: '2026-12-31' }, cat: { in: ['Food', 'Grocery'] } }, order: [['d', 'asc'], ['created_at', 'desc']] });
  eq(rows.length, 1);
  const r = sent[0], p = r.params;
  eq(r.path, '/rest/v1/kept_transactions'); eq(r.method, 'GET');
  eq(p.get('user_id'), 'eq.u1'); eq(p.get('deleted_at'), 'is.null'); eq(p.get('status'), 'neq.rejected');
  eq(p.getAll('d').sort().join('|'), 'gte.2026-01-01|lte.2026-12-31'); eq(p.get('cat'), 'in.(Food,Grocery)');
  eq(p.get('order'), 'd.asc,created_at.desc,id.asc', 'the primary key is added so paging is stable');
  eq(p.get('offset'), '0'); eq(p.get('limit'), '1000');
  eq(r.headers.get('apikey'), 'anon-test-key');
});
await t('select pages past the 1,000-row cap until a short page comes back', async () => {
  sent.length = 0;
  answer = (req) => { const off = Number(req.params.get('offset')); const n = off < 2000 ? 1000 : 250; return { status: 200, body: Array.from({ length: n }, (_, i) => ({ id: 'r' + (off + i) })) }; };
  const rows = await db.select('kept_transactions', { where: { user_id: 'u1' } });
  eq(rows.length, 2250); eq(sent.length, 3); eq(sent[2].params.get('offset'), '2000');
});
await t('select with a limit asks for exactly that many, and settings order by key', async () => {
  sent.length = 0; answer = () => ({ status: 200, body: [{ key: 'a' }] });
  await db.first('settings', { where: { key: 'a' } });
  eq(sent[0].params.get('limit'), '1'); eq(sent[0].params.get('order'), 'key.asc');
});
await t('count asks for an exact count with HEAD', async () => {
  sent.length = 0; answer = () => ({ status: 200, body: undefined, headers: { 'Content-Range': '0-0/42' } });
  eq(await db.count('profiles'), 42); eq(sent[0].method, 'HEAD'); ok(/count=exact/.test(sent[0].headers.get('prefer')));
});
await t('insert, update and delete send the right verb, body and filters, and ask for the rows back', async () => {
  sent.length = 0; answer = (req) => ({ status: req.method === 'POST' ? 201 : 200, body: [{ id: 'x' }] });
  await db.insert('kept_emis', { id: 'kemi_1', name: 'Car' });
  await db.update('kept_emis', { name: 'Car 2' }, { id: 'kemi_1', deleted_at: null });
  await db.remove('spent_days', { d: 'b1' });
  eq(sent[0].method, 'POST'); eq(JSON.parse(sent[0].body)[0].name, 'Car'); ok(/return=representation/.test(sent[0].headers.get('prefer')));
  eq(sent[1].method, 'PATCH'); eq(sent[1].params.get('id'), 'eq.kemi_1'); eq(sent[1].params.get('deleted_at'), 'is.null'); eq(JSON.parse(sent[1].body).name, 'Car 2');
  eq(sent[2].method, 'DELETE'); eq(sent[2].params.get('d'), 'eq.b1');
});
await t('upsert merges on the given conflict column and goes in slices of 500', async () => {
  sent.length = 0; answer = (req) => ({ status: 201, body: JSON.parse(req.body) });
  const rows = Array.from({ length: 1200 }, (_, i) => ({ id: 'ktx_' + i }));
  const out = await db.upsert('kept_transactions', rows, { onConflict: 'id' });
  eq(out.length, 1200); eq(sent.length, 3); eq(sent[0].params.get('on_conflict'), 'id');
  ok(/resolution=merge-duplicates/.test(sent[0].headers.get('prefer')));
  eq(JSON.parse(sent[2].body).length, 200);
});
await t('rpc calls the Postgres function by name', async () => {
  sent.length = 0; answer = () => ({ status: 200, body: null });
  await db.rpc('admin_delete_user', { target: 'u2' });
  eq(sent[0].path, '/rest/v1/rpc/admin_delete_user'); eq(JSON.parse(sent[0].body).target, 'u2');
});
await t('a row-level-security refusal is "Not allowed." with 403; an expired token is 401 signedOut', async () => {
  answer = () => ({ status: 403, body: { code: '42501', message: 'new row violates row-level security policy for table "kept_emis"' } });
  let e = null; try { await db.insert('kept_emis', { id: 'x' }); } catch (err) { e = err; }
  eq(e.status, 403); eq(e.message, 'Not allowed.');
  answer = () => ({ status: 401, body: { code: 'PGRST301', message: 'JWT expired' } });
  e = null; try { await db.select('kept_emis'); } catch (err) { e = err; }
  eq(e.status, 401); eq(e.signedOut, true);
});
await t('a missing config says so in words instead of failing obscurely', async () => {
  const c2 = { ...ctx, TN_CONFIG: { supabaseUrl: 'https://YOUR-PROJECT.supabase.co', supabaseAnonKey: 'YOUR-ANON-KEY' } };
  c2.window = c2; vm.createContext(c2);
  vm.runInContext(readFileSync(resolve(ROOT, 'assets/vendor/supabase.js'), 'utf8'), c2);
  vm.runInContext(readFileSync(resolve(ROOT, 'assets/js/db.js'), 'utf8'), c2);
  let e = null; try { await c2.TNData.db.select('profiles'); } catch (err) { e = err; }
  ok(e && /fill in \/assets\/js\/config\.js/.test(e.message), e && e.message);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
