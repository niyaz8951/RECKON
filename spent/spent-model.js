/* SPENT — the model: what a usual day looks like, learned from your days.
   =============================================================================
   The app assumes, you correct. For every weekday × category this keeps an
   exponentially weighted mean and variance of the minutes you confirmed
   (half-life four weeks, so a new routine takes over in about a month).
   With fewer than three confirmed samples it leans on the "Usual day" rules
   you set, as if they were that many extra samples.

   No machine learning, nothing hidden: every number it shows can be
   explained in one sentence ("Asked because exercise varies on Thursdays").
   Pure: days in, predictions and questions out. Shared by the page and the
   tests; needs SpentEngine.

     fit(days, prof, today)          -> model
     model.stat(dow, key)            -> { mean, sd, cv, n, high, rule }
     model.predictDay(d)             -> { d, blocks, conf: {key: stat}, usualYours }
     model.followUps(d, n, { when, exclude })  -> after "not a usual day"
     model.questionsFor(d, budget, { when, exclude })
                                     -> [ { kind:'usual'|'cat', … } ]  (≤ budget)
     presetsFor(stat, cat)           -> three dial presets (minutes)

   A sample is a category on a day whose source is confirmed, focus or ai
   (see SpentEngine.srcOf). Assumed minutes never teach the model — it would
   only be learning from itself. */
