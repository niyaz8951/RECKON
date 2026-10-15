/* Real Postgres for the tests: PGlite with the Supabase stub and
   supabase/schema.sql loaded, plus a TN.db-shaped client per signed-in
   person that runs every query AS that person — role authenticated, JWT
   subject set — so row-level security is exactly what Supabase enforces.
   All data the suites put in is invented. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const ROOT = resolve(import.meta.dirname, '../..');

export async function freshDb() {
  let PGlite;
  try { ({ PGlite } = await import('@electric-sql/pglite')); }
  catch (e) { console.log('SKIP  @electric-sql/pglite not installed (npm i --no-save @electric-sql/pglite)\n0/0 passed'); process.exit(0); }
  const pg = new PGlite();
  await pg.exec(readFileSync(resolve(ROOT, '_dev/supabase-stub.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(ROOT, 'supabase/schema.sql'), 'utf8'));
  let queue = Promise.resolve();
  /* One query at a time, each inside its own transaction with the caller's
     identity set locally — PGlite is a single connection. */
  function run(sub, sql, params) {
    const job = queue.then(() => pg.transaction(async (tx) => {
      if (sub !== 'postgres') {
        await tx.query('set local role ' + (sub ? 'authenticated' : 'anon'));
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(sub ? { sub, role: 'authenticated' } : { role: 'anon' })]);
      }
      const r = await tx.query(sql, params || []);
      return r.rows.map(fixRow);
    }));
    queue = job.catch(() => {});
    return job;
  }
  /* A Supabase sign-up: the auth.users insert fires the profile trigger. */
  async function signUp(email, name) {
    const id = randomUUID();
    await run('postgres', 'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, JSON.stringify(name ? { name } : {})]);
    return id;
  }
  return { pg, run, signUp, asUser: (uid) => pgClient(run, uid), admin: (sql, p) => run('postgres', sql, p) };
}

function fixRow(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k] = typeof v === 'bigint' ? Number(v) : v;
  return o;
}

const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';

/* The same interface assets/js/db.js gives the browser over supabase-js. */
export function pgClient(run, uid) {
  function where(w, params) {
    const parts = [];
    for (const [col, v] of Object.entries(w || {})) {
      if (v === null) { parts.push(q(col) + ' is null'); continue; }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.notNull) { parts.push(q(col) + ' is not null'); continue; }
        if (v.in) { params.push(v.in); parts.push(q(col) + ' = any($' + params.length + ')'); continue; }
        const ops = { neq: '<>', gte: '>=', lte: '<=', gt: '>', lt: '<' };
        for (const [k, op] of Object.entries(ops)) if (k in v) { params.push(v[k]); parts.push(q(col) + ' ' + op + ' $' + params.length); }
        continue;
      }
      params.push(v); parts.push(q(col) + ' = $' + params.length);
    }
    return parts.length ? ' where ' + parts.join(' and ') : '';
  }
  const order = (o) => (o && o.length ? ' order by ' + o.map(([c, d]) => q(c) + (d === 'desc' ? ' desc' : ' asc')).join(', ') : '');
  const wrap = (p) => p.catch((e) => { throw mapErr(e); });
  return {
    uid,
    select(table, o = {}) {
      const params = [];
      return wrap(run(uid, 'select ' + (o.columns || '*') + ' from public.' + q(table) + where(o.where, params) + order(o.order) + (o.limit ? ' limit ' + Number(o.limit) : ''), params));
    },
    async first(table, o = {}) { return (await this.select(table, { ...o, limit: 1 }))[0] || null; },
    async count(table, w) { const params = []; return Number((await wrap(run(uid, 'select count(*) as n from public.' + q(table) + where(w, params), params)))[0].n); },
    insert(table, rows) {
      rows = Array.isArray(rows) ? rows : [rows];
      if (!rows.length) return Promise.resolve([]);
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))], params = [];
      const vals = rows.map((r) => '(' + cols.map((c) => { if (!(c in r)) return 'default'; params.push(r[c]); return '$' + params.length; }).join(',') + ')').join(',');
      return wrap(run(uid, 'insert into public.' + q(table) + ' (' + cols.map(q).join(',') + ') values ' + vals + ' returning *', params));
    },
    update(table, patch, w) {
      const params = [], sets = Object.entries(patch).map(([c, v]) => { params.push(v); return q(c) + ' = $' + params.length; });
      return wrap(run(uid, 'update public.' + q(table) + ' set ' + sets.join(', ') + where(w, params) + ' returning *', params));
    },
    upsert(table, rows, opts = {}) {
      rows = Array.isArray(rows) ? rows : [rows];
      if (!rows.length) return Promise.resolve([]);
      const conflict = (opts.onConflict || 'id').split(',').map((s) => s.trim());
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))], params = [];
      const vals = rows.map((r) => '(' + cols.map((c) => { if (!(c in r)) return 'default'; params.push(r[c]); return '$' + params.length; }).join(',') + ')').join(',');
      const upd = cols.filter((c) => !conflict.includes(c)).map((c) => q(c) + ' = excluded.' + q(c)).join(', ');
      return wrap(run(uid, 'insert into public.' + q(table) + ' (' + cols.map(q).join(',') + ') values ' + vals +
        ' on conflict (' + conflict.map(q).join(',') + ') do ' + (upd ? 'update set ' + upd : 'nothing') + ' returning *', params));
    },
    remove(table, w) { const params = []; return wrap(run(uid, 'delete from public.' + q(table) + where(w, params) + ' returning *', params)); },
    async rpc(fn, args = {}) {
      const keys = Object.keys(args), params = keys.map((k) => args[k]);
      const rows = await wrap(run(uid, 'select public.' + q(fn) + '(' + keys.map((k, i) => q(k) + ' => $' + (i + 1)).join(', ') + ') as r', params));
      return rows[0] ? rows[0].r : null;
    }
  };
}

/* Postgres errors as the browser layer reports them. */
function mapErr(e) {
  const msg = String((e && e.message) || e);
  const err = new Error(/row-level security|permission denied/i.test(msg) ? 'Not allowed.' : msg);
  err.status = /row-level security|permission denied|Admin access required/i.test(msg) ? 403 : 400;
  err.pg = msg;
  return err;
}
