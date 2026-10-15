/* SPENT — the data layer.
   =============================================================================
   Every /api/spent/* request the page makes, answered in the browser
   against Supabase through TNData.db. Row-level security keeps each
   person to their own rows.

     GET /api/spent/bootstrap            { profile, days: [{d, blocks, note}], today }
     GET /api/spent/days?from=&to=       { days }
     PUT /api/spent/day                  { d, blocks:{cat: minutes}, note? } -> { day }
     PUT /api/spent/profile              { cats?, rules?, target_bp?, weekend? } -> { profile }

   A day is one row per date (unique user_id + d); minutes per category in
   blocks_json. Profile (categories, usual-day rules, target) is one JSON
   row per person. */
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
  function shapeDay(row) { return { d: row.d, blocks: parseJson(row.blocks_json, {}), note: row.note || '', updated_at: row.updated_at }; }
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
    return { profile: prof, days: await days(u, E.addDays(today, -120), null), today: today };
  });

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
    var row;
    if (existing) row = (await db.update('spent_days', { blocks_json: JSON.stringify(blocks), note: note, updated_at: ts }, { id: existing.id, user_id: u.id }))[0];
    else {
      try { row = (await db.insert('spent_days', { id: newId('sday'), user_id: u.id, d: d, blocks_json: JSON.stringify(blocks), note: note, created_at: ts, updated_at: ts }))[0]; }
      catch (e) {
        var again = await db.first('spent_days', { where: { user_id: u.id, d: d } });
        if (!again) throw e;
        row = (await db.update('spent_days', { blocks_json: JSON.stringify(blocks), note: note, updated_at: ts }, { id: again.id, user_id: u.id }))[0];
      }
    }
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