(function (root) {
  'use strict';
  var E = root.SpentEngine || (typeof require === 'function' ? require('./spent-engine.js') : null);

  var HALF_LIFE = 28;          // days
  var SEED_N = 3;              // below this many samples, the rules fill in
  var HIGH_N = 4;              // samples needed before a category is "known"
  var HIGH_CV = 0.25;          // …and how steady it must be
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  /* How much a wrong guess in each class moves the answer people care
     about (how much of the day was yours). */
  var IMPACT = { mine: 1.5, leak: 1.3, fixed: 0.6, ess: 0.6 };
  var LEARNED = { confirmed: 1, focus: 1, ai: 1 };

  function round5(m) { return Math.max(0, Math.round(m / 5) * 5); }
  function round15(m) { return Math.max(0, Math.round(m / 15) * 15); }
  function ageDays(d, today) { return Math.round((E.parse(today) - E.parse(d)) / 864e5); }
  function ruleFor(dow, key, prof) {
    var weekend = (prof.weekend || []).indexOf(dow) !== -1;
    var r = weekend ? prof.rules.weekend : prof.rules.weekday;
    return Number((r || {})[key]) || 0;
  }
  function lower(name) { return String(name).charAt(0).toLowerCase() + String(name).slice(1); }

  function fit(days, prof, today) {
    prof = E.profileOf(prof);
    today = today || E.iso(new Date());
    // acc[dow][key] = { W, Wx, Wxx, n }
    var acc = [];
    for (var i = 0; i < 7; i++) acc.push({});
    (days || []).forEach(function (day) {
      if (!day || !day.d || day.d > today) return;
      var a = ageDays(day.d, today);
      if (a < 0) return;
      var w = Math.pow(0.5, a / HALF_LIFE), dw = E.dow(day.d);
      prof.cats.forEach(function (c) {
        if (!LEARNED[E.srcOf(day, c.key)]) return;
        var x = Number((day.blocks || {})[c.key]) || 0;
        var s = acc[dw][c.key] || (acc[dw][c.key] = { W: 0, Wx: 0, Wxx: 0, n: 0 });
        s.W += w; s.Wx += w * x; s.Wxx += w * x * x; s.n += 1;
      });
    });

    var cache = {};
    function stat(dw, key) {
      var ck = dw + ':' + key;
      if (cache[ck]) return cache[ck];
      var s = acc[dw][key] || { W: 0, Wx: 0, Wxx: 0, n: 0 };
      var rule = ruleFor(dw, key, prof);
      var mean, variance;
      var sMean = s.W > 0 ? s.Wx / s.W : 0;
      var sVar = s.W > 0 ? Math.max(0, s.Wxx / s.W - sMean * sMean) : 0;
      if (s.n >= SEED_N) { mean = sMean; variance = sVar; }
      else {
        // The rule counts as (SEED_N − n) samples of average weight.
        var wbar = s.n ? s.W / s.n : 1, k = (SEED_N - s.n) * wbar;
        mean = (s.Wx + k * rule) / (s.W + k);
        // A rule you set is a fair guess, not a fact: ±20% of it, at least
        // half an hour.
        var priorSd = Math.max(30, rule * 0.2);
        variance = s.n >= 2 ? (s.W * (sVar + Math.pow(sMean - mean, 2)) + k * (priorSd * priorSd + Math.pow(rule - mean, 2))) / (s.W + k) : priorSd * priorSd;
      }
      var sd = Math.sqrt(variance), cv = sd / Math.max(mean, 30);
      var out = { mean: mean, sd: sd, cv: cv, n: s.n, rule: rule, high: s.n >= HIGH_N && cv < HIGH_CV, from: s.n >= SEED_N ? 'record' : s.n ? 'record+rules' : 'rules' };
      cache[ck] = out;
      return out;
    }

    /* The usual day for a date, fitted into 24 hours. */
    function predictDay(d) {
      var dw = E.dow(d), blocks = {}, conf = {};
      prof.cats.forEach(function (c) {
        var st = stat(dw, c.key); conf[c.key] = st;
        var m = round5(st.mean);
        if (m > 0) blocks[c.key] = m;
      });
      blocks = fitDay(blocks, prof, {});
      var c = E.byClass(blocks, prof);
      return { d: d, dow: dw, dayName: DAY_NAMES[dw], blocks: blocks, conf: conf, usualYours: c.mine };
    }

    /* At most `budget` questions, cheapest first: "Was it a usual day?",
       then the categories the model knows least about, weighted by how much
       a wrong guess would move "yours". */
    function questionsFor(d, budget, o) {
      o = o || {};
      budget = budget == null ? 5 : budget;
      if (budget < 1) return [];
      var p = predictDay(d), dn = p.dayName, when = o.when || 'today';
      var qs = [{ kind: 'usual', id: 'usual', title: 'Was ' + when + ' a usual ' + dn + '?',
        reason: 'Yes fills in the day from what your ' + dn + 's look like. No asks about the parts that change.' }];
      var skip = {}; (o.exclude || []).forEach(function (k) { skip[k] = 1; });
      var cands = prof.cats.filter(function (c) { return !skip[c.key]; }).map(function (c) {
        var st = p.conf[c.key];
        // Uncertainty in minutes. With almost no record, a rule you set is
        // trusted to ±15%; a category with no rule at all to ±30 minutes.
        var u = st.high ? 0 : st.n < 2 ? (st.rule > 0 ? Math.max(15, st.rule * 0.15) : 30) : st.sd;
        return { c: c, st: st, score: u * (IMPACT[c.cls] || 1), u: u };
      }).filter(function (x) { return x.u >= 10; });
      cands.sort(function (a, b) { return b.score - a.score || prof.cats.indexOf(a.c) - prof.cats.indexOf(b.c); });
      cands.slice(0, budget - 1).forEach(function (x) {
        var pred = p.blocks[x.c.key] || 0, nm = lower(x.c.name);
        qs.push({ kind: 'cat', id: 'cat:' + x.c.key, key: x.c.key, name: x.c.name, cls: x.c.cls, icon: x.c.icon, predicted: pred, stat: x.st,
          title: pred > 0 ? 'About ' + E.hm(pred) + ' of ' + nm + '?' : 'Any ' + nm + ' ' + when + '?',
          reason: reasonFor(x.st, x.c, dn) });
      });
      return qs;
    }

    /* After "no, not a usual day": the parts most likely to have been
       different, even ones the model is sure about on a usual day — the
       biggest blocks of what is yours and of drift first. */
    function followUps(d, n, o) {
      o = o || {};
      var p = predictDay(d), dn = p.dayName, when = o.when || 'today';
      var skip = {}; (o.exclude || []).forEach(function (k) { skip[k] = 1; });
      return prof.cats.filter(function (c) { return !skip[c.key]; }).map(function (c) {
        var st = p.conf[c.key];
        return { c: c, st: st, score: (IMPACT[c.cls] || 1) * (st.sd + 0.25 * st.mean + (st.mean > 0 ? 10 : 0)) };
      }).sort(function (a, b) { return b.score - a.score || prof.cats.indexOf(a.c) - prof.cats.indexOf(b.c); }).slice(0, Math.max(0, n)).map(function (x) {
        var pred = p.blocks[x.c.key] || 0, nm = lower(x.c.name);
        return { kind: 'cat', id: 'cat:' + x.c.key, key: x.c.key, name: x.c.name, cls: x.c.cls, icon: x.c.icon, predicted: pred, stat: x.st,
          title: pred > 0 ? 'About ' + E.hm(pred) + ' of ' + nm + '?' : 'Any ' + nm + ' ' + when + '?',
          reason: 'Asked because ' + when + ' was not a usual ' + dn + ', and ' + nm + ' is where days usually differ.' };
      });
    }

    return { prof: prof, today: today, stat: stat, predictDay: predictDay, questionsFor: questionsFor, followUps: followUps, samples: function (dw, key) { return (acc[dw][key] || { n: 0 }).n; } };
  }

  function reasonFor(st, c, dayName) {
    var nm = lower(c.name);
    if (st.n === 0) return 'Asked because there is nothing on record for ' + nm + ' on ' + dayName + 's yet.';
    if (st.n < HIGH_N) return 'Asked because only ' + st.n + ' ' + dayName + (st.n === 1 ? ' is' : 's are') + ' on record so far.';
    return 'Asked because ' + nm + ' varies on ' + dayName + 's.';
  }

  /* Squeeze a day into 1,440 minutes without touching what is locked:
     assumed drift goes first, then upkeep, then what is yours, then
     committed time, each class shrunk proportionally. */
  function fitDay(blocks, prof, locked) {
    var out = Object.assign({}, blocks), over = E.total(out) - E.DAY;
    if (over <= 0) return out;
    ['leak', 'ess', 'mine', 'fixed'].some(function (cls) {
      var keys = Object.keys(out).filter(function (k) { return !locked[k] && E.clsOf(prof, k) === cls; });
      var sum = keys.reduce(function (s, k) { return s + out[k]; }, 0);
      if (!sum) return false;
      var cut = Math.min(sum, over), f = (sum - cut) / sum;
      keys.forEach(function (k) { out[k] = round5(out[k] * f); if (!out[k]) delete out[k]; });
      over = E.total(out) - E.DAY;
      return over <= 0;
    });
    return out;
  }

  /* Three dial presets: about half, the usual, about one and a half — or,
     when the usual is nothing, half an hour, an hour, two. */
  function presetsFor(st, cat) {
    var p = st ? round15(st.mean) : 0;
    var out = p >= 15 ? [round15(p / 2) || 15, p, round15(p * 1.5)] : [30, 60, 120];
    var seen = {};
    return out.filter(function (m) { if (seen[m]) return false; seen[m] = 1; return true; });
  }
  /* The dial's range: up to 14h for committed time, 8h otherwise, and
     always room above the usual. */
  function dialMax(st, cat) {
    var base = cat && cat.cls === 'fixed' ? 840 : 480;
    var need = st ? Math.ceil(st.mean * 2 / 60) * 60 : 0;
    return Math.min(E.DAY, Math.max(base, need));
  }

  /* One sentence comparing the day with a usual one of its weekday. */
  function verdict(yours, usualYours, dayName) {
    var diff = yours - usualYours;
    if (Math.abs(diff) < 15) return E.hm(yours) + ' yours — about a usual ' + dayName + '.';
    return E.hm(yours) + ' yours — ' + E.hm(Math.abs(diff)) + (diff > 0 ? ' more' : ' less') + ' than a usual ' + dayName + '.';
  }

  var api = { fit: fit, fitDay: fitDay, presetsFor: presetsFor, dialMax: dialMax, verdict: verdict, DAY_NAMES: DAY_NAMES,
    HALF_LIFE: HALF_LIFE, SEED_N: SEED_N, HIGH_N: HIGH_N, HIGH_CV: HIGH_CV };
  root.SpentModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
