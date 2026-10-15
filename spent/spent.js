/* SPENT — the page.
   =============================================================================
   One page, four screens (Today · Week · Insights · Usual day). All maths
   lives in spent-engine.js; all storage is /api/spent/*; this file renders
   and wires. A day is edited in place with ±15 minute steppers (or typed
   through a sheet) and saved a moment after the last change. */
(function () {
  'use strict';

  var E = window.SpentEngine;
  var $ = function (id) { return document.getElementById(id); };
  var esc = TN.esc, hm = E.hm, pct = E.pct;

  var S = { profile: null, days: {}, today: null, viewing: null, screen: 'today', M: null, rule: 'weekday', kept: null, dirty: false, saveTimer: null, saving: false };
  var CLS_COLOR = { fixed: 'var(--color-text-muted)', ess: 'var(--color-warning)', mine: 'var(--color-primary)', leak: 'var(--color-danger)' };

  function today() { return E.iso(new Date()); }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
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
  function greet() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function dayLabel(d) {
    if (d === today()) return 'Today';
    if (d === E.addDays(today(), -1)) return 'Yesterday';
    return E.parse(d).toLocaleDateString('en-GB', { weekday: 'long' });
  }
  function dateSub(d) { return E.parse(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function fillIcons(root) {
    TN.els('[data-icon]', root).forEach(function (el) { if (!el.innerHTML) el.innerHTML = TN.icon(el.getAttribute('data-icon'), el.getAttribute('data-icon-size') ? +el.getAttribute('data-icon-size') : 18); });
  }

  /* ------------------------------------------------------------- state */
  function rebuild() {
    var list = Object.keys(S.days).map(function (d) { return S.days[d]; });
    S.M = E.build(list, S.profile, today());
  }
  function dayOf(d) { return S.days[d] || { d: d, blocks: {}, note: '' }; }

  /* ---------------------------------------------------------- navigation */
  var TITLES = { today: ['Today', 'How much of your time stays yours.'], week: ['This week', 'Seven days, side by side.'], insights: ['Insights', 'What the hours say, and one idea a day.'], settings: ['Usual day', 'The shape of a normal day, so the record starts filled in.'] };
  function showScreen(name) {
    if (!TITLES[name]) name = 'today';
    S.screen = name;
    TN.els('.kp-screen').forEach(function (sc) { sc.hidden = sc.getAttribute('data-screen') !== name; });
    TN.els('#sp-bar [data-screen]').forEach(function (b) { if (b.getAttribute('data-screen') === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('sp-title').textContent = TITLES[name][0]; $('sp-sub').textContent = TITLES[name][1];
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
    render(name);
    window.scrollTo(0, 0);
  }
  function render(name) {
    renderRate();
    if (name === 'today') renderToday();
    else if (name === 'week') renderWeek();
    else if (name === 'insights') renderInsights();
    else renderSettings();
  }
  function renderRate() {
    var box = $('sp-rate');
    if (!S.M || !S.M.week.n) { box.innerHTML = ''; return; }
    box.innerHTML = '<b>' + Math.round(S.M.week.rate) + '%</b><span>yours · last ' + S.M.week.n + ' day' + (S.M.week.n === 1 ? '' : 's') + '</span>';
  }

  /* --------------------------------------------------------------- Today */
  function renderToday() {
    var d = S.viewing, day = dayOf(d), prof = S.profile;
    $('day-label').textContent = dayLabel(d); $('day-sub').textContent = dateSub(d);
    $('day-next').disabled = d >= today();
    var st = E.dayStats(day.blocks, prof), isToday = d === today();
    var hero = $('today-hero');
    if (isToday) {
      var ts = E.todayStatus(day.blocks, prof, nowMin(), d);
      var empty = !st.logged;
      var tone = empty ? 'info' : ts.stillNeeded === 0 ? 'good' : ts.reachable ? 'warn' : 'bad';
      var verdict = empty ? 'Nothing on the record yet. The usual day is <b>' + hm(ts.committed) + '</b> committed, which leaves <b>' + hm(ts.free) + '</b> that can be yours — ' + hm(ts.reserve) + ' of it is the ' + ts.target + '% target.'
        : ts.stillNeeded === 0 ? 'You have already had <b>' + hm(ts.yoursSoFar) + '</b> that was yours today — past your ' + ts.target + '% target. Protect the rest of the evening.'
        : ts.reachable ? '<b>' + hm(ts.yoursSoFar) + '</b> of today has been yours so far. <b>' + hm(ts.stillNeeded) + '</b> more reaches your ' + ts.target + '% — and there is <b>' + hm(ts.free) + '</b> not yet spoken for.'
        : 'Only <b>' + hm(ts.yoursSoFar) + '</b> of today has been yours, and after what is still committed just <b>' + hm(ts.free) + '</b> of the day is left. The target is out of reach today; claim what is left.';
      var act = empty ? 'tap “Fill usual”, then tonight change only what was different. Thirty seconds.'
        : ts.stillNeeded === 0 ? 'log the evening before bed — thirty seconds, and the day is on the record.'
        : ts.free > 0 ? 'decide now what the next free ' + hm(Math.min(ts.free, ts.stillNeeded || ts.free)) + ' is for, before a screen decides for you.'
        : 'tomorrow, book the first hour after work before the day starts.';
      hero.innerHTML = '<div class="panel kp-hero kp-hero--' + tone + '"><div class="kp-hero__top"><div>' +
        '<p class="eyebrow">' + greet() + '. ' + E.parse(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '</p>' +
        '<div class="kp-hero__label">Yours today</div>' +
        '<div class="kp-hero__big ' + (ts.yoursSoFar > 0 ? 'pos' : '') + '">' + hm(ts.yoursSoFar) + '</div>' +
        '<div class="kp-hero__sub">' + (ts.free > 0 ? hm(ts.free) + ' of the day still free · ' + hm(ts.committed) + ' committed' : 'the day is spoken for') + '</div></div>' +
        ring(Math.min(1, ts.yoursSoFar / Math.max(1, ts.reserve)), { size: 104, cls: tone === 'good' ? '' : tone, center: '<b>' + Math.round(st.rate) + '%</b><span>yours<br>target ' + ts.target + '%</span>' }) + '</div>' +
        '<div class="kp-statrow"><div><span>Logged</span><b>' + hm(st.total) + '</b></div><div><span>Committed</span><b>' + hm(st.cls.fixed) + '</b></div><div><span>Upkeep</span><b>' + hm(st.cls.ess) + '</b></div><div><span>Drift</span><b>' + hm(st.cls.leak) + '</b></div></div>' +
        insight(verdict, act, tone) + '</div>';
    } else {
      hero.innerHTML = '<div class="panel kp-hero"><div class="kp-hero__top"><div><p class="eyebrow">' + E.parse(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '</p>' +
        '<div class="kp-hero__label">Yours that day</div><div class="kp-hero__big">' + hm(st.kept) + '</div>' +
        '<div class="kp-hero__sub">' + (st.logged ? hm(st.total) + ' logged · ' + hm(st.cls.leak) + ' drift' : 'nothing logged — fill it in from memory, or from your usual day') + '</div></div>' +
        ring(Math.min(1, st.rate / 100), { size: 96, center: '<b>' + Math.round(st.rate) + '%</b><span>yours</span>' }) + '</div></div>';
    }
    renderBar(day.blocks);
    renderRows(day.blocks);
    $('day-note').value = day.note || '';
    $('day-saved').textContent = S.dirty ? 'Saving…' : (day.updated_at ? 'Saved' : '');
  }
  function renderBar(blocks) {
    var prof = S.profile, cm = E.catMap(prof), t = E.total(blocks);
    var segs = prof.cats.filter(function (c) { return blocks[c.key] > 0; }).map(function (c) {
      return '<i class="sp-bar__seg sp-bar__seg--' + c.cls + '" style="width:' + (blocks[c.key] / E.DAY * 100).toFixed(2) + '%" title="' + esc(c.name) + ' ' + hm(blocks[c.key]) + '"></i>';
    }).join('');
    $('day-bar').innerHTML = segs + (t < E.DAY ? '<i class="sp-bar__seg sp-bar__seg--none" style="width:' + ((E.DAY - t) / E.DAY * 100).toFixed(2) + '%"></i>' : '');
    var c = E.byClass(blocks, prof);
    $('day-legend').innerHTML = ['fixed', 'ess', 'mine', 'leak'].map(function (k) { return '<span class="sp-legend__item"><i class="sp-bar__seg--' + k + '"></i>' + E.CLASS_LABEL[k] + ' <b>' + hm(c[k]) + '</b></span>'; }).join('');
    var un = E.DAY - t;
    $('day-unalloc').innerHTML = un > 0 ? '<b>' + hm(un) + '</b> of the day not yet placed' + (un > 180 ? ' — where did it go? Honest "Other" beats a flattering blank.' : '.') : un < 0 ? '<b class="neg">' + hm(-un) + ' over 24 hours</b> — something is counted twice.' : '<b>All 24 hours placed.</b>';
  }
  function renderRows(blocks) {
    var prof = S.profile;
    var groups = [['fixed', 'Committed — decided before the day started'], ['ess', 'Upkeep — the life admin'], ['mine', 'Yours — by choice'], ['leak', 'Drift — where unplanned hours go']];
    $('day-rows').innerHTML = groups.map(function (g) {
      var cats = prof.cats.filter(function (c) { return c.cls === g[0]; });
      if (!cats.length) return '';
      return '<div class="sp-group"><p class="sp-group__label sp-group__label--' + g[0] + '">' + g[1] + '</p>' + cats.map(function (c) { return rowHTML(c, blocks[c.key] || 0, 'day'); }).join('') + '</div>';
    }).join('');
    fillIcons($('day-rows'));
  }
  function rowHTML(c, min, scope) {
    return '<div class="sp-row" data-cat="' + esc(c.key) + '" data-scope="' + scope + '">' +
      '<span class="sp-row__icon sp-row__icon--' + c.cls + '"><span data-icon="' + esc(c.icon) + '"></span></span>' +
      '<button type="button" class="sp-row__name" data-type="1" aria-label="Set ' + esc(c.name) + '"><b>' + esc(c.name) + '</b><span class="sp-row__track"><i style="width:' + Math.min(100, min / 600 * 100) + '%"></i></span></button>' +
      '<div class="sp-row__ctl"><button type="button" class="sp-step" data-step="-15" aria-label="Less ' + esc(c.name) + '">−</button>' +
      '<button type="button" class="sp-row__val" data-type="1">' + (min ? hm(min) : '<span class="muted">—</span>') + '</button>' +
      '<button type="button" class="sp-step" data-step="15" aria-label="More ' + esc(c.name) + '">+</button></div></div>';
  }
  function currentBlocks() { return Object.assign({}, dayOf(S.viewing).blocks); }
  function setBlock(key, min) {
    var day = dayOf(S.viewing); var blocks = Object.assign({}, day.blocks);
    min = Math.max(0, Math.min(E.DAY, Math.round(min / 5) * 5));
    if (min) blocks[key] = min; else delete blocks[key];
    if (E.total(blocks) > E.DAY) { TN.toast('That takes the day past 24 hours.', 'error'); return; }
    S.days[S.viewing] = Object.assign({}, day, { blocks: blocks });
    S.dirty = true;
    rebuild();
    renderToday();
    scheduleSave();
  }
  function scheduleSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(saveDay, 700);
  }
  async function saveDay() {
    var d = S.viewing, day = dayOf(d);
    if (!S.dirty) return;
    S.dirty = false; S.saving = true;
    try {
      var r = await api('/api/spent/day', { method: 'PUT', body: { d: d, blocks: day.blocks, note: day.note || '' } });
      if (!S.dirty) { S.days[d] = r.day; if (S.viewing === d) $('day-saved').textContent = 'Saved'; }
    } catch (e) { S.dirty = true; fail(e); }
    S.saving = false;
  }
  function openMinutes(key) {
    var c = E.catMap(S.profile)[key]; if (!c) return;
    var min = currentBlocks()[key] || 0;
    $('ms-title').textContent = c.name;
    $('ms-h').value = Math.floor(min / 60); $('ms-m').value = min % 60;
    $('ms-quick').innerHTML = [15, 30, 60, 120, 240, 480].map(function (m) { return '<button type="button" class="btn btn--ghost btn--sm" data-min="' + m + '">' + hm(m) + '</button>'; }).join('');
    $('min-form').onsubmit = function (ev) {
      ev.preventDefault();
      setBlock(key, (Number($('ms-h').value) || 0) * 60 + (Number($('ms-m').value) || 0));
      $('min-sheet').close();
    };
    TN.els('#ms-quick [data-min]').forEach(function (b) { b.addEventListener('click', function () { setBlock(key, +b.getAttribute('data-min')); $('min-sheet').close(); }); });
    $('min-sheet').showModal();
    setTimeout(function () { $('ms-h').focus(); $('ms-h').select(); }, 50);
  }

  /* ---------------------------------------------------------------- Week */
  function renderWeek() {
    var M = S.M, rows = E.weekRows(M, today()), prof = S.profile;
    var w = M.week, pw = M.prevWeek;
    var h = '<div class="panel kp-hero"><div class="kp-hero__top"><div><p class="eyebrow">Last 7 days · ' + w.n + ' logged</p>' +
      '<div class="kp-hero__label">Yours per day</div><div class="kp-hero__big">' + hm(w.kept) + '</div>' +
      '<div class="kp-hero__sub">' + (pw.n ? (w.kept >= pw.kept ? '▲ ' : '▼ ') + hm(Math.abs(w.kept - pw.kept)) + ' vs the week before' : 'first week on record') + '</div></div>' +
      ring(Math.min(1, w.rate / 100), { size: 96, center: '<b>' + Math.round(w.rate) + '%</b><span>yours</span>' }) + '</div>' +
      '<div class="kp-statrow"><div><span>Sleep</span><b>' + hm(w.sleep) + '</b></div><div><span>Committed</span><b>' + hm(w.fixed) + '</b></div><div><span>Upkeep</span><b>' + hm(w.ess) + '</b></div><div><span>Drift</span><b>' + hm(w.leak) + '</b></div></div></div>';
    h += '<div class="panel"><div class="panel__head"><h2>Day by day</h2><span class="muted">tap a day to edit it</span></div><div class="sp-week">' +
      rows.map(function (x) {
        var s = x.row ? x.row.s : null, d = E.parse(x.d);
        var segs = s ? ['fixed', 'ess', 'mine', 'leak'].map(function (k) { return '<i class="sp-bar__seg--' + k + '" style="height:' + (s.cls[k] / E.DAY * 100).toFixed(1) + '%"></i>'; }).join('') : '';
        return '<button type="button" class="sp-week__day' + (s ? '' : ' is-empty') + (x.d === today() ? ' is-today' : '') + '" data-day="' + x.d + '">' +
          '<span class="sp-week__col">' + segs + '</span><b>' + d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2) + '</b><span class="sp-week__v">' + (s ? hm(s.kept) : '·') + '</span></button>';
      }).join('') + '</div>' +
      '<div class="sp-legend">' + ['fixed', 'ess', 'mine', 'leak'].map(function (k) { return '<span class="sp-legend__item"><i class="sp-bar__seg--' + k + '"></i>' + E.CLASS_LABEL[k] + '</span>'; }).join('') + '</div></div>';
    // where the week went, by category
    var cats = prof.cats.filter(function (c) { return w.cat[c.key] > 0; }).sort(function (a, b) { return w.cat[b.key] - w.cat[a.key]; });
    var max = cats.length ? w.cat[cats[0].key] : 1;
    h += '<div class="panel"><div class="panel__head"><h2>Where the week went</h2><span class="muted">per day, average</span></div><div class="kp-catlist">' +
      (cats.length ? cats.map(function (c) { var v = w.cat[c.key], p = pw.cat[c.key] || 0;
        return '<div class="kp-catrow"><span class="sp-row__icon sp-row__icon--' + c.cls + '" data-icon="' + esc(c.icon) + '"></span><div class="kp-catrow__name"><b>' + esc(c.name) + '</b><div class="kp-track"><i style="width:' + Math.round(v / max * 100) + '%"></i></div></div>' +
          '<div class="kp-catrow__amt">' + hm(v) + (pw.n && Math.abs(v - p) >= 15 ? '<small class="' + ((v > p) === (c.cls === 'mine') ? 'pos' : 'neg') + '">' + (v > p ? '▲' : '▼') + hm(Math.abs(v - p)) + ' vs last</small>' : '') + '</div></div>'; }).join('')
      : '<p class="muted">Nothing logged in the last seven days.</p>') + '</div></div>';
    $('week-wrap').innerHTML = h;
    fillIcons($('week-wrap'));
    TN.els('#week-wrap [data-day]').forEach(function (b) { b.addEventListener('click', function () { S.viewing = b.getAttribute('data-day'); showScreen('today'); }); });
  }

  /* ------------------------------------------------------------ Insights */
  function renderInsights() {
    var M = S.M, box = $('ins-wrap');
    if (!M.n) {
      box.innerHTML = '<div class="panel"><h2>Nothing to read yet</h2><p class="muted" style="margin-top:var(--space-2)">Log a few days — tonight\'s is enough to start — and this page begins to say something true about where your time goes.</p></div>';
      return;
    }
    var a = M.month.n >= 3 ? M.month : M.all, label = M.month.n >= 3 ? 'last 28 days' : 'all ' + M.n + ' day' + (M.n === 1 ? '' : 's');
    var les = E.lesson(M, today(), S.kept ? S.kept.hourly : 0, S.kept ? function (m) { return TN.money(m, S.kept.currency, { compact: true }); } : null);
    var h = '<div class="panel kp-hero"><div class="kp-hero__top"><div><p class="eyebrow">' + label + '</p><div class="kp-hero__label">Of every waking hour</div>' +
      '<div class="kp-hero__big">' + Math.round(a.rate) + '%</div><div class="kp-hero__sub">is yours by choice · target ' + (S.profile.target_bp / 100) + '%</div></div>' +
      ring(Math.min(1, a.rate / 100), { size: 96, cls: a.rate >= S.profile.target_bp / 100 ? '' : a.rate >= S.profile.target_bp / 200 ? 'warn' : 'bad', center: '<b>' + hm(a.kept) + '</b><span>a day</span>' }) + '</div>' +
      '<div class="kp-kpis" style="margin-top:var(--space-3)">' + kpi('Streak', M.streak + ' day' + (M.streak === 1 ? '' : 's'), 'logged in a row', M.streak >= 7 ? 'ok' : M.streak >= 3 ? 'warn' : 'bad') +
      kpi('Drift', hm(a.leak) + '/day', pct(a.leakRate) + ' of waking time', a.leakRate < 10 ? 'ok' : a.leakRate < 20 ? 'warn' : 'bad') +
      kpi('Sleep', hm(a.sleep), a.sleep >= 420 ? 'enough' : 'short of 7h', a.sleep >= 420 ? 'ok' : 'warn') +
      kpi('Best day', M.best ? hm(M.best.s.kept) : '—', M.best ? dateSub(M.best.d) : '', 'ok') + '</div></div>';
    if (les) h += '<div class="panel kp-lesson"><p class="eyebrow">' + TN.icon('lightbulb', 14) + ' One thing to learn today · ' + esc(les.title) + '</p><h2>' + les.lead + '</h2><p>' + les.body + '</p><p class="kp-lesson__why">' + esc(les.why) + '</p></div>';
    // Money pairing, when KEPT has an income on record.
    if (S.kept && S.kept.hourly > 0) {
      var money = function (m) { return TN.money(Math.round(m), S.kept.currency, { compact: true }); };
      var hourly = S.kept.hourly;
      h += '<div class="panel"><div class="panel__head"><h2>Time and money, side by side</h2><span class="muted">from KEPT</span></div>' +
        '<div class="kp-kpis">' + kpi('Your hour', money(hourly), 'average income ÷ 176 working hours') +
        kpi('Drift, priced', money(a.leak / 60 * hourly), 'per day at that rate', 'warn') +
        kpi('Yours, priced', money(a.kept / 60 * hourly), 'what the hours that were yours would fetch', 'ok') +
        kpi('A month of drift', money(a.leak / 60 * hourly * 30), 'the same arithmetic KEPT uses for purchases') + '</div>' +
        insight('Money and time are one budget seen from two sides. KEPT shows a purchase as hours of work; this shows an hour as money. Neither is the point — the point is that both are finite and both leak in the same places.', null, 'info') + '</div>';
    } else {
      h += '<div class="panel"><div class="panel__head"><h2>Time and money, side by side</h2></div><p class="muted">When KEPT has a salary on record, this card prices your hours with the same arithmetic KEPT uses to show a purchase as time at work.</p></div>';
    }
    // Trend: four weeks of keep-rate
    var weeks = [];
    for (var i = 3; i >= 0; i--) {
      var end = E.addDays(today(), -i * 7 + 1), list = [];
      for (var k = 1; k <= 7; k++) { var dd = E.addDays(end, -k); if (M.byD[dd]) list.push(M.byD[dd]); }
      var kept = list.reduce(function (s, r) { return s + r.s.kept; }, 0), wk = list.reduce(function (s, r) { return s + r.s.waking; }, 0);
      weeks.push({ label: i === 0 ? 'this week' : i + 'w ago', n: list.length, rate: wk ? kept / wk * 100 : null, kept: list.length ? kept / list.length : 0 });
    }
    h += '<div class="panel"><div class="panel__head"><h2>Four weeks</h2><span class="muted">share of waking hours that was yours</span></div><div class="sp-trend">' +
      weeks.map(function (w) { return '<div class="sp-trend__col"><i style="height:' + (w.rate == null ? 0 : Math.min(100, w.rate * 2)) + '%"></i><b>' + (w.rate == null ? '—' : Math.round(w.rate) + '%') + '</b><span>' + w.label + '</span></div>'; }).join('') + '</div></div>';
    box.innerHTML = h;
  }

  /* ------------------------------------------------------------ Settings */
  function renderSettings() {
    var prof = S.profile, rule = prof.rules[S.rule] || {};
    TN.els('#rule-seg [data-rule]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-rule') === S.rule)); });
    $('rule-rows').innerHTML = prof.cats.map(function (c) { return rowHTML(c, rule[c.key] || 0, 'rule'); }).join('');
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
    $('day-prev').addEventListener('click', function () { S.viewing = E.addDays(S.viewing, -1); renderToday(); });
    $('day-next').addEventListener('click', function () { if (S.viewing < today()) { S.viewing = E.addDays(S.viewing, 1); renderToday(); } });
    $('day-pick').addEventListener('click', function () { var i = $('day-input'); i.value = S.viewing; i.max = today(); try { i.showPicker(); } catch (e) { i.click(); } });
    $('day-input').addEventListener('change', function () { if (this.value && this.value <= today()) { S.viewing = this.value; renderToday(); } });
    document.addEventListener('click', function (ev) {
      var step = ev.target.closest('.sp-step'), row = ev.target.closest('.sp-row');
      if (!row) return;
      var key = row.getAttribute('data-cat'), scope = row.getAttribute('data-scope');
      if (step) {
        var cur = scope === 'rule' ? (S.profile.rules[S.rule][key] || 0) : (currentBlocks()[key] || 0);
        var next = cur + (+step.getAttribute('data-step'));
        if (scope === 'rule') setRule(key, next); else setBlock(key, next);
        return;
      }
      if (ev.target.closest('[data-type]')) {
        if (scope === 'rule') openRuleMinutes(key); else openMinutes(key);
      }
    });
    $('day-usual').addEventListener('click', function () {
      var u = E.usual(S.viewing, S.profile), blocks = currentBlocks();
      Object.keys(u).forEach(function (k) { if (!blocks[k]) blocks[k] = u[k]; });
      var day = dayOf(S.viewing); S.days[S.viewing] = Object.assign({}, day, { blocks: blocks }); S.dirty = true; rebuild(); renderToday(); scheduleSave();
    });
    $('day-clear').addEventListener('click', function () {
      var day = dayOf(S.viewing); S.days[S.viewing] = Object.assign({}, day, { blocks: {} }); S.dirty = true; rebuild(); renderToday(); scheduleSave();
    });
    $('day-note').addEventListener('input', function () { var day = dayOf(S.viewing); S.days[S.viewing] = Object.assign({}, day, { note: this.value }); S.dirty = true; scheduleSave(); });
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
  }
  function openRuleMinutes(key) {
    var c = E.catMap(S.profile)[key]; if (!c) return;
    var min = S.profile.rules[S.rule][key] || 0;
    $('ms-title').textContent = c.name + ' · usual ' + S.rule;
    $('ms-h').value = Math.floor(min / 60); $('ms-m').value = min % 60;
    $('ms-quick').innerHTML = [30, 60, 120, 240, 480, 540].map(function (m) { return '<button type="button" class="btn btn--ghost btn--sm" data-min="' + m + '">' + hm(m) + '</button>'; }).join('');
    $('min-form').onsubmit = function (ev) { ev.preventDefault(); setRule(key, (Number($('ms-h').value) || 0) * 60 + (Number($('ms-m').value) || 0)); $('min-sheet').close(); };
    TN.els('#ms-quick [data-min]').forEach(function (b) { b.addEventListener('click', function () { setRule(key, +b.getAttribute('data-min')); $('min-sheet').close(); }); });
    $('min-sheet').showModal();
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
      rebuild();
      // KEPT's income, if the person uses KEPT, prices the hours.
      try {
        var kb = await api('/api/kept/bootstrap');
        var rows = (kb && kb.transactions) || [], inc = 0, months = {};
        rows.forEach(function (r) { if (r.amount_minor > 0 && /income|salary/i.test(r.cat || '') && !/loan/i.test(r.descr || '')) { inc += r.amount_minor; months[r.d.slice(0, 7)] = 1; } });
        var n = Object.keys(months).length;
        if (n) S.kept = { hourly: inc / n / 176, currency: (kb.profile && kb.profile.currency) || 'AED' };
      } catch (e) { S.kept = null; }
      $('sp-loading').hidden = true;
      var start = location.hash.replace('#', '');
      showScreen(TITLES[start] ? start : 'today');
    } catch (e) {
      $('sp-loading').innerHTML = '<div class="notice notice--danger"><div>' + esc(e.message || 'Could not load.') + (/(table|relation).*spent|spent.*(missing|exist)/i.test(e.message || '') ? ' — run supabase/schema.sql once to add the SPENT tables.' : '') + '</div></div>';
    }
  }
  TN.ready(boot);
})();
