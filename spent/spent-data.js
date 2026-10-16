/* SPENT — the data layer.
   =============================================================================
   Every /api/spent/* request the page makes, answered in the browser
   against Supabase through TNData.db. Row-level security keeps each
   person to their own rows.

     GET /api/spent/bootstrap            { profile, days: [{d, blocks, src, note, confirmed_at}], today }
     GET /api/spent/days?from=&to=       { days }
     PUT /api/spent/day                  { d, blocks:{cat: minutes}, src?:{cat: source}, confirmed?, note? } -> { day }
     PUT /api/spent/profile              { cats?, rules?, target_bp?, weekend? } -> { profile }
     POST /api/spent/goals               { title, due_on, target_min?, cat?, pinned? } -> { goal }
     PUT /api/spent/goals/:id            same, plus done?, restore? -> { goal }
     DELETE /api/spent/goals/:id         soft delete -> { ok }
     POST /api/spent/focus/start         { goal_id?, cat } -> { session }   (the running one, if any)
     POST /api/spent/focus/stop          { id, discard? } -> { session, day }

   Bootstrap also carries goals, recent Focus sessions and the running one.
   Stopping a session adds its minutes to that day with source "focus";
   if that would pass 24 hours, assumed minutes make room first.

   A day is one row per date (unique user_id + d); minutes per category in
   blocks_json, with "_src" beside them saying where each came from
   (assumed | confirmed | focus | ai). `confirmed: true` is a check-in: it
   stamps confirmed_at. A row written before v2 has no "_src" and comes back
   with src: null, which the engine reads as confirmed. Profile (categories,
   usual-day rules, target) is one JSON row per person. */
