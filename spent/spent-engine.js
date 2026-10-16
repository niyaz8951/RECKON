/* SPENT — the maths.
   =============================================================================
   How much of your time stays yours. A day is 1,440 minutes split across
   categories; each category belongs to a class:

     fixed  committed before the day starts   sleep, work, commute
     ess    upkeep of life                     chores, errands, cooking, admin
     mine   yours, by choice                   family, learning, exercise, friends, making
     leak   drift                              screen, waiting, nothing

   Kept = minutes in "mine". Keep-rate = kept ÷ waking minutes (1,440 − sleep),
   the twin of KEPT's keep-rate for money. Everything here is pure: rows in,
   numbers out, no DOM, no network. Shared by the page and the tests. */
(function (root) {
  'use strict';

  var DAY = 1440;
  var DEFAULT_CATS = [
    { key: 'sleep',    name: 'Sleep',     cls: 'fixed', icon: 'moon' },
    { key: 'work',     name: 'Work',      cls: 'fixed', icon: 'briefcase' },
    { key: 'commute',  name: 'Commute',   cls: 'fixed', icon: 'kept-car' },
    { key: 'chores',   name: 'Home & errands', cls: 'ess', icon: 'home' },
    { key: 'meals',    name: 'Meals',     cls: 'ess',   icon: 'kept-food' },
    { key: 'family',   name: 'Family',    cls: 'mine',  icon: 'heart' },
    { key: 'learning', name: 'Learning',  cls: 'mine',  icon: 'book-open' },
    { key: 'exercise', name: 'Exercise',  cls: 'mine',  icon: 'activity' },
    { key: 'friends',  name: 'Friends',   cls: 'mine',  icon: 'users' },
    { key: 'making',   name: 'Making & projects', cls: 'mine', icon: 'tool' },
    { key: 'faith',    name: 'Faith & reflection', cls: 'mine', icon: 'sun' },
    { key: 'screen',   name: 'Screen & scrolling', cls: 'leak', icon: 'smartphone' },
    { key: 'other',    name: 'Other',     cls: 'leak',  icon: 'more-horizontal' }
  ];
  var CLASS_LABEL = { fixed: 'Committed', ess: 'Upkeep', mine: 'Yours', leak: 'Drift' };
  /* Usual weekday: the rules a new profile starts with (minutes). */
  var DEFAULT_RULES = {
    weekday: { sleep: 420, work: 540, commute: 60, meals: 90, chores: 45 },
    weekend: { sleep: 480, meals: 120, chores: 90 }
  };
  var PROFILE_DEFAULTS = { cats: DEFAULT_CATS, rules: DEFAULT_RULES, target_bp: 2000, weekend: [5, 6] };   // Fri, Sat (UAE); 0 = Sunday

  function iso(d) { var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate(); return y + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; }
  function parse(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00'); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function dow(s) { return parse(s).getDay(); }
  function isWeekend(s, prof) { return ((prof && prof.weekend) || PROFILE_DEFAULTS.weekend).indexOf(dow(s)) !== -1; }
  function hm(min) {
    min = Math.round(Number(min) || 0);
    var neg = min < 0; min = Math.abs(min);
    var h = Math.floor(min / 60), m = min % 60;
    var s = h ? h + 'h' + (m ? ' ' + (m < 10 ? '0' : '') + m + 'm' : '') : m + 'm';
    return (neg ? '−' : '') + s;
  }
  function hours1(min) { return (Math.round((Number(min) || 0) / 6) / 10) + 'h'; }
  function pct(n) { return (Math.round(n * 10) / 10) + '%'; }

  function profileOf(raw) {
    var p = Object.assign({}, PROFILE_DEFAULTS, raw || {});
    if (!Array.isArray(p.cats) || !p.cats.length) p.cats = DEFAULT_CATS;
    p.cats = p.cats.map(function (c) { return { key: c.key, name: c.name || c.key, cls: ['fixed', 'ess', 'mine', 'leak'].indexOf(c.cls) > -1 ? c.cls : 'leak', icon: c.icon || 'clock' }; });
    p.rules = Object.assign({ weekday: {}, weekend: {} }, p.rules || {});
    p.target_bp = Math.max(0, Math.min(10000, Math.round(Number(p.target_bp) || 2000)));
    return p;
  }
  function catMap(prof) { var m = {}; prof.cats.forEach(function (c) { m[c.key] = c; }); return m; }
  function clsOf(prof, key) { var c = catMap(prof)[key]; return c ? c.cls : 'leak'; }

  /* Blocks -> clean minutes map (non-negative integers, known keys only). */
  function cleanBlocks(blocks, prof) {
    var cm = catMap(prof), out = {};
    Object.keys(blocks || {}).forEach(function (k) {
      if (!cm[k]) return;
      var v = Math.round(Number(blocks[k]) || 0);
      if (v > 0) out[k] = Math.min(DAY, v);
    });
    return out;
  }
  function total(blocks) { return Object.keys(blocks || {}).reduce(function (a, k) { return a + (Number(blocks[k]) || 0); }, 0); }
  function byClass(blocks, prof) {
    var out = { fixed: 0, ess: 0, mine: 0, leak: 0 };
    Object.keys(blocks || {}).forEach(function (k) { out[clsOf(prof, k)] += Number(blocks[k]) || 0; });
    return out;
  }
  /* Where a category's minutes on a day came from:
       confirmed  you said so (check-in, Edit day, or any day logged before v2)
       focus      a Focus timer measured it
       ai         Quick add parsed it and you swiped yes
       assumed    nobody said; it is the usual day standing in
     day.src is the per-category map the data layer reads out of blocks_json.
     A day with no map at all was written before v2 by hand: confirmed.
     Otherwise a key without an entry is confirmed if the day was checked in
     (confirmed_at) and assumed if not. */
  var SRC = ['assumed', 'confirmed', 'focus', 'ai'];
  function srcOf(day, key) {
    if (!day || !day.src) return 'confirmed';
    var s = day.src[key];
    if (SRC.indexOf(s) !== -1) return s;
    return day.confirmed_at ? 'confirmed' : 'assumed';
  }
  /* Share of a day's minutes that someone actually stood behind. */
  function confirmedShare(day, prof) {
    var b = (day && day.blocks) || {}, t = 0, c = 0;
    Object.keys(b).forEach(function (k) { var m = Number(b[k]) || 0; t += m; if (srcOf(day, k) !== 'assumed') c += m; });
    if (!t) return day && (day.confirmed_at || !day.src) ? 1 : 0;
    return c / t;
  }
  var ASSUMED_WEIGHT = 0.35;   // an assumed day counts about a third of a confirmed one

  /* The usual day for a date: the rules for a weekday or a weekend day. */
  function usual(d, prof) { return Object.assign({}, isWeekend(d, prof) ? prof.rules.weekend : prof.rules.weekday); }

  /* One day summarised. */
  function dayStats(blocks, prof) {
    var b = cleanBlocks(blocks, prof), t = total(b), c = byClass(b, prof);
    var sleep = b.sleep || 0, waking = Math.max(1, DAY - sleep);
    var unallocated = Math.max(0, DAY - t);
    return { blocks: b, total: t, cls: c, sleep: sleep, waking: waking, kept: c.mine, unallocated: unallocated,
      rate: c.mine / waking * 100, leakRate: c.leak / waking * 100, logged: t > 0 };
  }

  /* "Where do I stand today": yours so far, what is still committed, and
     how much of the day can still be yours if the usual holds. nowMin is
     minutes since midnight (local). */
  function todayStatus(blocks, prof, nowMin, d) {
    var s = dayStats(blocks, prof), u = usual(d || iso(new Date()), prof);
    // Until tonight's sleep is logged, the waking day is sized from the usual night.
    if (!s.sleep) { s.waking = Math.max(1, DAY - (u.sleep || 420)); s.rate = s.kept / s.waking * 100; s.leakRate = s.cls.leak / s.waking * 100; }
    var left = Math.max(0, DAY - Math.min(DAY, nowMin));
    // Committed still to come: the usual fixed amounts not yet logged.
    var committed = 0;
    Object.keys(u).forEach(function (k) {
      if (clsOf(prof, k) !== 'fixed' && clsOf(prof, k) !== 'ess') return;
      var want = u[k] || 0;
      // The night's sleep is behind you once the morning has passed; only
      // what the clock has not yet covered can still take from today.
      if (k === 'sleep') want = Math.max(0, want - Math.min(nowMin, want));
      committed += Math.max(0, want - (s.blocks[k] || 0));
    });
    committed = Math.min(committed, left);
    var target = prof.target_bp / 100;
    var reserve = Math.round(s.waking * target / 100);               // minutes that should be yours today
    var free = Math.max(0, left - committed);                        // minutes not yet spoken for
    var yoursSoFar = s.kept;
    var stillNeeded = Math.max(0, reserve - yoursSoFar);
    return { stats: s, left: left, committed: committed, free: free, reserve: reserve, target: target,
      yoursSoFar: yoursSoFar, stillNeeded: stillNeeded, reachable: free >= stillNeeded,
      projRate: Math.min(100, (yoursSoFar + Math.min(free, stillNeeded)) / s.waking * 100) };
  }

  /* The record: days -> averages, streaks, trends. days = [{d, blocks,
     src?, confirmed_at?}]. opts.assume(d) -> blocks fills the days with no
     row between the first day on record and yesterday (the usual day,
     standing in); those rows are marked assumed and weigh less in every
     average, and each average says how much of it was assumed. */
  function build(days, prof, today, opts) {
    prof = profileOf(prof);
    opts = opts || {};
    var rows = (days || []).map(function (x) {
      var share = confirmedShare(x, prof);
      return { d: x.d, s: dayStats(x.blocks, prof), note: x.note || '', share: share, assumed: share === 0, w: ASSUMED_WEIGHT + (1 - ASSUMED_WEIGHT) * share, confirmed_at: x.confirmed_at || null };
    }).filter(function (x) { return x.s.logged; });
    if (opts.assume && rows.length) {
      var have = {}; rows.forEach(function (r) { have[r.d] = 1; });
      var first = rows.reduce(function (m, r) { return r.d < m ? r.d : m; }, today);
      for (var dd = first; dd < today; dd = addDays(dd, 1)) {
        if (have[dd]) continue;
        var ab = opts.assume(dd);
        if (ab && total(ab) > 0) rows.push({ d: dd, s: dayStats(ab, prof), note: '', share: 0, assumed: true, w: ASSUMED_WEIGHT, confirmed_at: null });
      }
    }
    rows.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    var byD = {}; rows.forEach(function (r) { byD[r.d] = r; });
    function window_(n, endExclusive) {
      var out = [];
      for (var i = 1; i <= n; i++) { var d = addDays(endExclusive, -i); if (byD[d]) out.push(byD[d]); }
      return out;
    }
    /* Weighted: a confirmed day counts 1, an assumed one ASSUMED_WEIGHT.
       out.assumed = share of the days' weightless count that was assumed
       (0 … 1), so a screen can say "mostly assumed". */
    function avg(list) {
      var W = 0, acc = { kept: 0, waking: 0, sleep: 0, leak: 0, fixed: 0, ess: 0, cat: {} }, unconf = 0;
      list.forEach(function (r) {
        var w = r.w == null ? 1 : r.w; W += w; unconf += 1 - (r.share == null ? 1 : r.share);
        acc.kept += w * r.s.kept; acc.waking += w * r.s.waking; acc.sleep += w * r.s.sleep; acc.leak += w * r.s.cls.leak; acc.fixed += w * r.s.cls.fixed; acc.ess += w * r.s.cls.ess;
        Object.keys(r.s.blocks).forEach(function (k) { acc.cat[k] = (acc.cat[k] || 0) + w * r.s.blocks[k]; });
      });
      var n = W || 1;
      var out = { n: list.length, confirmedN: list.filter(function (r) { return !r.assumed; }).length, assumed: list.length ? unconf / list.length : 0,
        kept: acc.kept / n, waking: acc.waking / n, sleep: acc.sleep / n, leak: acc.leak / n, fixed: acc.fixed / n, ess: acc.ess / n, cat: {} };
      Object.keys(acc.cat).forEach(function (k) { out.cat[k] = acc.cat[k] / n; });
      out.rate = out.waking > 0 ? out.kept / out.waking * 100 : 0;
      out.leakRate = out.waking > 0 ? out.leak / out.waking * 100 : 0;
      return out;
    }
    var tomorrow = addDays(today, 1);
    var w7 = window_(7, tomorrow), w7prev = window_(7, addDays(today, -6)), w28 = window_(28, tomorrow);
    // Streak: consecutive checked-in days ending today or yesterday.
    var real = function (d) { return byD[d] && !byD[d].assumed; };
    var streak = 0, cursor = real(today) ? today : addDays(today, -1);
    while (real(cursor)) { streak++; cursor = addDays(cursor, -1); }
    var best = rows.filter(function (r) { return r.share >= 0.5; }).sort(function (a, b) { return b.s.kept - a.s.kept; })[0] || null;
    return { prof: prof, rows: rows, byD: byD, n: rows.length, confirmedN: rows.filter(function (r) { return !r.assumed; }).length,
      week: avg(w7), prevWeek: avg(w7prev), month: avg(w28), all: avg(rows),
      streak: streak, best: best, firstDay: rows.length ? rows[0].d : null };
  }

  /* Seven days ending today, for the week screen. */
  function weekRows(M, today) {
    var out = [];
    for (var i = 6; i >= 0; i--) { var d = addDays(today, -i); out.push({ d: d, row: M.byD[d] || null }); }
    return out;
  }

  /* One idea a day, in the person's own hours. hourlyMinor: KEPT's money per
     working hour (minor units), when both apps have data. */
  function lesson(M, today, hourlyMinor, fmtMoney) {
    if (!M || !M.n) return null;
    var a = M.month.n >= 3 ? M.month : M.all, list = [];
    var yr = function (minPerDay) { return minPerDay * 365 / 60; };   // hours a year
    var weeks = function (hoursYear) { return Math.round(hoursYear / 40); };
    if (a.cat.commute > 0) list.push({ k: 'commute', title: 'The commute', lead: hm(a.cat.commute) + ' a day commuting is ' + weeks(yr(a.cat.commute)) + ' working weeks a year.',
      body: 'That is time already spoken for before the day begins. It cannot be deleted, but it can be converted: a podcast course, a language, a call to someone who matters.',
      why: 'Why it matters: fixed time is the easiest to redesign, because it arrives on schedule.' });
    if (a.cat.screen > 0) list.push({ k: 'screen', title: 'The scroll', lead: hm(a.cat.screen) + ' a day on screens is ' + Math.round(yr(a.cat.screen)) + ' hours a year — about ' + Math.round(yr(a.cat.screen) / 8) + ' books, or a new skill.',
      body: 'Nobody decides to spend ' + hm(a.cat.screen) + ' scrolling; it is the default when nothing else is planned. The fix is not willpower, it is having the next thing ready.',
      why: 'Why it matters: drift is the only category that grows without being chosen.' });
    if (a.sleep > 0) list.push({ k: 'sleep', title: 'Sleep is the base', lead: 'You sleep ' + hm(a.sleep) + ' on an average night' + (a.sleep < 420 ? ' — under the seven hours most adults need.' : '.'),
      body: a.sleep < 420 ? 'Short sleep taxes every other hour: slower work, weaker judgement, more drift. An extra 30 minutes usually pays itself back by mid-afternoon.' : 'Protecting it is the quiet reason the other hours work. Waking time is only as good as the sleep before it.',
      why: 'Why it matters: it is the one category where more is not less of something else.' });
    list.push({ k: 'keep', title: 'Keep-rate for time', lead: 'Of every waking hour, ' + Math.round(a.rate) + '% is yours by choice.',
      body: 'Work and sleep take the big blocks whatever you do. The part that is yours — family, learning, exercise, friends, making — is where a life is actually built, and it is the part that nobody schedules for you.',
      why: 'Why it matters: raising it from ' + Math.round(a.rate) + '% to ' + Math.max(20, Math.round(a.rate) + 5) + '% is ' + hm((Math.max(20, Math.round(a.rate) + 5) - a.rate) / 100 * a.waking) + ' a day, ' + weeks(yr((Math.max(20, Math.round(a.rate) + 5) - a.rate) / 100 * a.waking)) + ' working weeks a year.' });
    if (hourlyMinor > 0 && fmtMoney && a.leak > 0) list.push({ k: 'money', title: 'Time, priced', lead: 'At your income, an hour is worth about ' + fmtMoney(Math.round(hourlyMinor)) + '. Last month\'s drift cost ' + fmtMoney(Math.round(a.leak / 60 * hourlyMinor * 30)) + '.',
      body: 'Not money you lost — money that shows what the hours would fetch if you sold them. It is the same arithmetic KEPT uses to show a purchase as hours of work, run the other way.',
      why: 'Why it matters: time and money are one budget seen from two sides.' });
    list.push({ k: 'hour', title: 'One hour a day', lead: 'One hour a day, every day, is 365 hours a year — nine working weeks.',
      body: 'Enough to learn an instrument badly and a language passably, to read fifty books, or to get properly fit. The hour is nearly always there; it is usually inside "Screen" or "Other".',
      why: 'Why it matters: consistency beats intensity, and an hour is small enough to keep.' });
    var doy = Math.floor((parse(today) - new Date(parse(today).getFullYear(), 0, 1)) / 864e5);
    return list[doy % list.length];
  }

  root.SpentEngine = {
    DAY: DAY, DEFAULT_CATS: DEFAULT_CATS, DEFAULT_RULES: DEFAULT_RULES, PROFILE_DEFAULTS: PROFILE_DEFAULTS, CLASS_LABEL: CLASS_LABEL,
    iso: iso, parse: parse, addDays: addDays, dow: dow, isWeekend: isWeekend, hm: hm, hours1: hours1, pct: pct,
    profileOf: profileOf, catMap: catMap, clsOf: clsOf, cleanBlocks: cleanBlocks, total: total, byClass: byClass, usual: usual,
    SRC: SRC, srcOf: srcOf, confirmedShare: confirmedShare, ASSUMED_WEIGHT: ASSUMED_WEIGHT,
    dayStats: dayStats, todayStatus: todayStatus, build: build, weekRows: weekRows, lesson: lesson
  };
})(typeof window !== 'undefined' ? window : globalThis);
