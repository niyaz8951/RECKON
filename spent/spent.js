/* SPENT — the page.
   =============================================================================
   The app assumes, you correct. Today shows the day as RECKON expects it
   (your usual day for this weekday, learned by SpentModel) until you check
   in; the check-in is a deck of at most five swipe questions, and a usual
   day is one "yes". The full list of categories survives behind Edit day,
   for the days the questions did not cover.

   Screens: Today · Week · Insights · Usual day, plus Edit day (pushed).
   Maths in spent-engine.js and spent-model.js, storage in /api/spent/*,
   the deck in assets/js/deck.js. This file renders and wires. */
(function () {
  'use strict';

  var E = window.SpentEngine, SM = window.SpentModel, SG = window.SpentGoals;
  var $ = function (id) { return document.getElementById(id); };
  var esc = TN.esc, hm = E.hm, pct = E.pct;

  var S = { profile: null, days: {}, today: null, viewing: null, screen: 'today', from: 'today', M: null, model: null, rule: 'weekday', kept: null, dirty: false, saveTimer: null, deck: null,
    goals: [], focus: { active: null, recent: [] }, needsSchema: null, timer: null, wake: null };
  var CLASSES = ['fixed', 'ess', 'mine', 'leak'];
  var GROUPS = { fixed: 'Committed', ess: 'Upkeep', mine: 'Yours, by choice', leak: 'Drift' };

  function today() { return E.iso(new Date()); }
  function hour() { return new Date().getHours(); }
  function api(path, opts) { return TN.api(path, opts); }
  function fail(err) { TN.toast((err && err.message) || 'Something went wrong.', 'error'); }
  function ring(p, o) {
    o = o || {};
    var sz = o.size || 104, sw = o.stroke || 9, r = 50 - sw / 2, C = 2 * Math.PI * r, off = C * (1 - Math.max(0, Math.min(1, p)));
    return '<div class="kp-ring' + (o.cls ? ' kp-ring--' + o.cls : '') + (sz < 80 ? ' kp-ring--sm' : '') + '" style="width:' + sz + 'px;height:' + sz + 'px">' +
      '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="kp-ring__track" cx="50" cy="50" r="' + r + '" fill="none" stroke-width="' + sw + '"/>' +
      '<circle class="kp-ring__fill" cx="50" cy="50" r="' + r + '" fill="none" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + C.toFixed(2) +
      '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 50 50)"/></svg><div class="kp-ring__c">' + (o.center || '') + '</div></div>';
  }
  function insight(html, act, tone) { return '<div class="kp-insight' + (tone ? ' kp-insight--' + tone : '') + '">' + html + (act ? '<span class="kp-act">' + act + '</span>' : '') + '</div>'; }
  function kpi(l, v, s, cls) { return '<div class="kp-kpi' + (cls ? ' kp-kpi--' + cls : '') + '"><div class="kp-kpi__l">' + l + '</div><div class="kp-kpi__v">' + v + '</div><div class="kp-kpi__s">' + (s || '') + '</div></div>'; }
  function dayLabel(d) {
    if (d === today()) return 'Today';
    if (d === E.addDays(today(), -1)) return 'Yesterday';
    return E.parse(d).toLocaleDateString('en-GB', { weekday: 'long' });
  }
  function whenWord(d) { return d === today() ? 'today' : d === E.addDays(today(), -1) ? 'yesterday' : 'that day'; }
  function dateSub(d) { return E.parse(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function longDate(d) { return E.parse(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function clock(isoTs) { try { return new Date(isoTs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function fillIcons(root) {
    TN.els('[data-icon]', root).forEach(function (el) { if (!el.innerHTML) el.innerHTML = TN.icon(el.getAttribute('data-icon'), el.getAttribute('data-icon-size') ? +el.getAttribute('data-icon-size') : 18); });
  }
  function seen(key, set) {
    try { if (set) localStorage.setItem('sp-deck:' + key, '1'); return localStorage.getItem('sp-deck:' + key) === '1'; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------- state */
  function list() { return Object.keys(S.days).map(function (d) { return S.days[d]; }); }
  function rebuild() {
    S.model = SM.fit(list(), S.profile, today());
    S.M = E.build(Object.keys(S.days).map(viewOf), S.profile, today(), { assume: function (d) { return S.model.predictDay(d).blocks; } });
  }
  /* A day as the screens see it: the stored row, or the usual day standing
     in (every minute assumed) when there is none. A row that only knows a
     part of the day (a Focus session, one edited category) gets the rest
     from the usual day, still marked assumed. */
  function viewOf(d) {
    var r = S.days[d];
    if (!r) return { d: d, blocks: S.model.predictDay(d).blocks, src: {}, note: '', confirmed_at: null, virtual: true };
    if (!r.src || r.confirmed_at) return r;
    var pred = S.model.predictDay(d).blocks, b = Object.assign({}, r.blocks), locked = {}, filled = false;
    Object.keys(b).forEach(function (k) { if (E.srcOf(r, k) !== 'assumed') locked[k] = 1; });
    Object.keys(pred).forEach(function (k) { if (!r.src[k] && !b[k]) { b[k] = pred[k]; filled = true; } });
    return filled ? Object.assign({}, r, { blocks: SM.fitDay(b, S.profile, locked) }) : r;
  }
  function isConfirmed(v) { return !!(v && !v.virtual && (v.confirmed_at || !v.src)); }
  function srcMap(v) { var m = {}; S.profile.cats.forEach(function (c) { m[c.key] = E.srcOf(v, c.key); }); return m; }
  function assumedMinutes(v) { var t = 0; Object.keys(v.blocks || {}).forEach(function (k) { if (E.srcOf(v, k) === 'assumed') t += v.blocks[k]; }); return t; }

  /* ---------------------------------------------------------- navigation */
  var TITLES = { today: ['Today', 'How much of your time stays yours.'], week: ['This week', 'Seven days, side by side.'], insights: ['Insights', 'What the hours say, and one idea a day.'], settings: ['Usual day', 'Where RECKON starts, before it knows your weeks.'], edit: ['Edit day', ''] };
  function showScreen(name, opts) {
    if (!TITLES[name]) name = 'today';
    opts = opts || {};
    var prev = S.screen;
    S.screen = name;
    if (name === 'edit') S.from = opts.from || (prev !== 'edit' ? prev : S.from);
    TN.els('.kp-screen').forEach(function (sc) { sc.hidden = sc.getAttribute('data-screen') !== name; });
    var tab = name === 'edit' ? S.from : name;
    TN.els('#sp-bar [data-screen]').forEach(function (b) { if (b.getAttribute('data-screen') === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    document.body.classList.toggle('is-pushed', name === 'edit');
    $('sp-title').textContent = TITLES[name][0]; $('sp-sub').textContent = TITLES[name][1];
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
    render(name);
    window.scrollTo(0, 0);
    if (TN.titleChanged) TN.titleChanged();
  }
  function render(name) {
    renderRate();
    if (name === 'today') renderToday();
    else if (name === 'edit') renderEdit();
    else if (name === 'week') renderWeek();
    else if (name === 'insights') renderInsights();
    else renderSettings();
  }
  function renderRate() {
    var box = $('sp-rate'), w = S.M && S.M.week;
    if (!w || !w.n) { box.innerHTML = ''; return; }
    box.innerHTML = '<b>' + Math.round(w.rate) + '%</b><span>yours · last 7 days</span>';
  }

  /* --------------------------------------------------------------- Today */
  function compare(yours, usual, dayName) {
    var diff = yours - usual;
    if (Math.abs(diff) < 15) return 'About a usual ' + dayName;
    return hm(Math.abs(diff)) + (diff > 0 ? ' more' : ' less') + ' than a usual ' + dayName;
  }
  function renderToday() {
    var d = today(), v = viewOf(d), prof = S.profile, pred = S.model.predictDay(d);
    var st = E.dayStats(v.blocks, prof), done = isConfirmed(v);
    var target = prof.target_bp / 100, reserve = Math.round(st.waking * target / 100);
    var tone = st.kept >= reserve ? 'good' : st.kept >= reserve / 2 ? 'warn' : 'bad';
    var label = done ? 'Yours today' : 'Yours today, if it goes like a usual ' + pred.dayName;
    var sub = done ? compare(st.kept, pred.usualYours, pred.dayName) + ' · checked in ' + clock(v.confirmed_at || v.updated_at)
      : st.kept >= reserve ? 'That would clear your ' + target + '% target.' : hm(reserve - st.kept) + ' short of your ' + target + '% target on a usual ' + pred.dayName + '.';
    var hg = SG.hero(S.goals, Object.keys(S.days).map(viewOf), S.focus.recent, d);
    if (hg) { $('today-hero').innerHTML = goalHero(hg, st, done, pred); }
    else $('today-hero').innerHTML = '<div class="panel kp-hero sp-hero' + (done ? '' : ' is-assumed') + '"><div class="kp-hero__top"><div>' +
      '<p class="eyebrow">' + esc(longDate(d)) + '</p>' +
      '<div class="kp-hero__label">' + esc(label) + '</div>' +
      '<div class="kp-hero__big">' + hm(st.kept) + '</div>' +
      '<div class="kp-hero__sub">' + esc(sub) + '</div></div>' +
      ring(Math.min(1, st.kept / Math.max(1, reserve)), { size: 104, cls: tone === 'good' ? '' : tone === 'warn' ? 'warn' : 'muted', center: '<b>' + Math.round(st.rate) + '%</b><span>of waking<br>target ' + target + '%</span>' }) + '</div></div>';
    paintBar('today-bar', 'today-legend', v);
    renderGoals();
    var am = assumedMinutes(v);
    $('today-note').innerHTML = am > 0 ? '<i class="sp-swatch is-assumed"></i>Faded parts are assumed from a usual ' + esc(pred.dayName) + '. Checking in makes them true.' : done ? 'Every hour of today is on the record.' : '';
    // The one action, and whose day it is about.
    var y = E.addDays(d, -1), yv = viewOf(y), anyRecord = Object.keys(S.days).length > 0;
    var target_ = (hour() < 12 && anyRecord && !isConfirmed(yv)) ? y : d;
    var btn = $('checkin'), sub2 = $('checkin-sub');
    btn.setAttribute('data-day', target_);
    if (target_ === y) { btn.textContent = 'Check in for yesterday'; btn.className = 'btn btn--primary btn--lg btn--block'; sub2.textContent = 'Yesterday is still assumed. A few swipes and it is on the record.'; }
    else if (!done) { btn.textContent = 'Check in'; btn.className = 'btn btn--primary btn--lg btn--block'; sub2.textContent = hour() < 19 ? 'Best tonight, when the day is done — about 20 seconds.' : 'About 20 seconds. A usual day is one swipe.'; }
    else { btn.textContent = 'Check in again'; btn.className = 'btn btn--ghost btn--lg btn--block'; sub2.textContent = ''; }
  }
  /* The pinned countdown takes the hero; today's hours shrink to one line. */
  function goalHero(hg, st, done, pred) {
    var g = hg.goal, x = hg.status, w = SG.say(x);
    var p = x.pct != null ? x.pct : Math.max(0, Math.min(1, SG.diff(g.start_on || today(), today()) / Math.max(1, SG.diff(g.start_on || today(), g.due_on))));
    var tone = x.state === 'behind' || x.state === 'overdue' ? 'warn' : '';
    var center = x.target ? '<b>' + Math.round(p * 100) + '%</b><span>' + E.hm(x.total) + '<br>of ' + E.hm(x.target) + '</span>' : '<b>' + Math.max(0, x.daysLeft) + '</b><span>days</span>';
    return '<div class="panel kp-hero sp-hero sp-hero--goal" data-goal="' + esc(g.id) + '"><div class="kp-hero__top"><div>' +
      '<p class="eyebrow">' + esc(g.title) + '</p>' +
      '<div class="kp-hero__big">' + esc(w.head) + '</div>' +
      '<div class="kp-hero__sub">' + esc(w.sub) + '</div></div>' +
      ring(p, { size: 104, cls: tone, center: center }) + '</div>' +
      '<p class="sp-hero__yours">' + (done ? 'Yours today: <b>' + hm(st.kept) + '</b> · ' + esc(compare(st.kept, pred.usualYours, pred.dayName).toLowerCase()) : 'Yours today, if it goes like a usual ' + esc(pred.dayName) + ': <b>' + hm(st.kept) + '</b>') + '</p></div>';
  }

  /* ---------------------------------------------------------- countdowns */
  function renderGoals() {
    var box = $('goals-list'), note = $('goals-note');
    if (S.needsSchema) {
      box.innerHTML = '<div class="list-row list-row--static"><span class="list-row__label">Countdowns need one more database step: run <b>supabase/schema.sql</b> once in Supabase.</span></div>';
      note.textContent = ''; return;
    }
    var rows = SG.list(S.goals, Object.keys(S.days).map(viewOf), S.focus.recent, today());
    var cm = E.catMap(S.profile);
    box.innerHTML = rows.map(function (x) {
      var g = x.goal, w = SG.say(x.status), c = g.cat && cm[g.cat];
      var tone = x.status.state === 'behind' || x.status.state === 'overdue' ? ' is-behind' : x.status.state === 'done' ? ' is-done' : '';
      return '<div class="sp-goal' + tone + '" data-goal="' + esc(g.id) + '">' +
        '<button type="button" class="sp-goal__main" data-goal-edit="' + esc(g.id) + '"><b>' + esc(g.title) + (g.pinned ? ' <span class="sp-pin" aria-label="on Today">' + TN.icon('flag', 12) + '</span>' : '') + '</b>' +
        '<span class="sp-goal__head">' + esc(w.head) + (c ? ' · ' + esc(c.name) : '') + '</span><span class="sp-goal__sub">' + esc(w.sub) + '</span>' +
        (x.status.pct != null ? '<span class="sp-goal__track"><i style="width:' + Math.round(x.status.pct * 100) + '%"></i></span>' : '') + '</button>' +
        (x.status.state !== 'done' ? '<button type="button" class="sp-goal__go" data-goal-focus="' + esc(g.id) + '" aria-label="Focus on ' + esc(g.title) + '">' + TN.icon('play', 18) + '</button>' : '') + '</div>';
    }).join('') + '<button type="button" class="list-row sp-goal-add" id="goal-add">' + TN.icon('plus', 18) + '<span class="list-row__label">Add a countdown</span></button>';
    note.textContent = rows.length ? '' : 'A goal with a date — a course, a project, a trip. RECKON works out the pace it needs.';
  }
  function openGoal(id) {
    var g = id ? S.goals.filter(function (x) { return x.id === id; })[0] : null;
    $('gs-title').textContent = g ? 'Edit countdown' : 'New countdown';
    $('gs-name').value = g ? g.title : '';
    $('gs-due').value = g ? g.due_on : E.addDays(today(), 30);
    $('gs-due').min = g ? '' : today();
    $('gs-hours').value = g && g.target_min ? Math.round(g.target_min / 6) / 10 : '';
    var cats = S.profile.cats.slice().sort(function (a, b) { return (a.cls === 'mine' ? 0 : 1) - (b.cls === 'mine' ? 0 : 1); });
    $('gs-cat').innerHTML = '<option value="">Focus only</option>' + cats.map(function (c) { return '<option value="' + esc(c.key) + '">' + esc(c.name) + '</option>'; }).join('');
    $('gs-cat').value = g ? (g.cat || '') : 'learning';
    $('gs-pin').checked = g ? !!g.pinned : !S.goals.some(function (x) { return x.pinned && !x.done_at; });
    $('gs-error').textContent = '';
    $('gs-delete').hidden = !g; $('gs-done').hidden = !g;
    $('gs-done').textContent = g && g.done_at ? 'Not done yet' : 'Mark done';
    $('goal-form').onsubmit = async function (ev) {
      ev.preventDefault();
      var hours = $('gs-hours').value.trim();
      var body = { title: $('gs-name').value, due_on: $('gs-due').value, target_min: hours ? Math.round(Number(hours) * 60) : null, cat: $('gs-cat').value || null, pinned: $('gs-pin').checked };
      try {
        var r = await api(g ? '/api/spent/goals/' + encodeURIComponent(g.id) : '/api/spent/goals', { method: g ? 'PUT' : 'POST', body: body });
        upsertGoal(r.goal);
        $('goal-sheet').close();
        TN.toast(g ? 'Saved.' : 'Countdown added.', 'success');
      } catch (e) { $('gs-error').textContent = e.message || 'Could not save.'; }
    };
    $('gs-delete').onclick = async function () {
      $('goal-sheet').close();
      var before = S.goals.slice();
      S.goals = S.goals.filter(function (x) { return x.id !== g.id; }); renderToday();
      try {
        await api('/api/spent/goals/' + encodeURIComponent(g.id), { method: 'DELETE' });
        undoToast('Deleted “' + g.title + '”.', async function () {
          try { var r = await api('/api/spent/goals/' + encodeURIComponent(g.id), { method: 'PUT', body: { restore: true } }); upsertGoal(r.goal); } catch (e) { fail(e); }
        });
      } catch (e) { S.goals = before; renderToday(); fail(e); }
    };
    $('gs-done').onclick = async function () {
      try { var r = await api('/api/spent/goals/' + encodeURIComponent(g.id), { method: 'PUT', body: { done: !g.done_at } }); upsertGoal(r.goal); $('goal-sheet').close(); }
      catch (e) { $('gs-error').textContent = e.message; }
    };
    $('goal-sheet').showModal();
  }
  function upsertGoal(g) {
    var found = false;
    S.goals = S.goals.map(function (x) { if (x.id === g.id) { found = true; return g; } return g.pinned ? Object.assign({}, x, { pinned: false }) : x; });
    if (!found) S.goals.push(g);
    if (S.screen === 'today') renderToday();
  }

  /* --------------------------------------------------------------- Focus */
  function openFocusPicker() {
    if (S.focus.active) { showFocus(); return; }
    var open = S.goals.filter(function (g) { return !g.done_at && !g.deleted_at; });
    var mine = S.profile.cats.filter(function (c) { return c.cls === 'mine'; });
    var h = '';
    if (open.length) h += '<div class="list-group"><p class="list-group__title">A countdown</p><div class="list-group__card">' + open.map(function (g) {
      var c = g.cat && E.catMap(S.profile)[g.cat];
      return '<button type="button" class="list-row" data-focus-goal="' + esc(g.id) + '"><span class="list-row__icon">' + TN.icon('flag', 18) + '</span><span class="list-row__label">' + esc(g.title) + '<small>' + (c ? esc(c.name) : 'Focus only') + '</small></span></button>';
    }).join('') + '</div></div>';
    h += '<div class="list-group"><p class="list-group__title">' + (open.length ? 'Or just a category' : 'What is the time for?') + '</p><div class="list-group__card">' + mine.map(function (c) {
      return '<button type="button" class="list-row" data-focus-cat="' + esc(c.key) + '"><span class="list-row__icon">' + TN.icon(c.icon, 18) + '</span><span class="list-row__label">' + esc(c.name) + '</span></button>';
    }).join('') + '</div></div>';
    $('fs-list').innerHTML = h;
    $('fs-title').textContent = 'Focus on…';
    $('focus-sheet').showModal();
  }
  /* A countdown with no category still needs one for the day's record. */
  function pickCatFor(goal) {
    var mine = S.profile.cats.filter(function (c) { return c.cls === 'mine'; });
    $('fs-title').textContent = 'Count it as…';
    $('fs-list').innerHTML = '<div class="list-group"><p class="list-group__title">“' + esc(goal.title) + '” has no category. Which part of the day is it?</p><div class="list-group__card">' + mine.map(function (c) {
      return '<button type="button" class="list-row" data-focus-cat="' + esc(c.key) + '" data-focus-for="' + esc(goal.id) + '"><span class="list-row__icon">' + TN.icon(c.icon, 18) + '</span><span class="list-row__label">' + esc(c.name) + '</span></button>';
    }).join('') + '</div></div>';
    if (!$('focus-sheet').open) $('focus-sheet').showModal();
  }
  async function startFocus(goalId, cat) {
    var g = goalId ? S.goals.filter(function (x) { return x.id === goalId; })[0] : null;
    if (g && !g.cat && !cat) { pickCatFor(g); return; }
    if ($('focus-sheet').open) $('focus-sheet').close();
    try {
      var r = await api('/api/spent/focus/start', { method: 'POST', body: { goal_id: goalId || null, cat: (g && g.cat) || cat } });
      S.focus.active = r.session;
      showFocus();
    } catch (e) { fail(e); }
  }
  function elapsed(sess) { return Math.max(0, Date.now() - Date.parse(sess.started_at)); }
  function clockText(ms) {
    var t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return (h ? h + ':' + two(m) : m) + ':' + two(sec);
  }
  /* Full screen: what it is for, the time, Stop. Keeps the screen awake
     where the browser allows; the start time lives on the server, so a
     reload — or another device — picks the session up where it is. */
  function showFocus() {
    var sess = S.focus.active; if (!sess) return;
    var el = $('focus-screen');
    if (!el) {
      el = document.createElement('div'); el.id = 'focus-screen'; el.className = 'focus';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'focus-what');
      document.body.appendChild(el);
    }
    var g = sess.goal_id ? S.goals.filter(function (x) { return x.id === sess.goal_id; })[0] : null, c = E.catMap(S.profile)[sess.cat];
    el.innerHTML = '<div class="focus__body"><p class="focus__eyebrow">Focus · ' + esc(c ? c.name : sess.cat) + '</p>' +
      '<h2 class="focus__what" id="focus-what">' + esc(g ? g.title : (c ? c.name : 'Focus')) + '</h2>' +
      '<p class="focus__clock" id="focus-clock" aria-live="off">0:00</p>' +
      '<p class="focus__since">Started ' + esc(clock(sess.started_at)) + '. Close the app if you like — it keeps counting.</p></div>' +
      '<div class="focus__foot"><button type="button" class="btn btn--primary btn--lg btn--block" id="focus-stop">Stop</button>' +
      '<button type="button" class="btn btn--quiet" id="focus-discard">Discard this session</button></div>';
    document.documentElement.classList.add('deck-open');
    var tickFn = function () {
      var ms = elapsed(sess), n = $('focus-clock'); if (n) n.textContent = clockText(ms);
      if (ms > 600 * 60000 && n) n.setAttribute('data-capped', '1');
    };
    tickFn(); clearInterval(S.timer); S.timer = setInterval(tickFn, 1000);
    $('focus-stop').onclick = function () { stopFocus(false); };
    $('focus-discard').onclick = function () { stopFocus(true); };
    keepAwake(true);
    try { $('focus-stop').focus({ preventScroll: true }); } catch (e) {}
  }
  function hideFocus() {
    clearInterval(S.timer); S.timer = null;
    var el = $('focus-screen'); if (el) el.remove();
    document.documentElement.classList.remove('deck-open');
    keepAwake(false);
  }
  async function keepAwake(on) {
    try {
      if (on && !S.wake && navigator.wakeLock && navigator.wakeLock.request) { S.wake = await navigator.wakeLock.request('screen'); S.wake.addEventListener && S.wake.addEventListener('release', function () { S.wake = null; }); }
      else if (!on && S.wake) { var w = S.wake; S.wake = null; await w.release(); }
    } catch (e) { S.wake = null; }   // refused (battery saver, iOS before 16.4): the timer still counts
  }
  async function stopFocus(discard) {
    var sess = S.focus.active; if (!sess) return;
    $('focus-stop').disabled = true;
    try {
      var r = await api('/api/spent/focus/stop', { method: 'POST', body: { id: sess.id, discard: !!discard } });
      S.focus.active = null; hideFocus();
      if (r.session) S.focus.recent.push(r.session);
      if (r.day) { S.days[r.day.d] = r.day; }
      rebuild(); render(S.screen);
      var c = E.catMap(S.profile)[sess.cat];
      if (discard) TN.toast('Discarded — nothing added.');
      else if (r.session && r.session.minutes > 0) TN.toast(hm(r.session.minutes) + ' of ' + lowerName(c ? c.name : sess.cat) + ' added to ' + dayLabel(sess.d).toLowerCase() + '.', 'success');
      else TN.toast('Under a minute — nothing added.');
    } catch (e) { var b = $('focus-stop'); if (b) b.disabled = false; fail(e); }
  }

  function paintBar(barId, legendId, v) {
    var prof = S.profile, blocks = v.blocks || {}, t = E.total(blocks);
    var ordered = prof.cats.slice().sort(function (a, b) { return CLASSES.indexOf(a.cls) - CLASSES.indexOf(b.cls); });
    var segs = ordered.filter(function (c) { return blocks[c.key] > 0; }).map(function (c) {
      var as = E.srcOf(v, c.key) === 'assumed';
      return '<i class="sp-bar__seg sp-bar__seg--' + c.cls + (as ? ' is-assumed' : '') + '" style="width:' + (blocks[c.key] / E.DAY * 100).toFixed(2) + '%" title="' + esc(c.name) + ' ' + hm(blocks[c.key]) + (as ? ' (assumed)' : '') + '"></i>';
    }).join('');
    $(barId).innerHTML = segs + (t < E.DAY ? '<i class="sp-bar__seg sp-bar__seg--none" style="width:' + ((E.DAY - t) / E.DAY * 100).toFixed(2) + '%"></i>' : '');
    var c = E.byClass(blocks, prof);
    $(barId).setAttribute('aria-label', CLASSES.map(function (k) { return E.CLASS_LABEL[k] + ' ' + hm(c[k]); }).join(', '));
    $(legendId).innerHTML = CLASSES.map(function (k) { return '<span class="sp-legend__item"><i class="sp-bar__seg--' + k + '"></i>' + E.CLASS_LABEL[k] + ' <b>' + hm(c[k]) + '</b></span>'; }).join('');
  }

  /* ------------------------------------------------------------ Check in */
  function dialCard(q, start, presets) {
    var cat = E.catMap(S.profile)[q.key];
    return { id: 'dial:' + q.key, kind: 'dial', key: q.key, icon: q.icon, title: 'How much ' + lowerName(q.name) + '?', value: start,
      max: SM.dialMax(q.stat, cat), step: 5, presets: presets || SM.presetsFor(q.stat, cat), reason: 'Drag round the ring, or tap a preset.' };
  }
  function lowerName(n) { return String(n).charAt(0).toLowerCase() + String(n).slice(1); }
  function openCheckIn(d) {
    if (S.deck) return S.deck;
    d = d || today();
    var v = viewOf(d), pred = S.model.predictDay(d), prof = S.profile;
    // What the day already knows for sure stays; the rest starts as the usual.
    var known = {}, vals = {}, src = {};
    prof.cats.forEach(function (c) {
      var s = E.srcOf(v, c.key);
      if (!v.virtual && s !== 'assumed') { known[c.key] = 1; src[c.key] = s; if (v.blocks[c.key]) vals[c.key] = v.blocks[c.key]; }
      else if (pred.blocks[c.key]) vals[c.key] = pred.blocks[c.key];
    });
    var qs = S.model.questionsFor(d, 5, { when: whenWord(d), exclude: Object.keys(known) });
    var usual = false, answered = {};
    // A countdown that is behind gets one question of its own, right after
    // "was it a usual day?" — and it survives a "yes" to that.
    var lagging = SG.behind(S.goals, Object.keys(S.days).map(viewOf), S.focus.recent, d).filter(function (x) { return !known[x.goal.cat]; })[0];
    var goalCard = null;
    if (lagging) {
      var gst = lagging.status, gcat = E.catMap(prof)[lagging.goal.cat];
      goalCard = { id: 'goal:' + lagging.goal.id, kind: 'question', icon: 'flag', title: 'Put time into ' + lagging.goal.title + ' ' + (whenWord(d) === 'today' ? 'today' : whenWord(d)) + '?',
        reason: 'Asked because it is behind: ' + hm(Math.ceil(gst.need / 5) * 5) + ' a day needed, ' + hm(Math.round(gst.actual / 5) * 5) + ' a day lately.',
        q: { kind: 'goal', key: lagging.goal.cat, name: gcat ? gcat.name : lagging.goal.cat, icon: gcat && gcat.icon, stat: pred.conf[lagging.goal.cat], predicted: 0, need: gst.need } };
      qs = qs.filter(function (q) { return q.key !== lagging.goal.cat; }).slice(0, 4);
    }
    var cards = qs.map(function (q) {
      return q.kind === 'usual'
        ? { id: q.id, kind: 'question', q: q, icon: 'sun', eyebrow: longDate(d), title: q.title, reason: q.reason }
        : { id: q.id, kind: 'question', q: q, icon: q.icon, title: q.title, reason: q.reason };
    });
    if (goalCard) cards.splice(1, 0, goalCard);
    var finished = false;
    S.deck = TNDeck.open({
      label: 'Check in for ' + whenWord(d),
      cards: cards,
      onAnswer: function (card, a, deck) {
        if (card.kind === 'dial') {
          if (a !== 'skip') { if (a.value > 0) vals[card.key] = a.value; else delete vals[card.key]; answered[card.key] = 1; }
          return;
        }
        var q = card.q;
        if (q.kind === 'goal') {
          if (a === 'yes') { var n15 = Math.max(15, Math.round(q.need / 15) * 15); deck.insertNext(dialCard(q, n15, [Math.max(15, Math.round(n15 / 30) * 15), n15, n15 * 2])); }
          else if (a === 'no') { delete vals[q.key]; answered[q.key] = 1; }
          return;
        }
        if (q.kind === 'usual') {
          if (a === 'yes') { usual = true; deck.clear(); if (goalCard && !answered[goalCard.q.key]) deck.push(goalCard); return; }
          // Not a usual day: make sure the deck asks about what most often
          // differs, up to the budget of five.
          var have = cards.filter(function (c) { return c.q && (c.q.kind === 'cat' || c.q.kind === 'goal'); }).map(function (c) { return c.q.key; });
          S.model.followUps(d, 4 - have.length, { when: whenWord(d), exclude: have.concat(Object.keys(known)) }).forEach(function (f) {
            deck.push({ id: f.id, kind: 'question', q: f, icon: f.icon, title: f.title, reason: f.reason });
          });
          return;
        }
        if (a === 'skip') return;
        var p = q.predicted;
        if (a === 'yes') { if (p > 0) answered[q.key] = 1; else deck.insertNext(dialCard(q, 60, [30, 60, 120])); }
        else if (p > 0) { var r15 = function (m) { return Math.max(15, Math.round(m / 15) * 15); }; deck.insertNext(dialCard(q, p, [0, r15(p / 2), r15(p * 1.5)].filter(function (m, i, arr) { return arr.indexOf(m) === i; }))); }
        else { delete vals[q.key]; answered[q.key] = 1; }
      },
      onDone: function () {
        finished = true;
        var locked = {};
        prof.cats.forEach(function (c) {
          if (known[c.key]) { locked[c.key] = 1; return; }
          if (usual || answered[c.key]) { src[c.key] = 'confirmed'; locked[c.key] = !!answered[c.key]; }
          else src[c.key] = 'assumed';
        });
        var blocks = SM.fitDay(vals, prof, locked);
        var prior = S.days[d] || null;
        var row = { d: d, blocks: blocks, src: src, note: (prior && prior.note) || '', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        // Optimistic: the screen moves now, the write follows; a failed
        // write puts the day back and says so.
        S.days[d] = row; rebuild(); render(S.screen);
        api('/api/spent/day', { method: 'PUT', body: { d: d, blocks: blocks, src: src, confirmed: true, note: row.note } })
          .then(function (r) { S.days[d] = r.day; rebuild(); render(S.screen); })
          .catch(function (e) { if (prior) S.days[d] = prior; else delete S.days[d]; rebuild(); render(S.screen); fail(e); });
        var st = E.dayStats(blocks, prof);
        var asked = Object.keys(answered).length;
        return { icon: 'check', title: hm(st.kept) + ' yours ' + whenWord(d),
          body: compare(st.kept, pred.usualYours, pred.dayName) + '.' + (usual ? '' : asked ? '' : ' The rest stays as usual.'),
          actions: [{ label: 'Done', value: 'done', primary: true }, { label: 'Edit day', value: 'edit' }] };
      },
      onSummary: function (value) { if (value === 'edit') { S.viewing = d; showScreen('edit', { from: 'today' }); } },
      onClose: function () { seen(d, true); S.deck = null; if (!finished) TN.toast('Nothing saved — the day stays as usual.'); }
    });
    return S.deck;
  }
  /* The check-in comes to you: after 19:00 for today, before noon for a
     yesterday nobody confirmed. Once per day; closing it is an answer. */
  function maybeAutoOpen() {
    if (S.screen !== 'today' || S.deck || S.focus.active) return;
    var d = today(), y = E.addDays(d, -1), h = hour();
    if (h >= 19 && !isConfirmed(viewOf(d)) && !seen(d)) openCheckIn(d);
    else if (h < 12 && Object.keys(S.days).length && !isConfirmed(viewOf(y)) && !seen(y)) openCheckIn(y);
  }

  /* ------------------------------------------------------------ Edit day */
  function renderEdit() {
    var d = S.viewing || today(), v = viewOf(d), prof = S.profile;
    $('day-label').textContent = dayLabel(d); $('day-sub').textContent = dateSub(d);
    $('day-next').disabled = d >= today();
    $('edit-back-label').textContent = TITLES[S.from] ? TITLES[S.from][0] : 'Today';
    paintBar('day-bar', 'day-legend', v);
    var t = E.total(v.blocks), un = E.DAY - t;
    $('day-unalloc').innerHTML = un > 0 ? '<b>' + hm(un) + '</b> of the day not placed' + (un > 180 ? ' — honest "Other" beats a flattering blank.' : '.') : un < 0 ? '<b class="neg">' + hm(-un) + ' over 24 hours</b> — something is counted twice.' : '<b>All 24 hours placed.</b>';
    var am = assumedMinutes(v), done = isConfirmed(v);
    $('day-status').innerHTML = done ? (am ? 'Checked in. ' + hm(am) + ' is still the usual, faded below.' : 'Checked in' + (v.confirmed_at ? ' at ' + esc(clock(v.confirmed_at)) : '') + '.')
      : 'Assumed from a usual ' + esc(SM.DAY_NAMES[E.dow(d)]) + '. Change what was different, then tap Done.';
    $('day-rows').innerHTML = CLASSES.map(function (cls) {
      var cats = prof.cats.filter(function (c) { return c.cls === cls; });
      if (!cats.length) return '';
      return '<div class="list-group"><p class="list-group__title sp-gt sp-gt--' + cls + '">' + GROUPS[cls] + '</p><div class="list-group__card">' +
        cats.map(function (c) { return rowHTML(c, v.blocks[c.key] || 0, 'day', E.srcOf(v, c.key) === 'assumed'); }).join('') + '</div></div>';
    }).join('');
    fillIcons($('day-rows'));
    $('day-note').value = v.note || '';
    $('day-saved').textContent = S.dirty ? 'Saving…' : (!v.virtual && v.updated_at ? 'Saved' : '');
  }
  function rowHTML(c, min, scope, assumed) {
    return '<div class="sp-row' + (assumed ? ' is-assumed' : '') + '" data-cat="' + esc(c.key) + '" data-scope="' + scope + '">' +
      '<span class="sp-row__icon sp-row__icon--' + c.cls + '"><span data-icon="' + esc(c.icon) + '"></span></span>' +
      '<button type="button" class="sp-row__name" data-type="1" aria-label="Set ' + esc(c.name) + '"><b>' + esc(c.name) + '</b>' + (assumed && min ? '<small>usual</small>' : '') + '</button>' +
      '<div class="sp-row__ctl"><button type="button" class="sp-step" data-step="-15" aria-label="Less ' + esc(c.name) + '">−</button>' +
      '<button type="button" class="sp-row__val" data-type="1">' + (min ? hm(min) : '<span class="muted">—</span>') + '</button>' +
      '<button type="button" class="sp-step" data-step="15" aria-label="More ' + esc(c.name) + '">+</button></div></div>';
  }
  function editable(d) {
    var v = viewOf(d);
    return { blocks: Object.assign({}, v.blocks), src: srcMap(v), note: v.note || '', confirmed_at: v.virtual ? null : v.confirmed_at, prior: v };
  }
  function setBlock(key, min) {
    var d = S.viewing, e = editable(d);
    min = Math.max(0, Math.min(E.DAY, Math.round(min / 5) * 5));
    if (min) e.blocks[key] = min; else delete e.blocks[key];
    if (E.total(e.blocks) > E.DAY) { TN.toast('That takes the day past 24 hours.', 'error'); return; }
    e.src[key] = 'confirmed';
    commit(d, e, false);
  }
  function commit(d, e, confirm) {
    var prior = S.days[d];
    S.days[d] = { d: d, blocks: e.blocks, src: e.src, note: e.note, confirmed_at: confirm ? new Date().toISOString() : e.confirmed_at, updated_at: prior ? prior.updated_at : null };
    S.dirty = true; S.pendingConfirm = S.pendingConfirm || !!confirm;
    rebuild(); render(S.screen);
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(saveDay, confirm ? 0 : 700);
  }
  async function saveDay() {
    var d = S.viewing, day = S.days[d];
    if (!S.dirty || !day) return;
    var confirm = !!S.pendingConfirm;
    S.dirty = false; S.pendingConfirm = false;
    try {
      var r = await api('/api/spent/day', { method: 'PUT', body: { d: d, blocks: day.blocks, src: day.src, note: day.note || '', confirmed: confirm || undefined } });
      if (!S.dirty) { S.days[d] = r.day; rebuild(); if (S.screen === 'edit' && S.viewing === d) $('day-saved').textContent = 'Saved'; }
    } catch (e) { S.dirty = true; S.pendingConfirm = confirm; fail(e); }
  }
  function openMinutes(key, scope) {
    var c = E.catMap(S.profile)[key]; if (!c) return;
    var isRule = scope === 'rule';
    var min = isRule ? (S.profile.rules[S.rule][key] || 0) : (viewOf(S.viewing).blocks[key] || 0);
    $('ms-title').textContent = isRule ? c.name + ' · usual ' + S.rule : c.name;
    $('ms-h').value = Math.floor(min / 60); $('ms-m').value = min % 60;
    $('ms-quick').innerHTML = (isRule ? [30, 60, 120, 240, 480, 540] : [15, 30, 60, 120, 240, 480]).map(function (m) { return '<button type="button" class="btn btn--ghost btn--sm" data-min="' + m + '">' + hm(m) + '</button>'; }).join('');
    var set = isRule ? setRule : setBlock;
    $('min-form').onsubmit = function (ev) { ev.preventDefault(); set(key, (Number($('ms-h').value) || 0) * 60 + (Number($('ms-m').value) || 0)); $('min-sheet').close(); };
    TN.els('#ms-quick [data-min]').forEach(function (b) { b.addEventListener('click', function () { set(key, +b.getAttribute('data-min')); $('min-sheet').close(); }); });
    $('min-sheet').showModal();
  }

  /* ---------------------------------------------------------------- Week */
  function renderWeek() {
    var M = S.M, rows = E.weekRows(M, today()), prof = S.profile;
    var w = M.week, pw = M.prevWeek;
    var h = '<div class="panel kp-hero"><div class="kp-hero__top"><div><p class="eyebrow">Last 7 days · ' + w.confirmedN + ' of ' + w.n + ' checked in</p>' +
      '<div class="kp-hero__label">Yours per day</div><div class="kp-hero__big">' + hm(w.kept) + '</div>' +
      '<div class="kp-hero__sub">' + (pw.n ? hm(Math.abs(w.kept - pw.kept)) + (w.kept >= pw.kept ? ' more' : ' less') + ' than the week before' : 'First week on record') + '</div></div>' +
      ring(Math.min(1, w.rate / 100), { size: 96, center: '<b>' + Math.round(w.rate) + '%</b><span>yours</span>' }) + '</div>' +
      (w.n && w.assumed > 0.5 ? '<p class="sp-assumed-note">Mostly assumed — check in a few evenings and this gets sharper.</p>' : '') + '</div>';
    h += '<div class="list-group"><p class="list-group__title">Day by day · tap a day to edit it</p><div class="panel"><div class="sp-week">' +
      rows.map(function (x) {
        var s = x.row ? x.row.s : null, d = E.parse(x.d), as = x.row && x.row.assumed;
        var segs = s ? CLASSES.map(function (k) { return '<i class="sp-bar__seg--' + k + '" style="height:' + (s.cls[k] / E.DAY * 100).toFixed(1) + '%"></i>'; }).join('') : '';
        return '<button type="button" class="sp-week__day' + (s ? '' : ' is-empty') + (as ? ' is-assumed' : '') + (x.d === today() ? ' is-today' : '') + '" data-day="' + x.d + '" aria-label="' + esc(longDate(x.d)) + (s ? ', ' + hm(s.kept) + ' yours' + (as ? ', assumed' : '') : ', nothing yet') + '">' +
          '<span class="sp-week__col">' + segs + '</span><b>' + d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2) + '</b><span class="sp-week__v">' + (s ? hm(s.kept) : '·') + '</span></button>';
      }).join('') + '</div>' +
      '<div class="sp-legend">' + CLASSES.map(function (k) { return '<span class="sp-legend__item"><i class="sp-bar__seg--' + k + '"></i>' + E.CLASS_LABEL[k] + '</span>'; }).join('') + '<span class="sp-legend__item"><i class="sp-swatch is-assumed"></i>Assumed</span></div></div></div>';
    var cats = prof.cats.filter(function (c) { return w.cat[c.key] > 0; }).sort(function (a, b) { return w.cat[b.key] - w.cat[a.key]; });
    var max = cats.length ? w.cat[cats[0].key] : 1;
    h += '<div class="list-group"><p class="list-group__title">Where the week went · average per day</p><div class="panel"><div class="kp-catlist">' +
      (cats.length ? cats.map(function (c) { var v = w.cat[c.key], p = pw.cat[c.key] || 0;
        return '<div class="kp-catrow"><span class="sp-row__icon sp-row__icon--' + c.cls + '" data-icon="' + esc(c.icon) + '"></span><div class="kp-catrow__name"><b>' + esc(c.name) + '</b><div class="kp-track"><i class="sp-bar__seg--' + c.cls + '" style="width:' + Math.round(v / max * 100) + '%"></i></div></div>' +
          '<div class="kp-catrow__amt">' + hm(v) + (pw.n && Math.abs(v - p) >= 15 ? '<small class="' + ((v > p) === (c.cls === 'mine') ? 'pos' : 'neg') + '">' + (v > p ? '+' : '−') + hm(Math.abs(v - p)) + ' vs last</small>' : '') + '</div></div>'; }).join('')
      : '<p class="muted">Nothing in the last seven days yet. Check in tonight and this fills in.</p>') + '</div></div></div>';
    $('week-wrap').innerHTML = h;
    fillIcons($('week-wrap'));
    TN.els('#week-wrap [data-day]').forEach(function (b) { b.addEventListener('click', function () { S.viewing = b.getAttribute('data-day'); showScreen('edit', { from: 'week' }); }); });
  }

  /* ------------------------------------------------------------ Insights */
  function renderInsights() {
    var M = S.M, box = $('ins-wrap');
    if (!M.n) {
      box.innerHTML = '<div class="panel"><h2>Nothing to read yet</h2><p class="muted" style="margin-top:var(--space-2)">Check in tonight — one swipe on a usual day — and this page starts to say something true about where your time goes.</p></div>';
      return;
    }
    var a = M.month.n >= 3 ? M.month : M.all, label = M.month.n >= 3 ? 'Last 28 days' : 'All ' + M.n + ' day' + (M.n === 1 ? '' : 's');
    var les = E.lesson(M, today(), S.kept ? S.kept.hourly : 0, S.kept ? function (m) { return TN.money(m, S.kept.currency, { compact: true }); } : null);
    var h = '<div class="panel kp-hero"><div class="kp-hero__top"><div><p class="eyebrow">' + label + ' · ' + a.confirmedN + ' checked in</p><div class="kp-hero__label">Of every waking hour</div>' +
      '<div class="kp-hero__big">' + Math.round(a.rate) + '%</div><div class="kp-hero__sub">is yours by choice · target ' + (S.profile.target_bp / 100) + '%</div></div>' +
      ring(Math.min(1, a.rate / 100), { size: 96, cls: a.rate >= S.profile.target_bp / 100 ? '' : a.rate >= S.profile.target_bp / 200 ? 'warn' : 'muted', center: '<b>' + hm(a.kept) + '</b><span>a day</span>' }) + '</div>' +
      (a.assumed > 0.5 ? '<p class="sp-assumed-note">Mostly assumed: ' + a.confirmedN + ' of ' + a.n + ' days were checked in. Assumed days count about a third as much.</p>' : '') +
      '<div class="kp-kpis" style="margin-top:var(--space-3)">' + kpi('Streak', M.streak + ' day' + (M.streak === 1 ? '' : 's'), 'checked in, in a row', M.streak >= 7 ? 'ok' : M.streak >= 3 ? 'warn' : 'bad') +
      kpi('Drift', hm(a.leak) + '/day', pct(a.leakRate) + ' of waking time', a.leakRate < 10 ? 'ok' : a.leakRate < 20 ? 'warn' : 'bad') +
      kpi('Sleep', hm(a.sleep), a.sleep >= 420 ? 'enough' : 'short of 7h', a.sleep >= 420 ? 'ok' : 'warn') +
      kpi('Best day', M.best ? hm(M.best.s.kept) : '—', M.best ? dateSub(M.best.d) : '', 'ok') + '</div></div>';
    if (les) h += '<div class="panel kp-lesson"><p class="eyebrow">' + TN.icon('lightbulb', 14) + ' One thing to learn today · ' + esc(les.title) + '</p><h2>' + les.lead + '</h2><p>' + les.body + '</p><p class="kp-lesson__why">' + esc(les.why) + '</p></div>';
    if (S.kept && S.kept.hourly > 0) {
      var money = function (m) { return TN.money(Math.round(m), S.kept.currency, { compact: true }); };
      var hourly = S.kept.hourly;
      h += '<div class="panel"><div class="panel__head"><h2>Time and money, side by side</h2><span class="muted">from KEPT</span></div>' +
        '<div class="kp-kpis">' + kpi('Your hour', money(hourly), 'average income ÷ 176 working hours') +
        kpi('Drift, priced', money(a.leak / 60 * hourly), 'per day at that rate', 'warn') +
        kpi('Yours, priced', money(a.kept / 60 * hourly), 'what the hours that were yours would fetch', 'ok') +
        kpi('A month of drift', money(a.leak / 60 * hourly * 30), 'the same arithmetic KEPT uses for purchases') + '</div></div>';
    }
    var weeks = [];
    for (var i = 3; i >= 0; i--) {
      var end = E.addDays(today(), -i * 7 + 1), lst = [];
      for (var k = 1; k <= 7; k++) { var dd = E.addDays(end, -k); if (M.byD[dd]) lst.push(M.byD[dd]); }
      var W = 0, kept = 0, wk = 0;
      lst.forEach(function (r) { W += r.w; kept += r.w * r.s.kept; wk += r.w * r.s.waking; });
      weeks.push({ label: i === 0 ? 'This week' : i + 'w ago', n: lst.length, rate: wk ? kept / wk * 100 : null });
    }
    h += '<div class="panel"><div class="panel__head"><h2>Four weeks</h2><span class="muted">share of waking hours that was yours</span></div><div class="sp-trend">' +
      weeks.map(function (w) { return '<div class="sp-trend__col"><i style="height:' + (w.rate == null ? 0 : Math.min(100, w.rate * 2)) + '%"></i><b>' + (w.rate == null ? '—' : Math.round(w.rate) + '%') + '</b><span>' + w.label + '</span></div>'; }).join('') + '</div></div>';
    box.innerHTML = h;
  }

  /* ------------------------------------------------------------ Settings */
  function renderSettings() {
    var prof = S.profile, rule = prof.rules[S.rule] || {};
    TN.els('#rule-seg [data-rule]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-rule') === S.rule)); });
    $('rule-rows').innerHTML = '<div class="list-group__card">' + prof.cats.map(function (c) { return rowHTML(c, rule[c.key] || 0, 'rule', false); }).join('') + '</div>';
    fillIcons($('rule-rows'));
    var t = E.total(rule);
    $('rule-total').textContent = hm(t) + ' of 24h placed in the usual ' + S.rule + (t < E.DAY ? ' · ' + hm(E.DAY - t) + ' open for choice' : '');
    $('target-range').value = prof.target_bp / 100; $('target-label').textContent = (prof.target_bp / 100) + '% · ' + hm(Math.round(1020 * prof.target_bp / 10000)) + ' of a 17h day';
    var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    $('dow-pick').innerHTML = names.map(function (n, i) { return '<button type="button" class="sp-dow__b" data-dow="' + i + '" aria-pressed="' + (prof.weekend.indexOf(i) > -1) + '">' + n + '</button>'; }).join('');
  }
  var profTimer = null;
  function saveProfile(patch) {
    S.profile = E.profileOf(Object.assign({}, S.profile, patch));
    rebuild();
    clearTimeout(profTimer);
    profTimer = setTimeout(async function () {
      try { var r = await api('/api/spent/profile', { method: 'PUT', body: patch }); S.profile = E.profileOf(r.profile); rebuild(); }
      catch (e) { fail(e); }
    }, 600);
  }
  function setRule(key, min) {
    var rules = { weekday: Object.assign({}, S.profile.rules.weekday), weekend: Object.assign({}, S.profile.rules.weekend) };
    min = Math.max(0, Math.min(E.DAY, Math.round(min / 5) * 5));
    if (min) rules[S.rule][key] = min; else delete rules[S.rule][key];
    if (E.total(rules[S.rule]) > E.DAY) { TN.toast('That takes the usual day past 24 hours.', 'error'); return; }
    saveProfile({ rules: rules });
    renderSettings();
  }

  /* --------------------------------------------------------------- wiring */
  function wire() {
    TN.els('#sp-bar [data-screen]').forEach(function (b) { b.addEventListener('click', function () { showScreen(b.getAttribute('data-screen')); }); });
    $('checkin').addEventListener('click', function () { openCheckIn(this.getAttribute('data-day') || today()); });
    $('edit-open').addEventListener('click', function () { S.viewing = today(); showScreen('edit', { from: 'today' }); });
    $('focus-open').addEventListener('click', openFocusPicker);
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-goal-edit], [data-goal-focus], #goal-add, [data-focus-goal], [data-focus-cat], .sp-hero--goal');
      if (!t) return;
      if (t.id === 'goal-add') openGoal(null);
      else if (t.hasAttribute('data-goal-edit')) openGoal(t.getAttribute('data-goal-edit'));
      else if (t.hasAttribute('data-goal-focus')) startFocus(t.getAttribute('data-goal-focus'));
      else if (t.hasAttribute('data-focus-goal')) startFocus(t.getAttribute('data-focus-goal'));
      else if (t.hasAttribute('data-focus-cat')) startFocus(t.getAttribute('data-focus-for') || null, t.getAttribute('data-focus-cat'));
      else if (t.classList.contains('sp-hero--goal')) openGoal(t.getAttribute('data-goal'));
    });
    $('edit-back').addEventListener('click', function () { if (S.dirty) saveDay(); showScreen(S.from || 'today'); });
    $('edit-done').addEventListener('click', function () {
      var d = S.viewing, e = editable(d);
      Object.keys(e.src).forEach(function (k) { if (e.src[k] === 'assumed') e.src[k] = 'confirmed'; });
      commit(d, e, true);
      TN.toast(dayLabel(d) + ' is on the record.', 'success');
      showScreen(S.from || 'today');
    });
    $('day-prev').addEventListener('click', function () { if (S.dirty) saveDay(); S.viewing = E.addDays(S.viewing, -1); renderEdit(); });
    $('day-next').addEventListener('click', function () { if (S.viewing < today()) { if (S.dirty) saveDay(); S.viewing = E.addDays(S.viewing, 1); renderEdit(); } });
    $('day-pick').addEventListener('click', function () { var i = $('day-input'); i.value = S.viewing; i.max = today(); try { i.showPicker(); } catch (e) { i.click(); } });
    $('day-input').addEventListener('change', function () { if (this.value && this.value <= today()) { S.viewing = this.value; renderEdit(); } });
    document.addEventListener('click', function (ev) {
      var step = ev.target.closest('.sp-step'), row = ev.target.closest('.sp-row');
      if (!row) return;
      var key = row.getAttribute('data-cat'), scope = row.getAttribute('data-scope');
      if (step) {
        var cur = scope === 'rule' ? (S.profile.rules[S.rule][key] || 0) : (viewOf(S.viewing).blocks[key] || 0);
        var next = cur + (+step.getAttribute('data-step'));
        if (scope === 'rule') setRule(key, next); else setBlock(key, next);
        return;
      }
      if (ev.target.closest('[data-type]')) openMinutes(key, scope);
    });
    $('day-usual').addEventListener('click', function () {
      var d = S.viewing, e = editable(d), u = S.model.predictDay(d).blocks;
      Object.keys(u).forEach(function (k) { if (!e.blocks[k]) { e.blocks[k] = u[k]; e.src[k] = 'assumed'; } });
      e.blocks = SM.fitDay(e.blocks, S.profile, {});
      commit(d, e, false);
    });
    $('day-clear').addEventListener('click', function () {
      var d = S.viewing, e = editable(d), before = { blocks: Object.assign({}, e.blocks), src: Object.assign({}, e.src) };
      e.blocks = {}; S.profile.cats.forEach(function (c) { e.src[c.key] = 'confirmed'; });
      commit(d, e, false);
      undoToast('Cleared ' + dayLabel(d).toLowerCase() + '.', function () { var e2 = editable(d); e2.blocks = before.blocks; e2.src = before.src; commit(d, e2, false); });
    });
    $('day-note').addEventListener('input', function () { var d = S.viewing, e = editable(d); e.note = this.value; S.days[d] = Object.assign({}, viewOf(d), { blocks: e.blocks, src: e.src, note: e.note, virtual: false, confirmed_at: e.confirmed_at }); S.dirty = true; clearTimeout(S.saveTimer); S.saveTimer = setTimeout(saveDay, 700); });
    TN.els('#rule-seg [data-rule]').forEach(function (b) { b.addEventListener('click', function () { S.rule = b.getAttribute('data-rule'); renderSettings(); }); });
    $('target-range').addEventListener('input', function () { $('target-label').textContent = this.value + '% · ' + hm(Math.round(1020 * this.value / 100)) + ' of a 17h day'; });
    $('target-range').addEventListener('change', function () { saveProfile({ target_bp: this.value * 100 }); renderRate(); });
    $('dow-pick').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-dow]'); if (!b) return;
      var n = +b.getAttribute('data-dow'), w = S.profile.weekend.slice(), i = w.indexOf(n);
      if (i > -1) w.splice(i, 1); else w.push(n);
      saveProfile({ weekend: w }); renderSettings();
    });
    TN.els('dialog.sheet').forEach(function (dlg) { dlg.addEventListener('click', function (ev) { if (ev.target === dlg || ev.target.closest('[data-close]')) dlg.close(); }); });
    window.addEventListener('pagehide', function () { if (S.dirty) saveDay(); });
    window.addEventListener('hashchange', function () { var n = location.hash.replace('#', ''); if (TITLES[n] && n !== S.screen) showScreen(n); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || !S.profile) return;
      if (S.focus.active) { S.wake = null; keepAwake(true); return; }   // the lock is dropped when the page hides
      if (S.screen === 'today') renderToday();
      maybeAutoOpen();
    });
  }
  /* A toast with Undo: reversible actions do not ask first. */
  function undoToast(msg, undo) {
    TN.toast(msg);
    var region = $('toast-region'), last = region && region.lastElementChild;
    if (!last) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--quiet btn--sm toast__undo'; b.textContent = 'Undo';
    b.addEventListener('click', function () { undo(); last.remove(); });
    last.appendChild(b);
  }

  /* ----------------------------------------------------------------- boot */
  async function boot() {
    await TN.guard();
    fillIcons(document);
    wire();
    try {
      var b = await api('/api/spent/bootstrap');
      S.profile = E.profileOf(b.profile); S.today = b.today; S.viewing = b.today;
      S.days = {}; (b.days || []).forEach(function (d) { S.days[d.d] = d; });
      S.goals = b.goals || []; S.focus = b.focus || { active: null, recent: [] }; S.needsSchema = b.needsSchema || null;
      rebuild();
      $('sp-loading').hidden = true;
      var start = location.hash.replace('#', '');
      showScreen(TITLES[start] && start !== 'edit' ? start : 'today');
      if (S.focus.active) showFocus(); else maybeAutoOpen();
      document.dispatchEvent(new CustomEvent('spent:ready', { detail: { state: S } }));
      // KEPT's income, if the person uses KEPT, prices the hours (Insights).
      try {
        var kb = await api('/api/kept/bootstrap');
        var rows = (kb && kb.transactions) || [], inc = 0, months = {};
        rows.forEach(function (r) { if (r.amount_minor > 0 && /income|salary/i.test(r.cat || '') && !/loan/i.test(r.descr || '')) { inc += r.amount_minor; months[r.d.slice(0, 7)] = 1; } });
        var n = Object.keys(months).length;
        if (n) S.kept = { hourly: inc / n / 176, currency: (kb.profile && kb.profile.currency) || 'AED' };
        if (S.screen === 'insights') renderInsights();
      } catch (e) { S.kept = null; }
    } catch (e) {
      $('sp-loading').innerHTML = '<div class="notice notice--danger"><div>' + esc(e.message || 'Could not load.') + (/(table|relation).*spent|spent.*(missing|exist)/i.test(e.message || '') ? ' — run supabase/schema.sql once to add the SPENT tables.' : '') + '</div></div>';
    }
  }
  window.SPENT = { state: S, openCheckIn: openCheckIn, showScreen: showScreen, startFocus: startFocus, openGoal: openGoal };
  TN.ready(boot);
})();