(function (root) {
  'use strict';
  var D = root.TNData, db = D.db, route = D.route, fail = D.fail, E = root.SpentEngine;
  var now = D.now, newId = D.id;

  function parseJson(s, fb) { try { var v = JSON.parse(s || ''); return v == null ? fb : v; } catch (e) { return fb; } }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s)); }

  async function ensureProfile(u) {
    var row = await db.first('spent_profile', { where: { user_id: u.id } });
    if (!row) {
      try { row = (await db.insert('spent_profile', { id: newId('sprf'), user_id: u.id, profile_json: '{}' }))[0]; }
      catch (e) { row = await db.first('spent_profile', { where: { user_id: u.id } }); if (!row) throw e; }
    }
    return E.profileOf(parseJson(row.profile_json, {}));
  }
  function shapeDay(row) {
    var raw = parseJson(row.blocks_json, {}), src = null, blocks = {};
    Object.keys(raw).forEach(function (k) { if (k === '_src') { if (raw._src && typeof raw._src === 'object') src = raw._src; } else blocks[k] = raw[k]; });
    return { d: row.d, blocks: blocks, src: src, note: row.note || '', confirmed_at: row.confirmed_at || null, updated_at: row.updated_at };
  }
  function cleanSrc(src, prof) {
    var out = {}, cm = E.catMap(prof);
    Object.keys(src || {}).forEach(function (k) { if (cm[k] && E.SRC.indexOf(src[k]) !== -1) out[k] = src[k]; });
    return out;
  }
  /* The one write that a not-yet-migrated project refuses: say what to do. */
  function schemaHint(e) {
    if (/confirmed_at/.test(String((e && (e.pg || e.message)) || ''))) return fail('RECKON has been updated: run supabase/schema.sql once in Supabase (SQL editor) to add the check-in column.', 503);
    return e;
  }
  async function days(u, from, to) {
    var where = { user_id: u.id };
    if (from) where.d = { gte: from };
    if (to) where.d = Object.assign(where.d || {}, { lte: to });
    var rows = await db.select('spent_days', { where: where, order: [['d', 'asc']] });
    return rows.map(shapeDay);
  }

  route('GET', '/api/spent/bootstrap', async function (r) {
    var u = await r.me();
    var today = E.iso(new Date());
    var prof = await ensureProfile(u);
    var out = { profile: prof, days: await days(u, E.addDays(today, -120), null), today: today, goals: [], focus: { active: null, recent: [] } };
    // Countdowns and Focus need schema-2026-10-coach-2. Without it the rest
    // of SPENT still works; the page says what to run.
    try {
      out.goals = (await db.select('goals', { where: { user_id: u.id, deleted_at: null }, order: [['due_on', 'asc']] })).map(shapeGoal);
      var fs = await db.select('focus_sessions', { where: { user_id: u.id, d: { gte: E.addDays(today, -120) } }, order: [['started_at', 'asc']] });
      out.focus.recent = fs.filter(function (x) { return x.ended_at; }).map(shapeFocus);
      var act = await db.first('focus_sessions', { where: { user_id: u.id, ended_at: null }, order: [['started_at', 'desc']] });
      out.focus.active = act ? shapeFocus(act) : null;
    } catch (e) { out.needsSchema = 'goals'; }
    return out;
  });

  /* --------------------------------------------------------- countdowns */
  function shapeGoal(g) {
    return { id: g.id, title: g.title, due_on: g.due_on, start_on: g.start_on, target_min: g.target_min == null ? null : Number(g.target_min),
      cat: g.cat || null, pinned: !!Number(g.pinned), done_at: g.done_at || null, deleted_at: g.deleted_at || null, updated_at: g.updated_at };
  }
  function goalPatch(b, prof, partial) {
    var p = {};
    if (!partial || b.title != null) {
      var t = String(b.title || '').trim().slice(0, 80);
      if (!t) throw fail('Give the goal a name.');
      p.title = t;
    }
    if (!partial || b.due_on != null) {
      var due = String(b.due_on || '').slice(0, 10);
      if (!isDate(due)) throw fail('Pick a date for the goal.');
      p.due_on = due;
    }
    if (b.target_min !== undefined) {
      var m = b.target_min === null || b.target_min === '' ? null : Math.round(Number(b.target_min));
      if (m != null && (!(m > 0) || m > 600000)) throw fail('Hours must be more than zero (and under 10,000).');
      p.target_min = m;
    }
    if (b.cat !== undefined) {
      if (b.cat !== null && b.cat !== '' && !E.catMap(prof)[b.cat]) throw fail('That category is not in your SPENT list.');
      p.cat = b.cat || null;
    }
    if (b.pinned !== undefined) p.pinned = b.pinned ? 1 : 0;
    return p;
  }
  async function unpinOthers(u, keepId) {
    var pinned = await db.select('goals', { where: { user_id: u.id, pinned: 1 } });
    for (var i = 0; i < pinned.length; i++) if (pinned[i].id !== keepId) await db.update('goals', { pinned: 0 }, { id: pinned[i].id, user_id: u.id });
  }
  route('POST', '/api/spent/goals', async function (r) {
    var u = await r.me(), b = r.body || {}, prof = await ensureProfile(u), ts = now();
    var p = goalPatch(b, prof, false);
    var row = Object.assign({ id: newId('goal'), user_id: u.id, start_on: E.iso(new Date()), target_min: null, cat: null, pinned: 0, created_at: ts, updated_at: ts }, p);
    var out = (await db.insert('goals', row))[0];
    if (out.pinned) await unpinOthers(u, out.id);
    return { ok: true, goal: shapeGoal(out) };
  });
  route('PUT', '/api/spent/goals/:id', async function (r) {
    var u = await r.me(), b = r.body || {}, prof = await ensureProfile(u);
    var cur = await db.first('goals', { where: { id: r.params.id, user_id: u.id } });
    if (!cur || (cur.deleted_at && !b.restore)) throw fail('That goal is gone.', 404);
    var p = goalPatch(b, prof, true);
    if (b.done !== undefined) p.done_at = b.done ? now() : null;
    if (b.restore) p.deleted_at = null;
    p.updated_at = now();
    var out = (await db.update('goals', p, { id: cur.id, user_id: u.id }))[0];
    if (out.pinned) await unpinOthers(u, out.id);
    return { ok: true, goal: shapeGoal(out) };
  });
  route('DELETE', '/api/spent/goals/:id', async function (r) {
    var u = await r.me();
    var cur = await db.first('goals', { where: { id: r.params.id, user_id: u.id, deleted_at: null } });
    if (!cur) throw fail('That goal is gone.', 404);
    await db.update('goals', { deleted_at: now(), pinned: 0, updated_at: now() }, { id: cur.id, user_id: u.id });
    return { ok: true };
  });

  /* -------------------------------------------------------------- focus */
  var FOCUS_CAP = 600;   // a forgotten timer counts as ten hours at most
  function shapeFocus(x) { return { id: x.id, goal_id: x.goal_id || null, cat: x.cat, d: x.d, started_at: x.started_at, ended_at: x.ended_at || null, minutes: x.minutes == null ? null : Number(x.minutes) }; }
  route('POST', '/api/spent/focus/start', async function (r) {
    var u = await r.me(), b = r.body || {}, prof = await ensureProfile(u);
    var running = await db.first('focus_sessions', { where: { user_id: u.id, ended_at: null } });
    if (running) return { ok: true, session: shapeFocus(running), already: true };
    var goal = null;
    if (b.goal_id) {
      goal = await db.first('goals', { where: { id: String(b.goal_id), user_id: u.id, deleted_at: null } });
      if (!goal) throw fail('That goal is gone.', 404);
    }
    var cat = (goal && goal.cat) || b.cat;
    if (!cat || !E.catMap(prof)[cat]) throw fail('Pick what the time is for.');
    var row = { id: newId('foc'), user_id: u.id, goal_id: goal ? goal.id : null, cat: cat, d: E.iso(new Date()), started_at: now(), created_at: now() };
    return { ok: true, session: shapeFocus((await db.insert('focus_sessions', row))[0]) };
  });
  route('POST', '/api/spent/focus/stop', async function (r) {
    var u = await r.me(), b = r.body || {}, prof = await ensureProfile(u);
    var cur = await db.first('focus_sessions', { where: { id: String(b.id || ''), user_id: u.id } });
    if (!cur) throw fail('That session is gone.', 404);
    if (cur.ended_at) return { ok: true, session: shapeFocus(cur), day: null };
    if (b.discard) { await db.remove('focus_sessions', { id: cur.id, user_id: u.id }); return { ok: true, session: null, day: null, discarded: true }; }
    var ts = now();
    var minutes = Math.max(0, Math.min(FOCUS_CAP, Math.round((Date.parse(ts) - Date.parse(cur.started_at)) / 60000)));
    var sess = (await db.update('focus_sessions', { ended_at: ts, minutes: minutes }, { id: cur.id, user_id: u.id }))[0];
    var day = minutes > 0 ? await addFocus(u, prof, cur.d, cur.cat, minutes) : null;
    return { ok: true, session: shapeFocus(sess), day: day };
  });
  /* Add measured minutes to a day: the category becomes "focus" (or stays
     "confirmed" if the person had already said so), and if the day would
     pass 24 hours, assumed minutes shrink to make room. */
  async function addFocus(u, prof, d, cat, minutes) {
    var row = await db.first('spent_days', { where: { user_id: u.id, d: d } });
    var raw = row ? parseJson(row.blocks_json, {}) : {}, legacy = row && !raw._src;
    var src = raw._src && typeof raw._src === 'object' ? cleanSrc(raw._src, prof) : {};
    var blocks = E.cleanBlocks(raw, prof);
    blocks[cat] = (blocks[cat] || 0) + minutes;
    var day = { blocks: blocks, src: legacy ? null : src, confirmed_at: row ? row.confirmed_at : null };
    if (!legacy && E.srcOf(day, cat) !== 'confirmed') src[cat] = 'focus';
    var over = E.total(blocks) - E.DAY;
    if (over > 0) {
      var soft = Object.keys(blocks).filter(function (k) { return k !== cat && E.srcOf(day, k) === 'assumed'; });
      var sum = soft.reduce(function (a, k) { return a + blocks[k]; }, 0);
      soft.forEach(function (k) { blocks[k] = Math.max(0, Math.round(blocks[k] * Math.max(0, sum - over) / sum / 5) * 5); if (!blocks[k]) delete blocks[k]; });
      over = E.total(blocks) - E.DAY;
      if (over > 0) blocks[cat] = Math.max(0, blocks[cat] - over);
    }
    var stored = legacy ? blocks : Object.assign({}, blocks, { _src: src });
    var ts = now(), out;
    if (row) out = (await db.update('spent_days', { blocks_json: JSON.stringify(stored), updated_at: ts }, { id: row.id, user_id: u.id }))[0];
    else out = (await db.insert('spent_days', { id: newId('sday'), user_id: u.id, d: d, blocks_json: JSON.stringify(stored), note: '', created_at: ts, updated_at: ts }))[0];
    return shapeDay(out);
  }

  route('GET', '/api/spent/days', async function (r) {
    var u = await r.me(), q = r.query;
    var from = q.get('from') || null, to = q.get('to') || null;
    if ((from && !isDate(from)) || (to && !isDate(to))) throw fail('Dates must be YYYY-MM-DD.');
    return { days: await days(u, from, to) };
  });

  route('PUT', '/api/spent/day', async function (r) {
    var u = await r.me(), b = r.body || {};
    var d = String(b.d || '').slice(0, 10);
    if (!isDate(d)) throw fail('Date must be YYYY-MM-DD.');
    if (d > E.addDays(E.iso(new Date()), 1)) throw fail('That day has not happened yet.');
    var prof = await ensureProfile(u);
    var blocks = E.cleanBlocks(b.blocks, prof);
    if (E.total(blocks) > E.DAY) throw fail('A day has 24 hours; these add up to ' + E.hm(E.total(blocks)) + '.');
    var note = b.note == null ? null : String(b.note).slice(0, 500);
    var ts = now();
    var existing = await db.first('spent_days', { where: { user_id: u.id, d: d } });
    // Sources: what the page says, else what the row already said. An old
    // page sends none and writes a pre-v2 shaped row, which reads as confirmed.
    var stored = b.src && typeof b.src === 'object' ? Object.assign({}, blocks, { _src: cleanSrc(b.src, prof) })
      : existing && parseJson(existing.blocks_json, {})._src ? Object.assign({}, blocks, { _src: cleanSrc(parseJson(existing.blocks_json, {})._src, prof) })
      : blocks;
    var patch = { blocks_json: JSON.stringify(stored), note: note, updated_at: ts };
    if (b.confirmed === true) patch.confirmed_at = ts;
    var row;
    try {
      if (existing) row = (await db.update('spent_days', patch, { id: existing.id, user_id: u.id }))[0];
      else {
        try { row = (await db.insert('spent_days', Object.assign({ id: newId('sday'), user_id: u.id, d: d, created_at: ts }, patch)))[0]; }
        catch (e) {
          var again = await db.first('spent_days', { where: { user_id: u.id, d: d } });
          if (!again) throw e;
          row = (await db.update('spent_days', patch, { id: again.id, user_id: u.id }))[0];
        }
      }
    } catch (e) { throw schemaHint(e); }
    return { ok: true, day: shapeDay(row) };
  });

  route('PUT', '/api/spent/profile', async function (r) {
    var u = await r.me(), b = r.body || {};
    var cur = await ensureProfile(u);
    var next = Object.assign({}, cur);
    if (Array.isArray(b.cats)) {
      var seen = {};
      next.cats = b.cats.map(function (c) {
        var key = String(c && c.key || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
        return { key: key, name: String(c && c.name || key).slice(0, 40), cls: c && c.cls, icon: String(c && c.icon || 'clock').slice(0, 30) };
      }).filter(function (c) { if (!c.key || seen[c.key]) return false; seen[c.key] = true; return true; });
      if (!next.cats.some(function (c) { return c.key === 'sleep'; })) throw fail('Sleep stays — a day is measured from it.');
      if (next.cats.length < 3 || next.cats.length > 24) throw fail('Between 3 and 24 categories.');
    }
    if (b.rules && typeof b.rules === 'object') {
      next.rules = { weekday: cleanRule(b.rules.weekday, next), weekend: cleanRule(b.rules.weekend, next) };
    }
    if (b.target_bp != null) next.target_bp = Math.max(0, Math.min(10000, Math.round(Number(b.target_bp) || 0)));
    if (Array.isArray(b.weekend)) next.weekend = b.weekend.map(Number).filter(function (n) { return n >= 0 && n <= 6; }).slice(0, 7);
    next = E.profileOf(next);
    await db.update('spent_profile', { profile_json: JSON.stringify(next), updated_at: now() }, { user_id: u.id });
    return { ok: true, profile: next };
  });
  function cleanRule(rule, prof) {
    var out = E.cleanBlocks(rule || {}, E.profileOf(prof));
    if (E.total(out) > E.DAY) throw fail('The usual day adds up to more than 24 hours.');
    return out;
  }

  root.TNSpent = { ensureProfile: ensureProfile };
})(typeof window !== 'undefined' ? window : globalThis);
