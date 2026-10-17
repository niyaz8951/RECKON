/* KEPT — what repeats, and what is coming. (v2, phase 3)
   =============================================================================
   Pure functions over the ledger, shared by the page and the tests.

   detect(rows, today)      payments that come back on a schedule: the same
                            payee (normalised), every month / quarter / year
                            (each gap within ±7 days of the period), each
                            amount within ±15% of the usual one. Rows KEPT
                            posted itself (EMIs, recurring rules) are left out:
                            those are already known.
   headsUps(found, answers, today, o)
                            a card ~30 days before a quarterly or yearly bill:
                            "Car insurance was 2,400 on 14 Nov last year — set
                            aside 80/day?" Answered patterns (dismissed or
                            already reserved) stay quiet.
   setAside(found, answers, today)
                            what reserved patterns hold back from Safe to
                            spend for the rest of this month: the next bill,
                            spread evenly from the day the person said yes
                            (or the last payment) to its date.
   lookback(M, today, o)    last month against the month before and the same
                            month a year ago, by category; fires only on a
                            change of 20% or more, or a keep-rate target
                            crossed. Calendar months (KEPT's own months).
   importCard(M, today)     under three months on file: "bring your last
                            year in", so heads-ups work from day one.

   Every card carries `why`, the one line that says why it was shown. */
