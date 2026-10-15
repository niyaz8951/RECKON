/* DECIDED — the maths.
   =============================================================================
   A decision is logged with what was expected and how sure the person was.
   On the review date they record what happened. Over time that gives the
   one thing no one gets from experience alone: calibration — whether "80%
   sure" turns out right 80% of the time.

   Pure functions: decisions in, numbers out. Shared by the page and tests. */
(function (root) {
  'use strict';

  var DOMAINS = [
    { key: 'money',    name: 'Money',     icon: 'wallet' },
    { key: 'work',     name: 'Work',      icon: 'briefcase' },
    { key: 'health',   name: 'Health',    icon: 'activity' },
    { key: 'family',   name: 'Family',    icon: 'heart' },
    { key: 'learning', name: 'Learning',  icon: 'book-open' },
    { key: 'life',     name: 'Life',      icon: 'compass' }
  ];
  var STAKES = ['low', 'medium', 'high'];
  var REVIEW_PRESETS = [['1w', 7, 'in a week'], ['1m', 30, 'in a month'], ['3m', 91, 'in three months'], ['6m', 182, 'in six months'], ['1y', 365, 'in a year']];
  var SCORE_LABEL = { 1: 'Much worse', 2: 'Worse', 3: 'As expected', 4: 'Better', 5: 'Much better' };

  function iso(d) { var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate(); return y + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; }
  function parse(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00'); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function domainOf(key) { for (var i = 0; i < DOMAINS.length; i++) if (DOMAINS[i].key === key) return DOMAINS[i]; return DOMAINS[DOMAINS.length - 1]; }
  function pct(n) { return Math.round(n) + '%'; }

  /* Buckets for calibration: how often "70% sure" was right. */
  function bucketOf(conf) { return conf < 60 ? '50–59' : conf < 70 ? '60–69' : conf < 80 ? '70–79' : conf < 90 ? '80–89' : '90–100'; }
  var BUCKETS = ['50–59', '60–69', '70–79', '80–89', '90–100'];

  function build(list, today) {
    var all = (list || []).filter(function (d) { return !d.deleted_at; });
    var open = all.filter(function (d) { return d.status !== 'reviewed'; }).sort(function (a, b) { return a.review_on < b.review_on ? -1 : 1; });
    var due = open.filter(function (d) { return d.review_on <= today; });
    var upcoming = open.filter(function (d) { return d.review_on > today; });
    var reviewed = all.filter(function (d) { return d.status === 'reviewed'; }).sort(function (a, b) { return (b.reviewed_at || '') < (a.reviewed_at || '') ? -1 : 1; });
    var scored = reviewed.filter(function (d) { return d.as_expected === 0 || d.as_expected === 1; });

    // Calibration: predicted (mean confidence) vs actual hit-rate, overall and per bucket.
    var n = scored.length;
    var hits = scored.filter(function (d) { return d.as_expected === 1; }).length;
    var meanConf = n ? scored.reduce(function (s, d) { return s + d.confidence; }, 0) / n : 0;
    var hitRate = n ? hits / n * 100 : 0;
    var brier = n ? scored.reduce(function (s, d) { var p = d.confidence / 100; return s + Math.pow(p - d.as_expected, 2); }, 0) / n : null;
    var buckets = BUCKETS.map(function (b) {
      var rows = scored.filter(function (d) { return bucketOf(d.confidence) === b; });
      var h = rows.filter(function (d) { return d.as_expected === 1; }).length;
      return { bucket: b, n: rows.length, hit: rows.length ? h / rows.length * 100 : null, conf: rows.length ? rows.reduce(function (s, d) { return s + d.confidence; }, 0) / rows.length : null };
    });
    var gap = n >= 3 ? meanConf - hitRate : null;   // + = overconfident
    var byDomain = DOMAINS.map(function (dm) {
      var rows = scored.filter(function (d) { return d.domain === dm.key; }), h = rows.filter(function (d) { return d.as_expected === 1; }).length;
      var all_ = all.filter(function (d) { return d.domain === dm.key; });
      return { key: dm.key, name: dm.name, n: rows.length, total: all_.length, hit: rows.length ? h / rows.length * 100 : null, conf: rows.length ? rows.reduce(function (s, d) { return s + d.confidence; }, 0) / rows.length : null };
    }).filter(function (x) { return x.total > 0; });
    var outcomes = reviewed.filter(function (d) { return d.outcome_score >= 1; });
    var meanScore = outcomes.length ? outcomes.reduce(function (s, d) { return s + d.outcome_score; }, 0) / outcomes.length : null;
    var better = outcomes.filter(function (d) { return d.outcome_score >= 4; }).length, worse = outcomes.filter(function (d) { return d.outcome_score <= 2; }).length;
    var highStakesOpen = open.filter(function (d) { return d.stakes === 'high'; }).length;
    var lessons = reviewed.filter(function (d) { return d.lesson && d.lesson.trim(); });
    // How long the person leaves between deciding and reviewing, on average.
    var horizon = all.length ? all.reduce(function (s, d) { return s + Math.max(0, daysBetween(d.decided_on, d.review_on)); }, 0) / all.length : 0;
    var last30 = all.filter(function (d) { return daysBetween(d.decided_on, today) <= 30; }).length;
    return { all: all, open: open, due: due, upcoming: upcoming, reviewed: reviewed, scored: scored, n: n, hits: hits, meanConf: meanConf, hitRate: hitRate,
      brier: brier, buckets: buckets, gap: gap, byDomain: byDomain, meanScore: meanScore, better: better, worse: worse, highStakesOpen: highStakesOpen,
      lessons: lessons, horizon: horizon, last30: last30 };
  }

  /* A sentence about calibration, honest about thin data. */
  function verdict(M) {
    if (M.n < 3) return { tone: 'info', text: M.n === 0 ? 'No decision has come up for review yet. Calibration starts with the third reviewed decision.' : 'Reviewed ' + M.n + ' so far — three are needed before the numbers mean anything.' };
    var g = M.gap;
    if (Math.abs(g) < 8) return { tone: 'good', text: 'Well calibrated: you said <b>' + pct(M.meanConf) + '</b> on average and were right <b>' + pct(M.hitRate) + '</b> of the time. Keep trusting your estimates.' };
    if (g > 0) return { tone: 'bad', text: 'Overconfident by <b>' + Math.round(g) + ' points</b>: you said ' + pct(M.meanConf) + ' sure, and were right ' + pct(M.hitRate) + ' of the time. When you feel 80%, it is closer to ' + pct(Math.max(0, 80 - g)) + '.' };
    return { tone: 'warn', text: 'Underconfident by <b>' + Math.round(-g) + ' points</b>: you were right ' + pct(M.hitRate) + ' of the time but only claimed ' + pct(M.meanConf) + '. You can trust yourself more than you do.' };
  }

  /* One idea a day about deciding well, with the person's numbers where
     there are any. */
  function lesson(M, today) {
    var list = [];
    list.push({ k: 'calibration', title: 'Calibration', lead: M.n >= 3 ? 'Of the decisions you were ' + pct(M.meanConf) + ' sure about, ' + pct(M.hitRate) + ' went as expected.' : 'A well-calibrated person is right 70% of the time when they say "70% sure".',
      body: 'Most people run ten to twenty points overconfident on things they care about. The cure is not doubt; it is keeping score, which is what this journal does.',
      why: 'Why it matters: knowing how sure you really are tells you how much to hedge, insure, or wait.' });
    list.push({ k: 'doors', title: 'Two kinds of doors', lead: M.highStakesOpen ? 'You have ' + M.highStakesOpen + ' high-stakes decision' + (M.highStakesOpen === 1 ? '' : 's') + ' open right now.' : 'Most decisions are two-way doors: you can walk back through them.',
      body: 'Reversible decisions deserve speed; irreversible ones deserve the slow process — sleep on it, ask someone who has done it, write the pre-mortem. Treating every choice as a one-way door is how people freeze.',
      why: 'Why it matters: speed on small calls buys the time that big calls need.' });
    list.push({ k: 'premortem', title: 'The pre-mortem', lead: 'Imagine it is the review date and it went badly. Why?',
      body: 'Writing the failure story before deciding surfaces the risks hindsight would later call obvious. It takes two minutes and changes about a third of decisions in studies of it.',
      why: 'Why it matters: "What I expect to happen" is only half the entry; the other half is what would make you wrong.' });
    list.push({ k: 'outcome', title: 'Good decision, bad outcome', lead: M.worse ? M.worse + ' of your reviewed decisions turned out worse than expected.' : 'A decision can be right and still turn out badly.',
      body: 'Poker players call it resulting: judging the choice by how the cards fell. Review the reasoning you had with the information you had; the lesson is often "the process was fine" — or "I knew and ignored it".',
      why: 'Why it matters: punishing good process for bad luck teaches you to stop taking good bets.' });
    list.push({ k: 'baserate', title: 'Start from the base rate', lead: 'Before asking "will this work for me?", ask "how often does this work for anyone?"',
      body: 'Renovations overrun, diets end, side projects stall — at known rates. Your estimate should start there and move for your specifics, not start at hope.',
      why: 'Why it matters: the outside view is the single biggest fix for overconfidence.' });
    list.push({ k: 'regret', title: 'The regret test', lead: 'Which choice would the 80-year-old you regret less?',
      body: 'Short-term discomfort shrinks with distance; missed chances do not. The test does not say "always be bold" — it says weigh the decision on the time-scale it actually lives on.',
      why: 'Why it matters: most decisions are judged on the wrong clock.' });
    if (M.lessons.length) { var L = M.lessons[0];
      list.push({ k: 'own', title: 'In your own words', lead: '“' + String(L.lesson).slice(0, 140) + '”', body: 'From your review of <b>' + esc(L.title) + '</b>. Your own lessons, written at the moment of looking back, are worth more than any of the others here.', why: 'Why it matters: a lesson you wrote is one you believed.' }); }
    var doy = Math.floor((parse(today) - new Date(parse(today).getFullYear(), 0, 1)) / 864e5);
    return list[doy % list.length];
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  root.DecidedEngine = { DOMAINS: DOMAINS, STAKES: STAKES, REVIEW_PRESETS: REVIEW_PRESETS, SCORE_LABEL: SCORE_LABEL, BUCKETS: BUCKETS,
    iso: iso, parse: parse, addDays: addDays, daysBetween: daysBetween, domainOf: domainOf, pct: pct, bucketOf: bucketOf, build: build, verdict: verdict, lesson: lesson };
})(typeof window !== 'undefined' ? window : globalThis);
