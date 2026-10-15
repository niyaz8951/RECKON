/* RECKON — db.js
   =============================================================================
   The site has no server of its own any more: GitHub Pages serves the files
   and Supabase holds the data. This file is the one place the browser talks
   to Supabase. It gives the rest of the site three things:

     TNData.db     select / first / count / insert / update / upsert / remove /
                   rpc / storage — a deliberately small surface over supabase-js,
                   so every route reads the same way and the tests can run the
                   very same routes against real Postgres (PGlite) instead.
     TNData.auth   session, sign in / up / out, password.
     TNData.route  the local router. Pages still call TN.api('/api/kept/…');
                   the handler for that path now runs here, in the browser,
                   and Postgres row-level security decides what it may touch.

   Errors come back as Error objects with .status (401 = signed out, 403 = not
   allowed, 404, 400) and a sentence a person can read. */
(function (root) {
  'use strict';

  var cfg = root.TN_CONFIG || {};
  // The site's sign-in page as a full URL, worked out from where this script
  // sits (<base>assets/js/db.js) so it is right on a GitHub project site
  // (/Reckon/login/) and on a domain of its own (/login/) alike.
  var LOGIN_URL = (function () {
    var s = root.document && root.document.currentScript;
    try { return new URL('../../login/', s && s.src ? s.src : root.location.origin + '/assets/js/').href; }
    catch (e) { return '/login/'; }
  })();
  var sb = null;
  function client() {
    if (sb) return sb;
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || /YOUR-/.test(cfg.supabaseUrl + cfg.supabaseAnonKey)) {
      throw fail('This site is not connected to Supabase yet: fill in /assets/js/config.js.', 500);
    }
    if (!root.supabase || !root.supabase.createClient) throw fail('The Supabase library did not load.', 500);
    sb = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'tn-auth' }
    });
    return sb;
  }

  function fail(message, status, extra) {
    var e = new Error(message);
    e.status = status || 400;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  /* A Supabase/PostgREST error as a sentence and a status. */
  function mapError(err) {
    var msg = String((err && (err.message || err.error_description || err.error)) || err || 'Something went wrong.');
    var code = err && err.code;
    if (code === '42501' || /row-level security|permission denied/i.test(msg)) return fail('Not allowed.', 403, { pg: msg });
    if (code === 'PGRST301' || /JWT expired|invalid JWT|not authenticated/i.test(msg)) return fail('Your session has ended. Sign in again.', 401, { signedOut: true });
    if (code === '23505') return fail('That already exists.', 409, { pg: msg });
    return fail(msg.replace(/^ERROR:\s*/, ''), err && err.status >= 400 && err.status < 600 ? err.status : 400, { pg: msg });
  }

  /* ------------------------------------------------------------- the db */
  // Primary keys, for a stable order when a long result is paged.
  var PK = { settings: 'key', migrations: 'name', audit_log: 'id' };
  var PAGE = 1000;   // PostgREST's default row cap per request

  function applyWhere(b, where) {
    Object.keys(where || {}).forEach(function (col) {
      var v = where[col];
      if (v === null) { b = b.is(col, null); return; }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.notNull) b = b.not(col, 'is', null);
        if (v.in) b = b.in(col, v.in);
        if ('neq' in v) b = b.neq(col, v.neq);
        if ('gte' in v) b = b.gte(col, v.gte);
        if ('lte' in v) b = b.lte(col, v.lte);
        if ('gt' in v) b = b.gt(col, v.gt);
        if ('lt' in v) b = b.lt(col, v.lt);
        return;
      }
      b = b.eq(col, v);
    });
    return b;
  }
  async function done(p) {
    var r = await p;
    if (r.error) throw mapError(r.error);
    return r.data;
  }

  var db = {
    /* Every matching row, paged past the 1,000-row cap. o = { columns,
       where, order: [[col, 'asc'|'desc'], …], limit }. */
    select: async function (table, o) {
      o = o || {};
      var order = (o.order || []).slice(), pk = PK[table] || 'id';
      if (!order.some(function (x) { return x[0] === pk; })) order.push([pk, 'asc']);
      var out = [], from = 0;
      for (;;) {
        var to = from + PAGE - 1;
        if (o.limit) to = Math.min(to, o.limit - 1);
        var b = client().from(table).select(o.columns || '*');
        b = applyWhere(b, o.where);
        order.forEach(function (x) { b = b.order(x[0], { ascending: x[1] !== 'desc' }); });
        var rows = await done(b.range(from, to));
        out = out.concat(rows || []);
        if (!rows || rows.length < to - from + 1 || (o.limit && out.length >= o.limit)) break;
        from = to + 1;
      }
      return out;
    },
    first: async function (table, o) {
      var rows = await db.select(table, Object.assign({}, o, { limit: 1 }));
      return rows[0] || null;
    },
    count: async function (table, where) {
      var r = await applyWhere(client().from(table).select('*', { count: 'exact', head: true }), where);
      if (r.error) throw mapError(r.error);
      return r.count || 0;
    },
    insert: function (table, rows) {
      rows = Array.isArray(rows) ? rows : [rows];
      if (!rows.length) return Promise.resolve([]);
      return done(client().from(table).insert(rows).select());
    },
    update: function (table, patch, where) {
      return done(applyWhere(client().from(table).update(patch), where).select());
    },
    upsert: async function (table, rows, opts) {
      rows = Array.isArray(rows) ? rows : [rows];
      var out = [];
      // Large imports go in slices: one request per 500 rows.
      for (var i = 0; i < rows.length; i += 500) {
        out = out.concat(await done(client().from(table).upsert(rows.slice(i, i + 500), { onConflict: (opts && opts.onConflict) || 'id' }).select()) || []);
      }
      return out;
    },
    remove: function (table, where) {
      return done(applyWhere(client().from(table).delete(), where).select());
    },
    rpc: function (fn, args) { return done(client().rpc(fn, args || {})); },
    storage: {
      upload: async function (bucket, path, body, opts) {
        var r = await client().storage.from(bucket).upload(path, body, { contentType: opts && opts.contentType, upsert: !!(opts && opts.upsert), cacheControl: '3600' });
        if (r.error) throw mapError(r.error);
        return r.data;
      },
      download: async function (bucket, path) {
        var r = await client().storage.from(bucket).download(path);
        if (r.error) throw mapError(r.error.message ? r.error : { message: 'That file is missing from storage.', status: 404 });
        return r.data;   // a Blob
      },
      list: async function (bucket, prefix) {
        var r = await client().storage.from(bucket).list(prefix || '', { limit: 1000 });
        if (r.error) throw mapError(r.error);
        return r.data;
      },
      remove: async function (bucket, paths) {
        var r = await client().storage.from(bucket).remove(paths);
        if (r.error) throw mapError(r.error);
        return r.data;
      }
    }
  };

  /* ------------------------------------------------------------- auth */
  var auth = {
    session: async function () {
      var r = await client().auth.getSession();
      return (r.data && r.data.session) || null;
    },
    signIn: async function (email, password) {
      var r = await client().auth.signInWithPassword({ email: email, password: password });
      if (r.error) throw fail(/invalid login/i.test(r.error.message) ? 'That email and password do not match.' :
        /not confirmed/i.test(r.error.message) ? 'Confirm your email first — the link is in your inbox.' : r.error.message, 401);
      return r.data.session;
    },
    signUp: async function (email, password, name) {
      var r = await client().auth.signUp({ email: email, password: password, options: { data: { name: name || '' }, emailRedirectTo: LOGIN_URL } });
      if (r.error) throw fail(/closed/i.test(r.error.message) ? 'Sign-ups are closed.' : r.error.message, 400);
      return r.data;
    },
    /* scope: 'local' (this device), 'others' (every other device), 'global'. */
    signOut: async function (scope) {
      try { await client().auth.signOut({ scope: scope || 'local' }); } catch (e) { /* signed out either way */ }
    },
    setPassword: async function (password) {
      var r = await client().auth.updateUser({ password: password });
      if (r.error) throw fail(r.error.message, 400);
    },
    onChange: function (fn) { return client().auth.onAuthStateChange(fn); }
  };

  /* ----------------------------------------------------------- router */
  var routes = [];
  /* route('GET', '/api/kept/transactions/:id', handler). The handler gets
     { method, path, params, query, body, me } and returns the JSON the page
     expects; throwing an Error with .status is how it answers an error. */
  function route(method, pattern, fn) {
    var keys = [];
    var rx = new RegExp('^' + pattern.replace(/\/:([a-z_]+)/gi, function (_, k) { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ method: method.toUpperCase(), rx: rx, keys: keys, fn: fn });
  }

  /* Who is asking: the session's user and their profile row. Cached briefly
     so a page's burst of calls costs one profile read, not ten. */
  var meCache = { at: 0, value: null };
  async function me(opts) {
    if (!opts || !opts.fresh) { if (meCache.value && Date.now() - meCache.at < 30000) return meCache.value; }
    var s = await auth.session();
    if (!s) { meCache = { at: Date.now(), value: null }; return null; }
    var p = await db.first('profiles', { where: { id: s.user.id } });
    var value = p ? { id: p.id, email: p.email, name: p.name, role: p.role, status: p.status, avatar_url: p.avatar || null, last_login_at: p.last_login_at } : null;
    meCache = { at: Date.now(), value: value };
    return value;
  }
  function forgetMe() { meCache = { at: 0, value: null }; }

  /* For routes: the signed-in, approved person, or the error the page shows. */
  async function requireUser() {
    var u = await me();
    if (!u) throw fail('Your session has ended. Sign in again.', 401, { signedOut: true });
    if (u.status !== 'active') throw fail(u.status === 'pending' ? 'This account is waiting for admin approval.' : 'This account is not active.', 403);
    return u;
  }
  async function requireAdmin() {
    var u = await requireUser();
    if (u.role !== 'admin') throw fail('Admin access required.', 403);
    return u;
  }

  async function handle(method, path, body) {
    var url = new URL(path, 'https://local.invalid');
    method = (method || 'GET').toUpperCase();
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      if (r.method !== method) continue;
      var m = r.rx.exec(url.pathname);
      if (!m) continue;
      var params = {};
      r.keys.forEach(function (k, j) { params[k] = decodeURIComponent(m[j + 1]); });
      try {
        return await r.fn({ method: method, path: url.pathname, params: params, query: url.searchParams, body: body || {}, me: requireUser, admin: requireAdmin });
      } catch (e) {
        if (e && e.status) throw e;
        throw mapError(e);
      }
    }
    throw fail('Unknown request: ' + method + ' ' + url.pathname, 404);
  }

  /* ------------------------------------------------------------ helpers */
  var now = function () { return new Date().toISOString(); };
  var newId = function (prefix) {
    var b = new Uint8Array(8);
    (root.crypto || globalThis.crypto).getRandomValues(b);
    return prefix + '_' + Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  };
  /* Best effort: an audit row never blocks the action it describes. */
  async function audit(action, target, meta) {
    try {
      var u = await me();
      if (!u) return;
      await db.insert('audit_log', { actor_id: u.id, actor_email: u.email, action: action, target: target || null, meta: meta ? JSON.stringify(meta) : null });
    } catch (e) { /* ignore */ }
  }

  root.TNData = {
    db: db, auth: auth, route: route, handle: handle, me: me, forgetMe: forgetMe,
    requireUser: requireUser, requireAdmin: requireAdmin, fail: fail, mapError: mapError,
    now: now, id: newId, audit: audit,
    /* Tests swap the backend: a PGlite client with the same interface, and a
       fake auth. Nothing in the site calls this. */
    _use: function (backend) {
      if (backend.db) { Object.keys(backend.db).forEach(function (k) { db[k] = backend.db[k]; }); }
      if (backend.auth) Object.keys(backend.auth).forEach(function (k) { auth[k] = backend.auth[k]; });
      forgetMe();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
