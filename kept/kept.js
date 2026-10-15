/* KEPT — the page.
   =============================================================================
   One page, five screens (Home · Spend · + · EMIs · Insights) plus History
   behind Spend and Settings behind Insights. All maths lives in
   kept-engine.js; all storage is /api/kept/*; this file only renders and
   wires. Amounts are minor-unit integers everywhere until TN.money()
   formats them for the screen.

   How it opens: the last snapshot this browser kept (kept-store.js) is drawn
   first, in the same frame the page appears; one /api/kept/bootstrap call
   then replaces it and repaints only if something changed. Writes apply to
   the screen before the server answers and roll back if it refuses. The
   two vendored libraries (Chart.js, SheetJS) load the first time a chart or
   a spreadsheet is needed, not on every open. */
(function () {
  'use strict';

  var E = window.KeptEngine, IM = window.KeptImport;
  var $ = function (id) { return document.getElementById(id); };
  var esc = TN.esc;

  /* ------------------------------------------------------------- state */
  var S = {
    user: null, profile: null, cats: [], catByName: {}, rows: [], emis: [], rules: [], M: null,
    ai: false, screen: 'home', spendPeriod: null, openCat: null, hxShown: 150, charts: {}, insView: null, budgets: {},
    scroll: {}, fromCache: false
  };
  var Store = window.KeptStore;
  var today = function () { return E.iso(new Date()); };
  var cur = function () { return S.profile ? S.profile.currency : 'AED'; };
  var money = function (minor) { return TN.money(minor, cur(), { compact: true }); };
  var fmt0 = function (minor) { return TN.money(Math.abs(minor), '', { compact: true }); };
  var pct = E.pct;
  var CH = {};

  /* ----------------------------------------------------------- helpers */
  function fillIcons(root) {
    TN.els('[data-icon]', root || document).forEach(function (el) {
      el.innerHTML = TN.icon(el.getAttribute('data-icon'), 20);
      el.removeAttribute('data-icon');
    });
  }
  function catIcon(name) {
    var c = S.catByName[name];
    if (c) return c.icon;
    if (/fuel|petrol/i.test(name)) return 'kept-fuel';
    if (/educat|school/i.test(name)) return 'kept-education';
    if (/refund|cashback|income|salary/i.test(name)) return 'kept-salary';
    return 'kept-misc';
  }
  function catClass(name) { var c = S.catByName[name]; return c ? c.cls : E.defaultCatClass(name); }
  /* The icon chip beside a row. The glyph follows the category; the tint
     says in / out / loan. */
  function chip(cat, kind) {
    var mod = kind === 'income' || kind === 'refund' ? ' kp-ic--in' : kind === 'borrowed' || kind === 'debtpay' ? ' kp-ic--loan' : '';
    var ic = kind === 'borrowed' || kind === 'debtpay' ? 'kept-bank' : kind === 'income' || kind === 'refund' ? 'kept-salary' : kind === 'invest' ? 'kept-invest' : catIcon(cat);
    return '<span class="kp-ic' + mod + '" aria-hidden="true">' + TN.icon(ic, 18) + '</span>';
  }
  /* Progress ring. cls: '' | warn | bad | accent | muted. */
  function ring(p, o) {
    o = o || {};
    var sz = o.size || 104, sw = o.stroke || 9, r = 50 - sw / 2, C = 2 * Math.PI * r, off = C * (1 - Math.max(0, Math.min(1, p)));
    return '<div class="kp-ring' + (o.cls ? ' kp-ring--' + o.cls : '') + (sz < 80 ? ' kp-ring--sm' : '') + '" style="width:' + sz + 'px;height:' + sz + 'px">' +
      '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="kp-ring__track" cx="50" cy="50" r="' + r + '" fill="none" stroke-width="' + sw + '"/>' +
      '<circle class="kp-ring__fill" cx="50" cy="50" r="' + r + '" fill="none" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + C.toFixed(2) +
      '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 50 50)"/></svg><div class="kp-ring__c">' + (o.center || '') + '</div></div>';
  }
  function insight(html, act, tone) {
    return '<div class="kp-insight' + (tone ? ' kp-insight--' + tone : '') + '">' + html + (act ? '<span class="kp-act">' + act + '</span>' : '') + '</div>';
  }
  function kpi(l, v, s, cls) { return '<div class="kp-kpi' + (cls ? ' kp-kpi--' + cls : '') + '"><div class="kp-kpi__l">' + l + '</div><div class="kp-kpi__v">' + v + '</div><div class="kp-kpi__s">' + (s || '') + '</div></div>'; }
  function pill(cls, text) { return '<span class="kp-pill kp-pill--' + cls + '">' + esc(text) + '</span>'; }
  function dateShort(d) { return E.parse(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  function monthName(d) { return (d instanceof Date ? d : E.parse(d)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }); }
  function ordinal(n) { n = +n; var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function greet() {
    // The account's name (Account → Name); KEPT no longer keeps its own.
    var u = TN.session.user || S.user || {};
    var h = new Date().getHours(), name = ((u.name || (S.profile && S.profile.profile_json.name) || '').trim().split(/\s+/)[0]) || '';
    return (h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (name ? ', ' + esc(name) : '') + '.';
  }
  function openSheet(d) { if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', ''); }
  function closeSheet(d) { if (typeof d.close === 'function' && d.open) d.close(); else d.removeAttribute('open'); }
  function say(id, msg) { var el = $(id); el.textContent = msg || ''; el.hidden = !msg; }
  function api(path, opts) { return TN.api(path, opts); }
  function fail(err) { TN.toast((err && err.message) || 'Something went wrong.', 'error'); }

  /* Chart colours read from the tokens at render time so they follow the
     theme. Categorical order is fixed (primary, accent, warning, danger,
     muted) and a sixth series and beyond fold into "Other". */
  function tokens() {
    var cs = getComputedStyle(document.documentElement);
    var g = function (n) { return cs.getPropertyValue(n).trim(); };
    return { primary: g('--color-primary'), accent: g('--color-accent'), warning: g('--color-warning'), danger: g('--color-danger'),
      muted: g('--color-text-muted'), success: g('--color-success'), border: g('--color-border'), surface: g('--color-surface'), text: g('--color-text') };
  }
  function alpha(color, a) {
    var m = color.match(/^#([0-9a-f]{6})$/i);
    if (m) { var n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
    var r = color.match(/rgba?\(([^)]+)\)/);
    if (r) { var p = r[1].split(',').slice(0, 3).map(function (x) { return x.trim(); }); return 'rgba(' + p.join(',') + ',' + a + ')'; }
    return color;
  }
  function palette(t) { return [t.primary, t.accent, t.warning, t.danger, t.muted]; }
  /* Chart.js (205 KB) loads the first time a chart is asked for. Until it
     has, the lists beside every chart already carry the figures. */
  var CHART_SRC = '/assets/vendor/chart.umd.js?v=1';
  function ensureChart() {
    if (typeof window.Chart === 'function') return Promise.resolve();
    return TN.loadScript(CHART_SRC);
  }
  function chart(id, cfg) {
    ensureChart().then(function () { drawChart(id, cfg); }).catch(function () { /* the lists stand on their own */ });
  }
  function drawChart(id, cfg) {
    var c = $(id);
    if (!c || !c.isConnected || typeof window.Chart !== 'function') return;
    var t = tokens();
    try {
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.color = t.muted;
      Chart.defaults.borderColor = t.border;
      var old = CH[id];
      // Same canvas, same kind of chart: update in place and let Chart.js
      // animate the change instead of tearing the chart down and rebuilding.
      if (old && old.canvas === c && old.config && old.config.type === cfg.type && typeof old.update === 'function') {
        old.data = cfg.data; old.options = cfg.options; old.update();
        return;
      }
      if (old) { try { old.destroy(); } catch (e) { /* already gone */ } }
      CH[id] = new Chart(c, cfg);
    } catch (e) { /* no canvas (test runner); the lists beside the chart carry the data */ }
  }

  /* -------------------------------------------------------------- data */
  function rebuild() {
    var es = S.rows.length ? E.emiSummary(S.emis || [], S.rows, today()) : null;
    S.M = S.rows.length ? E.build(S.rows, { today: today(), catClass: catClass, emiMonthly: es ? es.monthly : 0 }) : null;
    analyse();
  }
  function committed() { return E.committedThisMonth(S.emis || [], S.rules || [], today()); }
  /* "≈ 2h 10m of your work" — or nothing, when there is no income to measure by. */
  function timeCost(minor) { var t = E.timeCost(minor, S.M); return t ? '<span class="kp-time" title="at your average income">≈ ' + esc(t) + '</span>' : ''; }
  /* Puts a bootstrap payload (from the server or the snapshot) into state.
     Returns true when anything the screens draw from changed. */
  function applyBootstrap(b) {
    var before = fingerprint();
    S.profile = b.profile; S.cats = b.categories || [];
    S.catByName = {}; S.cats.forEach(function (c) { S.catByName[c.name] = c; });
    S.emis = b.emis || []; S.rules = b.rules || []; S.rows = b.transactions || [];
    rebuild();
    return fingerprint() !== before;
  }
  function fingerprint() {
    try { return JSON.stringify([S.profile, S.cats, S.emis, S.rules, S.rows.map(function (r) { return [r.id, r.d, r.amount_minor, r.descr, r.cat, r.remark]; })]); }
    catch (e) { return String(Math.random()); }
  }
  /* The snapshot follows the state: every successful write re-saves it, so
     the next open starts from exactly what was on screen. */
  var persistTimer = null;
  function persist() {
    if (!Store || !S.user || !S.profile) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      Store.write(S.user.id, { profile: S.profile, categories: S.cats, emis: S.emis, rules: S.rules, transactions: S.rows });
    }, 150);
  }
  async function loadAll() {
    var b = await api('/api/kept/bootstrap');
    applyBootstrap(b);
    persist();
  }
  async function loadRows() {
    var t = await api('/api/kept/transactions?all=1');
    S.rows = t.transactions;
    rebuild();
    persist();
  }
  async function reloadEmis() { S.emis = (await api('/api/kept/emis')).emis; persist(); }

  /* Local ledger edits, so the screen reflects a write before the server
     has answered. Rows keep the server's order: by date, then by when they
     were written (a new row goes last within its day). */
  function sortRows() {
    S.rows.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : String(a.created_at || '') < String(b.created_at || '') ? -1 : 1; });
  }
  function upsertRow(row) {
    if (!row || !row.id) return;
    if (!row.kind) row.kind = E.classify(row);
    var i = indexOfRow(row.id);
    if (i > -1) S.rows[i] = row; else S.rows.push(row);
    sortRows(); rebuild(); persist();
  }
  function removeRow(id) {
    var i = indexOfRow(id);
    if (i > -1) { S.rows.splice(i, 1); rebuild(); persist(); }
  }
  function indexOfRow(id) { for (var i = 0; i < S.rows.length; i++) if (S.rows[i].id === id) return i; return -1; }

  /* --------------------------------------------------------- navigation */
  /* Four tabs (Home, Spend, EMIs, Insights) and pages pushed on top of them
     (Transactions over Spend, any opened Insights tile over Insights). The
     address is #screen or #insights:view, and every move is a real history
     entry, so the phone's back gesture does what it does in a native app:
     a pushed page goes back to where it came from, a tab goes back to Home,
     Home leaves. Pushed pages slide in from the right; tabs cross-fade. */
  var TITLES = { home: ['Home', 'Where do I stand this month?'], spend: ['Spend', 'Where the money went.'], history: ['Transactions', 'The continuous record, searchable.'],
    emis: ['EMIs', 'Every loan as a ring: months left, money left, the end.'], insights: ['Insights', 'What KEPT noticed, the reviews, the tools.'] };
  var BAR_FOR = { history: 'spend' };
  var PARENT = { history: 'spend' };
  function parseHash(h) {
    var p = String(h || '').replace(/^#/, '').split(':');
    var screen = TITLES[p[0]] ? p[0] : 'home';
    return { screen: screen, ins: screen === 'insights' && p[1] ? p[1] : null };
  }
  function hashOf(t) { return '#' + t.screen + (t.ins ? ':' + t.ins : ''); }
  function depthOf(t) { return t.ins || PARENT[t.screen] ? 1 : 0; }
  function current() { return { screen: S.screen, ins: S.insView }; }
  function setHash(t, mode, back) {
    if (mode === 'none') return;
    var state = { kept: hashOf(t), back: back || null };
    try {
      if (mode === 'replace') history.replaceState(state, '', state.kept);
      else history.pushState(state, '', state.kept);
    } catch (e) { /* file:// */ }
  }
  /* A DOM switch inside a view transition when the browser has them and
     the person has not asked for reduced motion; html[data-nav] tells the
     CSS which way to move (push, pop, fade). */
  function transition(run, dir) {
    var reduced = false;
    try { reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (dir === 'none' || reduced || document.hidden || typeof document.startViewTransition !== 'function') { run(); return; }
    var root = document.documentElement;
    root.setAttribute('data-nav', dir);
    try {
      var vt = document.startViewTransition(run);
      var done = function () { root.removeAttribute('data-nav'); };
      if (vt && vt.finished && vt.finished.then) vt.finished.then(done, done); else done();
    } catch (e) { root.removeAttribute('data-nav'); run(); }
  }
  /* Draws a target. opts: dir (push|pop|fade|none), restore (scroll back
     to where that page was), focus (move focus to the new page's title). */
  function apply(t, opts) {
    opts = opts || {};
    var from = hashOf(current());
    if (S.screen) S.scroll[from] = window.scrollY || 0;
    var paint = function () {
      S.screen = t.screen; S.insView = t.ins || null;
      var pushed = depthOf(t) > 0;
      document.body.classList.toggle('is-pushed', pushed);
      TN.els('.kp-screen').forEach(function (sc) { sc.hidden = sc.getAttribute('data-screen') !== t.screen; });
      TN.els('#kp-bar [data-screen]').forEach(function (b) {
        if (b.getAttribute('data-screen') === (BAR_FOR[t.screen] || t.screen)) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      $('kp-title').textContent = TITLES[t.screen][0];
      $('kp-sub').textContent = TITLES[t.screen][1];
      render(t.screen);
      window.scrollTo(0, opts.restore ? (S.scroll[hashOf(t)] || 0) : 0);
      if (opts.focus) {
        var h = pushed ? TN.el('.kp-screen:not([hidden]) .nav-bar__title, #ins-view:not([hidden]) .nav-bar__title') : $('kp-title');
        if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
      }
    };
    transition(paint, opts.dir || 'none');
  }
  /* Tabs. The same tab again scrolls to the top, as on iOS. A tab other
     than Home sits on top of Home in history (so back returns there);
     moving between those tabs replaces rather than piling up entries. */
  function goTab(name) {
    var cur = current(), st = history.state || {};
    if (cur.screen === name && !cur.ins && !PARENT[cur.screen]) { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); } return; }
    var t = { screen: name, ins: null };
    if (name === 'home' && st.back === '#home' && depthOf(cur) === 0) { history.back(); return; }
    if (cur.screen === 'home' && !cur.ins) setHash(t, 'push', '#home');
    else setHash(t, 'replace', name === 'home' ? null : (st.back === '#home' || depthOf(cur) === 0 ? '#home' : null));
    apply(t, { dir: 'fade', focus: true });
  }
  /* Pages pushed over a tab. */
  function pushPage(t) {
    var from = hashOf(current());
    setHash(t, 'push', from);
    apply(t, { dir: 'push', focus: true });
  }
  /* The back button on a pushed page: real back when we pushed it, else
     straight to its parent (a page opened from a link or a reload). */
  function goBack(fallback) {
    var st = history.state || {};
    if (st.back && st.kept === hashOf(current())) { history.back(); return; }
    var t = fallback || { screen: PARENT[S.screen] || 'insights', ins: null };
    setHash(t, 'replace', t.screen === 'home' ? null : '#home');
    apply(t, { dir: 'pop', focus: true });
  }
  /* Kept for callers that still say "show this screen" (the cards on Home,
     the add flows): a tab goes through goTab, a pushed page through pushPage. */
  function showScreen(name, opts) {
    opts = opts || {};
    if (!TITLES[name]) name = 'home';
    if (opts.silent) { apply({ screen: name, ins: null }, { dir: 'none', restore: opts.restore }); return; }
    if (PARENT[name]) pushPage({ screen: name, ins: null }); else goTab(name);
  }
  function render(name) {
    name = name || S.screen;
    renderRate();
    if (name === 'home') renderHome();
    else if (name === 'spend') renderSpend();
    else if (name === 'history') renderHistory(true);
    else if (name === 'emis') renderEmis();
    else if (name === 'insights') renderInsights();
  }
  function renderAll() { render(S.screen); }

  function renderRate() {
    var box = $('kp-rate');
    if (!S.M || !S.M.fullMonths.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<b>' + pct(S.M.cashKeptRate) + '</b><span>kept · ' + S.M.fullMonths.length + ' full month' + (S.M.fullMonths.length === 1 ? '' : 's') + '</span>';
  }

  /* ---------------------------------------------------------------- Home */
  function renderHome() {
    var box = $('home-wrap');
    if (!S.M) {
      box.innerHTML = '<div class="panel kp-hero"><p class="eyebrow">' + greet() + '</p><h2>How much of your money stays yours?</h2>' +
        '<p class="muted" style="margin-top:var(--space-2)">Kept answers that every day. Start with one of three things — none takes more than a minute.</p>' +
        '<div class="kp-start">' +
        '<button type="button" id="hw-add"><b>Log today\'s spending</b><span>Tap +, type the amount, pick a category. Thirty seconds.</span></button>' +
        '<button type="button" id="hw-emi"><b>Add your EMIs</b><span>Instalment, months done, next due date — Kept shows months left and the debt-free date.</span></button>' +
        '<button type="button" id="hw-up"><b>Upload your Excel</b><span>Date, Description, Amount (negative = spent), Category. History appears instantly.</span></button></div>' +
        '<p class="hint"><a href="#" id="hw-sample">Download the sample Excel</a> to see the upload layout.</p></div>';
      $('hw-add').addEventListener('click', function () { openAdd(); });
      $('hw-emi').addEventListener('click', function () { showScreen('emis'); openEmi(null); });
      $('hw-up').addEventListener('click', function () { location.href = TN.url('kept/settings/'); });
      $('hw-sample').addEventListener('click', function (e) { e.preventDefault(); IM.sample(); });
      return;
    }
    var M = S.M, cm = committed(), st = E.monthStatus(M, S.profile.target_keep_bp, today(), cm);
    var targetPct = st.target, cur_ = st.month;
    var verdict, act, tone, projTxt = st.projRate == null ? '' : pct(st.projRate);
    if (st.assumedIncome) {
      tone = 'warn';
      verdict = 'Salary has not landed yet this month, so this assumes your usual <b>' + money(st.expectIn) + '</b>. <b>' + money(st.out) + '</b> has gone out so far — ' + (st.spendDelta <= 0 ? '<b>' + money(-st.spendDelta) + '</b> under' : '<b>' + money(st.spendDelta) + '</b> over') + ' your usual pace for day ' + st.day + '.';
      act = st.spendDelta > 0 ? 'hold spending to ' + money(Math.round(M.avg.spend * 0.9)) + ' this month; the overrun is already ' + money(st.spendDelta) + '.'
        : 'when salary lands, move ' + money(st.reserve) + ' to savings the same day — before the month has a chance to spend it.';
    } else if (st.onTarget) {
      tone = 'good';
      verdict = 'On track to keep <b>' + projTxt + '</b> of this month\'s income — above your ' + targetPct + '% target — if the next ' + st.left + ' day' + (st.left === 1 ? '' : 's') + ' go at your usual pace' + (st.committed ? ', with <b>' + money(st.committed) + '</b> still to go out for bills and EMIs' : '') + '.';
      act = 'keep daily spending under ' + money(st.safePerDay) + ' and the month closes on target.';
    } else {
      tone = 'bad';
      verdict = 'At the usual pace this month closes keeping <b>' + projTxt + '</b> — the plan needs ' + targetPct + '%. The gap is <b>' + money(st.gap) + '</b>' + (st.spendDelta > 0 ? ', and spending is already <b>' + money(st.spendDelta) + '</b> over pace' : '') + (st.committed ? '; <b>' + money(st.committed) + '</b> of bills and EMIs is still to come' : '') + '.';
      act = st.left > 0 && st.safe > 0 ? 'cap the remaining ' + st.left + ' days at ' + money(st.safePerDay) + '/day — the month can still close on plan.'
        : st.left > 0 ? 'there is nothing safe left to spend this month; every purchase from here comes out of the ' + targetPct + '% you meant to keep.'
        : 'the month is closing short; decide now which category pays for it next month.';
    }
    var ringCls = st.projRate == null ? 'warn' : st.projRate >= targetPct ? '' : st.projRate >= targetPct / 2 ? 'warn' : 'bad';
    var h = '<div class="panel kp-hero kp-hero--' + tone + '"><div class="kp-hero__top"><div>' +
      '<p class="eyebrow">' + greet() + ' ' + E.monthLong(cur_) + (st.live ? ', day ' + st.day + ' of ' + st.dim : ' (last month on file)') + '</p>' +
      '<div class="kp-hero__label">Safe to spend</div>' +
      '<div class="kp-hero__big ' + (st.safe > 0 ? 'pos' : 'neg') + '">' + money(st.safePerDay) + '<small>/day</small></div>' +
      '<div class="kp-hero__sub">' + (st.left > 0 ? money(st.safe) + ' over the next ' + st.left + ' day' + (st.left === 1 ? '' : 's') : money(st.safe) + ' left today') + ' · spend this and you still keep ' + targetPct + '%</div></div>' +
      ring(st.ringP, { size: 104, cls: ringCls, center: st.projRate == null ? '<b>' + st.usualPct + '%</b><span>of usual<br>month out</span>' : '<b>' + Math.round(st.projRate) + '%</b><span>' + (st.onTarget ? 'on track' : 'at usual<br>pace') + '</span>' }) + '</div>' +
      '<div class="kp-statrow"><div><span>In</span><b>' + money(st.inn) + '</b></div><div><span>Spent</span><b>' + money(st.spend) + '</b></div>' +
      '<div><span>EMIs &amp; bills</span><b>' + money(st.debtpay) + '</b>' + (st.committed ? '<small>+ ' + money(st.committed) + ' due</small>' : '') + '</div>' +
      '<div><span>Invested</span><b>' + money(st.invest) + '</b></div></div>' +
      '<div class="kp-keptline">Kept so far <b>' + money(st.keptNow) + '</b>' + (st.rate != null ? ' (' + pct(st.rate) + ')' : '') + (st.live && st.projRate != null ? ' · month-end at this pace <b>' + money(st.projKept) + '</b> (' + projTxt + ')' : '') + '<span class="kp-muted-sm"> · investing counts as kept</span></div>' +
      '<div class="kp-pace" title="spending vs your usual pace"><i class="' + (st.out <= st.pace ? '' : 'is-over') + '" style="width:' + Math.min(100, st.usualPct) + '%"></i><em style="left:' + Math.min(100, st.day / 30.44 * 100) + '%"></em></div>' +
      '<div class="kp-muted-sm">Out <b>' + money(st.out) + '</b> vs <b>' + money(st.pace) + '</b> usual by day ' + st.day + ' · bar = share of a usual month, marker = today</div>' +
      insight(verdict, act, tone) + '</div>';

    // This week — the habit loop: what went out, against last week, and
    // whether the record is being kept at all.
    var wk = E.weekSummary(S.rows, today());
    var dl = wk.daysLogged, dots = ''; for (var di = 0; di < 7; di++) dots += '<i class="' + (di < dl ? 'on' : '') + '"></i>';
    h += '<div class="panel kp-week"><div class="kp-cardhd"><h2>This week</h2><span class="kp-week__dots" title="days with an entry, last 7">' + dots + '</span></div>' +
      '<div class="kp-week__row"><div><b>' + money(wk.cur) + '</b><span>spent, 7 days</span></div>' +
      '<div><b class="' + (wk.delta <= 0 ? 'pos' : 'neg') + '">' + (wk.prev > 0 ? (wk.delta <= 0 ? '▼ ' : '▲ ') + fmt0(wk.delta) : '—') + '</b><span>vs the week before</span></div>' +
      '<div><b>' + (wk.top ? esc(wk.top) : '—') + '</b><span>' + (wk.top ? money(wk.topAmt) + ' · biggest' : 'nothing logged') + '</span></div></div>' +
      '<p class="kp-muted-sm">' + (dl >= 6 ? 'Logged ' + dl + ' of the last 7 days — the record is honest, so the numbers are.' : dl >= 3 ? 'Logged ' + dl + ' of the last 7 days. The days you skip are where money quietly goes.' : 'Only ' + dl + ' of the last 7 days have an entry. Thirty seconds a day keeps the picture true — tap + tonight.') + '</p></div>';

    // One idea a day, in the person's own numbers.
    var les = E.lesson(M, S.profile, S.emis, today());
    if (les) h += '<div class="panel kp-lesson"><p class="eyebrow">' + TN.icon('lightbulb', 14) + ' One thing to learn today · ' + esc(les.title) + '</p><h2>' + les.lead + '</h2><p>' + les.body + '</p><p class="kp-lesson__why">' + esc(les.why) + '</p></div>';

    h += homeAnalysisCard();
    h += '<div class="kp-two">';
    var s = E.emiSummary(S.emis, S.rows, today());
    if (s) {
      var nextLine = s.due ? 'Next: <b>' + esc(s.due.e.name) + '</b> ' + esc(s.due.d.status) : s.dueN ? 'All ' + s.dueN + ' instalment' + (s.dueN === 1 ? '' : 's') + ' for this month recorded' : 'Nothing due this month';
      h += '<div class="panel kp-tap" data-go="emis" role="button" tabindex="0"><div class="kp-cardhd"><h2>EMIs</h2><span class="kp-chev">' + TN.icon('arrow-right', 18) + '</span></div>' +
        '<div class="kp-emimini">' + s.items.slice(0, 4).map(function (x, i) { return ring(x.d.progress, { size: 56, stroke: 9, cls: ['', 'accent', 'warn', 'muted'][i % 4], center: '<b>' + x.d.left + '</b>' }); }).join('') +
        '<div class="kp-emimini__txt"><b class="num">' + money(s.monthly) + '</b>/month to lenders · <b class="num">' + money(s.remaining) + '</b> left<br><span>' + nextLine + ' · debt-free ' + monthName(s.end) + '</span></div></div></div>';
    } else {
      h += '<div class="panel kp-tap" data-go="emis" role="button" tabindex="0"><div class="kp-cardhd"><h2>EMIs</h2><span class="kp-chev">' + TN.icon('arrow-right', 18) + '</span></div>' +
        '<p class="muted">No EMIs recorded. Add each loan once and Kept tracks months left, money left and the due dates.</p></div>';
    }
    var cats = Object.keys(st.byCat).sort(function (a, b) { return st.byCat[b] - st.byCat[a]; }).slice(0, 5), cmax = cats[0] ? st.byCat[cats[0]] : 1;
    h += '<div class="panel kp-tap" data-go="spend" role="button" tabindex="0"><div class="kp-cardhd"><h2>Where it went — ' + E.monthLong(cur_).split(' ')[0] + '</h2><span class="kp-chev">' + TN.icon('arrow-right', 18) + '</span></div><div class="kp-catlist">' +
      (cats.length ? cats.map(function (c) { var v = st.byCat[c], prev = st.prevByCat ? (st.prevByCat[c] || 0) : null;
        return '<div class="kp-catrow">' + chip(c, 'expense') + '<div class="kp-catrow__name"><b>' + esc(c) + '</b><div class="kp-track"><i style="width:' + Math.round(v / cmax * 100) + '%"></i></div></div>' +
          '<div class="kp-catrow__amt">' + money(v) + (prev != null && prev > 0 && Math.abs(v - prev) >= 100 ? '<small class="' + (v > prev ? 'neg' : 'pos') + '">' + (v > prev ? '▲' : '▼') + fmt0(v - prev) + ' vs last</small>' : '') + (timeCost(v) ? '<small>' + timeCost(v) + '</small>' : '') + '</div></div>'; }).join('')
        : '<p class="muted">Nothing spent yet this month.</p>') + '</div></div>';
    h += '</div><div class="kp-two">';
    var ps = E.pathStatus(M, S.profile, S.profile.profile_json.pathBase || null, today());
    if (ps) {
      if (ps.newBase) saveProfile({ profile_json: { pathBase: ps.base } }, true).catch(function () { /* the baseline is recomputed next time */ });
      h += '<div class="panel kp-tap" data-go="insights:health" role="button" tabindex="0"><div class="kp-cardhd"><h2>The path</h2>' + pill(ps.cls, ps.ok == null ? 'not scored' : ps.ok ? 'on path' : 'deviation') + '</div>' +
        '<p class="muted">' + pathLine(ps) + '</p><p class="kp-muted-sm" style="margin-top:var(--space-2)">Discipline score <b>' + M.score + '/100</b> · keep-rate across ' + M.fullMonths.length + ' full month' + (M.fullMonths.length === 1 ? '' : 's') + ': <b>' + pct(M.cashKeptRate) + '</b> · tap for the health check</p></div>';
    }
    var recent = S.rows.slice(-5).reverse();
    h += '<div class="panel"><div class="kp-cardhd"><h2>Recent</h2><button type="button" class="btn btn--quiet btn--sm" data-go="history">See all ' + TN.icon('arrow-right', 16) + '</button></div><div class="kp-txlist">' +
      (recent.length ? recent.map(txRow).join('') : '<p class="muted">Nothing yet. Tap + to log the first entry.</p>') + '</div></div></div>';
    box.innerHTML = h;
    wireGo(box);
    wireTx(box);
  }
  function pathLine(ps) {
    if (ps.ok == null) return 'NOT SCORED — no complete month with a normal income yet' + (ps.latest ? ' (latest complete: ' + E.monthShort(ps.latest) + ')' : '') + '. Add or upload the months containing your salary and the path check starts.';
    var note = ps.skipped > 0 ? ' (' + ps.skipped + ' month' + (ps.skipped > 1 ? 's' : '') + ' skipped — no salary recorded)' : '';
    return ps.ok ? 'ON PATH — ' + E.monthShort(ps.lm) + ' kept ' + pct(ps.actual) + ' against a plan of ' + pct(ps.should) + note + '. Hold the line.'
      : 'DEVIATION — ' + E.monthShort(ps.lm) + ' kept ' + pct(ps.actual) + ' against the ' + pct(ps.should) + ' the ramp requires: ' + money(ps.amt) + ' short' + note + '. The plan only works if the ramp holds.';
  }
  function wireGo(root) {
    TN.els('[data-go]', root).forEach(function (el) {
      var go = function (e) {
        e.stopPropagation();
        var t = el.getAttribute('data-go').split(':');
        if (t[0] === 'insights' && t[1]) openInsight(t[1]); else showScreen(t[0]);
      };
      el.addEventListener('click', go);
      if (el.getAttribute('role') === 'button') el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
    });
  }
  function txRow(r) {
    var k = r.kind || E.classify(r);
    return '<button type="button" class="kp-tx' + (r.pending ? ' is-pending' : '') + '" data-id="' + esc(r.id) + '"' + (r.pending ? ' disabled aria-busy="true"' : '') + '>' + chip(r.cat, k) +
      '<div class="kp-tx__mid"><div class="kp-tx__name">' + esc(String(r.descr).slice(0, 60)) + '</div><div class="kp-tx__meta">' + esc(r.cat || 'Uncategorised') + ' · ' + dateShort(r.d) +
      (r.remark && !/^(quick-add|income entry|sms|quick-tile)$/.test(r.remark) ? ' · ' + esc(String(r.remark).slice(0, 28)) : '') + (k !== 'expense' && k !== 'income' ? ' · ' + k : '') + '</div></div>' +
      '<div class="kp-tx__amt ' + (r.amount_minor >= 0 ? 'pos' : '') + '">' + (r.amount_minor >= 0 ? '+' : '−') + fmt0(r.amount_minor) + '</div></button>';
  }
  function wireTx(root) {
    TN.els('.kp-tx', root).forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); openAdd({ id: b.getAttribute('data-id') }); }); });
  }

  /* --------------------------------------------------------------- Spend */
  function spendPeriods() {
    var ms = S.M.months.slice().reverse(), ty = today().slice(0, 7);
    return ms.map(function (m) { return { k: m, lb: m === ty ? 'This month' : E.monthShort(m) }; }).concat([{ k: 'all', lb: 'All time' }]);
  }
  function renderSpend() {
    if (!S.M) {
      $('spend-chips').innerHTML = ''; $('spend-head').innerHTML = '<div class="empty">Nothing to show yet — add an entry or upload your Excel.</div>';
      $('cat-list').innerHTML = ''; $('merchants').innerHTML = ''; $('spend-sub').textContent = ''; $('donut-center').innerHTML = ''; return;
    }
    var M = S.M, ps = spendPeriods();
    if (!S.spendPeriod || !ps.some(function (p) { return p.k === S.spendPeriod; })) S.spendPeriod = ps[0].k;
    var period = S.spendPeriod, inP = function (t) { return period === 'all' || t.month === period; };
    $('spend-chips').innerHTML = ps.map(function (p) { return '<button type="button" role="tab" aria-selected="' + (p.k === period) + '" data-p="' + p.k + '">' + esc(p.lb) + '</button>'; }).join('');
    TN.els('#spend-chips button').forEach(function (c) { c.addEventListener('click', function () { S.spendPeriod = c.getAttribute('data-p'); S.openCat = null; renderSpend(); }); });
    var sel = TN.el('#spend-chips [aria-selected="true"]'); if (sel && sel.scrollIntoView) { try { sel.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { /* jsdom */ } }
    var tx = M.txns.filter(inP);
    var cats = {}; tx.forEach(function (t) { if (t.kind === 'expense') cats[t.cat] = (cats[t.cat] || 0) + (-t.amt); });
    var entries = Object.keys(cats).map(function (c) { return [c, cats[c]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var tot = entries.reduce(function (a, e) { return a + e[1]; }, 0);
    var emi = tx.filter(function (t) { return t.kind === 'debtpay'; }).reduce(function (a, t) { return a - t.amt; }, 0);
    var nM = period === 'all' ? (M.fullMonths.length || 1) : 1;
    var cmp = '';
    if (period !== 'all') {
      var i = M.months.indexOf(period), prev = i > 0 ? M.months[i - 1] : null;
      if (prev) { var pv = M.per[prev].spend, d = tot - pv, live = period === today().slice(0, 7), day = live ? Math.max(1, new Date().getDate()) : null;
        cmp = live ? 'Day ' + day + ': usual pace for this point is <b>' + money(Math.round(pv * day / 30.44)) + '</b> (' + E.monthShort(prev) + ' ran ' + money(pv) + ' in total).'
          : (d <= 0 ? '<b class="pos">' + money(-d) + ' less</b>' : '<b class="neg">' + money(d) + ' more</b>') + ' than ' + E.monthShort(prev) + '.'; }
    } else cmp = '<b>' + money(Math.round(tot / nM)) + '</b> a month on average across ' + M.fullMonths.length + ' full months.';
    $('spend-head').innerHTML = '<div class="panel kp-hero" style="margin-bottom:var(--space-3)"><p class="eyebrow">' + (period === 'all' ? 'All time' : period === today().slice(0, 7) ? 'This month' : E.monthShort(period)) + '</p>' +
      '<div class="kp-hero__big">' + money(tot) + '</div><div class="kp-hero__sub">spent on life' + (emi ? ' · plus <b>' + money(emi) + '</b> to lenders' : '') + (tx.length ? ' · ' + tx.filter(function (t) { return t.kind === 'expense'; }).length + ' purchases' : '') + '</div>' +
      '<div class="kp-hero__sub">' + cmp + '</div></div>';
    $('spend-sub').textContent = tot ? entries.length + ' categories' : 'Nothing spent in this period.';
    var t = tokens(), pal = palette(t);
    var top = entries.slice(0, 5), rest = entries.slice(5).reduce(function (a, e) { return a + e[1]; }, 0);
    var dl = top.map(function (e) { return e[0]; }).concat(rest > 0 ? ['Other'] : []), dv = top.map(function (e) { return e[1]; }).concat(rest > 0 ? [rest] : []);
    chart('ch-cat', { type: 'doughnut', data: { labels: dl, datasets: [{ data: dv.map(function (v) { return v / 100; }), backgroundColor: dl.map(function (c, i) { return c === 'Other' ? alpha(t.muted, 0.45) : pal[i % pal.length]; }), borderWidth: 2, borderColor: t.surface, hoverOffset: 6 }] },
      options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return ' ' + c.label + ': ' + money(Math.round(c.parsed * 100)) + ' (' + pct(tot ? c.parsed * 100 / tot * 100 : 0) + ')'; } } } } } });
    $('donut-center').innerHTML = tot ? '<b>' + pct(entries[0][1] / tot * 100) + '</b><span>' + esc(entries[0][0]) + '</span>' : '';
    var cmax = entries[0] ? entries[0][1] : 1;
    $('cat-list').innerHTML = entries.length ? entries.map(function (e) { var c = e[0], v = e[1], n = tx.filter(function (x) { return x.kind === 'expense' && x.cat === c; }).length, open = S.openCat === c;
      return '<div class="kp-catrow" role="button" tabindex="0" aria-expanded="' + open + '" data-c="' + esc(c) + '">' + chip(c, 'expense') +
        '<div class="kp-catrow__name"><b>' + esc(c) + '</b><small>' + n + ' · ' + pct(v / tot * 100) + (period === 'all' ? ' · ' + money(Math.round(v / nM)) + '/mo' : '') + '</small><div class="kp-track"><i style="width:' + Math.round(v / cmax * 100) + '%"></i></div></div>' +
        '<div class="kp-catrow__amt">' + money(v) + '</div></div>' + (open ? catDrill(c, tx) : ''); }).join('') : '<p class="muted">No spending rows here.</p>';
    TN.els('#cat-list [data-c]').forEach(function (r) {
      var toggle = function () { S.openCat = S.openCat === r.getAttribute('data-c') ? null : r.getAttribute('data-c'); renderSpend(); };
      r.addEventListener('click', toggle);
      r.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
    wireTx($('cat-list'));
    var mer = {}; tx.forEach(function (x) { if (x.kind !== 'expense') return; mer[x.nm] = mer[x.nm] || { k: x.nm, sum: 0, n: 0, cat: x.cat }; mer[x.nm].sum += -x.amt; mer[x.nm].n++; });
    var ml = Object.keys(mer).map(function (k) { return mer[k]; }).sort(function (a, b) { return b.sum - a.sum; }).slice(0, 8), mmax = ml[0] ? ml[0].sum : 1;
    $('merchants').innerHTML = ml.length ? ml.map(function (m) { return '<div class="kp-catrow">' + chip(m.cat, 'expense') + '<div class="kp-catrow__name"><b>' + esc(m.k) + '</b><small>' + m.n + ' · ' + esc(m.cat) + '</small><div class="kp-track"><i style="width:' + Math.round(m.sum / mmax * 100) + '%"></i></div></div><div class="kp-catrow__amt">' + money(m.sum) + '</div></div>'; }).join('') : '<p class="muted">—</p>';
    var L = M.fullMonths, topCats = Object.keys(M.catTotal).sort(function (a, b) { return M.catTotal[b] - M.catTotal[a]; }).slice(0, 5);
    var ds = topCats.map(function (c, i) { return { label: c, data: L.map(function (m) { return (M.per[m].byCat[c] || 0) / 100; }), backgroundColor: pal[i % pal.length], stack: 's', borderRadius: 2 }; });
    ds.push({ label: 'Other', data: L.map(function (m) { var s = M.per[m].spend; topCats.forEach(function (c) { s -= M.per[m].byCat[c] || 0; }); return Math.max(0, s) / 100; }), backgroundColor: alpha(t.muted, 0.45), stack: 's' });
    chart('ch-stack', { type: 'bar', data: { labels: L.map(E.monthShort), datasets: ds }, options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + money(Math.round(c.parsed.y * 100)); } } } } } });
  }
  function catDrill(c, tx) {
    var rows = tx.filter(function (t) { return t.kind === 'expense' && t.cat === c; }).slice().reverse().slice(0, 60);
    return '<div class="kp-drill kp-txlist">' + rows.map(function (t) { return txRow({ id: t.id, d: t.ds, descr: t.descr, amount_minor: t.amt, cat: t.cat, remark: t.rem, kind: t.kind }); }).join('') +
      (rows.length === 60 ? '<p class="kp-muted-sm">Showing the latest 60 — the full list is under Transactions.</p>' : '') + '</div>';
  }

  /* ------------------------------------------------------------- History */
  function renderHistory(reset) {
    if (reset) S.hxShown = 150;
    var sel = $('hx-month'), keep = sel.value || 'all';
    var ms = []; var seen = {}; S.rows.forEach(function (r) { var m = r.d.slice(0, 7); if (!seen[m]) { seen[m] = 1; ms.push(m); } });
    ms.sort().reverse();
    sel.innerHTML = '<option value="all">All months</option>' + ms.map(function (m) { return '<option value="' + m + '">' + E.monthShort(m) + '</option>'; }).join('');
    sel.value = ms.indexOf(keep) > -1 ? keep : 'all';
    var q = ($('hx-search').value || '').toLowerCase(), kd = $('hx-kind').value, mo = sel.value;
    var all = S.rows.slice().reverse();
    var rows = all.filter(function (r) {
      if (mo !== 'all' && r.d.slice(0, 7) !== mo) return false;
      if (kd !== 'all' && (r.kind || E.classify(r)) !== kd) return false;
      if (q && !((r.descr || '') + ' ' + (r.cat || '') + ' ' + (r.remark || '')).toLowerCase().includes(q)) return false;
      return true;
    });
    var page = rows.slice(0, S.hxShown);
    var inSum = rows.filter(function (r) { return r.amount_minor > 0; }).reduce(function (a, r) { return a + r.amount_minor; }, 0);
    var outSum = rows.filter(function (r) { return r.amount_minor < 0; }).reduce(function (a, r) { return a - r.amount_minor; }, 0);
    $('hx-count').innerHTML = '<b>' + rows.length + '</b> of ' + all.length + ' transactions · in ' + money(inSum) + ' · out ' + money(outSum) + ' · net <b class="' + (inSum - outSum >= 0 ? 'pos' : 'neg') + '">' + money(inSum - outSum) + '</b>';
    var html = '', lastDay = '';
    page.forEach(function (r) {
      if (r.d !== lastDay) { lastDay = r.d; html += '<div class="kp-txday">' + E.parse(r.d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + '</div>'; }
      html += txRow(r);
    });
    $('hx-list').innerHTML = page.length ? html : '<p class="muted" style="padding:var(--space-3) 0">No transactions match. Tap + to log today\'s spending, or upload your Excel in Settings.</p>';
    $('hx-more').hidden = rows.length <= S.hxShown;
    $('hx-more').textContent = 'Show more (' + Math.max(0, rows.length - S.hxShown) + ' left)';
    wireTx($('hx-list'));
  }

  /* ---------------------------------------------------------------- EMIs */
  function renderEmis() {
    var box = $('emi-wrap'), rows = S.rows, t = today();
    var es = S.emis.map(function (e, i) { return { e: e, d: E.emiDerive(e, rows, t), i: i }; });
    var run = es.filter(function (x) { return x.d.left > 0; }), fin = es.filter(function (x) { return x.d.left <= 0; });
    var inc = S.M && S.M.avg.income > 0 ? S.M.avg.income : 0;
    var h = '';
    if (!run.length) {
      h += '<div class="panel kp-hero"><h2>Your EMIs, in one place</h2><p class="muted" style="margin-top:var(--space-2)">Add each loan the way you know it — the instalment, how many are done, when the next one is due. Kept turns that into months left, money left, a debt-free date, and a reminder on the due day.</p>' +
        '<p style="margin-top:var(--space-3)"><button type="button" class="btn btn--primary" id="emi-add0">' + TN.icon('plus', 18) + ' Add an EMI</button></p></div>';
    } else {
      var s = E.emiSummary(S.emis, rows, t), share = inc ? s.monthly / inc * 100 : 0, freed = s.nextEnd ? s.nextEnd.d.emi : 0;
      h += '<div class="panel kp-hero"><div class="kp-hero__top"><div><p class="eyebrow">Every month, to lenders</p><div class="kp-hero__big">' + money(s.monthly) + '</div>' +
        '<div class="kp-hero__sub">' + (inc ? '<b>' + pct(share) + '</b> of your income · ' : '') + s.n + ' running EMI' + (s.n === 1 ? '' : 's') + '</div></div>' +
        ring(1 - (s.remaining / Math.max(1, s.remaining + s.paidAmt)), { size: 104, center: '<b>' + s.monthsLeft + '</b><span>months<br>to go</span>' }) + '</div>' +
        '<div class="kp-statrow"><div><span>Left to pay</span><b>' + money(s.remaining) + '</b></div><div><span>Debt-free</span><b>' + monthName(s.end) + '</b></div><div><span>This month</span><b>' + s.paid + '/' + s.dueN + ' recorded</b></div></div>' +
        insight(s.unrecorded.length ? '<b>' + s.unrecorded.length + '</b> instalment' + (s.unrecorded.length === 1 ? ' was' : 's were') + ' due and ' + (s.unrecorded.length === 1 ? 'is' : 'are') + ' not in the record yet: ' + s.unrecorded.map(function (x) { return esc(x.e.name); }).join(', ') + '. Either the payment did not go out, or it went out and Kept does not know — both need a look.'
          : s.nextEnd ? 'The first one to finish is <b>' + esc(s.nextEnd.e.name) + '</b> in ' + monthName(s.nextEnd.d.end) + '. From the month after, <b>' + money(freed) + '</b> a month stops leaving. That money has no owner yet — if it is not assigned before it arrives, it becomes lifestyle.' : 'Everything due this month is recorded.',
          s.unrecorded.length ? 'check the bank app for ' + esc(s.unrecorded[0].e.name) + '; if it was paid, tap the card and mark it, so the keep-rate stays honest.' : s.nextEnd ? 'set a standing order of ' + money(freed) + ' into savings dated the month after ' + monthName(s.nextEnd.d.end) + ' — today, while it is still a plan and not a temptation.' : 'nothing to do here — the next due date will show up on Home.',
          s.unrecorded.length ? 'bad' : 'good') + '</div>';
      h += '<div class="kp-emigrid">' + run.sort(function (a, b) { return a.d.end - b.d.end; }).map(emiCard).join('') + '</div>' +
        '<p><button type="button" class="btn btn--ghost" id="emi-add">' + TN.icon('plus', 18) + ' Add another EMI</button></p>';
      var tl = E.emiTimeline(S.emis, rows, 36, t), mx = Math.max(1, tl[0] ? Math.max.apply(null, tl.map(function (x) { return x.load; })) : 1), ends = tl.filter(function (x) { return x.ends.length; });
      h += '<div class="panel"><div class="kp-cardhd"><h2>EMI load — the next three years</h2></div><p class="muted">What leaves for lenders each month if nothing changes. Every step down is money that becomes yours again.</p>' +
        '<div class="kp-tl" role="img" aria-label="EMI load by month for 36 months">' + tl.map(function (x, i) { return '<div title="' + monthName(x.m) + ': ' + money(x.load) + '"><i class="' + (x.ends.length ? 'is-end' : '') + '" style="height:' + Math.round(x.load / mx * 100) + '%"></i>' + (i % 6 === 0 ? '<span>' + x.m.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) + '</span>' : '') + '</div>'; }).join('') + '</div>' +
        '<div class="kp-tl__legend"><span><i></i>monthly load</span><span><i class="is-end"></i>a loan ends</span></div>' +
        '<div style="margin-top:var(--space-3)">' + (ends.map(function (x) { var next = tl[tl.indexOf(x) + 1]; return '<div class="kp-ms"><b>' + monthName(x.m) + '</b><span>' + x.ends.map(function (e) { return esc(e.name); }).join(', ') + (x.ends.length === 1 ? ' ends' : ' end') + ' → load drops to <b class="num">' + money(next ? next.load : 0) + '</b>/month</span></div>'; }).join('') || '<p class="muted">No EMI finishes within three years.</p>') + '</div></div>';
      h += payoffBlock(run);
    }
    if (fin.length) h += '<div class="panel"><div class="kp-cardhd"><h2>Finished</h2></div><p class="muted">Closed loans. Delete them when you no longer want the record.</p>' + fin.map(function (x) { return '<div class="kp-row"><span>' + esc(x.e.name) + ' · ' + x.d.total + ' instalments of ' + money(x.d.emi) + '</span><button type="button" class="btn btn--ghost btn--sm" data-edit="' + x.e.id + '">Edit</button></div>'; }).join('') + '</div>';
    box.innerHTML = h;
    TN.els('[data-edit]', box).forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); openEmi(b.getAttribute('data-edit')); }); });
    TN.els('.kp-emicard', box).forEach(function (c) { var go = function () { openEmi(c.getAttribute('data-id')); }; c.addEventListener('click', go); c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }); });
    ['emi-add', 'emi-add0'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', function () { openEmi(null); }); });
    var ex = $('pay-extra'); if (ex) ex.addEventListener('input', function () { renderPayoff(run); });
    renderPayoff(run);
    renderRules();
  }
  function emiCard(x) {
    var e = x.e, d = x.d, cls = ['', 'accent', 'warn', 'muted'][x.i % 4];
    return '<div class="panel kp-emicard kp-tap" data-id="' + esc(e.id) + '" role="button" tabindex="0" aria-label="' + esc(e.name) + ': ' + d.left + ' months left">' +
      ring(d.progress, { size: 110, stroke: 10, cls: cls, center: '<b>' + d.left + '</b><span>' + (d.left === 1 ? 'month' : 'months') + ' left</span><em>' + money(d.remaining) + '</em>' }) +
      '<div class="kp-emicard__body"><div class="kp-emicard__name">' + esc(e.name) + (e.lender ? ' <small>· ' + esc(e.lender) + '</small>' : '') + '</div>' +
      '<div class="kp-emicard__meta num">' + money(d.emi) + '/month · due ' + ordinal(e.due_day || 1) + ' · ' + d.done + ' of ' + d.total + ' paid</div>' +
      (d.hasApr ? '<div class="kp-emicard__meta">≈ ' + money(d.principal) + ' principal at ' + (e.apr_bp / 100) + '%</div>' : '<div class="kp-emicard__meta">rate not set — add it for interest maths</div>') +
      '<div class="kp-emicard__foot">' + pill(d.cls, d.status) + '<span class="muted">ends ' + monthName(d.end) + '</span></div></div></div>';
  }
  function payoffBlock(run) {
    return '<div class="panel" id="payoff"><div class="kp-cardhd"><h2>Snowball vs avalanche</h2></div><p class="muted">Fed by your EMI records. Add a rate to each loan for honest interest maths; loans without one are simulated at 0%.</p>' +
      '<div class="field" style="margin-top:var(--space-3)"><label for="pay-extra">Extra per month on top of the instalments: <b id="pay-lbl"></b></label><input id="pay-extra" type="range" min="0" max="500000" step="5000" value="50000"></div><div id="pay-cmp" style="margin-top:var(--space-3)"></div></div>';
  }
  function renderPayoff(run) {
    var box = $('pay-cmp'); if (!box) return;
    var extra = +$('pay-extra').value; $('pay-lbl').textContent = money(extra);
    var L = E.loansFromEmis(S.emis, S.rows, today()).filter(function (l) { return l.balance > 0; });
    if (!L.length) { box.innerHTML = '<p class="muted">No running loans to simulate.</p>'; return; }
    var base = E.simulate(L, 0, 'snow'), snow = E.simulate(L, extra, 'snow'), ava = E.simulate(L, extra, 'ava');
    var df = function (n) { var d = new Date(); d.setMonth(d.getMonth() + n); return monthName(d); };
    var row = function (n, s) { return '<div class="kp-row"><span><b style="font-family:var(--font-body)">' + n + '</b><br><span class="kp-muted-sm">debt-free ' + df(s.months) + ' · ' + s.months + ' months</span></span><span><b>' + money(s.interest) + '</b><br><span class="kp-muted-sm">interest</span></span></div>'; };
    var diff = snow.interest - ava.interest, firstKill = L.slice().sort(function (a, b) { return a.balance - b.balance; })[0];
    box.innerHTML = row('Minimums only', base) + row('Snowball', snow) + row('Avalanche', ava) +
      insight('Adding <b>' + money(extra) + '/month</b> saves <b>' + money(Math.max(0, base.interest - ava.interest)) + '</b> in interest and brings freedom forward by <b>' + Math.max(0, base.months - ava.months) + ' months</b>. ' +
        (diff > 20000 ? '<b>Avalanche</b> — the highest-rate loan is expensive enough that maths beats motivation; target <b>' + esc(L.slice().sort(function (a, b) { return b.apr - a.apr; })[0].name) + '</b> first.'
          : '<b>Snowball</b> — the interest difference is only ' + money(Math.abs(diff)) + ', so take the psychology: kill <b>' + esc(firstKill.name) + '</b> first, feel the win, roll its EMI into the next.'),
        'fix the extra payment as a standing order the day after salary, not a month-end leftover.');
  }
  function renderRules() {
    var rs = S.rules, box = $('rc-list');
    box.innerHTML = rs.length ? rs.map(function (r) {
      var f = r.freq === 'weekly' ? 'Weekly' : r.freq === 'yearly' ? 'Yearly' : 'Monthly';
      return '<div class="kp-catrow">' + chip(r.cat, r.amount_minor > 0 ? 'income' : 'expense') + '<div class="kp-catrow__name"><b>' + esc(r.descr) + '</b><small>' + f + ' from ' + dateShort(r.start_d) + (r.end_d ? ' · ends ' + dateShort(r.end_d) : ' · no end date') + ' · ' + esc(r.cat) + '</small></div>' +
        '<div class="kp-catrow__amt ' + (r.amount_minor > 0 ? 'pos' : '') + '">' + (r.amount_minor > 0 ? '+' : '−') + fmt0(r.amount_minor) + '<br><button type="button" class="btn btn--quiet btn--sm" data-del="' + esc(r.id) + '" aria-label="Delete rule ' + esc(r.descr) + '">' + TN.icon('trash', 16) + '</button></div></div>';
    }).join('') : '<p class="muted">No recurring rules yet. Rent, salary and subscriptions are the ones worth adding — they are most of the month.</p>';
    TN.els('[data-del]', box).forEach(function (b) { b.addEventListener('click', async function () {
      if (!confirm('Delete this rule? Transactions it already wrote stay in the record.')) return;
      try { S.rules = (await api('/api/kept/recurring?id=' + encodeURIComponent(b.getAttribute('data-del')), { method: 'DELETE' })).rules; persist(); renderRules(); TN.toast('Rule deleted', 'success'); } catch (e) { fail(e); }
    }); });
  }

  /* ------------------------------------------------------------ Insights */
  var INS = [
    { k: 'analysis', t: 'What KEPT noticed', i: 'lightbulb', special: true },
    { group: 'The review' },
    { k: 'health', t: 'Health check', d: 'Score, factors, the numbers that matter.', i: 'activity' },
    { k: 'cfo', t: 'Monthly statement', d: 'Your household as a business would see it: income, costs, what is left, break-even day, budget vs actual.', i: 'file-text' },
    { k: 'mom', t: 'Month-on-month', d: 'Years overlaid, projections, cautions.', i: 'bar-chart' },
    { k: 'forecast', t: 'Forecast & risks', d: 'Twelve months out, the risks, the outliers.', i: 'trending-up' },
    { k: 'life', t: 'Life plan', d: 'The 5/10/20-year arithmetic of the path.', i: 'calendar' },
    { group: 'Tools' },
    { k: 'upcoming', t: 'Upcoming expenses', d: 'The next 30 or 60 days, from EMIs and rules.', i: 'calendar' },
    { k: 'categorise', t: 'Categorise', d: 'Rows still on Misc, matched to how you filed the same place before.', i: 'layers' }
  ];
  function renderInsights() {
    var hub = $('ins-hub'), view = $('ins-view');
    if (S.insView) { hub.hidden = true; view.hidden = false; renderInsightView(S.insView); return; }
    view.hidden = true; hub.hidden = false;
    hub.innerHTML = INS.map(function (x) {
      if (x.group !== undefined) return '<p class="eyebrow kp-hub__group">' + x.group + '</p>';
      if (x.special) return analysisTile();
      return '<button type="button" data-ins="' + x.k + '"><span class="kp-ic">' + TN.icon(x.i, 18) + '</span><span><b>' + x.t + '</b><span class="kp-hub__d">' + x.d + '</span></span><span class="kp-chev">' + TN.icon('chevron-right', 18) + '</span></button>';
    }).join('');
    TN.els('[data-ins]', hub).forEach(function (b) { b.addEventListener('click', function () { openInsight(b.getAttribute('data-ins')); }); });
  }
  /* Opening a tile is a page of its own, pushed over the hub. */
  function openInsight(k) {
    if (!INS.some(function (x) { return x.k === k; })) return;
    pushPage({ screen: 'insights', ins: k });
  }
  function renderInsightView(k) {
    var def = INS.filter(function (x) { return x.k === k; })[0];
    if (!def) { S.insView = null; renderInsights(); return; }
    $('ins-title').textContent = def.t;
    var body = $('ins-body');
    if (!S.M && ['analysis', 'upcoming', 'categorise'].indexOf(k) < 0) { body.innerHTML = '<div class="empty">Upload or enter data first — the review needs your real numbers.</div>'; return; }
    ({ analysis: renderAnalysis, health: renderHealth, cfo: renderCFO, mom: renderMoM, forecast: renderForecast, life: renderLife,
      upcoming: renderUpcoming, categorise: renderCategorise })[k](body);
  }

  /* ------------------------------------------------------------ Analysis */
  /* What KEPT noticed. The findings engine (kept-core.js) runs right here
     over the record on screen, so an entry added a second ago is already
     part of the analysis. Each finding carries its own figures, a plain
     "why" and one "do this"; there is no model on this site. */
  var SEV = { high: ['Needs a look', 'bad'], medium: ['Worth a look', 'warn'], low: ['Worth knowing', 'info'], good: ['Good news', 'ok'] };
  var KIND_ICON = { subscription: 'repeat', price_creep: 'trending-up', duplicate: 'copy', category_spike: 'bar-chart', improving: 'check',
    small_leaks: 'coins', fees: 'kept-fees', one_off: 'alert-triangle', salary: 'kept-salary', income: 'kept-salary', payday: 'calendar',
    trend: 'activity', emi_ending: 'kept-bank', seasonal: 'calendar', hygiene: 'layers' };
  var AN = { showSeen: false, open: {} };
  function analyse() {
    if (!window.KeptCore || !S.profile) { S.analysis = null; return; }
    try {
      S.analysis = { findings: KeptCore.computeFindings({ rows: S.rows.filter(function (r) { return !r.pending; }), emis: S.emis, rules: S.rules, prof: S.profile }) };
    } catch (e) { S.analysis = null; }
  }
  function dismissed() { return (S.profile && S.profile.profile_json && S.profile.profile_json.dismissed) || {}; }
  function findings() { return (S.analysis && S.analysis.findings && S.analysis.findings.items) || []; }
  function visibleFindings() { var d = dismissed(); return findings().filter(function (f) { return d[f.id] !== f.sig; }); }
  function analysisTile() {
    var v = visibleFindings(), look = v.filter(function (f) { return f.severity !== 'good'; }), good = v.length - look.length;
    var head = look[0] ? look[0].title : 'Nothing unusual so far this month';
    return '<button type="button" class="kp-ana-tile" data-ins="analysis"><span class="kp-ic">' + TN.icon('lightbulb', 18) + '</span><span>' +
      '<span class="eyebrow">What KEPT noticed</span><b>' + esc(head) + '</b>' +
      '<span class="kp-hub__d">' + (look.length ? look.length + ' thing' + (look.length === 1 ? '' : 's') + ' worth a look' : 'All clear') + (good ? ' · ' + good + ' good news' : '') + '</span></span>' +
      '<span class="kp-chev">' + TN.icon('chevron-right', 18) + '</span></button>';
  }
  /* The card on Home: the top three. */
  function homeAnalysisCard() {
    if (!S.analysis) return '';
    var v = visibleFindings(), look = v.filter(function (f) { return f.severity !== 'good'; }), good = v.filter(function (f) { return f.severity === 'good'; });
    var list = look.slice(0, 3).concat(look.length < 3 ? good.slice(0, 3 - look.length) : []);
    return '<div class="panel kp-tap kp-ana-home" data-go="insights:analysis" role="button" tabindex="0">' +
      '<div class="kp-cardhd"><h2>' + TN.icon('lightbulb', 18) + ' What KEPT noticed</h2><span class="kp-chev">' + TN.icon('chevron-right', 18) + '</span></div>' +
      (list.length ? '<ul class="kp-ana-mini">' + list.map(function (f) {
        return '<li class="is-' + SEV[f.severity][1] + '"><span class="kp-ic">' + TN.icon(KIND_ICON[f.kind] || 'lightbulb', 16) + '</span><span><b>' + esc(f.title) + '</b><small>' + esc(f.facts[0] || '') + '</small></span></li>';
      }).join('') + '</ul>' : '<p class="muted">Nothing unusual so far this month.</p>') +
      (look.length > 3 ? '<p class="kp-muted-sm">' + (look.length - 3) + ' more inside</p>' : '') + '</div>';
  }
  function paintAnalysisIfOpen() { if (S.screen === 'insights' && S.insView === 'analysis') renderAnalysis($('ins-body')); else if (S.screen === 'insights' && !S.insView) renderInsights(); }
  function renderAnalysis(body) {
    var A = S.analysis, all = findings(), v = visibleFindings(), seen = all.length - v.length;
    var look = v.filter(function (f) { return f.severity !== 'good'; }).length;
    var h = '<div class="panel kp-hero kp-ana-intro">' +
      '<h2>' + (look ? look + ' thing' + (look === 1 ? '' : 's') + ' worth a look' : 'Nothing unusual so far') + '</h2>' +
      '<p>' + (A && A.findings && !A.findings.enough_data ? 'KEPT needs two complete months to compare against; with more history it notices more.'
        : 'Found by checking your whole record: regular charges, price rises, double charges, spikes, fees, payday habits, what is coming up. It updates as you add entries.') + '</p></div>';
    if (!all.length) {
      h += '<div class="empty">' + (S.rows.length ? 'Nothing stands out. KEPT checks again every time your record changes.' : 'Add entries or upload your Excel — the analysis reads your record.') + '</div>';
    }
    h += v.map(function (f) { return findingCard(f, false); }).join('');
    if (seen) {
      h += '<p class="kp-ana-seen"><button type="button" class="btn btn--quiet btn--sm" id="ana-seen">' + (AN.showSeen ? 'Hide' : 'Show') + ' ' + seen + ' you marked as seen</button></p>';
      if (AN.showSeen) h += all.filter(function (f) { return v.indexOf(f) < 0; }).map(function (f) { return findingCard(f, true); }).join('');
    }
    body.innerHTML = h;
    var sb = $('ana-seen'); if (sb) sb.addEventListener('click', function () { AN.showSeen = !AN.showSeen; renderAnalysis(body); });
    TN.els('[data-dismiss]', body).forEach(function (b) { b.addEventListener('click', function () { dismissFinding(b.getAttribute('data-dismiss'), b.getAttribute('data-sig'), b.hasAttribute('data-undo')); }); });
    TN.els('[data-rows]', body).forEach(function (b) { b.addEventListener('click', function () { var id = b.getAttribute('data-rows'); AN.open[id] = !AN.open[id]; renderAnalysis(body); }); });
    wireTx(body);
  }
  function findingCard(f, seen) {
    var sev = SEV[f.severity] || SEV.low;
    var rows = (f.rows || []).map(function (id) { return S.rows.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean);
    return '<article class="kp-find kp-find--' + sev[1] + (seen ? ' is-seen' : '') + '">' +
      '<header class="kp-find__head"><span class="kp-ic">' + TN.icon(KIND_ICON[f.kind] || 'lightbulb', 18) + '</span>' +
      '<div><span class="kp-find__sev">' + sev[0] + '</span><h3>' + esc(f.title) + '</h3></div></header>' +
      '<ul class="kp-find__facts">' + f.facts.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<p class="kp-find__why">' + esc(f.why) + '</p>' +
      '<p class="kp-find__act"><b>Do this:</b> ' + esc(f.action) + '</p>' +
      (rows.length && AN.open[f.id] ? '<div class="kp-txlist kp-find__rows">' + rows.map(txRow).join('') + '</div>' : '') +
      '<footer class="kp-find__foot"><span></span>' +
      '<span>' + (rows.length ? '<button type="button" class="btn btn--quiet btn--sm" data-rows="' + esc(f.id) + '">' + (AN.open[f.id] ? 'Hide entries' : 'Show entries') + '</button>' : '') +
      '<button type="button" class="btn btn--ghost btn--sm" data-dismiss="' + esc(f.id) + '" data-sig="' + esc(f.sig) + '"' + (seen ? ' data-undo' : '') + '>' + (seen ? 'Bring back' : TN.icon('check', 16) + ' Got it') + '</button></span>' +
      '</footer></article>';
  }
  /* "Got it": the finding goes until its figures change. Stored on the
     profile so every device agrees. */
  async function dismissFinding(id, sig, undo) {
    var d = Object.assign({}, dismissed());
    if (undo) delete d[id]; else d[id] = sig;
    S.profile.profile_json.dismissed = d;
    paintAnalysisIfOpen();
    try { await saveProfile({ profile_json: { dismissed: d } }, true); }
    catch (e) { fail(e); }
  }

  function caveat() {
    var M = S.M, n = M.fullMonths.length, inc = M.avg.income + M.avg.refund, out = [];
    if (n === 0) out.push('No complete month yet — every figure below is from a partial month and will move a lot.');
    else if (n === 1) out.push('Only <b>one</b> complete month on record: treat averages as a first reading, not a trend. Trends need three.');
    else if (n === 2) out.push('Two complete months on record — enough for a direction, not yet a pattern.');
    if (inc <= 0) out.push('No income rows detected, so the keep-rate cannot be computed. Add your salary rows (positive amounts) or map the income column on upload.');
    if (M.lastPartial) out.push('The newest month is still running and is excluded from averages — its own progress is on Home.');
    return out.length ? '<div class="notice notice--warning"><div><b>Read this first.</b> ' + out.join(' ') + '</div></div>' : '';
  }
  function renderHealth(body) {
    var M = S.M, a = M.avg, cls = function (v, g, w) { return v >= g ? 'ok' : v >= w ? 'warn' : 'bad'; };
    var s = M.score, scol = s >= 70 ? '' : s >= 45 ? 'warn' : 'bad';
    var worst = M.factors.slice().sort(function (x, y) { return x.val - y.val; });
    var ps = E.pathStatus(M, S.profile, S.profile.profile_json.pathBase || null, today());
    body.innerHTML = caveat() +
      '<div class="panel kp-hero"><h2>For every ' + cur() + ' 100 you earn, you keep <b>' + Math.max(0, Math.min(100, Math.round(M.cashKeptRate))) + '</b>.</h2><p class="muted" style="margin-top:var(--space-2)">' +
      (M.cashKeptRate >= 20 ? 'You are building.' : M.cashKeptRate >= 8 ? 'You are treading water.' : 'The money is leaking faster than it grows.') + ' Across ' + M.fullMonths.length + ' full months: real income averaged <b>' + money(a.income) + '</b>/month, spending <b>' + money(a.spend) + '</b>, debt payments <b>' + money(a.debtpay) + '</b> — leaving <b>' + money(a.net) + '</b> with you' + (a.invest > 0 ? ' (of which <b>' + money(a.invest) + '</b> invested)' : '') + '.' +
      (M.totalBorrowed > 0 ? ' And <b>' + money(M.totalBorrowed) + '</b> of your inflow was borrowed, not earned.' : '') + '</p>' + (ps ? insight(pathLine(ps), null, ps.cls === 'ok' ? 'good' : ps.cls) : '') + '</div>' +
      '<div class="kp-kpis">' +
      kpi('Avg monthly income', money(a.income), '+ ' + money(a.refund) + ' refunds & cashback', 'ok') +
      kpi('Avg monthly spending', money(a.spend), money(Math.round(a.spend / 30.44)) + ' per day', a.spend < a.income * 0.6 ? 'ok' : a.spend < a.income * 0.8 ? 'warn' : 'bad') +
      kpi('Net kept / month', money(a.net), 'keep-rate ' + pct(M.cashKeptRate), cls(M.cashKeptRate, 20, 10)) +
      kpi('Debt burden', pct(M.debtBurden), money(a.debtpay) + '/month to lenders', M.debtBurden < 15 ? 'ok' : M.debtBurden < 30 ? 'warn' : 'bad') +
      kpi('Cash built over period', money(M.cumNet), M.fullMonths.length + ' full months on file', M.cumNet > 0 ? 'ok' : 'bad') +
      kpi('Emergency buffer', (Math.round(M.bufferMonths * 10) / 10) + ' mo', 'target 6 months of outflow', M.bufferMonths >= 6 ? 'ok' : M.bufferMonths >= 2 ? 'warn' : 'bad') +
      kpi('Borrowed inflow', money(M.totalBorrowed), pct(M.borrowShare) + ' of everything that came in', M.borrowShare < 3 ? 'ok' : M.borrowShare < 10 ? 'warn' : 'bad') +
      kpi('Invested so far', money(M.totalInvest), pct(a.income ? a.invest / a.income * 100 : 0) + ' of income', M.totalInvest > a.income ? 'ok' : M.totalInvest > 0 ? 'warn' : 'bad') + '</div>' +
      '<div class="panel"><div class="kp-cardhd"><h2>Discipline score</h2></div><div class="kp-gauge">' + ring(s / 100, { size: 140, stroke: 12, cls: scol, center: '<b>' + s + '</b><span>' + (s >= 70 ? 'Disciplined' : s >= 45 ? 'Recovering' : 'At risk') + '</span>' }) +
      '<div style="flex:1 1 260px">' + M.factors.map(function (f) { return '<div class="kp-factor"><span>' + f.name + ' <span class="muted">(' + f.w + '%)</span><br><small class="muted">' + f.disp + ' — ' + f.why + '</small></span><div class="kp-track"><i style="width:' + Math.round(f.val) + '%"></i></div><span class="num">' + Math.round(f.val) + '</span></div>'; }).join('') + '</div></div>' +
      insight('Your score is <b>' + s + '/100</b>. It is being dragged down mostly by <b>' + worst[0].name.toLowerCase() + '</b> (' + worst[0].disp + ') and <b>' + worst[1].name.toLowerCase() + '</b> (' + worst[1].disp + ').',
        worst[0].name === 'Savings rate' ? 'move a fixed ' + money(Math.max(50000, Math.round(a.income * 0.1))) + ' to savings the day salary lands — before any spending.'
        : worst[0].name === 'Debt burden' ? 'add an extra payment to the highest-rate loan (see Snowball vs avalanche on EMIs).'
        : worst[0].name === 'Investing' ? 'automate ' + money(Math.max(20000, Math.round(a.income * 0.05))) + '/month into an index fund.' : 'see Spend — the top three categories are where the leak is.') + '</div>' +
      '<div class="panel"><div class="kp-cardhd"><h2>Income, spending, kept</h2></div><div class="kp-chart"><canvas id="ch-trend" role="img" aria-label="Income, spending and kept by month"></canvas></div><div class="table-wrap" style="margin-top:var(--space-3)"><table class="data"><thead><tr><th>Month</th><th class="num">In</th><th class="num">Spend</th><th class="num">EMIs</th><th class="num">Kept</th></tr></thead><tbody>' +
      M.fullMonths.slice().reverse().map(function (m) { var p = M.per[m]; return '<tr><td>' + E.monthShort(m) + '</td><td class="num">' + fmt0(p.income + p.refund) + '</td><td class="num">' + fmt0(p.spend) + '</td><td class="num">' + fmt0(p.debtpay) + '</td><td class="num ' + (p.net >= 0 ? 'pos' : 'neg') + '">' + fmt0(p.net) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    var t = tokens(), L = M.fullMonths;
    chart('ch-trend', { type: 'bar', data: { labels: L.map(E.monthShort), datasets: [
      { label: 'Income', data: L.map(function (m) { return (M.per[m].income + M.per[m].refund) / 100; }), backgroundColor: alpha(t.accent, 0.7), borderRadius: 4, order: 2 },
      { label: 'Spending', data: L.map(function (m) { return M.per[m].spend / 100; }), backgroundColor: alpha(t.danger, 0.7), borderRadius: 4, order: 2 },
      { label: 'EMIs', data: L.map(function (m) { return M.per[m].debtpay / 100; }), backgroundColor: alpha(t.warning, 0.7), borderRadius: 4, order: 2 },
      { label: 'Kept', type: 'line', data: L.map(function (m) { return M.per[m].net / 100; }), borderColor: t.primary, backgroundColor: t.primary, tension: .3, borderWidth: 2, pointRadius: 3, order: 1 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } } });
  }
  function renderCFO(body) {
    var M = S.M, p = E.pl(M), cf = E.cashflow(M), be = E.breakeven(M), fees = E.fees(M), ctl = E.controls(M);
    var row = function (lb, v, b, ind) { return '<tr' + (b ? ' style="font-weight:600"' : '') + '><td' + (ind ? ' style="padding-left:var(--space-5);color:var(--color-text-muted)"' : '') + '>' + lb + '</td><td class="num">' + fmt0(v) + '</td><td class="num muted">' + (p.rev ? pct(v / p.rev * 100) : '—') + '</td></tr>'; };
    var crow = function (lb, v, b) { return '<tr' + (b ? ' style="font-weight:600"' : '') + '><td>' + lb + '</td><td class="num ' + (v >= 0 ? 'pos' : 'neg') + '">' + (v >= 0 ? '+' : '−') + fmt0(v) + '</td></tr>'; };
    body.innerHTML = caveat() +
      '<div class="kp-two"><div class="panel"><div class="kp-cardhd"><h2>Household P&amp;L</h2><span class="muted">average / month</span></div><div class="table-wrap"><table class="data"><thead><tr><th>Line</th><th class="num">Amount</th><th class="num">% rev</th></tr></thead><tbody>' +
      row('Income (salary + other + cashback)', p.rev, 1) + row('Committed costs (rent, utilities, bills)', -p.F, 0, 1) + row('Essential variable (grocery, transport, health)', -p.E, 0, 1) + row('Discretionary (food out, shopping, wants)', -p.D, 0, 1) +
      row('Operating surplus — before financing', p.op, 1) + row('Financing: EMIs & repayments', -p.P, 0, 1) + row('Investing', -p.I, 0, 1) + row('Net kept — the household\'s profit', p.net, 1) + '</tbody></table></div>' +
      insight('Operating margin <b>' + pct(p.opM) + '</b>; net margin <b>' + pct(p.netM) + '</b>. A company running at ' + pct(p.netM) + ' net would be in the boardroom explaining itself' + (p.D > p.net ? ' — discretionary spend (' + money(p.D) + ') is ' + (p.net > 0 ? (Math.round(p.D / Math.max(1, p.net) * 10) / 10) + '× the profit' : 'eating the entire profit') : '') + '.',
        'treat ' + money(Math.round(p.D * 0.8)) + ' as the discretionary envelope; anything above needs the 24-hour approval rule.', p.netM >= 15 ? 'good' : p.netM >= 5 ? 'warn' : 'bad') + '</div>' +
      '<div class="stack"><div class="panel"><div class="kp-cardhd"><h2>Cash-flow statement</h2><span class="muted">whole period</span></div><div class="table-wrap"><table class="data"><tbody>' +
      crow('Operating (earned − living costs)', cf.op, 1) + crow('Financing: loans taken', cf.borrowedIn) + crow('Financing: repaid to lenders', -cf.repaid) + crow('Financing net', cf.fin, 1) + crow('Investing', cf.inv, 1) + crow('Net cash movement', cf.net, 1) + '</tbody></table></div>' +
      insight(cf.op < 0 ? 'Living costs exceeded earnings by <b>' + money(-cf.op) + '</b> — the gap was financed by borrowing. That is a company burning cash to pay salaries.' : 'You generated <b>' + money(cf.op) + '</b> from operations, but financing took <b>' + money(cf.repaid) + '</b> back out. The operating engine works — the balance sheet is the problem.',
        'goal for the next 12 months: financing net stays negative (repaying), operating stays positive, investing turns real.') + '</div>' +
      '<div class="kp-kpis" style="grid-template-columns:repeat(3,1fr)">' + kpi('Fixed burn / month', money(be.committed), 'rent + bills + EMIs — leaves before you choose', be.share < 40 ? 'ok' : be.share < 55 ? 'warn' : 'bad') + kpi('Break-even day', 'Day ' + be.day, 'salary is spoken for until here', be.day <= 12 ? 'ok' : be.day <= 18 ? 'warn' : 'bad') + kpi('Bank fees paid', money(fees.tot), fees.n + ' pure-fee rows', fees.tot < 10000 ? 'ok' : 'bad') + '</div></div></div>' +
      '<div class="panel"><div class="kp-cardhd"><h2>Spending controls — ' + E.monthShort(ctl.lm) + '</h2></div><div class="table-wrap"><table class="data"><thead><tr><th>Rule</th><th class="num">Target</th><th class="num">Actual</th><th>Status</th></tr></thead><tbody>' +
      ctl.rules.map(function (r) { return '<tr><td style="white-space:normal">' + r.r + '</td><td class="num">' + (r.money ? (r.tgt === 1 ? '> 0' : fmt0(r.tgt)) : r.tgt) + '</td><td class="num">' + (r.money ? fmt0(r.act) : r.act) + '</td><td>' + pill(r.ok ? 'ok' : 'bad', r.ok ? 'PASS' : 'FAIL') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      insight('Controls passed: <b>' + ctl.rules.filter(function (r) { return r.ok; }).length + '/' + ctl.rules.length + '</b>. In a company, a failed control triggers a corrective action, not guilt.', 'pick the one FAIL you will flip first.') + '</div>' +
      '<div class="panel" id="bv-panel"></div>';
    renderBudgetTable($('bv-panel'));
  }
  async function renderBudgetTable(box) {
    var M = S.M, lm = M.fullMonths[M.fullMonths.length - 1] || M.months[M.months.length - 1], nM = M.fullMonths.length || 1;
    var month = today().slice(0, 7);
    var live = [];
    try { live = (await api('/api/kept/budgets?month=' + month)).budgets; } catch (e) { /* offline: defaults still render */ }
    var saved = {}; live.forEach(function (b) { if (b.status === 'approved') saved[b.cat] = b.amount_minor; });
    var def = E.budgetDefaults(M), bud = {};
    Object.keys(def).forEach(function (c) { bud[c] = saved[c] != null ? saved[c] : def[c]; });
    Object.keys(saved).forEach(function (c) { if (bud[c] == null) bud[c] = saved[c]; });
    var p = M.per[month] || M.per[lm], within = 0, n = 0, tot = 0;
    var h = '<div class="kp-cardhd"><h2>Budget vs actual — ' + E.monthShort(month) + '</h2><span class="muted">edit the envelope; it saves for this month</span></div><div class="table-wrap"><table class="data kp-budget"><thead><tr><th>Category</th><th class="num">Avg / mo</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Variance</th><th>Status</th></tr></thead><tbody>';
    Object.keys(bud).forEach(function (c) {
      var bv = bud[c], avg = Math.round((M.catTotal[c] || 0) / nM), act = p ? (p.byCat[c] || 0) : 0, va = bv - act; n++; tot += bv; if (va >= 0) within++;
      h += '<tr><td>' + esc(c) + ' <small class="muted">' + catClass(c) + (saved[c] != null ? ' · set' : ' · default') + '</small></td><td class="num">' + fmt0(avg) + '</td><td class="num"><label class="sr-only" for="bud-' + esc(c) + '">Budget for ' + esc(c) + '</label><input id="bud-' + esc(c) + '" type="number" step="1" min="0" value="' + Math.round(bv / 100) + '" data-cat="' + esc(c) + '"></td><td class="num">' + fmt0(act) + '</td><td class="num ' + (va >= 0 ? 'pos' : 'neg') + '">' + (va >= 0 ? '+' : '−') + fmt0(va) + '</td><td>' + pill(va >= 0 ? 'ok' : 'bad', va >= 0 ? 'WITHIN' : 'OVER') + '</td></tr>';
    });
    h += '</tbody></table></div>' + insight('Budget compliance: <b>' + within + '/' + n + '</b> categories within envelope. Total budgeted <b>' + money(tot) + '</b> against average revenue ' + money(M.avg.income + M.avg.refund) + ' — leaving <b class="' + (M.avg.income + M.avg.refund - tot > 0 ? 'pos' : 'neg') + '">' + money(M.avg.income + M.avg.refund - tot) + '</b> pre-assigned to savings and debt before the month starts.',
      'zero-based rule: if a category has no budget line, it has no money.');
    box.innerHTML = h;
    TN.els('input[data-cat]', box).forEach(function (inp) { inp.addEventListener('change', async function () {
      try { await api('/api/kept/budgets', { method: 'PUT', body: { month: month, cat: inp.getAttribute('data-cat'), amount_minor: Math.round((+inp.value || 0) * 100) } }); TN.toast('Budget saved', 'success'); renderBudgetTable(box); } catch (e) { fail(e); }
    }); });
  }
  function renderMoM(body) {
    var M = S.M, ys = []; M.months.forEach(function (m) { if (ys.indexOf(m.slice(0, 4)) < 0) ys.push(m.slice(0, 4)); }); ys.sort();
    var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var yNow = ys[ys.length - 1], yPrev = ys.length > 1 ? ys[ys.length - 2] : null, pj = E.projNext(M, 3), cl = E.cautions(M);
    var cautionText = function (c) {
      if (c.kind === 'seasonal') return ['<b>' + E.monthShort(c.m) + '</b> is historically expensive: same month last year cost <b>' + money(c.amt) + '</b> vs your ' + money(M.avg.out) + ' average' + (c.driver ? ', driven by <b>' + esc(c.driver) + '</b> (' + money(c.driverAmt) + ')' : '') + '.', 'pre-decide a ' + E.monthShort(c.m) + ' cap of ' + money(c.cap) + ' before the month starts.'];
      if (c.kind === 'trend') return ['<b>' + esc(c.cat) + '</b> is trending up: ' + money(c.rec) + '/month lately vs ' + money(c.all) + ' normally — lifestyle inflation in motion.', 'return ' + esc(c.cat) + ' to ' + money(c.all) + ' next month; the difference goes to the loan.'];
      if (c.kind === 'surge') return ['Salary-day surge: daily spend runs <b>' + c.x + '×</b> normal in the 3 days after payday.', 'move the savings standing order to salary day, before the surge can happen.'];
      return ['<b>' + pct(c.share) + '</b> of inflow this period was new borrowing — the next expensive month will tempt another loan.', 'borrowing freeze stays on; expensive months are handled by the cap, not by credit.'];
    };
    body.innerHTML = caveat() +
      '<div class="panel"><div class="kp-cardhd"><h2>Money out, year over year</h2><span class="muted">spend + EMIs + investing</span></div><div class="kp-chart"><canvas id="ch-mom" role="img" aria-label="Money out by calendar month, one line per year"></canvas></div>' +
      '<div class="kp-mcards" style="margin-top:var(--space-3)">' + MN.map(function (nm, i) { var key = yNow + '-' + String(i + 1).padStart(2, '0'), pk = yPrev ? yPrev + '-' + String(i + 1).padStart(2, '0') : null;
        var v = M.per[key] ? E.mval(M.per[key], 'out') : null, pv = pk && M.per[pk] ? E.mval(M.per[pk], 'out') : null, d = '<small class="muted">— vs prior year</small>';
        if (v != null && pv != null) { var dd = v - pv; d = '<small class="' + (dd <= 0 ? 'pos' : 'neg') + '">' + (dd >= 0 ? '▲' : '▼') + ' ' + fmt0(dd) + ' vs ' + yPrev + '</small>'; }
        return '<div class="kp-mcard"><span>' + nm + ' ' + yNow + '</span><b>' + (v != null ? fmt0(v) : '—') + '</b>' + d + '</div>'; }).join('') + '</div></div>' +
      '<div class="panel"><div class="kp-cardhd"><h2>Next three months</h2><span class="muted">half recent run-rate, half same month last year</span></div>' +
      pj.map(function (p) { return insight('<b>' + E.monthShort(p.m) + '</b> — projected out: <b>' + money(p.out) + '</b>, projected kept: <b class="' + (p.kept >= 0 ? 'pos' : 'neg') + '">' + money(p.kept) + '</b>' + (p.seasonal ? ' · <span class="neg">seasonally expensive month</span>' : ''), null, p.seasonal ? 'warn' : ''); }).join('') +
      insight('Three-month picture: about <b>' + money(pj.reduce(function (a, p) { return a + p.out; }, 0)) + '</b> will go out against ~' + money(pj[0].inc * 3) + ' in if nothing changes.', 'decide now which projected month you will beat, and by how much — write the number down.') + '</div>' +
      '<div class="panel"><div class="kp-cardhd"><h2>Cautions</h2></div>' + (cl.length ? cl.map(function (c) { var x = cautionText(c); return insight('<b>' + c.sev + '</b> · ' + x[0], x[1], c.sev === 'High' ? 'bad' : 'warn'); }).join('') : insight('No pattern-based warnings right now.', 'keep the streak: same rules next month.', 'good')) + '</div>' +
      '<div class="panel"><div class="kp-cardhd"><h2>Every month</h2></div><div class="table-wrap"><table class="data"><thead><tr><th>Month</th><th class="num">In</th><th class="num">Spend</th><th class="num">EMIs</th><th class="num">Kept</th><th class="num">Rate</th><th class="num">vs same month LY</th></tr></thead><tbody>' +
      pj.slice().reverse().map(function (p) { return '<tr style="opacity:.7"><td>' + E.monthShort(p.m) + ' <i>projected</i></td><td class="num">' + fmt0(p.inc) + '</td><td class="num" colspan="2">' + fmt0(p.out) + ' out</td><td class="num ' + (p.kept >= 0 ? 'pos' : 'neg') + '">' + fmt0(p.kept) + '</td><td class="num">' + pct(p.inc > 0 ? p.kept / p.inc * 100 : 0) + '</td><td class="num muted">pattern</td></tr>'; }).join('') +
      M.months.slice().reverse().map(function (m) { var p = M.per[m], pl = M.per[E.addMonths(m, -12)], dOut = pl ? E.mval(p, 'out') - E.mval(pl, 'out') : null, rate = p.income + p.refund > 0 ? p.net / (p.income + p.refund) * 100 : 0;
        return '<tr><td>' + E.monthShort(m) + '</td><td class="num">' + fmt0(p.income + p.refund) + '</td><td class="num">' + fmt0(p.spend) + '</td><td class="num">' + fmt0(p.debtpay) + '</td><td class="num ' + (p.net >= 0 ? 'pos' : 'neg') + '">' + fmt0(p.net) + '</td><td class="num">' + pct(rate) + '</td><td class="num ' + (dOut == null ? 'muted' : dOut <= 0 ? 'pos' : 'neg') + '">' + (dOut == null ? '—' : (dOut >= 0 ? '+' : '−') + fmt0(dOut)) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    var t = tokens(), pal = palette(t);
    chart('ch-mom', { type: 'line', data: { labels: MN, datasets: ys.slice(-4).map(function (y, i, arr) { var last = i === arr.length - 1;
      return { label: y, data: MN.map(function (_, k) { var key = y + '-' + String(k + 1).padStart(2, '0'); return M.per[key] ? E.mval(M.per[key], 'out') / 100 : null; }), borderColor: last ? t.primary : pal[(i + 1) % pal.length], backgroundColor: last ? t.primary : pal[(i + 1) % pal.length], borderWidth: last ? 3 : 1.5, tension: .3, spanGaps: true, pointRadius: last ? 4 : 2 }; }) },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } } });
  }
  function renderForecast(body) {
    var M = S.M, f = M.fc, L = M.fullMonths, start = L[L.length - 1] || M.months[M.months.length - 1];
    var flabels = []; for (var i = 1; i <= 12; i++) flabels.push(E.addMonths(start, i));
    var cum = Math.max(0, M.cumNet), cumSeries = []; flabels.forEach(function () { cum += f.net; cumSeries.push(cum); });
    var loans = E.loansFromEmis(S.emis, S.rows, today()), totalDebt = loans.reduce(function (a, l) { return a + l.balance; }, 0), sim = E.simulate(loans, 50000, 'ava');
    var dfd = function (n) { return monthName(E.parse(E.addMonths(start, n) + '-01')); };
    var risks = E.risks(M), an = E.anomalies(M), sevName = ['', 'Low', 'Medium', 'High', 'Critical'], sevCls = ['', 'info', 'warn', 'bad', 'bad'];
    body.innerHTML = caveat() +
      '<div class="kp-kpis">' + kpi('Next month (projected)', money(f.net), money(f.income) + ' in − ' + money(f.out) + ' out', f.net > 0 ? 'ok' : 'bad') + kpi('Next quarter', money(f.net * 3), 'at current 3-month pace', f.net > 0 ? 'ok' : 'bad') +
      kpi('Cash in 12 months', money(cumSeries[11]), 'if nothing changes', cumSeries[11] > M.cumNet ? 'ok' : 'bad') + kpi('Debt-free date', totalDebt ? dfd(sim.months) : 'Now', totalDebt ? 'avalanche + ' + money(50000) + ' extra' : 'no running loans', totalDebt ? 'warn' : 'ok') + '</div>' +
      '<div class="panel"><div class="kp-cardhd"><h2>Cash position</h2><span class="muted">actual, then projected at the recent pace</span></div><div class="kp-chart"><canvas id="ch-fc" role="img" aria-label="Cumulative cash, actual and projected"></canvas></div>' +
      insight('At the recent pace you add <b>' + money(f.net) + '</b>/month. Every ' + money(10000) + ' cut from leaks moves the 12-month line up by ' + money(120000) + ' — cuts compound faster than raises because they repeat automatically.', 're-check this line next month; it should move up, not sideways.') + '</div>' +
      '<div class="kp-two"><div class="panel"><div class="kp-cardhd"><h2>Risks</h2></div>' + (risks.length ? risks.map(function (r) { return '<div class="kp-risk">' + pill(sevCls[r.sev], sevName[r.sev]) + '<div><b>' + r.name + '</b><p>' + r.why + '</p></div></div>'; }).join('') : '<p class="muted">No material risks detected. Rare — verify the data is complete.</p>') + '</div>' +
      '<div class="panel"><div class="kp-cardhd"><h2>Outliers</h2></div>' + (an.length ? '<ul class="kp-list">' + an.map(function (x) { return '<li><b>' + esc(x.descr) + '</b> — ' + money(-x.amt) + ' on ' + x.ds + ' (' + esc(x.cat) + '). One-off or a pattern starting?</li>'; }).join('') + '</ul>' : '<p class="muted">Nothing unusual found.</p>') + '</div></div>';
    var t = tokens(), hc = 0, histCum = L.map(function (m) { return (hc += M.per[m].net) / 100; });
    chart('ch-fc', { type: 'line', data: { labels: L.map(E.monthShort).concat(flabels.map(E.monthShort)), datasets: [
      { label: 'Actual', data: histCum.concat(new Array(12).fill(null)), borderColor: t.primary, backgroundColor: alpha(t.primary, 0.12), fill: true, pointRadius: 0, borderWidth: 2, tension: .2 },
      { label: 'Projected', data: new Array(Math.max(0, L.length - 1)).fill(null).concat([histCum[histCum.length - 1] || 0]).concat(cumSeries.map(function (v) { return v / 100; })), borderColor: t.accent, borderDash: [6, 4], backgroundColor: alpha(t.accent, 0.1), fill: true, pointRadius: 0, borderWidth: 2, tension: .2 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }, scales: { x: { grid: { display: false } } } } });
  }
  function renderLife(body) {
    var p = S.profile.profile_json;
    var fields = [['Age', 'age', 1], ['Retire at', 'retireAge', 1], ['Expected return % / yr', 'ret', 1], ['Inflation % / yr', 'infl', 1], ['Savings you hold today', 'nw', 100], ['Cost of one child\'s degree (today)', 'kidCost', 100]];
    var h = '<div class="panel"><div class="kp-cardhd"><h2>Profile</h2></div><form id="life-form" class="stack"><div class="field-row">' +
      fields.map(function (f) { return '<div class="field"><label for="lf-' + f[1] + '">' + f[0] + '</label><input id="lf-' + f[1] + '" type="number" step="any" data-k="' + f[1] + '" data-div="' + f[2] + '" value="' + (p[f[1]] / f[2]) + '"></div>'; }).join('') + '</div>' +
      '<div class="field"><label for="lf-kids">Children\'s birth years (comma separated)</label><input id="lf-kids" type="text" value="' + esc((p.kids || []).join(', ')) + '"></div>' +
      '<div class="field"><label for="lf-majors">Major expenses: label, year, amount (one per line)</label><textarea id="lf-majors" rows="3">' + esc((p.majors || []).map(function (m) { return m[0] + ', ' + m[1] + ', ' + (m[2] / 100); }).join('\n')) + '</textarea></div>' +
      '<div><button type="submit" class="btn btn--primary">Save profile</button></div></form></div><div id="life-out" class="stack"></div>';
    body.innerHTML = h;
    $('life-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var pj = {};
      TN.els('[data-k]', body).forEach(function (i) { pj[i.getAttribute('data-k')] = Math.round((+i.value || 0) * (+i.getAttribute('data-div'))); });
      pj.kids = $('lf-kids').value.split(',').map(function (s) { return parseInt(s, 10); }).filter(Boolean);
      pj.majors = $('lf-majors').value.split('\n').map(function (l) { return l.split(',').map(function (s) { return s.trim(); }); }).filter(function (a) { return a.length === 3; }).map(function (a) { return [a[0], +a[1], Math.round((+a[2] || 0) * 100)]; });
      try { await saveProfile({ profile_json: pj }); TN.toast('Profile saved', 'success'); renderLifeOut(); } catch (err) { fail(err); }
    });
    renderLifeOut();
  }
  function renderLifeOut() {
    var box = $('life-out'); if (!box) return;
    if (!S.M) { box.innerHTML = '<p class="muted">Upload or enter data first — the arithmetic needs your real numbers.</p>'; return; }
    var L = E.lifePlan(S.M, S.profile.profile_json, today());
    var b = [];
    var ps = E.pathStatus(S.M, S.profile, S.profile.profile_json.pathBase || null, today());
    if (ps) b.push({ bad: !ps.ok, t: pathLine(ps) });
    b.push({ bad: L.covNow < 60, t: 'Retirement needs about <b>' + money(L.corpus) + '</b> (25× your annual outflow). Your current path reaches <b>' + pct(L.covNow) + '</b> of it by ' + L.retireAge + '. The 20% path reaches <b>' + pct(L.cov20) + '</b>. This gap is the price of today\'s habits, compounded ' + L.yearsToRet + ' years.' });
    b.push({ bad: L.monthsRet < 120, t: 'Translated: at the current pace you arrive at ' + L.retireAge + ' with <b>' + Math.round(L.monthsRet) + ' months</b> of living costs. After that, the money depends on someone else.' });
    L.kids.forEach(function (k) { b.push({ bad: !k.covered, t: 'Child ' + k.i + ' reaches university in <b>' + k.yrs + ' years</b>; the degree will cost ~<b>' + money(k.cost) + '</b> then. Current path has <b>' + money(k.have) + '</b> of it' + (k.covered ? ' — covered, if nothing derails it.' : ' — <b>' + pct(k.pctCovered) + '</b> covered, and that assumes nothing else competes for the same money.') }); });
    L.majors.forEach(function (m) { b.push({ bad: !m.ok, t: '<b>' + esc(m.label) + '</b> in ' + m.year + ' needs <b>' + money(m.need) + '/month</b> from today. You currently free up ' + money(L.sNow) + '/month for everything future.' }); });
    b.push({ bad: true, t: 'Every year spent at ~0% savings deletes roughly <b>' + money(L.lost) + '</b> from your ' + L.retireAge + '-year-old self. Not later money — this year\'s decision.' });
    box.innerHTML = '<div class="panel"><div class="kp-cardhd"><h2>The arithmetic</h2><span class="muted">today\'s money, ' + pct(L.rr) + ' real return</span></div><div class="table-wrap"><table class="data"><thead><tr><th>Path</th><th class="num">5 yrs</th><th class="num">10 yrs</th><th class="num">20 yrs</th><th class="num">At ' + L.retireAge + '</th></tr></thead><tbody>' +
      L.paths.map(function (r) { return '<tr><td>' + r.label + '</td><td class="num">' + fmt0(r.v.y5) + '</td><td class="num">' + fmt0(r.v.y10) + '</td><td class="num">' + fmt0(r.v.y20) + '</td><td class="num" style="font-weight:600">' + fmt0(r.v.ret) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      '<div class="stack">' + b.map(function (x) { return '<div class="kp-brutal' + (x.bad ? '' : ' is-good') + '">' + x.t + '</div>'; }).join('') + '</div>';
  }

  /* --------------------------------------------------------------- Tools */
  function upcomingTable(items) {
    return items.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>What</th><th class="num">Amount</th></tr></thead><tbody>' + items.map(function (i) { return '<tr><td>' + dateShort(i.d) + '</td><td>' + esc(i.descr) + ' <small class="muted">' + i.kind + '</small></td><td class="num ' + (i.amount_minor > 0 ? 'pos' : '') + '">' + (i.amount_minor > 0 ? '+' : '−') + fmt0(i.amount_minor) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">Nothing committed in this window — no EMIs due and no rules firing.</p>';
  }
  /* What is already committed to leave (and arrive) in the next 30 or 60
     days, from the EMIs and the recurring rules. */
  function renderUpcoming(body) {
    var days = 60;
    var paint = function () {
      var items = E.upcoming(S.emis, S.rules, days, today()), committed = items.reduce(function (a, i) { return a + (i.amount_minor < 0 ? -i.amount_minor : 0); }, 0), inn = items.reduce(function (a, i) { return a + (i.amount_minor > 0 ? i.amount_minor : 0); }, 0);
      $('up-det').innerHTML = '<div class="kp-statrow" style="margin:0 0 var(--space-3)"><div><span>Committed out</span><b>' + money(committed) + '</b></div><div><span>Expected in</span><b>' + money(inn) + '</b></div><div><span>Items</span><b>' + items.length + '</b></div></div>' + upcomingTable(items);
    };
    body.innerHTML = '<div class="panel"><div class="kp-cardhd"><h2>Upcoming expenses</h2><div class="segmented" id="up-seg"><button type="button" data-d="30" aria-pressed="false">30 days</button><button type="button" data-d="60" aria-pressed="true">60 days</button></div></div>' +
      '<p class="muted">Computed from your EMIs and recurring rules. Add a rule for anything regular that is missing.</p><div id="up-det" style="margin-top:var(--space-3)"></div></div>';
    TN.els('#up-seg button').forEach(function (b) { b.addEventListener('click', function () { days = +b.getAttribute('data-d'); TN.els('#up-seg button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); paint(); }); });
    paint();
  }
  /* Rows still on Misc, each matched to the category you used most for the
     same place before (or a guess from the name). You pick and apply;
     nothing changes until you do. Only the category is written. */
  function proposeCategory(r) {
    var key = (r.merchant || KeptCore.normMerchant(r.descr)), votes = {};
    S.rows.forEach(function (x) {
      if (x.id === r.id || !x.cat || x.cat === 'Misc') return;
      if ((x.merchant || KeptCore.normMerchant(x.descr)) === key) votes[x.cat] = (votes[x.cat] || 0) + 1;
    });
    var best = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; })[0];
    if (best) return { cat: best, why: 'filed ' + votes[best] + '× before' };
    var g = guessCat(r.descr);
    return g !== 'Misc' ? { cat: g, why: 'from the name' } : { cat: '', why: '' };
  }
  function renderCategorise(body) {
    var rows = S.rows.filter(function (r) { return (!r.cat || r.cat === 'Misc') && r.amount_minor < 0 && !r.pending; }).slice(-60).reverse();
    var cats = outCats();
    body.innerHTML = '<div class="panel"><div class="kp-cardhd"><h2>Categorise</h2></div><p class="muted"><b>' + rows.length + '</b> row' + (rows.length === 1 ? '' : 's') + ' on Misc' + (rows.length === 60 ? ' (the latest 60)' : '') + '. Each is matched to how you filed the same place before. Change any, then apply.</p></div>' +
      (rows.length ? '<div class="panel"><div class="table-wrap"><table class="data"><thead><tr><th>Row</th><th class="num">Amount</th><th>Category</th></tr></thead><tbody>' + rows.map(function (r) {
        var p = proposeCategory(r);
        return '<tr><td>' + esc(r.descr) + ' <small class="muted">' + dateShort(r.d) + (p.why ? ' · ' + p.why : '') + '</small></td><td class="num">' + fmt0(r.amount_minor) + '</td><td><label class="sr-only" for="cg-' + esc(r.id) + '">Category for ' + esc(r.descr) + '</label><select id="cg-' + esc(r.id) + '" data-cg="' + esc(r.id) + '"><option value="">Leave on Misc</option>' +
          cats.filter(function (c) { return c !== 'Misc'; }).map(function (c) { return '<option' + (c === p.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></td></tr>';
      }).join('') + '</tbody></table></div><p style="margin-top:var(--space-3)"><button type="button" class="btn btn--primary" id="cg-go">' + TN.icon('check', 16) + ' Apply</button></p></div>' : '<div class="empty">Every row has a category.</div>');
    var go = $('cg-go');
    if (go) go.addEventListener('click', async function () {
      var picks = TN.els('[data-cg]', body).filter(function (s) { return s.value; });
      if (!picks.length) { TN.toast('Pick a category for at least one row.', 'error'); return; }
      go.disabled = true;
      var done = 0;
      for (var i = 0; i < picks.length; i++) {
        try { var res = await api('/api/kept/transactions', { method: 'PUT', body: { id: picks[i].getAttribute('data-cg'), cat: picks[i].value } }); if (res.transaction) upsertRow(res.transaction); done++; }
        catch (e) { fail(e); break; }
      }
      TN.toast(done + ' row' + (done === 1 ? '' : 's') + ' categorised', 'success');
      renderCategorise(body);
    });
  }

  async function saveProfile(patch, silent) {
    var r = await api('/api/kept/profile', { method: 'PUT', body: patch });
    S.profile = r.profile; persist();
    if (!silent) { rebuild(); renderRate(); }
  }

  /* ----------------------------------------------------------- Add sheet */
  var AS = { mode: 'out', cat: 'Food', inIdx: 0, editId: null, editRow: null };
  var IN = [['Income', 'Salary'], ['Refund', 'Refund / cashback'], ['Loan', 'Loan received'], ['Income', 'Other income']];
  function outCats() { return S.cats.filter(function (c) { return c.flow === 'out'; }).map(function (c) { return c.name; }); }
  function yestISO() { var d = new Date(); d.setDate(d.getDate() - 1); return E.iso(d); }
  function frequent() {
    var map = {};
    S.rows.slice(-400).forEach(function (r) {
      if (r.amount_minor >= 0 || /^(recurring|emi):/.test(String(r.remark || '')) || /loan|emi/i.test(r.cat + ' ' + r.descr)) return;
      var k = String(r.descr).trim().slice(0, 28).toUpperCase(); if (!k) return;
      map[k] = map[k] || { n: 0, sum: 0, cat: r.cat || 'Misc', label: String(r.descr).trim().slice(0, 28) };
      map[k].n++; map[k].sum += -r.amount_minor;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).filter(function (v) { return v.n >= 3; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 4).map(function (v) { return { label: v.label, cat: v.cat, amt: Math.round(v.sum / v.n) }; });
  }
  function paintTiles() {
    var box = $('as-tiles'), f = (AS.mode === 'out' && !AS.editId) ? frequent() : [];
    box.innerHTML = f.map(function (v, i) { return '<button type="button" class="kp-tile" data-i="' + i + '">' + chip(v.cat, 'expense') + '<span><b>' + esc(v.label) + '</b><i>' + money(v.amt) + ' · ' + esc(v.cat) + '</i></span></button>'; }).join('');
    TN.els('.kp-tile', box).forEach(function (b) { b.addEventListener('click', async function () {
      var v = f[+b.getAttribute('data-i')], amt = Math.round((parseFloat($('as-amt').value) || 0) * 100) || v.amt;
      await writeTx({ d: $('as-date').value || today(), descr: v.label, amount_minor: -Math.abs(amt), cat: v.cat, remark: 'quick-tile' }, '−' + fmt0(amt) + ' ' + v.label);
      closeSheet($('add-sheet'));
    }); });
  }
  function paintCats() {
    var box = $('as-cats');
    if (AS.mode === 'in') {
      box.innerHTML = IN.map(function (c, i) { return '<button type="button" class="kp-catbtn" aria-pressed="' + (i === AS.inIdx) + '" data-i="' + i + '"><span class="kp-ic kp-ic--in">' + TN.icon(i === 2 ? 'kept-bank' : 'kept-salary', 18) + '</span><span>' + c[1] + '</span></button>'; }).join('');
      TN.els('.kp-catbtn', box).forEach(function (b) { b.addEventListener('click', function () { AS.inIdx = +b.getAttribute('data-i'); paintCats(); }); });
    } else {
      box.innerHTML = outCats().map(function (c) { return '<button type="button" class="kp-catbtn" aria-pressed="' + (c === AS.cat) + '" data-c="' + esc(c) + '"><span class="kp-ic">' + TN.icon(catIcon(c), 18) + '</span><span>' + esc(c) + '</span></button>'; }).join('');
      TN.els('.kp-catbtn', box).forEach(function (b) { b.addEventListener('click', function () { AS.cat = b.getAttribute('data-c'); paintCats(); }); });
    }
  }
  function setMode(m) {
    AS.mode = m;
    TN.els('#as-seg button').forEach(function (s) { s.setAttribute('aria-pressed', s.getAttribute('data-m') === m); });
    $('as-manual').hidden = m === 'sms'; $('as-sms').hidden = m !== 'sms';
    $('as-save').textContent = AS.editId ? 'Save changes' : m === 'in' ? 'Save income' : m === 'sms' ? 'Read messages' : 'Save expense';
    if (m !== 'sms') { paintCats(); paintTiles(); }
    say('as-msg', '');
  }
  function setDate(d) { $('as-date').value = d; $('as-today').setAttribute('aria-pressed', d === today()); $('as-yest').setAttribute('aria-pressed', d === yestISO()); }
  function openAdd(opts) {
    opts = opts || {};
    AS.editId = opts.id || null; AS.editRow = AS.editId ? S.rows.filter(function (r) { return r.id === AS.editId; })[0] || null : null;
    if (!AS.editRow) AS.editId = null;
    $('as-title').textContent = AS.editId ? 'Edit entry' : 'Add an entry';
    $('as-del').hidden = !AS.editId; $('as-seg').hidden = !!AS.editId; $('as-cur').textContent = cur();
    if (AS.editRow) {
      var r = AS.editRow, inflow = r.amount_minor > 0;
      AS.mode = inflow ? 'in' : 'out';
      if (inflow) AS.inIdx = /loan/i.test(r.descr) ? 2 : /refund|cashback|reversal/i.test(r.descr + r.cat) ? 1 : 0;
      else AS.cat = outCats().indexOf(r.cat) > -1 ? r.cat : 'Misc';
      $('as-amt').value = Math.abs(r.amount_minor) / 100; $('as-desc').value = r.descr; setDate(r.d);
      say('as-time', r.amount_minor < 0 && E.timeCost(r.amount_minor, S.M) ? 'This cost about ' + E.timeCost(r.amount_minor, S.M) + ' of your work.' : '');
    } else {
      AS.mode = opts.mode || 'out'; if (AS.mode === 'out' && outCats().indexOf(AS.cat) < 0) AS.cat = outCats()[0] || 'Misc';
      $('as-amt').value = ''; $('as-desc').value = ''; setDate(today());
      say('as-time', '');
    }
    var seen = {}; S.rows.slice(-800).forEach(function (r) { var k = String(r.descr).trim(); if (k && !/^(recurring|emi):/.test(String(r.remark || ''))) seen[k] = (seen[k] || 0) + 1; });
    $('as-merch').innerHTML = Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a]; }).slice(0, 60).map(function (m) { return '<option value="' + esc(m) + '">'; }).join('');
    setMode(AS.mode);
    openSheet($('add-sheet'));
    setTimeout(function () { if (AS.mode !== 'sms') $('as-amt').focus(); }, 60);
  }
  /* The row goes on screen at once; the server's answer replaces the
     provisional row (it may have merged into an existing one, or
     superseded the one being edited), and a refusal puts things back. */
  async function writeTx(tx, label, edited) {
    var snapshot = S.rows.slice(), tempId = null;
    if (edited) {
      var i = indexOfRow(tx.id);
      if (i > -1) upsertRow(Object.assign({}, S.rows[i], tx, { kind: null }));
    } else {
      tempId = 'tmp_' + Date.now();
      upsertRow({ id: tempId, d: tx.d, descr: tx.descr, amount_minor: tx.amount_minor, cat: tx.cat || 'Misc', remark: tx.remark || '', currency: cur(), created_at: new Date().toISOString(), pending: true });
    }
    renderAll();
    var res;
    try {
      res = edited ? await api('/api/kept/transactions', { method: 'PUT', body: tx }) : await api('/api/kept/transactions', { method: 'POST', body: tx });
    } catch (e) {
      S.rows = snapshot; rebuild(); renderAll();
      throw e;
    }
    if (tempId) removeRow(tempId);
    if (res.superseded) removeRow(res.superseded);
    if (res.transaction) {
      // An edit that changed date, amount or description comes back as a
      // new row that supersedes the old one; the old id leaves the screen.
      if (res.transaction.supersedes_id) removeRow(res.transaction.supersedes_id);
      if (edited && res.transaction.id !== tx.id) removeRow(tx.id);
      upsertRow(res.transaction);
    }
    renderAll();
    var tail = monthTail();
    TN.toast((edited ? 'Updated: ' : res.added ? 'Saved: ' : 'Already recorded — updated: ') + label + (tail ? ' · ' + tail : ''), 'success');
    return res;
  }
  function monthTail() {
    if (!S.M) return '';
    var st = E.monthStatus(S.M, S.profile.target_keep_bp, today(), committed());
    if (!st.live) return '';
    if (!(S.M.avg.spend > 0)) return money(st.out) + ' out this month';
    var d = st.out - st.pace;
    return money(st.out) + ' out this month, ' + money(Math.abs(d)) + ' ' + (d <= 0 ? 'under' : 'over') + ' pace';
  }
  async function saveManual() {
    var amt = Math.round((parseFloat($('as-amt').value) || 0) * 100), date = $('as-date').value || today();
    if (!(amt > 0)) { say('as-msg', 'Enter the amount first.'); $('as-amt').focus(); return; }
    var desc = ($('as-desc').value || '').trim(), c, signed, rem;
    if (AS.mode === 'in') { var pick = IN[AS.inIdx]; c = pick[0]; desc = desc || pick[1]; signed = amt; rem = 'income entry'; if (AS.inIdx === 2 && !/loan/i.test(desc)) desc += ' (loan)'; }
    else { c = AS.cat; desc = desc || c; signed = -amt; rem = 'quick-add'; }
    try {
      if (AS.editRow) { rem = AS.editRow.remark && !/^(quick-add|income entry|sms|quick-tile)$/.test(AS.editRow.remark) ? AS.editRow.remark : rem;
        await writeTx({ id: AS.editId, d: date, descr: desc, amount_minor: signed, cat: c, remark: rem }, (signed > 0 ? '+' : '−') + fmt0(amt) + ' ' + desc, true); }
      else await writeTx({ d: date, descr: desc, amount_minor: signed, cat: c, remark: rem }, (signed > 0 ? '+' : '−') + fmt0(amt) + ' ' + desc);
      closeSheet($('add-sheet'));
    } catch (e) { say('as-msg', e.message); }
  }
  async function delEntry() {
    if (!AS.editId || !confirm('Delete this entry?')) return;
    var id = AS.editId, snapshot = S.rows.slice();
    removeRow(id); renderAll(); closeSheet($('add-sheet'));
    try { await api('/api/kept/transactions?id=' + encodeURIComponent(id), { method: 'DELETE' }); TN.toast('Entry deleted', 'success'); }
    catch (e) { S.rows = snapshot; rebuild(); renderAll(); fail(e); }
  }
  /* Bank SMS / notification parser — common Gulf and Indian formats. */
  function parseLine(line) {
    var cm = line.match(/\b(AED|SAR|INR|USD|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i) || line.match(/([\d,]+(?:\.\d{1,2})?)\s*\b(AED|SAR|INR|USD)\b/i);
    if (!cm) return null;
    var amt = Math.round(parseFloat((cm[2] || cm[1]).replace(/,/g, '')) * 100); if (!amt) return null;
    var credit = /credited|received|refund|reversal|salary/i.test(line), merch = null;
    var at = line.match(/\bat\s+([A-Z0-9][A-Za-z0-9 &.'\-]{2,40})/i); if (at) merch = at[1];
    if (!merch) { var on = line.match(/\b(?:on|to|towards)\s+([A-Z0-9][A-Za-z0-9 &.'\-]{2,40})/i); if (on) merch = on[1]; }
    merch = (merch || 'pasted entry').replace(/\s+(?:on|dated|using|via|card|a\/c).*$/i, '').trim();
    var dm = line.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/), date = today();
    if (dm) { var y = dm[3].length === 2 ? '20' + dm[3] : dm[3]; var dd = new Date(+y, +dm[2] - 1, +dm[1]); if (!isNaN(dd)) date = y + '-' + String(dm[2]).padStart(2, '0') + '-' + String(dm[1]).padStart(2, '0'); }
    return { d: date, descr: merch, amount_minor: credit ? amt : -amt, cat: credit ? 'Income' : guessCat(merch), remark: 'sms' };
  }
  function guessCat(m) {
    m = (m || '').toUpperCase();
    if (/TALABAT|KITCHEN|CAFETERIA|RESTAURANT|CAFE|TEA |COFFEE|MCDONALD|KFC|HARDEE|DELIVEROO|ZOMATO/.test(m)) return 'Food';
    if (/CARREFOUR|MART|GROCER|SUPERMARKET|LULU|HYPER|UNION COOP|SPINNEYS|WAITROSE/.test(m)) return 'Grocery';
    if (/PETROL|ADNOC|ENOC|EPPCO|FUEL/.test(m)) return 'Fuel';
    if (/TAXI|CAREEM|UBER|RTA|METRO|SALIK|NOL/.test(m)) return 'Transport';
    if (/NOON|AMAZON|MALL|STORE|SHOP|IKEA|MAX |SPLASH|SHEIN/.test(m)) return 'Shopping';
    if (/DEWA|SEWA|ETISALAT|DU |DU,|SMART GOVERNMENT|RECHARGE|EMPOWER/.test(m)) return 'Utilities';
    if (/PHARMA|CLINIC|HOSPITAL|MEDIC/.test(m)) return 'Medicine';
    if (/SCHOOL|NURSERY|ACADEMY|UNIVERSITY/.test(m)) return 'Education';
    return 'Misc';
  }
  async function parsePaste() {
    var rows = ($('as-paste').value || '').split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean).map(parseLine).filter(Boolean);
    if (!rows.length) { say('as-msg', 'Nothing recognisable — paste the bank SMS text, one per line.'); return; }
    try {
      var added = 0;
      for (var i = 0; i < rows.length; i++) { var r = await api('/api/kept/transactions', { method: 'POST', body: rows[i] }); added += r.added || 0; if (r.transaction) upsertRow(r.transaction); }
      renderAll(); $('as-paste').value = ''; closeSheet($('add-sheet'));
      TN.toast(added + ' of ' + rows.length + ' messages added — categories are guesses, check them in Transactions.', 'success');
    } catch (e) { say('as-msg', e.message); }
  }

  /* ----------------------------------------------------------- EMI sheet */
  var EM = { id: null };
  function openEmi(id) {
    EM.id = id || null;
    var e = id ? S.emis.filter(function (x) { return x.id === id; })[0] : null, d = e ? E.emiDerive(e, S.rows, today()) : null;
    var nd = new Date(); nd.setMonth(nd.getMonth() + (nd.getDate() > 5 ? 1 : 0)); nd.setDate(5);
    $('em-title').textContent = e ? 'Edit EMI' : 'Add an EMI';
    $('em-name').value = e ? e.name : ''; $('em-lender').value = e ? (e.lender || '') : '';
    $('em-amt').value = e ? e.emi_minor / 100 : ''; $('em-total').value = e ? e.total_n : ''; $('em-paid').value = e ? d.done : '';
    $('em-next').value = e ? (d.next ? E.iso(d.next) : E.iso(d.end)) : E.iso(nd);
    $('em-apr').value = e && e.apr_bp ? e.apr_bp / 100 : ''; $('em-auto').checked = e ? e.auto_post !== 0 : true;
    $('em-del').hidden = !e; say('em-msg', ''); emiPreview();
    openSheet($('emi-sheet'));
    setTimeout(function () { $('em-name').focus(); }, 60);
  }
  function emiPreview() {
    var emi = Math.round((+$('em-amt').value || 0) * 100), total = Math.round(+$('em-total').value || 0), paid = Math.round(+$('em-paid').value || 0), p = $('em-preview');
    if (!emi || !total) { p.textContent = ''; return; }
    var left = Math.max(0, total - paid), nd = $('em-next').value ? E.parse($('em-next').value) : null, end = nd ? new Date(nd.getFullYear(), nd.getMonth() + left - 1, 1) : null;
    p.innerHTML = '<b>' + left + '</b> instalment' + (left === 1 ? '' : 's') + ' left · <b class="num">' + money(emi * left) + '</b> still to pay' + (end && left ? ' · last one ' + monthName(end) : '') + ' · <b class="num">' + money(emi * 12) + '</b> a year while it runs';
  }
  async function saveEmi() {
    var b = { id: EM.id, name: $('em-name').value.trim(), lender: $('em-lender').value.trim(), emi_minor: Math.round((+$('em-amt').value || 0) * 100), total_n: Math.round(+$('em-total').value || 0),
      paid_n: Math.round(+$('em-paid').value || 0), next_due: $('em-next').value, apr_bp: Math.round((+$('em-apr').value || 0) * 100), auto_post: $('em-auto').checked };
    try {
      var r = await api('/api/kept/emis', { method: EM.id ? 'PUT' : 'POST', body: b });
      S.emis = r.emis; closeSheet($('emi-sheet'));
      if (r.posted && (r.posted.added || r.posted.updated)) await loadRows(); else { rebuild(); persist(); }
      renderAll();
      TN.toast((EM.id ? 'EMI updated' : 'EMI added') + (r.posted && r.posted.added ? ' · ' + r.posted.added + ' instalment' + (r.posted.added === 1 ? '' : 's') + ' posted' : ''), 'success');
    } catch (e) { say('em-msg', e.message); }
  }
  async function delEmi() {
    if (!EM.id || !confirm('Delete this EMI? Instalments already in the record stay there.')) return;
    try { S.emis = (await api('/api/kept/emis?id=' + encodeURIComponent(EM.id), { method: 'DELETE' })).emis; persist(); closeSheet($('emi-sheet')); renderAll(); TN.toast('EMI deleted', 'success'); } catch (e) { say('em-msg', e.message); }
  }

  /* ------------------------------------------------------ Recurring sheet */
  function openRule() {
    $('rc-cat').innerHTML = S.cats.map(function (c) { return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('');
    $('rc-start').value = today(); $('rc-end').value = ''; $('rc-amt').value = ''; $('rc-desc').value = ''; say('rc-msg', '');
    openSheet($('rc-sheet')); setTimeout(function () { $('rc-amt').focus(); }, 60);
  }
  async function saveRule() {
    var amt = Math.round((parseFloat($('rc-amt').value) || 0) * 100), kind = $('rc-kind').value;
    if (!(amt > 0)) { say('rc-msg', 'Enter the amount.'); return; }
    try {
      var r = await api('/api/kept/recurring', { method: 'POST', body: { descr: $('rc-desc').value.trim(), amount_minor: kind === 'in' ? amt : -amt, cat: $('rc-cat').value, freq: $('rc-freq').value, start_d: $('rc-start').value, end_d: $('rc-end').value } });
      S.rules = r.rules; closeSheet($('rc-sheet'));
      if (r.posted && (r.posted.added || r.posted.updated)) await loadRows(); else { rebuild(); persist(); }
      renderAll();
      var yearly = $('rc-freq').value === 'monthly' ? amt * 12 : $('rc-freq').value === 'weekly' ? amt * 52 : amt;
      TN.toast('Rule saved — ' + (r.posted.added || 0) + ' past occurrence' + (r.posted.added === 1 ? '' : 's') + ' written. ' + (kind === 'in' ? 'Counted as income: ' : 'This commits ') + money(yearly) + ' a year.', 'success');
    } catch (e) { say('rc-msg', e.message); }
  }

  /* ---------------------------------------------------------------- boot */
  function wire() {
    fillIcons();
    TN.els('#kp-bar [data-screen]').forEach(function (b) { b.addEventListener('click', function () { goTab(b.getAttribute('data-screen')); }); });
    $('kp-fab').addEventListener('click', function () { openAdd(); });
    wireGo(document);
    $('ins-back').addEventListener('click', function () { goBack({ screen: 'insights', ins: null }); });
    TN.els('[data-back]').forEach(function (b) { b.addEventListener('click', function () { goBack({ screen: b.getAttribute('data-back'), ins: null }); }); });
    TN.els('dialog.sheet').forEach(function (d) {
      TN.els('[data-close]', d).forEach(function (b) { b.addEventListener('click', function () { closeSheet(d); }); });
      d.addEventListener('click', function (e) { if (e.target === d) closeSheet(d); });
    });
    TN.els('#as-seg button').forEach(function (s) { s.addEventListener('click', function () { setMode(s.getAttribute('data-m')); }); });
    $('as-form').addEventListener('submit', function (e) { e.preventDefault(); if (AS.mode === 'sms') parsePaste(); else saveManual(); });
    $('as-del').addEventListener('click', delEntry);
    $('as-today').addEventListener('click', function () { setDate(today()); });
    $('as-yest').addEventListener('click', function () { setDate(yestISO()); });
    $('as-date').addEventListener('change', function () { setDate($('as-date').value || today()); });
    $('em-form').addEventListener('submit', function (e) { e.preventDefault(); saveEmi(); });
    $('em-del').addEventListener('click', delEmi);
    ['em-amt', 'em-total', 'em-paid', 'em-next'].forEach(function (id) { $(id).addEventListener('input', emiPreview); });
    $('rc-open').addEventListener('click', openRule);
    $('rc-form').addEventListener('submit', function (e) { e.preventDefault(); saveRule(); });
    $('rc-kind').addEventListener('change', function () { if ($('rc-kind').value === 'in') $('rc-cat').value = 'Income'; });
    $('hx-search').addEventListener('input', function () { renderHistory(true); });
    $('hx-month').addEventListener('change', function () { renderHistory(true); });
    $('hx-kind').addEventListener('change', function () { renderHistory(true); });
    $('hx-more').addEventListener('click', function () { S.hxShown += 150; renderHistory(); });
    $('hx-export').addEventListener('click', function () { if (!S.rows.length) { TN.toast('Nothing to export yet.', 'error'); return; } IM.exportAll(S.rows); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') TN.els('dialog.sheet[open]').forEach(closeSheet); });
    // Back and forward, from the gesture, the button or the in-app bar.
    // Deeper means forward (a slide in), shallower means back.
    window.addEventListener('popstate', function () {
      var t = parseHash(location.hash), was = current();
      var d0 = depthOf(was), d1 = depthOf(t);
      apply(t, { dir: d1 > d0 ? 'push' : d1 < d0 ? 'pop' : 'fade', restore: true, focus: true });
    });
    // Charts read the tokens at render time; a theme switch repaints the
    // screens that draw one. Everything else is CSS and follows the tokens.
    var mo = new MutationObserver(function () {
      if (S.screen === 'spend' || (S.screen === 'insights' && S.insView)) render(S.screen);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  /* The page as the address says. A deep link or a reload lands on a
     pushed page with nothing under it, so its back bar goes to the parent. */
  function firstScreen() {
    $('kp-loading').hidden = true;
    var t = parseHash(location.hash);
    if (t.ins && !INS.some(function (x) { return x.k === t.ins; })) t.ins = null;
    var st = history.state || {};
    setHash(t, 'replace', st.kept === hashOf(t) ? st.back : null);
    apply(t, { dir: 'none', restore: true });
  }
  async function boot() {
    wire();
    // 1. Draw from the snapshot this browser kept, if it belongs to the
    //    person the browser last saw. No request has been made yet.
    var hint = TN.session.user || TN.cachedUser();
    var painted = false;
    if (Store && hint && hint.id) {
      var snap = await Store.read(hint.id);
      if (snap && snap.profile) {
        S.user = hint; S.fromCache = true;
        applyBootstrap(snap);
        firstScreen();
        painted = true;
      }
    }
    // 2. Confirm who is signed in; a different account drops the snapshot.
    S.user = await TN.guard();
    if (painted && S.user.id !== hint.id) {
      painted = false; S.fromCache = false;
      S.rows = []; S.emis = []; S.rules = []; S.profile = null; S.M = null;
      $('kp-loading').hidden = false;
    }
    // 3. One round trip for the real thing; repaint only if it differs.
    try {
      var b = await api('/api/kept/bootstrap');
      var changed = applyBootstrap(b);
      S.fromCache = false;
      persist();
      if (!painted) firstScreen(); else if (changed) renderAll();

    } catch (e) {
      if (!painted) { $('kp-loading').className = 'notice notice--danger'; $('kp-loading').textContent = 'Could not load your record: ' + e.message; return; }
      TN.toast('Showing the last copy on this device — ' + e.message, 'error');
    }
    document.dispatchEvent(new CustomEvent('kept:ready', { detail: { state: S } }));
  }
  window.KEPT = { state: S, showScreen: showScreen, openAdd: openAdd, openEmi: openEmi, openInsight: openInsight, reload: loadAll, render: renderAll };
  // global.js mounts the chrome on DOMContentLoaded and fires tn:ready once
  // the session is known; guard() then resolves without a second request.
  if (TN.session.loaded) boot(); else document.addEventListener('tn:ready', boot, { once: true });
})();