(function (root) {
  'use strict';

  var PERIODS = { monthly: { days: 30.44, months: 1, min: 3 }, quarterly: { days: 91.31, months: 3, min: 2 }, yearly: { days: 365.25, months: 12, min: 2 } };
  var TOL_DAYS = 7, TOL_AMT = 0.15, HEADS_UP_DAYS = 30;

  function parse(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00'); }
  function iso(d) { var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate(); return y + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; }
  function days(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function addMonths(s, n) {
    var d = parse(s), day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return iso(d);
  }
  function median(xs) { var s = xs.slice().sort(function (a, b) { return a - b; }), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; }
  function plain(minor) { return String(Math.round(Math.abs(minor) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function dateShort(s) { return parse(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace('Sept', 'Sep'); }

  /* "POS 4417 CARREFOUR MOE DUBAI ARE" and "Carrefour MOE" are one payee. */
  var NOISE = /\b(POS|PURCHASE|PAYMENT|PAYMT|PMT|CARD|DEBIT|CREDIT|ENDING|REF|TXN|TRANSFER|ONLINE|AUTOPAY|DIRECT|DD|SI|DUBAI|SHARJAH|ABU DHABI|RIYADH|JEDDAH|ARE|UAE|SAU|LLC|L L C|FZE|FZCO|CO|THE)\b/g;
  function normKey(descr) {
    var t = String(descr || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\b\d+\b/g, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
    return t.split(' ').slice(0, 3).join(' ') || String(descr || '').toUpperCase().trim();
  }
  function titleCase(s) { return String(s).toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  function modeOf(xs) { var c = {}, best = null; xs.forEach(function (x) { c[x] = (c[x] || 0) + 1; if (best === null || c[x] > c[best]) best = x; }); return best; }

  function eligible(r) {
    if (!r || r.deleted_at || !(Number(r.amount_minor) < 0)) return false;
    if (/^(emi|recurring):/.test(String(r.remark || ''))) return false;
    if (/transfer|invest/i.test(String(r.cat || ''))) return false;
    return true;
  }

  /* One payee's payments → the period they keep to, or null. */
  function fit(occ) {
    if (occ.length < 2) return null;
    var gaps = [];
    for (var i = 1; i < occ.length; i++) gaps.push(days(occ[i - 1].d, occ[i].d));
    var amts = occ.map(function (o) { return o.amount; }), med = median(amts);
    if (!med) return null;
    var spread = Math.max.apply(null, amts.map(function (a) { return Math.abs(a - med) / med; }));
    if (spread > TOL_AMT) return null;
    var keys = Object.keys(PERIODS);
    for (var k = 0; k < keys.length; k++) {
      var P = PERIODS[keys[k]];
      if (occ.length < P.min) continue;
      if (gaps.every(function (g) { return Math.abs(g - P.days) <= TOL_DAYS; })) return { freq: keys[k], period: P, amount: Math.round(med), spread: spread, gaps: gaps };
    }
    return null;
  }

  function detect(rows, today) {
    var groups = {};
    (rows || []).filter(eligible).forEach(function (r) {
      var k = normKey(r.descr);
      (groups[k] = groups[k] || []).push({ d: String(r.d).slice(0, 10), amount: -Number(r.amount_minor), descr: r.descr, cat: r.cat });
    });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var occ = groups[k].sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
      var f = fit(occ);
      if (!f) return;
      var last = occ[occ.length - 1], next = addMonths(last.d, f.period.months);
      // A pattern whose next date passed more than a week ago has stopped.
      if (today && days(next, today) > TOL_DAYS) return;
      out.push({
        key: k, label: titleCase(k), cat: modeOf(occ.map(function (o) { return o.cat; })) || 'Misc', freq: f.freq,
        amount: f.amount, n: occ.length, spread: f.spread, first_d: occ[0].d,
        last: { d: last.d, amount: last.amount }, next_d: next,
        why: 'Shown because it came ' + occ.length + ' times, ' + (f.freq === 'yearly' ? 'a year apart' : f.freq === 'quarterly' ? 'three months apart' : 'a month apart') + ', each within 15% of ' + plain(f.amount) + '.'
      });
    });
    out.sort(function (a, b) { return a.next_d < b.next_d ? -1 : a.next_d > b.next_d ? 1 : b.amount - a.amount; });
    return out;
  }

  function answerOf(answers, key) { for (var i = 0; i < (answers || []).length; i++) if (answers[i].key === key) return answers[i]; return null; }
  function perDay(amount, from, to) { return Math.ceil(amount / Math.max(1, days(from, to))); }

  /* ~30 days before a quarterly or yearly bill. */
  function headsUps(found, answers, today, o) {
    o = o || {}; var money = o.money || plain, avgSpend = o.avgSpend || 0;
    return (found || []).filter(function (p) {
      if (p.freq === 'monthly') return false;
      var a = answerOf(answers, p.key);
      if (a && (a.status === 'dismissed' || a.status === 'reserved')) return false;
      var left = days(today, p.next_d);
      return left >= 1 && left <= HEADS_UP_DAYS;
    }).map(function (p) {
      var left = days(today, p.next_d), daily = perDay(p.amount, today, p.next_d);
      var ago = p.freq === 'yearly' ? 'last year' : 'three months ago';
      // Nearer and bigger first; a bill that is a large share of a month
      // scores close to 1.
      var size = avgSpend > 0 ? Math.min(1, p.amount / avgSpend * 2) : 0.6;
      var near = 1 - (left - 1) / HEADS_UP_DAYS * 0.5;
      return {
        app: 'kept', type: 'heads-up', key: p.key, score: Math.round((0.5 + 0.5 * size) * near * 100) / 100,
        eyebrow: 'Coming up · ' + left + ' day' + (left === 1 ? '' : 's'),
        title: p.label + ' was ' + money(p.last.amount) + ' on ' + dateShort(p.last.d) + ' ' + ago + '.',
        body: 'The next one is due about ' + dateShort(p.next_d) + '. Set aside ' + money(daily) + ' a day and it is paid for when it lands.',
        why: p.why, pattern: p, perDay: daily,
        actions: [{ label: 'Set aside ' + money(daily) + '/day', value: 'reserve', primary: true }, { label: 'Not a repeat', value: 'dismiss' }]
      };
    });
  }

  /* What reserved bills hold back from the rest of this month. */
  function setAside(found, answers, today) {
    var ym = String(today).slice(0, 7), t = parse(today);
    var monthEnd = iso(new Date(t.getFullYear(), t.getMonth() + 1, 0));
    var items = [];
    (answers || []).filter(function (a) { return a.status === 'reserved'; }).forEach(function (a) {
      var p = null; for (var i = 0; i < (found || []).length; i++) if (found[i].key === a.key) p = found[i];
      var next = p ? p.next_d : a.next_d, amount = p ? p.amount : Number(a.amount_minor) || 0;
      if (!next || !amount || next <= today) return;
      var from = a.reserve_from || today;
      if (p && p.last.d > from) from = p.last.d;          // paid since: the fund starts again from that payment
      var daily = amount / Math.max(1, days(from, next));
      var end = next < monthEnd ? next : monthEnd;
      var n = Math.max(0, days(today, end));
      if (!n) return;
      items.push({ key: a.key, label: p ? p.label : (a.label || titleCase(a.key)), next_d: next, perDay: Math.ceil(daily), month: ym, amount: Math.round(daily * n) });
    });
    return { total: items.reduce(function (s, x) { return s + x.amount; }, 0), items: items };
  }

  /* Last month, looked back on. */
  function prevMonth(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - (n || 1); while (m < 1) { m += 12; y--; } return y + '-' + (m < 10 ? '0' : '') + m; }
  function keepRate(p) { var inn = p.income + p.refund; return inn > 0 ? (inn - p.spend - p.debtpay) / inn * 100 : null; }
  function monthName(ym) { return parse(ym + '-01').toLocaleDateString('en-GB', { month: 'long' }); }
  function lookback(M, today, o) {
    o = o || {}; var money = o.money || plain, target = (o.targetBp || 2000) / 100;
    if (!M || !M.per) return [];
    var dom = parse(today).getDate();
    if (dom > 10) return [];                        // a look back belongs to the start of the month
    var last = prevMonth(String(today).slice(0, 7)), before = prevMonth(last), yearAgo = prevMonth(last, 12);
    var L = M.per[last];
    if (!L) return [];
    var out = [], fresh = 1 - (dom - 1) / 10 * 0.5;
    // Keep-rate target crossed, either way.
    var r1 = keepRate(L), r0 = M.per[before] ? keepRate(M.per[before]) : null;
    if (r1 != null && r0 != null && (r1 >= target) !== (r0 >= target)) {
      var up = r1 >= target;
      out.push({ app: 'kept', type: 'lookback', key: 'rate:' + last, score: Math.round(0.9 * fresh * 100) / 100,
        eyebrow: 'Looking back · ' + monthName(last),
        title: monthName(last) + ' kept ' + Math.round(r1) + '% — ' + (up ? 'over' : 'under') + ' your ' + target + '% target.',
        body: monthName(before) + ' kept ' + Math.round(r0) + '%. ' + (up ? 'Whatever changed, it worked: name it so you can do it again.' : 'One month is not a trend; two is. Worth a look at what moved.'),
        why: 'Shown because the keep rate crossed your target between ' + monthName(before) + ' and ' + monthName(last) + '.' });
    }
    // The biggest category move against the month before, or a year ago.
    var floor = Math.max(10000, Math.round(((M.avg && M.avg.spend) || L.spend) * 0.02));
    [[before, 'month'], [yearAgo, 'year']].forEach(function (cmp) {
      var P = M.per[cmp[0]]; if (!P) return;
      var best = null;
      Object.keys(Object.assign({}, L.byCat, P.byCat)).forEach(function (c) {
        var a = L.byCat[c] || 0, b = P.byCat[c] || 0, d = a - b;
        if (b <= 0 || Math.abs(d) < floor || Math.abs(d) / b < 0.2) return;
        if (!best || Math.abs(d) > Math.abs(best.d)) best = { cat: c, a: a, b: b, d: d };
      });
      if (!best) return;
      var pc = Math.round(Math.abs(best.d) / best.b * 100), more = best.d > 0;
      var than = cmp[1] === 'year' ? monthName(last) + ' last year' : monthName(cmp[0]);
      out.push({ app: 'kept', type: 'lookback', key: 'cat:' + cmp[1] + ':' + last + ':' + best.cat,
        score: Math.round((cmp[1] === 'year' ? 0.75 : 0.7) * Math.min(1, 0.6 + pc / 250) * fresh * 100) / 100,
        eyebrow: 'Looking back · ' + monthName(last),
        title: best.cat + ': ' + money(best.a) + ' in ' + monthName(last) + ' — ' + pc + '% ' + (more ? 'more' : 'less') + ' than ' + than + '.',
        body: than.charAt(0).toUpperCase() + than.slice(1) + ' it was ' + money(best.b) + '. ' + (more ? 'Was it one big thing, or a lot of small ones?' : 'That is ' + money(Math.abs(best.d)) + ' that stayed yours.'),
        why: 'Shown because ' + best.cat + ' moved by ' + pc + '% — more than the 20% that counts as a change.' });
    });
    return out;
  }

  function importCard(M, today) {
    var n = M && M.months ? M.months.length : 0;
    if (n >= 3) return [];
    return [{ app: 'kept', type: 'import', key: 'import', score: 0.35,
      eyebrow: 'Get more from KEPT', title: 'Bring your last year in.',
      body: 'Upload a bank or card export (Excel or CSV). With a year on file KEPT can warn you a month before the yearly bills.',
      why: 'Shown because KEPT has ' + (n ? n + ' month' + (n === 1 ? '' : 's') : 'nothing') + ' on file — heads-ups need a year.',
      actions: [{ label: 'Upload a file', value: 'import', primary: true }] }];
  }

  var KeptRecur = { PERIODS: PERIODS, normKey: normKey, detect: detect, headsUps: headsUps, setAside: setAside, lookback: lookback, importCard: importCard, addMonths: addMonths, days: days };
  root.KeptRecur = KeptRecur;
  if (typeof module !== 'undefined' && module.exports) module.exports = KeptRecur;
})(typeof window !== 'undefined' ? window : globalThis);
