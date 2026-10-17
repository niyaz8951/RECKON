/* RECKON — routes-core.js
   =============================================================================
   The account and admin requests every page can make, answered in the
   browser through Supabase (see db.js). Same paths and shapes as the old
   Cloudflare functions, so the pages did not have to change:

     GET  /api/auth/me            who is signed in, plus the announcement
     POST /api/auth/login         sign in; refuses pending/suspended; ends
                                  every other session (one device at a time)
     POST /api/auth/logout
     POST /api/auth/signup        new accounts wait for approval
     POST /api/auth/password      change password; signs out everywhere
     GET  /api/auth/profile       PUT { name?, avatar?, ai_on? }
     /api/admin/users[/:id]       list · PATCH { status?, role?, name?, notes? } · DELETE
     /api/admin/settings          GET · PATCH { signup_mode?, maintenance?, announcement? }
     GET  /api/admin/audit
     GET  /api/admin/health       is the Supabase project set up as the site expects?
     GET  /api/cards/feedback?app=  the last 120 days of card feedback (CardEngine)
     POST /api/cards/feedback       { app, type, card_key, verdict, d } */
(function (root) {
  'use strict';
  var D = root.TNData, db = D.db, auth = D.auth, route = D.route, fail = D.fail;

  async function setting(key, fallback) {
    try {
      var row = await db.first('settings', { where: { key: key } });
      return row ? row.value : fallback;
    } catch (e) { return fallback; }
  }

  /* --------------------------------------------------------------- auth */
  route('GET', '/api/auth/me', async function () {
    var u = await D.me({ fresh: true });
    var announcement = '', maintenance = 'off';
    if (u) { announcement = await setting('announcement', ''); maintenance = await setting('maintenance', 'off'); }
    return { user: u, announcement: announcement, maintenance: maintenance === 'on' };
  });

  route('POST', '/api/auth/login', async function (r) {
    var email = String(r.body.email || '').trim().toLowerCase(), password = String(r.body.password || '');
    if (!email || !password) throw fail('Enter your email and password.');
    await auth.signIn(email, password);
    D.forgetMe();
    var u = await D.me({ fresh: true });
    if (!u) { await auth.signOut('local'); throw fail('This account has no profile. Ask the admin to check it.', 403); }
    if (u.status === 'pending') { await auth.signOut('local'); throw fail('This account is waiting for admin approval.', 403); }
    if (u.status === 'suspended') { await auth.signOut('local'); throw fail('This account has been suspended.', 403); }
    // One live session per account: signing in here ends every other one.
    await auth.signOut('others');
    try { await db.update('profiles', { last_login_at: D.now() }, { id: u.id }); } catch (e) { /* not essential */ }
    D.audit('user.login', u.id);
    return { ok: true, user: u };
  });

  route('POST', '/api/auth/logout', async function () {
    await auth.signOut('local');
    D.forgetMe();
    return { ok: true };
  });

  route('POST', '/api/auth/signup', async function (r) {
    var email = String(r.body.email || '').trim().toLowerCase(), password = String(r.body.password || '');
    var name = String(r.body.name || '').trim().slice(0, 80);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('Enter a valid email address.');
    if (password.length < 8) throw fail('Use at least 8 characters for your password.');
    if ((await setting('signup_mode', 'approval')) === 'closed') throw fail('Sign-ups are closed.', 403);
    var res = await auth.signUp(email, password, name);
    var message = 'Thanks — an admin will approve your account. You can sign in once they have.';
    if (res && res.session) {
      // Email confirmation is off in Supabase, so sign-up signed us in. Find
      // out whether this was the first account (made admin) and then leave:
      // a pending account has nothing to do here yet.
      D.forgetMe();
      var u = await D.me({ fresh: true });
      if (u && u.status === 'active') message = u.role === 'admin' ? 'You are the first account, so you are the admin. Sign in.' : 'Your account is ready. Sign in.';
      await auth.signOut('local');
    } else {
      message = 'Check your inbox to confirm your email. After that, ' + 'an admin approves the account and you can sign in.';
    }
    D.forgetMe();
    return { ok: true, message: message };
  });

  route('POST', '/api/auth/password', async function (r) {
    var u = await r.me();
    var next = String(r.body.new_password || '');
    if (next.length < 8) throw fail('Use at least 8 characters for your new password.');
    try { await auth.signIn(u.email, String(r.body.current_password || '')); }
    catch (e) { throw fail('Your current password is not correct.', 403); }
    await auth.setPassword(next);
    D.audit('user.password_changed', u.id);
    await auth.signOut('global');
    D.forgetMe();
    return { ok: true, message: 'Password changed. Sign in again.' };
  });

  /* ------------------------------------------------------------ profile */
  var AVATAR_MAX = 200 * 1024;
  var AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

  route('GET', '/api/auth/profile', async function (r) {
    await r.me();
    return { user: await D.me({ fresh: true }) };
  });
  route('PUT', '/api/auth/profile', async function (r) {
    var u = await r.me(), b = r.body, patch = {};
    if (b.name !== undefined) {
      var name = String(b.name == null ? '' : b.name).trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!name) throw fail('Your name cannot be empty.');
      patch.name = name;
    }
    if (b.ai_on !== undefined) patch.ai_on = b.ai_on ? 1 : 0;
    if (b.avatar !== undefined) {
      if (b.avatar === null || b.avatar === '') patch.avatar = null;
      else {
        var a = String(b.avatar);
        if (a.length > AVATAR_MAX) throw fail('That photo is too large. Pick a smaller one.');
        if (!AVATAR_RE.test(a)) throw fail('That file is not a photo this page can use (JPEG, PNG or WebP).');
        patch.avatar = a;
      }
    }
    if (!Object.keys(patch).length) throw fail('Nothing to change.');
    await db.update('profiles', patch, { id: u.id });
    return { ok: true, user: await D.me({ fresh: true }) };
  });

  /* -------------------------------------------------------------- admin */
  route('GET', '/api/admin/users', async function (r) {
    await r.admin();
    var rows = await db.select('profiles', { columns: 'id,email,name,role,status,notes,created_at,last_login_at', order: [['created_at', 'asc']] });
    return { users: rows };
  });
  route('PATCH', '/api/admin/users/:id', async function (r) {
    var admin = await r.admin(), b = r.body, patch = {};
    if (b.status !== undefined) {
      if (['pending', 'active', 'suspended'].indexOf(b.status) < 0) throw fail('Bad status.');
      if (r.params.id === admin.id && b.status !== 'active') throw fail('You cannot change your own status.');
      patch.status = b.status;
    }
    if (b.role !== undefined) {
      if (['user', 'admin'].indexOf(b.role) < 0) throw fail('Bad role.');
      if (r.params.id === admin.id && b.role !== 'admin') throw fail('You cannot remove your own admin role.');
      patch.role = b.role;
    }
    if (b.name !== undefined) patch.name = String(b.name).trim().slice(0, 80) || null;
    if (b.notes !== undefined) patch.notes = String(b.notes).trim().slice(0, 500) || null;
    if (!Object.keys(patch).length) throw fail('Nothing to change.');
    var rows = await db.update('profiles', patch, { id: r.params.id });
    if (!rows.length) throw fail('No such account.', 404);
    D.audit('user.update', r.params.id, patch);
    return { ok: true };
  });
  route('DELETE', '/api/admin/users/:id', async function (r) {
    await r.admin();
    await db.rpc('admin_delete_user', { target: r.params.id });
    D.audit('user.delete', r.params.id);
    return { ok: true };
  });

  route('GET', '/api/admin/settings', async function (r) {
    await r.admin();
    var rows = await db.select('settings', { order: [['key', 'asc']] }), settings = {};
    rows.forEach(function (x) { settings[x.key] = x.value; });
    return { settings: settings };
  });
  route('PATCH', '/api/admin/settings', async function (r) {
    await r.admin();
    var allowed = { signup_mode: ['approval', 'open', 'closed'], maintenance: ['on', 'off'], announcement: null };
    var rows = [];
    Object.keys(r.body).forEach(function (key) {
      if (!(key in allowed)) throw fail('Unknown setting: ' + key);
      var v = String(r.body[key] == null ? '' : r.body[key]).trim().slice(0, 300);
      if (allowed[key] && allowed[key].indexOf(v) < 0) throw fail('Bad value for ' + key);
      rows.push({ key: key, value: v, updated_at: D.now() });
    });
    await db.upsert('settings', rows, { onConflict: 'key' });
    D.audit('settings.update', null, r.body);
    return { ok: true };
  });

  route('GET', '/api/admin/audit', async function (r) {
    await r.admin();
    return { rows: await db.select('audit_log', { order: [['created_at', 'desc']], limit: 200 }) };
  });

  /* Everything the site expects of the Supabase project. */
  var EXPECTED_TABLES = ['profiles', 'settings', 'audit_log', 'migrations',
    'kept_transactions', 'kept_categories', 'kept_emis', 'kept_recurring', 'kept_budgets', 'kept_profile',
    'spent_days', 'spent_profile', 'decisions', 'goals', 'focus_sessions', 'kept_patterns', 'card_feedback', 'ai_usage', 'ai_cache'];
  var EXPECTED_MIGRATIONS = ['schema-2026-10-supabase', 'schema-2026-10-spent-decided', 'schema-2026-10-coach-1', 'schema-2026-10-coach-2', 'schema-2026-10-coach-3'];
  route('GET', '/api/admin/health', async function (r) {
    await r.admin();
    var problems = [], counts = {}, migrations = [];
    for (var i = 0; i < EXPECTED_TABLES.length; i++) {
      var t = EXPECTED_TABLES[i];
      try { counts[t] = await db.count(t); }
      catch (e) { counts[t] = null; problems.push('table missing or unreadable: ' + t + ' — run supabase/schema.sql'); }
    }
    // Columns added by later migrations, which a count cannot see.
    try { await db.select('spent_days', { columns: 'id,confirmed_at', limit: 1 }); }
    catch (e) { if (counts.spent_days != null) problems.push('column missing: spent_days.confirmed_at — run supabase/schema.sql'); }
    try { await db.select('profiles', { columns: 'id,ai_on', limit: 1 }); }
    catch (e) { problems.push('column missing: profiles.ai_on — run supabase/schema.sql'); }
    try {
      migrations = await db.select('migrations', { order: [['applied_at', 'asc']] });
      var have = migrations.map(function (m) { return m.name; });
      EXPECTED_MIGRATIONS.forEach(function (n) { if (have.indexOf(n) < 0) problems.push('schema not applied: ' + n); });
    } catch (e) { problems.push('migrations table missing — run supabase/schema.sql'); }
    return { ok: problems.length === 0, problems: problems, counts: counts, migrations: migrations,
      bindings: { DB: true }, checked_at: D.now(),
      note: 'Counts for personal tables are your own rows: row-level security hides everyone else\'s, even from an admin.' };
  });

  /* -------------------------------------------------------------- cards */
  var APPS_ = ['kept', 'spent', 'decided', 'hub'], VERDICTS = ['shown', 'useful', 'not', 'acted'];
  function localDay(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function minusDays(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() - n); return localDay(d); }
  route('GET', '/api/cards/feedback', async function (r) {
    var u = await r.me(), app = r.query.get('app'), where = { user_id: u.id, d: { gte: minusDays(localDay(), 120) } };
    if (app) where.app = app;
    try { return { feedback: await db.select('card_feedback', { columns: 'app,type,card_key,verdict,d', where: where, order: [['created_at', 'asc']] }) }; }
    catch (e) { return { feedback: [], needsSchema: 'cards' }; }
  });
  route('POST', '/api/cards/feedback', async function (r) {
    var u = await r.me(), b = r.body;
    var app = String(b.app || ''), verdict = String(b.verdict || ''), type = String(b.type || '').slice(0, 40), key = String(b.card_key || '').slice(0, 200);
    var d = /^\d{4}-\d{2}-\d{2}$/.test(String(b.d || '')) ? b.d : localDay();
    if (APPS_.indexOf(app) < 0 || VERDICTS.indexOf(verdict) < 0 || !type || !key) throw fail('Bad card feedback.');
    // "shown" once per card per day is enough.
    if (verdict === 'shown' && await db.first('card_feedback', { where: { user_id: u.id, type: type, card_key: key, d: d, verdict: 'shown' } })) return { ok: true, already: true };
    var row = (await db.insert('card_feedback', { id: D.id('cfb'), user_id: u.id, app: app, type: type, card_key: key, verdict: verdict, d: d }))[0];
    return { ok: true, feedback: { app: row.app, type: row.type, card_key: row.card_key, verdict: row.verdict, d: row.d } };
  });

  root.TNRoutesCore = { EXPECTED_TABLES: EXPECTED_TABLES, EXPECTED_MIGRATIONS: EXPECTED_MIGRATIONS };
})(typeof window !== 'undefined' ? window : globalThis);
