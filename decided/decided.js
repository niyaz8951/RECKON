/* DECIDED — the page.
   =============================================================================
   Open (due for review first), Journal (what was reviewed), Insights
   (calibration), How. Two sheets: log/edit a decision, review one. */
(function () {
  'use strict';

  var E = window.DecidedEngine;
  var $ = function (id) { return document.getElementById(id); };
  var esc = TN.esc, pct = E.pct;
  var S = { list: [], M: null, screen: 'open', edit: null, review: null, form: { domain: 'life', stakes: 'medium', reversible: 1, preset: '1m' } };

  function today() { return E.iso(new Date()); }
  function api(path, opts) { return TN.api(path, opts); }
  function fail(err) { TN.toast((err && err.message) || 'Something went wrong.', 'error'); }
  function say(id, msg) { var el = $(id); el.textContent = msg || ''; el.hidden = !msg; }
  function fillIcons(root) { TN.els('[data-icon]', root).forEach(function (el) { if (!el.innerHTML) el.innerHTML = TN.icon(el.getAttribute('data-icon'), 18); }); }
  function insight(html, act, tone) { return '<div class="kp-insight' + (tone ? ' kp-insight--' + tone : '') + '">' + html + (act ? '<span class="kp-act">' + act + '</span>' : '') + '</div>'; }
  function kpi(l, v, s, cls) { return '<div class="kp-kpi' + (cls ? ' kp-kpi--' + cls : '') + '"><div class="kp-kpi__l">' + l + '</div><div class="kp-kpi__v">' + v + '</div><div class="kp-kpi__s">' + (s || '') + '</div></div>'; }
  function dateShort(d) { return E.parse(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: E.parse(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).replace('Sept', 'Sep'); }
  function rel(d) {
    var n = E.daysBetween(today(), d);
    if (n === 0) return 'today'; if (n === 1) return 'tomorrow'; if (n === -1) return 'yesterday';
    if (n < 0) return Math.abs(n) + ' days overdue'; if (n < 30) return 'in ' + n + ' days'; if (n < 365) return 'in ' + Math.round(n / 30) + ' months';
    return 'in ' + (Math.round(n / 365 * 10) / 10) + ' years';
  }
  function rebuild() { S.M = E.build(S.list, today()); }

  /* ---------------------------------------------------------- navigation */
  var TITLES = { open: ['Open', 'Decisions waiting for their review date.'], journal: ['Journal', 'What you decided, and what happened.'], insights: ['Insights', 'How good your judgement is, measured.'], how: ['How it works', 'Four steps, and why.'] };
  function showScreen(name) {
    if (!TITLES[name]) name = 'open';
    S.screen = name;
    TN.els('.kp-screen').forEach(function (sc) { sc.hidden = sc.getAttribute('data-screen') !== name; });
    TN.els('#dc-bar [data-screen]').forEach(function (b) { if (b.getAttribute('data-screen') === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('dc-title').textContent = TITLES[name][0]; $('dc-sub').textContent = TITLES[name][1];
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
    render(); window.scrollTo(0, 0);
  }
  function render() {
    renderRate();
    if (S.screen === 'open') renderOpen(); else if (S.screen === 'journal') renderJournal(); else if (S.screen === 'insights') renderInsights();
  }
  function renderRate() {
    var M = S.M, box = $('dc-rate');
    if (!M || M.n < 3) { box.innerHTML = M && M.due.length ? '<b>' + M.due.length + '</b><span>due for review</span>' : ''; return; }
    box.innerHTML = '<b>' + pct(M.hitRate) + '</b><span>as expected · ' + M.n + ' reviewed</span>';
  }

  /* ---------------------------------------------------------------- cards */
  function card(d, mode) {
    var dm = E.domainOf(d.domain), due = d.review_on <= today();
    return '<article class="dc-card dc-card--' + esc(d.stakes) + (due && d.status !== 'reviewed' ? ' is-due' : '') + '" data-id="' + esc(d.id) + '">' +
      '<div class="dc-card__top"><span class="dc-card__dom" data-icon="' + esc(dm.icon) + '"></span><div class="dc-card__t"><h3>' + esc(d.title) + '</h3>' +
      '<p class="dc-card__meta">' + esc(dm.name) + ' · ' + esc(d.stakes) + ' stakes · ' + (d.reversible ? 'reversible' : 'one-way') + ' · decided ' + dateShort(d.decided_on) + '</p></div>' +
      '<span class="dc-conf-pill" title="how sure you were">' + d.confidence + '%</span></div>' +
      (d.choice ? '<p class="dc-card__line"><b>Chose:</b> ' + esc(d.choice) + '</p>' : '') +
      (d.expected ? '<p class="dc-card__line"><b>Expected:</b> ' + esc(d.expected) + '</p>' : '') +
      (mode === 'journal' ? '<p class="dc-card__line dc-card__outcome"><b>Happened:</b> ' + esc(d.outcome) + '</p>' +
        '<p class="dc-card__verdict"><span class="kp-pill kp-pill--' + (d.as_expected ? 'ok' : 'bad') + '">' + (d.as_expected ? 'As expected' : 'Not as expected') + '</span> ' + (d.outcome_score && d.outcome_score !== 3 ? '<span class="kp-pill kp-pill--' + (d.outcome_score >= 4 ? 'ok' : 'bad') + '">' + esc(E.SCORE_LABEL[d.outcome_score]) + ' than hoped</span>' : '') + '</p>' +
        (d.lesson ? '<p class="dc-card__lesson">“' + esc(d.lesson) + '”</p>' : '') +
        '<div class="dc-card__acts"><button type="button" class="btn btn--quiet btn--sm" data-act="reopen">Reopen</button></div>'
      : '<div class="dc-card__acts"><span class="dc-card__when' + (due ? ' is-due' : '') + '">' + (due ? 'Review ' + rel(d.review_on) : 'Review ' + rel(d.review_on) + ' · ' + dateShort(d.review_on)) + '</span>' +
        '<button type="button" class="btn btn--quiet btn--sm" data-act="edit">Edit</button>' +
        '<button type="button" class="btn ' + (due ? 'btn--primary' : 'btn--ghost') + ' btn--sm" data-act="review">' + (due ? 'Look back now' : 'Review early') + '</button></div>') +
      '</article>';
  }
  function wireCards(root) {
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return;
      var id = b.closest('.dc-card').getAttribute('data-id'), d = S.list.filter(function (x) { return x.id === id; })[0];
      if (!d) return;
      var act = b.getAttribute('data-act');
      if (act === 'edit') openEdit(d); else if (act === 'review') openReview(d); else if (act === 'reopen') reopen(d);
    });
  }

  /* ----------------------------------------------------------------- Open */
  function renderOpen() {
    var M = S.M, box = $('open-wrap'), h = '';
    if (!M.all.length) {
      h = '<div class="panel kp-hero"><p class="eyebrow">Start here</p><h2>Log the next decision before you know how it goes.</h2>' +
        '<p class="muted" style="margin-top:var(--space-2)">Anything with a real choice and a real outcome: a purchase, a job, a habit, a trip, a conversation you are putting off. Write what you expect and how sure you are. In a month the app asks you how it went — and that is where judgement starts to improve.</p>' +
        '<div class="kp-start"><button type="button" id="ow-add"><b>Log a decision</b><span>Twenty seconds. The review date does the rest.</span></button></div></div>';
      box.innerHTML = h; $('ow-add').addEventListener('click', function () { openEdit(null); }); return;
    }
    if (M.due.length) h += '<div class="panel kp-hero kp-hero--warn"><p class="eyebrow">Due for review</p><h2>' + M.due.length + ' decision' + (M.due.length === 1 ? '' : 's') + ' reached ' + (M.due.length === 1 ? 'its' : 'their') + ' review date.</h2><p class="muted" style="margin-top:var(--space-2)">A review takes a minute and is the whole point: the score only exists if you look back.</p></div>' +
      '<div class="dc-list">' + M.due.map(function (d) { return card(d, 'open'); }).join('') + '</div>';
    else h += '<div class="panel kp-hero"><p class="eyebrow">' + M.open.length + ' open · next review ' + (M.upcoming[0] ? rel(M.upcoming[0].review_on) : '—') + '</p><h2>Nothing is due today.</h2><p class="muted" style="margin-top:var(--space-2)">' + (M.last30 ? M.last30 + ' decision' + (M.last30 === 1 ? '' : 's') + ' logged in the last 30 days.' : 'Nothing logged in the last 30 days — the small ones count too.') + '</p></div>';
    if (M.upcoming.length) h += '<div class="panel"><div class="panel__head"><h2>Waiting</h2><span class="muted">soonest first</span></div><div class="dc-list">' + M.upcoming.map(function (d) { return card(d, 'open'); }).join('') + '</div></div>';
    box.innerHTML = h; fillIcons(box);
  }
  /* -------------------------------------------------------------- Journal */
  function renderJournal() {
    var M = S.M, box = $('journal-wrap');
    if (!M.reviewed.length) { box.innerHTML = '<div class="panel"><h2>Nothing reviewed yet</h2><p class="muted" style="margin-top:var(--space-2)">Reviewed decisions land here with what happened, how it compared, and the line you wrote to your past self.</p></div>'; return; }
    box.innerHTML = '<div class="panel"><div class="panel__head"><h2>' + M.reviewed.length + ' reviewed</h2><span class="muted">' + M.better + ' better than expected · ' + M.worse + ' worse</span></div><div class="dc-list">' + M.reviewed.map(function (d) { return card(d, 'journal'); }).join('') + '</div></div>';
    fillIcons(box);
  }
  /* ------------------------------------------------------------- Insights */
  function renderInsights() {
    var M = S.M, box = $('ins-wrap'), v = E.verdict(M), les = E.lesson(M, today());
    var h = '<div class="panel kp-hero kp-hero--' + v.tone + '"><div class="kp-hero__top"><div><p class="eyebrow">Calibration</p>' +
      '<div class="kp-hero__label">Said · Were right</div><div class="kp-hero__big">' + (M.n >= 3 ? pct(M.meanConf) + ' <small>·</small> ' + pct(M.hitRate) : '—') + '</div>' +
      '<div class="kp-hero__sub">' + (M.n >= 3 ? (M.gap > 8 ? 'overconfident' : M.gap < -8 ? 'underconfident' : 'well calibrated') + ' · ' + M.n + ' reviewed' : M.n + ' reviewed · 3 needed') + '</div></div></div>' + insight(v.text, null, v.tone) + '</div>';
    h += '<div class="kp-kpis">' + kpi('Decisions', M.all.length, M.open.length + ' open', 'ok') + kpi('Reviewed', M.reviewed.length, M.due.length ? M.due.length + ' due now' : 'none due', M.due.length ? 'warn' : 'ok') +
      kpi('Turned out', M.meanScore ? (Math.round(M.meanScore * 10) / 10) + ' / 5' : '—', M.meanScore ? (M.meanScore >= 3.2 ? 'better than you expected' : M.meanScore <= 2.8 ? 'worse than you expected' : 'about as expected') : 'after the first review', M.meanScore ? (M.meanScore >= 3 ? 'ok' : 'warn') : '') +
      kpi('Brier score', M.brier == null ? '—' : (Math.round(M.brier * 100) / 100), 'lower is sharper · 0.25 = coin toss', M.brier == null ? '' : M.brier < 0.2 ? 'ok' : 'warn') + '</div>';
    if (M.n >= 3) {
      h += '<div class="panel"><div class="panel__head"><h2>When you said…</h2><span class="muted">…how often you were right</span></div><div class="dc-cal">' +
        M.buckets.map(function (b) { return '<div class="dc-cal__row"><span class="dc-cal__b">' + b.bucket + '%</span><span class="dc-cal__bar"><i class="dc-cal__said" style="width:' + (b.conf || 0) + '%"></i><i class="dc-cal__hit" style="width:' + (b.hit == null ? 0 : b.hit) + '%"></i></span><span class="dc-cal__v">' + (b.n ? pct(b.hit) + ' <small>of ' + b.n + '</small>' : '<small>—</small>') + '</span></div>'; }).join('') +
        '</div><p class="kp-muted-sm"><i class="dc-key dc-key--said"></i> what you said &nbsp; <i class="dc-key dc-key--hit"></i> what happened</p></div>';
      var doms = M.byDomain.filter(function (x) { return x.n > 0; });
      if (doms.length) h += '<div class="panel"><div class="panel__head"><h2>By area</h2></div><div class="kp-catlist">' + doms.map(function (x) {
        var g = x.conf - x.hit;
        return '<div class="kp-catrow"><div class="kp-catrow__name"><b>' + esc(x.name) + '</b><div class="kp-track"><i style="width:' + Math.round(x.hit) + '%"></i></div></div><div class="kp-catrow__amt">' + pct(x.hit) + '<small class="' + (Math.abs(g) < 10 ? 'pos' : 'neg') + '">said ' + pct(x.conf) + ' · ' + x.n + '</small></div></div>'; }).join('') + '</div></div>';
    }
    if (les) h += '<div class="panel kp-lesson"><p class="eyebrow">' + TN.icon('lightbulb', 14) + ' One thing to learn today · ' + esc(les.title) + '</p><h2>' + les.lead + '</h2><p>' + les.body + '</p><p class="kp-lesson__why">' + esc(les.why) + '</p></div>';
    if (M.lessons.length) h += '<div class="panel"><div class="panel__head"><h2>Your own lessons</h2><span class="muted">' + M.lessons.length + '</span></div><ul class="dc-lessons">' + M.lessons.slice(0, 12).map(function (d) { return '<li>“' + esc(d.lesson) + '”<span>' + esc(d.title) + ' · ' + dateShort(d.reviewed_at.slice(0, 10)) + '</span></li>'; }).join('') + '</ul></div>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------- the sheets */
  var CONF_HINT = { 50: 'A coin toss. Fine — say so.', 60: 'More likely than not.', 70: 'Fairly sure. Most people live here.', 80: 'Confident. Be right four times in five.', 90: 'Very sure. Nine in ten — are you?', 95: 'Near certain. Reserve this.' };
  function confHint(v) { var keys = Object.keys(CONF_HINT).map(Number).sort(function (a, b) { return a - b; }), out = CONF_HINT[50]; keys.forEach(function (k) { if (v >= k) out = CONF_HINT[k]; }); return out; }
  function paintForm() {
    var f = S.form;
    $('ds-domain').innerHTML = E.DOMAINS.map(function (d) { return '<button type="button" class="dc-chip" data-v="' + d.key + '" aria-pressed="' + (f.domain === d.key) + '"><span data-icon="' + d.icon + '"></span>' + d.name + '</button>'; }).join('');
    fillIcons($('ds-domain'));
    TN.els('#ds-stakes [data-v]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === f.stakes)); });
    TN.els('#ds-rev [data-v]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-v') === f.reversible)); });
    $('ds-review').innerHTML = E.REVIEW_PRESETS.map(function (p) { return '<button type="button" class="dc-chip" data-v="' + p[0] + '" aria-pressed="' + (f.preset === p[0]) + '">' + p[2] + '</button>'; }).join('') + '<button type="button" class="dc-chip" data-v="date" aria-pressed="' + (f.preset === 'date') + '">a date</button>';
    $('ds-review-date').hidden = f.preset !== 'date';
    $('ds-conf-label').textContent = $('ds-conf').value + '%'; $('ds-conf-hint').textContent = confHint(+$('ds-conf').value);
  }
  function reviewDate() {
    var f = S.form, base = S.edit ? S.edit.decided_on : today();
    if (f.preset === 'date') return $('ds-review-date').value;
    var p = E.REVIEW_PRESETS.filter(function (x) { return x[0] === f.preset; })[0];
    return E.addDays(base, p ? p[1] : 30);
  }
  function openEdit(d) {
    S.edit = d || null;
    $('ds-title').textContent = d ? 'Edit decision' : 'Log a decision';
    $('ds-save').textContent = d ? 'Save' : 'Log it';
    $('ds-del').hidden = !d;
    $('ds-name').value = d ? d.title : ''; $('ds-choice').value = d ? d.choice : ''; $('ds-expected').value = d ? d.expected : '';
    $('ds-context').value = d ? d.context : ''; $('ds-options').value = d ? d.options.join('\n') : '';
    $('ds-conf').value = d ? d.confidence : 75;
    S.form = { domain: d ? d.domain : 'life', stakes: d ? d.stakes : 'medium', reversible: d ? (d.reversible ? 1 : 0) : 1, preset: d ? 'date' : '1m' };
    $('ds-review-date').value = d ? d.review_on : E.addDays(today(), 30);
    $('ds-review-date').min = today();
    say('ds-msg', '');
    paintForm();
    $('dec-sheet').showModal();
    setTimeout(function () { $('ds-name').focus(); }, 60);
  }
  async function saveDecision(ev) {
    ev.preventDefault();
    var body = {
      title: $('ds-name').value, choice: $('ds-choice').value, expected: $('ds-expected').value, context: $('ds-context').value,
      options: $('ds-options').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
      confidence: +$('ds-conf').value, domain: S.form.domain, stakes: S.form.stakes, reversible: S.form.reversible, review_on: reviewDate()
    };
    if (!body.title.trim()) { say('ds-msg', 'Give the decision a name you will recognise later.'); $('ds-name').focus(); return; }
    if (!body.review_on) { say('ds-msg', 'Pick when to look back.'); return; }
    $('ds-save').disabled = true;
    try {
      var r = S.edit ? await api('/api/decided/decisions', { method: 'PUT', body: Object.assign({ id: S.edit.id }, body) }) : await api('/api/decided/decisions', { method: 'POST', body: body });
      upsert(r.decision);
      $('dec-sheet').close();
      TN.toast(S.edit ? 'Saved' : 'Logged — see you ' + rel(r.decision.review_on) + '.', 'success');
      showScreen('open');
    } catch (e) { say('ds-msg', e.message); }
    $('ds-save').disabled = false;
  }
  function upsert(d) { var i = S.list.findIndex(function (x) { return x.id === d.id; }); if (i > -1) S.list[i] = d; else S.list.unshift(d); rebuild(); }
  async function del() {
    if (!S.edit || !confirm('Delete this decision? It leaves the record for good.')) return;
    try { await api('/api/decided/decisions?id=' + encodeURIComponent(S.edit.id), { method: 'DELETE' }); S.list = S.list.filter(function (x) { return x.id !== S.edit.id; }); rebuild(); $('dec-sheet').close(); render(); }
    catch (e) { say('ds-msg', e.message); }
  }
  function openReview(d) {
    S.review = d;
    $('rv-recall').innerHTML = '<p class="eyebrow">' + dateShort(d.decided_on) + ' · you were ' + d.confidence + '% sure</p><h3>' + esc(d.title) + '</h3>' + (d.choice ? '<p><b>Chose:</b> ' + esc(d.choice) + '</p>' : '') + (d.expected ? '<p><b>Expected:</b> ' + esc(d.expected) + '</p>' : '') + (d.context ? '<details><summary>What you wrote at the time</summary><p>' + esc(d.context) + '</p></details>' : '');
    $('rv-outcome').value = ''; $('rv-lesson').value = '';
    S.rv = { asexp: null, score: null };
    TN.els('#rv-asexp [data-v]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    $('rv-score').innerHTML = [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" class="dc-score__b" data-v="' + n + '" aria-pressed="false"><b>' + n + '</b><span>' + E.SCORE_LABEL[n] + '</span></button>'; }).join('');
    say('rv-msg', '');
    $('rev-sheet').showModal();
    setTimeout(function () { $('rv-outcome').focus(); }, 60);
  }
  async function saveReview(ev) {
    ev.preventDefault();
    if (!$('rv-outcome').value.trim()) { say('rv-msg', 'Write what happened — one line is enough.'); return; }
    if (S.rv.asexp == null) { say('rv-msg', 'Did it go as you expected?'); return; }
    if (!S.rv.score) { say('rv-msg', 'How did it compare, 1 to 5?'); return; }
    try {
      var r = await api('/api/decided/review', { method: 'POST', body: { id: S.review.id, outcome: $('rv-outcome').value, as_expected: S.rv.asexp, outcome_score: S.rv.score, lesson: $('rv-lesson').value } });
      upsert(r.decision); $('rev-sheet').close(); TN.toast('Reviewed. ' + (S.M.n >= 3 ? 'Calibration updated.' : (3 - S.M.n) + ' more and calibration starts.'), 'success'); render();
    } catch (e) { say('rv-msg', e.message); }
  }
  async function reopen(d) {
    try { var r = await api('/api/decided/reopen', { method: 'POST', body: { id: d.id } }); upsert(r.decision); render(); } catch (e) { fail(e); }
  }

  /* --------------------------------------------------------------- wiring */
  function wire() {
    TN.els('#dc-bar [data-screen]').forEach(function (b) { b.addEventListener('click', function () { showScreen(b.getAttribute('data-screen')); }); });
    $('dc-fab').addEventListener('click', function () { openEdit(null); });
    wireCards($('open-wrap')); wireCards($('journal-wrap'));
    $('dec-form').addEventListener('submit', saveDecision);
    $('rev-form').addEventListener('submit', saveReview);
    $('ds-del').addEventListener('click', del);
    $('ds-conf').addEventListener('input', function () { $('ds-conf-label').textContent = this.value + '%'; $('ds-conf-hint').textContent = confHint(+this.value); });
    $('ds-domain').addEventListener('click', function (ev) { var b = ev.target.closest('[data-v]'); if (!b) return; S.form.domain = b.getAttribute('data-v'); paintForm(); });
    $('ds-stakes').addEventListener('click', function (ev) { var b = ev.target.closest('[data-v]'); if (!b) return; S.form.stakes = b.getAttribute('data-v'); paintForm(); });
    $('ds-rev').addEventListener('click', function (ev) { var b = ev.target.closest('[data-v]'); if (!b) return; S.form.reversible = +b.getAttribute('data-v'); paintForm(); });
    $('ds-review').addEventListener('click', function (ev) { var b = ev.target.closest('[data-v]'); if (!b) return; S.form.preset = b.getAttribute('data-v'); paintForm(); if (S.form.preset === 'date') $('ds-review-date').focus(); });
    $('rv-asexp').addEventListener('click', function (ev) { var b = ev.target.closest('[data-v]'); if (!b) return; S.rv.asexp = +b.getAttribute('data-v'); TN.els('#rv-asexp [data-v]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); });
    $('rv-score').addEventListener('click', function (ev) { var b = ev.target.closest('[data-v]'); if (!b) return; S.rv.score = +b.getAttribute('data-v'); TN.els('#rv-score [data-v]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); });
    TN.els('dialog.sheet').forEach(function (dlg) { dlg.addEventListener('click', function (ev) { if (ev.target === dlg || ev.target.closest('[data-close]')) dlg.close(); }); });
    window.addEventListener('hashchange', function () { var n = location.hash.replace('#', ''); if (TITLES[n] && n !== S.screen) showScreen(n); });
  }

  async function boot() {
    await TN.guard();
    fillIcons(document);
    wire();
    try {
      var b = await api('/api/decided/bootstrap');
      S.list = b.decisions || []; rebuild();
      $('dc-loading').hidden = true;
      var start = location.hash.replace('#', '');
      showScreen(TITLES[start] ? start : 'open');
    } catch (e) {
      $('dc-loading').innerHTML = '<div class="notice notice--danger"><div>' + esc(e.message || 'Could not load.') + (/decisions/i.test(e.message || '') ? ' — run supabase/schema.sql once to add the DECIDED table.' : '') + '</div></div>';
    }
  }
  TN.ready(boot);
})();
