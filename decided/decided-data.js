/* DECIDED — the data layer.
   =============================================================================
   Every /api/decided/* request, answered in the browser against Supabase
   through TNData.db. Row-level security keeps each person to their own
   decisions. Nothing is hard-deleted: deleted_at hides a row.

     GET    /api/decided/bootstrap    { decisions, today }
     POST   /api/decided/decisions    { title, context?, options?, choice?, expected?, confidence, domain, stakes, reversible, decided_on?, review_on } -> { decision }
     PUT    /api/decided/decisions    { id, …same fields… } -> { decision }     (an open decision only)
     POST   /api/decided/review       { id, outcome, outcome_score, as_expected, lesson? } -> { decision }
     POST   /api/decided/reopen       { id } -> { decision }
     DELETE /api/decided/decisions?id= */
(function (root) {
  'use strict';
  var D = root.TNData, db = D.db, route = D.route, fail = D.fail, E = root.DecidedEngine;
  var now = D.now, newId = D.id;

  function str(v, max) { if (v == null) return ''; var s = String(v).replace(/\s+/g, ' ').trim(); return s.slice(0, max); }
  function text(v, max) { if (v == null) return ''; return String(v).replace(/\r\n?/g, '\n').trim().slice(0, max); }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s)); }
  function today() { return E.iso(new Date()); }

  function shape(row) {
    var opts = [];
    try { opts = JSON.parse(row.options_json || '[]') || []; } catch (e) { opts = []; }
    return {
      id: row.id, title: row.title, context: row.context || '', options: opts, choice: row.choice || '', expected: row.expected || '',
      confidence: row.confidence, domain: row.domain, stakes: row.stakes, reversible: row.reversible === 1 || row.reversible === true,
      decided_on: row.decided_on, review_on: row.review_on, status: row.status, outcome: row.outcome || '', outcome_score: row.outcome_score,
      as_expected: row.as_expected, lesson: row.lesson || '', reviewed_at: row.reviewed_at, created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at
    };
  }
  function readDecision(b, existing) {
    var title = str(b.title, 140);
    if (!title) throw fail('Give the decision a name you will recognise later.');
    var conf = Math.round(Number(b.confidence));
    if (!(conf >= 0 && conf <= 100)) throw fail('How sure are you, from 0 to 100?');
    var decided = str(b.decided_on, 10) || (existing ? existing.decided_on : today());
    var review = str(b.review_on, 10);
    if (!isDate(decided)) throw fail('Decided-on must be a date.');
    if (!isDate(review)) throw fail('Pick a review date.');
    if (review < decided) throw fail('The review date comes after the decision.');
    var options = Array.isArray(b.options) ? b.options.map(function (o) { return str(o, 120); }).filter(Boolean).slice(0, 8) : (existing ? JSON.parse(existing.options_json || '[]') : []);
    var domain = E.DOMAINS.some(function (d) { return d.key === b.domain; }) ? b.domain : (existing ? existing.domain : 'life');
    var stakes = E.STAKES.indexOf(b.stakes) > -1 ? b.stakes : (existing ? existing.stakes : 'medium');
    return {
      title: title, context: text(b.context, 2000) || null, options_json: JSON.stringify(options), choice: str(b.choice, 200) || null,
      expected: text(b.expected, 1000) || null, confidence: conf, domain: domain, stakes: stakes,
      reversible: b.reversible === false || b.reversible === 0 ? 0 : 1, decided_on: decided, review_on: review
    };
  }
  async function own(u, id) {
    var row = await db.first('decisions', { where: { id: str(id, 40), user_id: u.id, deleted_at: null } });
    if (!row) throw fail('Not found.', 404);
    return row;
  }

  route('GET', '/api/decided/bootstrap', async function (r) {
    var u = await r.me();
    var rows = await db.select('decisions', { where: { user_id: u.id, deleted_at: null }, order: [['decided_on', 'desc'], ['created_at', 'desc']] });
    return { decisions: rows.map(shape), today: today() };
  });

  route('POST', '/api/decided/decisions', async function (r) {
    var u = await r.me(), d = readDecision(r.body || {}), ts = now();
    var row = (await db.insert('decisions', Object.assign({ id: newId('dec'), user_id: u.id, status: 'open', created_at: ts, updated_at: ts }, d)))[0];
    return { ok: true, decision: shape(row) };
  });

  route('PUT', '/api/decided/decisions', async function (r) {
    var u = await r.me(), b = r.body || {};
    var old = await own(u, b.id);
    if (old.status === 'reviewed') throw fail('A reviewed decision is history; reopen it to change it.');
    var d = readDecision(Object.assign({}, shape(old), b), old);
    var row = (await db.update('decisions', Object.assign({ updated_at: now() }, d), { id: old.id, user_id: u.id }))[0];
    return { ok: true, decision: shape(row) };
  });

  route('POST', '/api/decided/review', async function (r) {
    var u = await r.me(), b = r.body || {};
    var old = await own(u, b.id);
    var outcome = text(b.outcome, 2000);
    if (!outcome) throw fail('Write what actually happened — one line is enough.');
    var score = Math.round(Number(b.outcome_score));
    if (!(score >= 1 && score <= 5)) throw fail('How did it turn out, from 1 (much worse) to 5 (much better)?');
    var asExp = b.as_expected === 1 || b.as_expected === true || b.as_expected === '1' ? 1 : 0;
    var ts = now();
    var row = (await db.update('decisions', { status: 'reviewed', outcome: outcome, outcome_score: score, as_expected: asExp, lesson: text(b.lesson, 1000) || null, reviewed_at: ts, updated_at: ts }, { id: old.id, user_id: u.id }))[0];
    return { ok: true, decision: shape(row) };
  });

  route('POST', '/api/decided/reopen', async function (r) {
    var u = await r.me(), old = await own(u, (r.body || {}).id);
    var row = (await db.update('decisions', { status: 'open', reviewed_at: null, updated_at: now() }, { id: old.id, user_id: u.id }))[0];
    return { ok: true, decision: shape(row) };
  });

  route('DELETE', '/api/decided/decisions', async function (r) {
    var u = await r.me(), old = await own(u, r.query.get('id'));
    await db.update('decisions', { deleted_at: now(), updated_at: now() }, { id: old.id, user_id: u.id });
    return { ok: true };
  });
})(typeof window !== 'undefined' ? window : globalThis);
