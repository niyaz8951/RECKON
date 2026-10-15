/* KEPT — the data layer.
   =============================================================================
   Every /api/kept/* request the page makes, answered in the browser against
   Supabase through TNData.db. Row-level security keeps each person to their
   own rows; this file keeps the rules the Cloudflare functions used to keep:

   - the dedupe rule: same date + amount + description is one row, updated
     in place; an edit to date, amount or description writes a new row that
     supersedes the old one (soft-deleted, never rewritten);
   - financial rows are never hard-deleted (deleted_at hides them);
   - due EMI instalments and recurring occurrences are posted into the
     ledger once a day (profile_json.postedOn), or at once when a rule or an
     EMI is saved;
   - an upload replaces the record only with confirm:true.

     GET  /api/kept/bootstrap                      everything the page draws from
     GET|POST|PUT|DELETE /api/kept/transactions
     POST /api/kept/import                         { rows, confirm }
     GET|POST|PUT|DELETE /api/kept/emis
     GET|POST|DELETE /api/kept/recurring
     GET|PUT|DELETE /api/kept/budgets
     GET|PUT /api/kept/profile
     GET  /api/kept/analysis                       "What KEPT noticed" (computed) */
(function (root) {
  'use strict';
  var D = root.TNData, db = D.db, route = D.route, fail = D.fail, K = root.KeptCore;
  var now = D.now, newId = D.id;

  /* ------------------------------------------------------------ helpers */
  var CURRENCIES = ['AED', 'SAR', 'INR', 'USD', 'EUR', 'GBP', 'QAR', 'KWD', 'OMR', 'BHD'];
  var JSON_KEYS = ['age', 'retireAge', 'ret', 'infl', 'nw', 'kids', 'majors', 'kidCost', 'name', 'pathBase', 'dismissed', 'postedOn'];

  function parseProfile(row) {
    var pj = {};
    try { pj = JSON.parse(row.profile_json || '{}') || {}; } catch (e) { pj = {}; }
    return Object.assign({}, row, { profile_json: Object.assign({}, K.PROFILE_DEFAULTS, pj) });
  }
  async function ensureProfile(u) {
    var row = await db.first('kept_profile', { where: { user_id: u.id } });
    if (!row) {
      try {
        row = (await db.insert('kept_profile', { id: newId('kprf'), user_id: u.id, currency: 'AED', target_keep_bp: 2000, ramp_months: 6, profile_json: '{}' }))[0];
      } catch (e) {
        // Two tabs racing to create it: the other one won; read theirs.
        row = await db.first('kept_profile', { where: { user_id: u.id } });
        if (!row) throw e;
      }
    }
    return parseProfile(row);
  }
  async function saveProfileJson(u, pj) {
    await db.update('kept_profile', { profile_json: JSON.stringify(pj), updated_at: now() }, { user_id: u.id });
  }
  async function ensureCategories(u) {
    var have = await db.select('kept_categories', { where: { user_id: u.id }, order: [['sort', 'asc'], ['name', 'asc']] });
    if (have.length) return have;
    var ts = now();
    var rows = K.DEFAULT_CATEGORIES.map(function (c, i) {
      return { id: newId('kcat'), user_id: u.id, name: c.name, icon: c.icon, flow: c.flow, cls: c.cls, sort: i, source: 'system', created_at: ts, updated_at: ts };
    });
    return db.insert('kept_categories', rows);
  }
  function withKind(r) { r.kind = K.classify(r); return r; }
  async function loadLedger(u) {
    var rows = await db.select('kept_transactions', {
      where: { user_id: u.id, deleted_at: null, status: { neq: 'rejected' } },
      order: [['d', 'asc'], ['created_at', 'asc']]
    });
    return rows.map(withKind);
  }
  async function liveEmis(u) { return db.select('kept_emis', { where: { user_id: u.id, deleted_at: null }, order: [['created_at', 'asc']] }); }
  async function liveRules(u) { return db.select('kept_recurring', { where: { user_id: u.id, deleted_at: null }, order: [['created_at', 'asc']] }); }

  /* Writes rows with the dedupe rule. A row whose hash already exists is
     updated in place (category, remark and merchant from the new row win);
     a row the person deleted is not resurrected by the posting jobs, but a
     person's own write or an import brings it back. One upsert, not one
     request per row. Returns { added, updated, skipped }. */
  async function mergeRows(u, rows, source) {
    var res = { added: 0, updated: 0, skipped: 0 };
    if (!rows.length) return res;
    var existing = await db.select('kept_transactions', { where: { user_id: u.id } });
    var byHash = new Map();
    existing.forEach(function (e) {
      var cur = byHash.get(e.hash);
      if (!cur || (cur.deleted_at && !e.deleted_at)) byHash.set(e.hash, e);
    });
    var ts = now(), out = [], seen = new Set();
    rows.forEach(function (r) {
      var h = K.txHash(r.d, r.amount_minor, r.descr);
      if (seen.has(h)) return;
      seen.add(h);
      var cur = byHash.get(h);
      if (cur && cur.deleted_at && source === 'system') { res.skipped++; return; }
      var merchant = K.normMerchant(r.descr);
      if (cur) {
        out.push(Object.assign({}, cur, { cat: r.cat || 'Misc', remark: r.remark || null, merchant: merchant, deleted_at: null, status: 'approved', updated_at: ts }));
        res.updated++;
      } else {
        out.push({ id: newId('ktx'), user_id: u.id, d: r.d, descr: r.descr, amount_minor: Math.round(r.amount_minor),
          currency: r.currency || 'AED', cat: r.cat || 'Misc', merchant: merchant, remark: r.remark || null, hash: h,
          source: source, status: 'approved', supersedes_id: null, deleted_at: null, created_at: ts, updated_at: ts });
        res.added++;
      }
    });
    // Row objects from the database carry the computed `kind`; the table has no such column.
    out.forEach(function (o) { delete o.kind; });
    if (out.length) await db.upsert('kept_transactions', out, { onConflict: 'id' });
    return res;
  }

  async function postEmis(u, today) {
    var emis = (await liveEmis(u)).filter(function (e) { return Number(e.auto_post) === 1; });
    if (!emis.length) return { added: 0, updated: 0, skipped: 0 };
    var rows = await loadLedger(u), out = [];
    var nowD = today ? new Date(today + 'T00:00:00Z') : new Date();
    emis.forEach(function (e) {
      var total = Math.max(1, Number(e.total_n) || 1), from = e.post_from || '0000-00';
      for (var k = 0; k < total; k++) {
        var d = K.emiDueDate(e, k);
        if (d > nowD) break;
        var iso = K.todayISO(d), ym = iso.slice(0, 7);
        if (ym < from || K.emiPaymentIn(e, ym, rows)) continue;
        out.push({ d: iso, descr: e.name + ' EMI', amount_minor: -Math.abs(e.emi_minor), cat: 'Loan', remark: 'emi:' + e.id, currency: e.currency });
      }
    });
    return mergeRows(u, out, 'system');
  }
  async function postRecurring(u, today) {
    var rules = await liveRules(u);
    if (!rules.length) return { added: 0, updated: 0, skipped: 0 };
    var nowD = today ? new Date(today + 'T00:00:00Z') : new Date(), out = [];
    rules.forEach(function (r) {
      var d = new Date(r.start_d + 'T00:00:00Z'), end = r.end_d ? new Date(r.end_d + 'T00:00:00Z') : null, guard = 0;
      while (d <= nowD && (!end || d <= end) && guard++ < 600) {
        out.push({ d: K.todayISO(d), descr: r.descr, amount_minor: r.amount_minor, cat: r.cat, remark: 'recurring:' + r.id, currency: r.currency });
        d = K.stepDate(d, r.freq);
      }
    });
    return mergeRows(u, out, 'system');
  }
  /* Both posting jobs, once per day (or now, with force). */
  async function postDue(u, force) {
    var prof = await ensureProfile(u), today = K.todayISO();
    if (!force && prof.profile_json.postedOn === today) return { added: 0, updated: 0, skipped: 0, ran: false };
    var a = await postEmis(u), b = await postRecurring(u);
    await saveProfileJson(u, Object.assign({}, prof.profile_json, { postedOn: today }));
    return { added: a.added + b.added, updated: a.updated + b.updated, skipped: a.skipped + b.skipped, ran: true };
  }

  async function analysisFor(u, rows, emis, rules, prof) {
    var findings = K.computeFindings({ rows: rows, emis: emis, rules: rules, prof: prof });
    // There is no model on this site: the findings carry their own plain
    // "why" and "do this". The page reads narration:null as "none".
    return { findings: findings, narration: null, stale: false };
  }

  /* ---------------------------------------------------------- bootstrap */
  route('GET', '/api/kept/bootstrap', async function (r) {
    var u = await r.me();
    var posted = await postDue(u, false);
    var results = await Promise.all([ensureProfile(u), ensureCategories(u), loadLedger(u), liveEmis(u), liveRules(u)]);
    var profile = results[0], categories = results[1], transactions = results[2], rawEmis = results[3], rules = results[4];
    var emis = rawEmis.map(function (e) { return Object.assign({}, e, { derived: K.deriveEmi(e, transactions) }); });
    return {
      profile: profile, categories: categories, ai: false, emis: emis, rules: rules, transactions: transactions,
      posted: posted, today: K.todayISO(), analysis: await analysisFor(u, transactions, rawEmis, rules, profile)
    };
  });

  route('GET', '/api/kept/analysis', async function (r) {
    var u = await r.me();
    var res = await Promise.all([ensureProfile(u), loadLedger(u), liveEmis(u), liveRules(u)]);
    var a = await analysisFor(u, res[1], res[2], res[3], res[0]);
    a.ai = false;
    return a;
  });

  /* ------------------------------------------------------- transactions */
  function readTx(b) {
    var d = K.str(b.d, 10), descr = K.str(b.descr, 120), amount = K.intMinor(b.amount_minor);
    if (!K.isDate(d)) throw fail('Date must be YYYY-MM-DD.');
    if (!descr) throw fail('Give the entry a description.');
    if (amount == null || amount === 0) throw fail('Amount must be a non-zero integer in minor units.');
    return { d: d, descr: descr, amount_minor: amount, cat: K.str(b.cat, 40) || 'Misc', remark: K.str(b.remark, 200) || '' };
  }

  route('GET', '/api/kept/transactions', async function (r) {
    var u = await r.me(), qy = r.query;
    var month = qy.get('month') || '', kind = qy.get('kind') || '', q = (qy.get('q') || '').toLowerCase().trim();
    var all = qy.get('all') === '1';
    var limit = Math.min(1000, Math.max(1, Number(qy.get('limit')) || 200)), offset = Math.max(0, Number(qy.get('offset')) || 0);
    var out = await loadLedger(u);
    if (month) out = out.filter(function (x) { return x.d.slice(0, 7) === month; });
    if (kind) out = out.filter(function (x) { return x.kind === kind; });
    if (q) out = out.filter(function (x) { return ((x.descr || '') + ' ' + (x.cat || '') + ' ' + (x.remark || '')).toLowerCase().indexOf(q) > -1; });
    var total = out.length;
    if (!all) out = out.slice().reverse().slice(offset, offset + limit);
    return { transactions: out, total: total, limit: limit, offset: offset };
  });

  async function rowByHash(u, h) {
    var rows = await db.select('kept_transactions', { where: { user_id: u.id, hash: h, deleted_at: null }, order: [['updated_at', 'desc']], limit: 1 });
    return rows[0] ? withKind(rows[0]) : null;
  }

  route('POST', '/api/kept/transactions', async function (r) {
    var u = await r.me(), tx = readTx(r.body), prof = await ensureProfile(u);
    var res = await mergeRows(u, [Object.assign({}, tx, { currency: prof.currency })], 'user');
    return Object.assign({ ok: true }, res, { transaction: await rowByHash(u, K.txHash(tx.d, tx.amount_minor, tx.descr)) });
  });

  route('PUT', '/api/kept/transactions', async function (r) {
    var u = await r.me(), rid = K.str(r.body.id, 40);
    if (!rid) throw fail('id is required.');
    var old = await db.first('kept_transactions', { where: { id: rid, user_id: u.id, deleted_at: null } });
    if (!old) throw fail('Not found.', 404);
    var tx = readTx(Object.assign({}, old, r.body)), ts = now(), h = K.txHash(tx.d, tx.amount_minor, tx.descr);
    if (h === old.hash) {
      // Only category / remark changed: the row stays the row.
      var upd = await db.update('kept_transactions', { cat: tx.cat, remark: tx.remark || null, updated_at: ts }, { id: old.id });
      return { ok: true, transaction: withKind(upd[0]), replaced: false };
    }
    // Date, amount or description changed: supersede. If the new key is
    // already a live row, that row absorbs the edit — no duplicate, ever.
    var clash = await db.first('kept_transactions', { where: { user_id: u.id, hash: h, deleted_at: null, id: { neq: old.id } } });
    await db.update('kept_transactions', { deleted_at: ts, updated_at: ts }, { id: old.id });
    var row;
    if (clash) {
      row = (await db.update('kept_transactions', { cat: tx.cat, remark: tx.remark || null, supersedes_id: old.id, updated_at: ts }, { id: clash.id }))[0];
    } else {
      row = (await db.insert('kept_transactions', { id: newId('ktx'), user_id: u.id, d: tx.d, descr: tx.descr, amount_minor: tx.amount_minor,
        currency: old.currency, cat: tx.cat, merchant: K.normMerchant(tx.descr), remark: tx.remark || null, hash: h, source: 'user',
        status: 'approved', supersedes_id: old.id, created_at: ts, updated_at: ts }))[0];
    }
    return { ok: true, transaction: withKind(row), replaced: true, superseded: old.id };
  });

  route('DELETE', '/api/kept/transactions', async function (r) {
    var u = await r.me(), rid = K.str(r.query.get('id'), 40);
    if (!rid) throw fail('id is required.');
    var ts = now();
    var rows = await db.update('kept_transactions', { deleted_at: ts, updated_at: ts }, { id: rid, user_id: u.id, deleted_at: null });
    if (!rows.length) throw fail('Not found.', 404);
    return { ok: true, id: rid };
  });

  /* -------------------------------------------------------------- import */
  route('POST', '/api/kept/import', async function (r) {
    var u = await r.me(), b = r.body;
    var input = Array.isArray(b.rows) ? b.rows.slice(0, 20000) : [];
    var prof = await ensureProfile(u), byHash = new Map(), invalid = 0;
    input.forEach(function (x) {
      var d = K.str(x.d, 10), descr = K.str(x.descr, 120), amount = K.intMinor(x.amount_minor);
      if (!K.isDate(d) || !descr || amount == null || amount === 0) { invalid++; return; }
      byHash.set(K.txHash(d, amount, descr), { d: d, descr: descr, amount_minor: amount, cat: K.str(x.cat, 40) || 'Misc', remark: K.str(x.remark, 200) || '', currency: prof.currency });
    });
    var rows = Array.from(byHash.values()).sort(function (a, c) { return a.d < c.d ? -1 : a.d > c.d ? 1 : 0; });
    if (!rows.length) throw fail('No usable rows: each needs a date, a description and a non-zero amount.');
    var preview = { rows: rows.length, collapsed: input.length - invalid - rows.length, invalid: invalid, from: rows[0].d, to: rows[rows.length - 1].d };
    if (b.confirm !== true) return { ok: true, preview: preview, written: false };
    var ts = now();
    var replaced = await db.update('kept_transactions', { deleted_at: ts, updated_at: ts }, { user_id: u.id, deleted_at: null });
    // mergeRows revives a just-deleted row for an import: the same
    // transaction in the new file is the same row.
    var res = await mergeRows(u, rows, 'import');
    var pj = Object.assign({}, prof.profile_json);
    delete pj.pathBase;
    await saveProfileJson(u, pj);
    return Object.assign({ ok: true, preview: preview, written: true, replaced: replaced.length }, res);
  });

  /* ---------------------------------------------------------------- EMIs */
  async function emiList(u) {
    var emis = await liveEmis(u), rows = await loadLedger(u);
    return emis.map(function (e) { return Object.assign({}, e, { derived: K.deriveEmi(e, rows) }); });
  }
  function readEmi(b) {
    var name = K.str(b.name, 60), lender = K.str(b.lender, 60);
    var emi = K.intMinor(b.emi_minor), total = Math.round(Number(b.total_n) || 0), paid = Math.round(Number(b.paid_n) || 0);
    var next = K.str(b.next_due, 10), apr = Math.round(Number(b.apr_bp) || 0);
    if (!name) throw fail('Give the loan a name you will recognise.');
    if (!(emi > 0)) throw fail('Enter the monthly instalment.');
    if (!(total >= 1 && total <= 600)) throw fail('How many instalments in total?');
    if (paid < 0 || paid > total) throw fail('Paid so far must be between 0 and the total.');
    if (!K.isDate(next)) throw fail('Pick the next due date.');
    return { name: name, lender: lender, emi_minor: emi, total_n: total, due_day: Number(next.slice(8, 10)),
      start_month: K.addMonths(next.slice(0, 7), -paid), apr_bp: Math.max(0, apr),
      auto_post: b.auto_post === false || b.auto_post === 0 ? 0 : 1 };
  }
  route('GET', '/api/kept/emis', async function (r) {
    var u = await r.me();
    var posted = await postDue(u, r.query.get('post') === '1');
    return { emis: await emiList(u), posted: posted };
  });
  route('POST', '/api/kept/emis', async function (r) {
    var u = await r.me(), e = readEmi(r.body), prof = await ensureProfile(u), ts = now(), eid = newId('kemi');
    await db.insert('kept_emis', Object.assign({ id: eid, user_id: u.id, currency: prof.currency, post_from: ts.slice(0, 7),
      source: 'user', status: 'approved', created_at: ts, updated_at: ts }, e, { lender: e.lender || null }));
    var posted = await postEmis(u);
    return { ok: true, emis: await emiList(u), posted: posted, id: eid };
  });
  route('PUT', '/api/kept/emis', async function (r) {
    var u = await r.me(), eid = K.str(r.body.id, 40);
    var old = await db.first('kept_emis', { where: { id: eid, user_id: u.id, deleted_at: null } });
    if (!old) throw fail('Not found.', 404);
    var e = readEmi(r.body);
    await db.update('kept_emis', Object.assign({}, e, { lender: e.lender || null, updated_at: now() }), { id: eid });
    var posted = await postEmis(u);
    return { ok: true, emis: await emiList(u), posted: posted };
  });
  route('DELETE', '/api/kept/emis', async function (r) {
    var u = await r.me(), eid = K.str(r.query.get('id'), 40), ts = now();
    var rows = await db.update('kept_emis', { deleted_at: ts, updated_at: ts }, { id: eid, user_id: u.id, deleted_at: null });
    if (!rows.length) throw fail('Not found.', 404);
    return { ok: true, emis: await emiList(u) };
  });

  /* ----------------------------------------------------------- recurring */
  route('GET', '/api/kept/recurring', async function (r) {
    var u = await r.me();
    var posted = await postDue(u, r.query.get('post') === '1');
    return { rules: await liveRules(u), posted: posted };
  });
  route('POST', '/api/kept/recurring', async function (r) {
    var u = await r.me(), b = r.body;
    var descr = K.str(b.descr, 80), amount = K.intMinor(b.amount_minor), cat = K.str(b.cat, 40) || 'Misc';
    var freq = ['weekly', 'monthly', 'yearly'].indexOf(b.freq) > -1 ? b.freq : 'monthly';
    var start = K.str(b.start_d, 10), end = K.str(b.end_d, 10);
    if (!descr) throw fail('Give it a name — you will see it in the record.');
    if (amount == null || amount === 0) throw fail('Enter the amount.');
    if (!K.isDate(start)) throw fail('Pick the start date.');
    if (end && (!K.isDate(end) || end < start)) throw fail('The end date is before the start date.');
    var prof = await ensureProfile(u), ts = now(), rid = newId('krec');
    await db.insert('kept_recurring', { id: rid, user_id: u.id, descr: descr, amount_minor: amount, currency: prof.currency, cat: cat,
      freq: freq, start_d: start, end_d: end || null, source: 'user', status: 'approved', created_at: ts, updated_at: ts });
    var posted = await postRecurring(u);
    return { ok: true, rules: await liveRules(u), posted: posted, id: rid };
  });
  route('DELETE', '/api/kept/recurring', async function (r) {
    var u = await r.me(), rid = K.str(r.query.get('id'), 40), ts = now();
    var rows = await db.update('kept_recurring', { deleted_at: ts, updated_at: ts }, { id: rid, user_id: u.id, deleted_at: null });
    if (!rows.length) throw fail('Not found.', 404);
    return { ok: true, rules: await liveRules(u) };
  });

  /* ------------------------------------------------------------- budgets */
  async function liveBudgets(u, month) {
    var rows = await db.select('kept_budgets', { where: { user_id: u.id, month: month, status: { neq: 'rejected' } }, order: [['cat', 'asc'], ['created_at', 'asc']] });
    var superseded = new Set(rows.map(function (x) { return x.supersedes_id; }).filter(Boolean));
    return rows.filter(function (x) { return !superseded.has(x.id); });
  }
  route('GET', '/api/kept/budgets', async function (r) {
    var u = await r.me(), month = K.str(r.query.get('month'), 7) || now().slice(0, 7);
    if (!K.isMonth(month)) throw fail('month must be YYYY-MM.');
    return { month: month, budgets: await liveBudgets(u, month) };
  });
  route('PUT', '/api/kept/budgets', async function (r) {
    var u = await r.me(), b = r.body;
    var month = K.str(b.month, 7), cat = K.str(b.cat, 40), amount = K.intMinor(b.amount_minor);
    if (!K.isMonth(month)) throw fail('month must be YYYY-MM.');
    if (!cat) throw fail('cat is required.');
    if (amount == null || amount < 0) throw fail('amount_minor must be a non-negative integer.');
    var prof = await ensureProfile(u), ts = now();
    var live = (await liveBudgets(u, month)).filter(function (x) { return x.cat === cat; });
    var own = live.filter(function (x) { return x.source === 'user' && x.status === 'approved'; })[0];
    if (own) await db.update('kept_budgets', { amount_minor: amount, updated_at: ts }, { id: own.id });
    else {
      await db.insert('kept_budgets', { id: newId('kbud'), user_id: u.id, month: month, cat: cat, amount_minor: amount, currency: prof.currency,
        source: 'user', status: 'approved', supersedes_id: live[0] ? live[0].id : null, created_at: ts, updated_at: ts });
      for (var i = 1; i < live.length; i++) await db.update('kept_budgets', { status: 'rejected', updated_at: ts }, { id: live[i].id });
    }
    return { ok: true, budgets: await liveBudgets(u, month) };
  });
  route('DELETE', '/api/kept/budgets', async function (r) {
    var u = await r.me(), bid = K.str(r.query.get('id'), 40);
    var rows = await db.update('kept_budgets', { status: 'rejected', updated_at: now() }, { id: bid, user_id: u.id });
    if (!rows.length) throw fail('Not found.', 404);
    return { ok: true, id: bid };
  });

  /* ------------------------------------------------------------- profile */
  route('GET', '/api/kept/profile', async function (r) {
    var u = await r.me();
    var res = await Promise.all([ensureProfile(u), ensureCategories(u)]);
    return { profile: res[0], categories: res[1], ai: false };
  });
  route('PUT', '/api/kept/profile', async function (r) {
    var u = await r.me(), b = r.body, cur = await ensureProfile(u);
    var currency = b.currency != null ? K.str(b.currency, 3).toUpperCase() : cur.currency;
    if (CURRENCIES.indexOf(currency) < 0) throw fail('Unsupported currency.');
    var target = b.target_keep_bp != null ? Math.round(Number(b.target_keep_bp)) : cur.target_keep_bp;
    if (!(target >= 100 && target <= 8000)) throw fail('Target keep-rate must be between 1% and 80%.');
    var ramp = b.ramp_months != null ? Math.round(Number(b.ramp_months)) : cur.ramp_months;
    if (!(ramp >= 1 && ramp <= 36)) throw fail('Ramp must be 1–36 months.');
    var pj = Object.assign({}, cur.profile_json);
    if (b.profile_json && typeof b.profile_json === 'object') JSON_KEYS.forEach(function (k) { if (k in b.profile_json) pj[k] = b.profile_json[k]; });
    if (pj.name) pj.name = K.str(pj.name, 40);
    // Findings marked "Got it": { id: signature }, at most 80, newest kept.
    if (pj.dismissed && typeof pj.dismissed === 'object' && !Array.isArray(pj.dismissed)) {
      var entries = Object.keys(pj.dismissed).filter(function (k) { return k.length <= 120 && typeof pj.dismissed[k] === 'string' && pj.dismissed[k].length <= 20; })
        .map(function (k) { return [k, pj.dismissed[k]]; });
      pj.dismissed = {};
      entries.slice(-80).forEach(function (e) { pj.dismissed[e[0]] = e[1]; });
    } else if ('dismissed' in pj) pj.dismissed = {};
    await db.update('kept_profile', { currency: currency, target_keep_bp: target, ramp_months: ramp, profile_json: JSON.stringify(pj), updated_at: now() }, { user_id: u.id });
    return { ok: true, profile: await ensureProfile(u) };
  });

  root.KeptData = { mergeRows: mergeRows, postDue: postDue, ensureProfile: ensureProfile, loadLedger: loadLedger };
})(typeof window !== 'undefined' ? window : globalThis);
