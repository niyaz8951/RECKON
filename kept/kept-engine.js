/* KEPT — the engine. Pure maths, no DOM, no fetch.
   =============================================================================
   Ported from the standalone app's core.js / life.js / emis.js. Every amount
   in and out is an INTEGER in minor units (fils, paise); percentages are
   basis points unless the name says otherwise. Dates are 'YYYY-MM-DD' and
   months 'YYYY-MM'. Nothing here reads the clock: `today` is always passed
   in, so the tests can pin it.

   Exposed as window.KeptEngine (and globalThis.KeptEngine for the tests,
   which load this file into a vm context). */
(function (root) {
  'use strict';

  var MONTH_MS = 30.44 * 864e5;

  /* ------------------------------------------------------------ dates */
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parse(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00'); }
  function dim(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
  function addMonths(ym, n) {
    var p = ym.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1 + n, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function monthsBetween(a, b) { return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()); }
  /* "Sep 2026", never "Sept 26" — a two-digit year beside a month reads
     as a day of the month. */
  function monthShort(ym) {
    var d = new Date(ym + '-01T00:00:00');
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).replace(/^Sept\b/, 'Sep');
  }
  function monthLong(ym) { return new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); }

  /* ----------------------------------------------------------- dedupe */
  /* Same date + amount + description = the same transaction. Identical to
     txHash() on the server, so a preview can predict what will merge. */
  function hash(d, amountMinor, descr) {
    var s = String(d) + '|' + String(Math.round(Number(amountMinor) || 0)) + '|' + String(descr || '').slice(0, 60);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 't' + (h >>> 0).toString(36);
  }

  /* --------------------------------------------------------- classify */
  var LOAN_RX = /loan|emi|cc_|expensetoemi/i;
  var REFUND_RX = /cashback|refund|reversal|rebate/i;
  var SALARY_RX = /salary|payroll|wage/i;

  function normMerchant(s) {
    var t = String(s || '').toUpperCase().replace(/\s+/g, ' ')
      .replace(/\b(DUBAI|SHARJAH|ABU DHABI|RIYADH|JEDDAH|ARE|UAE|SAU|SA|AE|LLC|L\.L\.C)\b/g, '')
      .replace(/\d{4,}/g, '').replace(/[*#-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t || String(s || '').toUpperCase();
  }
  function classify(t) {
    var descr = String(t.descr || ''), cat = String(t.cat || ''), amt = Number(t.amount_minor) || 0;
    if (amt > 0) {
      if (LOAN_RX.test(descr) && !SALARY_RX.test(descr)) return 'borrowed';
      if (REFUND_RX.test(descr)) return 'refund';
      if (/income|salary/i.test(cat)) {
        if (SALARY_RX.test(descr) || /rent|bonus|freelance|dividend|interest|transfer from/i.test(descr)) return 'income';
        if (/[A-Z]{3,}.*(ARE|UAE|DUBAI|\.AE|\.COM)/i.test(descr) || amt < 15000) return 'refund';
        return 'income';
      }
      return 'refund';
    }
    if (/self transfer|transfer/i.test(cat)) return 'transfer';
    if (/investment|invest/i.test(cat) || /^SIP\b/i.test(descr)) return 'invest';
    if (/loan|emi/i.test(cat)) return LOAN_RX.test(descr) ? 'debtpay' : 'expense';
    return 'expense';
  }

  var FIXEDCATS = ['Rent', 'Utilities', 'Insurance', 'Internet', 'Mobile', 'Bills', 'School', 'Education', 'Loan'];
  var ESSCATS = ['Grocery', 'Groceries', 'Transport', 'Car', 'Fuel', 'Medicine', 'Health', 'Medical', 'Laundry', 'Salik'];
  function defaultCatClass(c) { return FIXEDCATS.indexOf(c) > -1 ? 'fixed' : ESSCATS.indexOf(c) > -1 ? 'ess' : 'disc'; }

  /* ------------------------------------------------------------ model */
  /* rows: [{id, d, descr, amount_minor, cat, remark}] — the live ledger.
     opts.today 'YYYY-MM-DD'. */
  function build(rows, opts) {
    opts = opts || {};
    var catClass = opts.catClass || defaultCatClass;
    var txns = rows.filter(function (r) { return r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.d || '')); }).map(function (r) {
      var t = { id: r.id, d: parse(r.d), ds: String(r.d).slice(0, 10), descr: String(r.descr || ''),
        amt: Math.round(Number(r.amount_minor) || 0), cat: r.cat || 'Misc', rem: r.remark || '',
        hash: r.hash || hash(r.d, r.amount_minor, r.descr), source: r.source || 'user' };
      t.month = t.ds.slice(0, 7);
      t.kind = classify({ descr: t.descr, cat: t.cat, amount_minor: t.amt });
      t.nm = normMerchant(t.descr);
      return t;
    });
    txns.sort(function (a, b) { return a.d - b.d; });
    var months = []; var seen = {};
    txns.forEach(function (t) { if (!seen[t.month]) { seen[t.month] = 1; months.push(t.month); } });
    months.sort();
    var cntBy = {}; txns.forEach(function (t) { cntBy[t.month] = (cntBy[t.month] || 0) + 1; });
    var counts = months.map(function (m) { return cntBy[m]; }).sort(function (a, b) { return a - b; });
    var med = counts[Math.floor(months.length / 2)] || 1;
    // The running month also counts as partial when it is the calendar month
    // we are in and today is not its last day — a thin month is not a trend.
    var todayYm = opts.today ? String(opts.today).slice(0, 7) : null;
    var last = months[months.length - 1];
    var lastPartial = !!last && (cntBy[last] < med * 0.4 || (todayYm === last && String(opts.today).slice(8, 10) !== String(dim(+last.slice(0, 4), +last.slice(5, 7) - 1))));
    var fullMonths = lastPartial ? months.slice(0, -1) : months;

    var per = {};
    months.forEach(function (m) { per[m] = { income: 0, borrowed: 0, refund: 0, spend: 0, debtpay: 0, invest: 0, byCat: {}, net: 0, n: cntBy[m] }; });
    txns.forEach(function (t) {
      var p = per[t.month];
      if (t.kind === 'income') p.income += t.amt;
      else if (t.kind === 'borrowed') p.borrowed += t.amt;
      else if (t.kind === 'refund') p.refund += t.amt;
      else if (t.kind === 'debtpay') p.debtpay += -t.amt;
      else if (t.kind === 'invest') p.invest += -t.amt;
      else if (t.kind === 'expense') { p.spend += -t.amt; p.byCat[t.cat] = (p.byCat[t.cat] || 0) + (-t.amt); }
    });
    // Kept = what came in, less living costs and loan payments. Money moved
    // into investments is still yours, so it counts as kept (shown as
    // "of which invested"); only spending and debt service leave for good.
    months.forEach(function (m) { var p = per[m]; p.net = p.income + p.refund - p.spend - p.debtpay; });

    var nFull = fullMonths.length || 1;
    var sum = function (k) { return fullMonths.reduce(function (a, m) { return a + per[m][k]; }, 0); };
    var avg = {};
    ['income', 'borrowed', 'refund', 'spend', 'debtpay', 'invest'].forEach(function (k) { avg[k] = Math.round(sum(k) / nFull); });
    avg.net = avg.income + avg.refund - avg.spend - avg.debtpay;
    avg.out = avg.spend + avg.debtpay + avg.invest;
    // Loans added after the record started have no history of payments
    // yet; the caller passes what they cost per month so projections
    // include them from day one.
    var emiMonthly = Math.round(Number(opts.emiMonthly) || 0);
    var extraDebt = Math.max(0, emiMonthly - avg.debtpay);

    var catTotal = {};
    txns.forEach(function (t) { if (t.kind === 'expense' && fullMonths.indexOf(t.month) > -1) catTotal[t.cat] = (catTotal[t.cat] || 0) + (-t.amt); });

    var merch = {};
    txns.forEach(function (t) {
      if (t.kind !== 'expense') return;
      var k = t.nm;
      merch[k] = merch[k] || { name: k, n: 0, sum: 0, cat: t.cat, months: {} };
      merch[k].n++; merch[k].sum += -t.amt; merch[k].months[t.month] = 1;
    });
    var recurring = Object.keys(merch).map(function (k) { var v = merch[k]; var mN = Object.keys(v.months).length;
      return { name: k, monthsN: mN, perMonth: Math.round(v.sum / mN), total: v.sum, n: v.n, cat: v.cat }; })
      .filter(function (v) { return v.monthsN >= 3 && v.perMonth >= 800; })
      .sort(function (a, b) { return b.perMonth - a.perMonth; });

    var small = txns.filter(function (t) { return t.kind === 'expense' && -t.amt <= 2500; });
    var smallByM = {}; fullMonths.forEach(function (m) { smallByM[m] = 0; });
    small.forEach(function (t) { if (smallByM[t.month] != null) smallByM[t.month] += -t.amt; });

    var salDates = txns.filter(function (t) { return t.kind === 'income' && SALARY_RX.test(t.descr); }).map(function (t) { return t.d.getTime(); });
    var postSal = 0;
    txns.forEach(function (t) { if (t.kind === 'expense' && salDates.some(function (s) { return t.d.getTime() >= s && t.d.getTime() < s + 3 * 864e5; })) postSal += -t.amt; });
    var dailyAvgSpend = sum('spend') / (fullMonths.length * 30.44 || 1);
    var postSalDaily = postSal / (salDates.length * 3 || 1);

    var totalSpend = sum('spend');
    var cashKeptRate = avg.income > 0 ? Math.max(0, avg.net / avg.income * 100) : 0;
    var debtBurden = avg.income > 0 ? avg.debtpay / avg.income * 100 : 0;
    var borrowShare = (avg.income + avg.borrowed) > 0 ? avg.borrowed / (avg.income + avg.borrowed) * 100 : 0;
    var smallSum = 0; fullMonths.forEach(function (m) { smallSum += smallByM[m]; });
    var smallShare = totalSpend > 0 ? smallSum / totalSpend * 100 : 0;
    var nets = fullMonths.map(function (m) { return per[m].net; });
    var meanNet = nets.reduce(function (a, b) { return a + b; }, 0) / (nets.length || 1);
    var sd = Math.sqrt(nets.reduce(function (a, b) { return a + (b - meanNet) * (b - meanNet); }, 0) / (nets.length || 1));
    var stability = avg.income > 0 ? Math.max(0, 100 - sd / avg.income * 100) : 0;
    var cumNet = nets.reduce(function (a, b) { return a + b; }, 0);
    var bufferMonths = (avg.spend + avg.debtpay) > 0 ? Math.max(0, cumNet) / (avg.spend + avg.debtpay) : 0;
    var investRate = avg.income > 0 ? avg.invest / avg.income * 100 : 0;

    var factors = [
      { name: 'Savings rate', w: 25, val: Math.min(100, cashKeptRate / 25 * 100), disp: pct(cashKeptRate),
        why: cashKeptRate >= 20 ? 'Strong — protect it.' : cashKeptRate >= 10 ? 'Below the 20% target.' : 'Critically low — the core problem.' },
      { name: 'Debt burden', w: 20, val: Math.max(0, 100 - debtBurden / 45 * 100), disp: pct(debtBurden) + ' of income',
        why: debtBurden < 15 ? 'Manageable.' : debtBurden < 30 ? 'Heavy — every extra payment counts.' : 'Severe — this is eating your salary.' },
      { name: 'Borrowing habit', w: 15, val: Math.max(0, 100 - borrowShare / 30 * 100), disp: pct(borrowShare) + ' of inflow',
        why: borrowShare < 3 ? 'Clean.' : 'Part of your income was new loans.' },
      { name: 'Impulse spending', w: 15, val: Math.max(0, 100 - smallShare / 20 * 100), disp: pct(smallShare) + ' in small buys',
        why: smallShare < 7 ? 'Controlled.' : 'Death by a thousand taps.' },
      { name: 'Cash-flow stability', w: 15, val: stability, disp: '±' + Math.round(sd / 100).toLocaleString() + '/mo',
        why: stability > 70 ? 'Predictable.' : 'Swings make planning impossible.' },
      { name: 'Investing', w: 10, val: Math.min(100, investRate / 10 * 100), disp: pct(investRate) + ' of income',
        why: investRate >= 5 ? 'Building.' : 'Almost nothing is working for you.' }
    ];
    var score = Math.round(factors.reduce(function (a, f) { return a + f.val * f.w; }, 0) / 100);

    var last3 = fullMonths.slice(-3);
    var ma = function (k) { return last3.reduce(function (a, m) { return a + per[m][k]; }, 0) / (last3.length || 1); };
    var fc = { income: Math.round(ma('income') + ma('refund')), out: Math.round(ma('spend') + ma('debtpay') + ma('invest') + extraDebt), extraDebt: extraDebt };
    fc.net = fc.income - fc.out;
    // Money per working hour, for showing a purchase as time at work.
    var hourly = avg.income > 0 ? avg.income / (22 * 8) : 0;

    var tot = function (kind, sign) { return txns.filter(function (t) { return t.kind === kind; }).reduce(function (a, t) { return a + sign * t.amt; }, 0); };
    return {
      txns: txns, months: months, fullMonths: fullMonths, lastPartial: lastPartial, per: per, avg: avg, sum: sum,
      catTotal: catTotal, catClass: catClass, merch: merch, recurring: recurring, small: small, smallByM: smallByM,
      postSalDaily: postSalDaily, dailyAvgSpend: dailyAvgSpend,
      factors: factors, score: score, cashKeptRate: cashKeptRate, debtBurden: debtBurden, borrowShare: borrowShare,
      emiMonthly: emiMonthly, extraDebt: extraDebt, hourly: hourly,
      smallShare: smallShare, stability: stability, bufferMonths: bufferMonths, cumNet: cumNet, sd: sd, fc: fc,
      totalBorrowed: tot('borrowed', 1), totalIncome: tot('income', 1), totalRefund: tot('refund', 1),
      totalSpend: tot('expense', -1), totalDebtpay: tot('debtpay', -1), totalInvest: tot('invest', -1)
    };
  }
  function pct(n) { return (Math.round(n * 10) / 10) + '%'; }

  /* ------------------------------------------------- the running month */
  /* "Where do I stand this month": the Home hero numbers. target_bp is the
     profile's target keep-rate. */
  /* committed = { debt, other }: what is still due this month and not yet
     in the record (EMIs on later due days, recurring rules), from
     upcoming(). Everything "projected" assumes the usual pace for the days
     left, on top of what is committed. */
  function monthStatus(M, targetBp, today, committed) {
    if (!M || !M.months.length) return null;
    committed = committed || { debt: 0, other: 0 };
    var now = parse(today), nowYM = String(today).slice(0, 7);
    var cur = M.months[M.months.length - 1];
    var live = cur === nowYM;
    var p = M.per[cur];
    var day = live ? Math.max(1, now.getDate()) : 30;
    var dimN = dim(now.getFullYear(), now.getMonth());
    var inn = p.income + p.refund, out = p.spend + p.debtpay + p.invest;
    var keptNow = inn - p.spend - p.debtpay;                 // investing counts as kept
    var pace = Math.round(M.avg.out * day / 30.44);
    var usualIn = M.avg.income + M.avg.refund;
    var salaryIn = inn >= Math.max(1, usualIn * 0.4);
    var rate = salaryIn && inn > 0 ? Math.max(-100, Math.min(100, keptNow / inn * 100)) : null;
    var target = targetBp / 100;
    var left = Math.max(0, dimN - day);
    var spendPace = Math.round(M.avg.spend * day / 30.44), spendDelta = p.spend - spendPace;
    // The month, finished at the usual pace: what is still committed, plus
    // the usual daily spending for the days left.
    var restSpend = live ? Math.round(M.avg.spend * left / 30.44) : 0;
    var commit = live ? (committed.debt || 0) + (committed.other || 0) : 0;
    var expectIn = salaryIn ? inn : Math.max(inn, usualIn);
    var projKept = expectIn - p.spend - p.debtpay - commit - restSpend;
    var projRate = expectIn > 0 ? Math.max(-100, Math.min(100, projKept / expectIn * 100)) : null;
    // Safe to spend: what may still go on living, after the committed
    // bills and the share you have promised to keep.
    var reserve = Math.round(expectIn * target / 100);
    var safe = Math.max(0, expectIn - p.spend - p.debtpay - commit - reserve);
    var allowance = Math.round(Math.max(0, inn * (1 - target / 100) - out));
    return {
      month: cur, live: live, day: day, dim: dimN, left: left, inn: inn, out: out, keptNow: keptNow, pace: pace,
      salaryIn: salaryIn, rate: rate, target: target, spendPace: spendPace, spendDelta: spendDelta,
      onTarget: projRate != null && projRate >= target, gap: projRate == null ? 0 : Math.round(expectIn * target / 100 - projKept),
      allowance: allowance, perDay: left > 0 ? Math.round(allowance / left) : 0,
      committed: commit, committedDebt: committed.debt || 0, committedOther: committed.other || 0,
      expectIn: expectIn, assumedIncome: !salaryIn, restSpend: restSpend,
      projKept: projKept, projRate: projRate, reserve: reserve,
      safe: safe, safePerDay: left > 0 ? Math.round(safe / (left + 1)) : safe,
      ringP: projRate == null ? Math.min(1, out / Math.max(1, M.avg.out)) : Math.max(0, Math.min(1, projRate / 100)),
      usualPct: Math.round(out / Math.max(1, M.avg.out) * 100), spend: p.spend, debtpay: p.debtpay, invest: p.invest,
      byCat: p.byCat, prevByCat: M.months.length > 1 ? M.per[M.months[M.months.length - 2]].byCat : null
    };
  }

  /* What is still due in the running month, from the upcoming list. */
  function committedThisMonth(emis, rules, today) {
    var ym = String(today).slice(0, 7), d = parse(today);
    var left = dim(d.getFullYear(), d.getMonth()) - d.getDate();
    var items = upcoming(emis, rules, left, today).filter(function (x) { return x.d.slice(0, 7) === ym && x.d > String(today).slice(0, 10) && x.amount_minor < 0; });
    var debt = 0, other = 0;
    items.forEach(function (x) { if (x.kind === 'emi' || /loan|emi/i.test(x.cat || '')) debt += -x.amount_minor; else other += -x.amount_minor; });
    return { debt: debt, other: other, items: items };
  }

  /* A sum of money as time at work: 2,100 at 18,500/month ≈ 2.5 days. */
  function timeCost(amountMinor, M) {
    if (!M || !(M.hourly > 0)) return null;
    var h = Math.abs(amountMinor) / M.hourly;
    if (h < 1 / 60) return null;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
    if (h < 8) { var hh = Math.floor(h), mm = Math.round((h - hh) * 60); return hh + 'h' + (mm ? ' ' + mm + 'm' : ''); }
    var days = h / 8;
    if (days < 22) return (Math.round(days * 10) / 10) + ' day' + (days >= 1.95 ? 's' : '') + ' of work';
    return (Math.round(days / 22 * 10) / 10) + ' months of work';
  }

  /* The last seven days against the seven before: spend, top category,
     and how many of the seven you logged anything at all. */
  function weekSummary(rows, today) {
    var end = parse(today), start = new Date(end.getTime() - 6 * 864e5), prevStart = new Date(end.getTime() - 13 * 864e5);
    var s = iso(start), ps = iso(prevStart), e = iso(end);
    var cur = 0, prev = 0, byCat = {}, days = {};
    rows.forEach(function (r) {
      var k = r.kind || classify(r);
      if (r.d >= s && r.d <= e) {
        days[r.d] = true;
        if (k === 'expense') { cur += -r.amount_minor; byCat[r.cat] = (byCat[r.cat] || 0) + (-r.amount_minor); }
      } else if (r.d >= ps && r.d < s && k === 'expense') prev += -r.amount_minor;
    });
    var top = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })[0] || null;
    return { cur: cur, prev: prev, delta: cur - prev, top: top, topAmt: top ? byCat[top] : 0, daysLogged: Object.keys(days).length };
  }

  /* One idea a day, computed from the person's own numbers. The lesson is
     the point of the app: numbers people have seen in their own money
     stick; definitions do not. */
  function lesson(M, prof, emis, today, sumsHeld) {
    if (!M) return null;
    var a = M.avg, inc = a.income + a.refund, fmt = function (n) { return fmtMoney(n, prof && prof.currency); };
    var list = [];
    var topCat = Object.keys(M.catTotal || {}).sort(function (x, y) { return M.catTotal[y] - M.catTotal[x]; })[0];
    var monthlyOut = a.spend + a.debtpay;
    if (monthlyOut > 0) list.push({
      k: 'emergency', title: 'Emergency fund', lead: 'Three months of your outgoings is ' + fmt(monthlyOut * 3) + '.',
      body: 'That is the cushion that turns a job loss or a hospital bill into an inconvenience instead of a loan. At your current keep-rate of ' + pct(M.cashKeptRate) + ' it takes ' + (a.net > 0 ? Math.ceil(monthlyOut * 3 / a.net) + ' months' : 'longer than the record can see') + ' to build from zero.',
      why: 'Why it matters: without it, every surprise is paid for with debt, and debt is paid for with interest.' });
    if (topCat && M.catTotal[topCat] > 0) {
      var perMonth = M.catTotal[topCat] / (M.fullMonths.length || 1);
      list.push({ k: 'latte', title: 'The small-leak rule', lead: esc(topCat) + ' runs about ' + fmt(perMonth) + ' a month — ' + fmt(perMonth * 12) + ' a year.',
        body: 'Trimming it by a fifth is ' + fmt(perMonth * 0.2 * 12) + ' a year, with no change to how you live. Repeated habits are where the money actually is; one-off splurges are rarer than they feel.',
        why: 'Why it matters: a cut repeats itself every month without effort; a raise does not.' });
    }
    if (inc > 0) list.push({ k: 'keeprate', title: 'Keep-rate', lead: 'Of every ' + fmt(10000) + ' you earn, ' + fmt(Math.round(100 * M.cashKeptRate)) + ' stays yours.',
      body: 'Keep-rate is the one number that decides your future, more than income. Someone keeping 20% of ' + fmt(1500000) + ' builds wealth faster than someone keeping 5% of ' + fmt(3000000) + '.',
      why: 'Why it matters: raising it from ' + Math.round(M.cashKeptRate) + '% to ' + Math.max(20, Math.round(M.cashKeptRate) + 5) + '% is worth ' + fmt(Math.round(inc * (Math.max(20, Math.round(M.cashKeptRate) + 5) - M.cashKeptRate) / 100 * 12)) + ' a year.' });
    var withApr = (emis || []).filter(function (e) { return e.apr_bp > 0 && !e.deleted_at; });
    if (withApr.length) {
      var e0 = withApr.sort(function (x, y) { return y.apr_bp - x.apr_bp; })[0];
      var yearly = Math.round(e0.emi_minor * 12 * (e0.apr_bp / 10000) / 2);   // rough: interest on the declining balance
      list.push({ k: 'interest', title: 'What a loan really costs', lead: esc(e0.name) + ' charges about ' + fmt(yearly) + ' a year in interest at ' + (e0.apr_bp / 100) + '%.',
        body: 'Interest buys nothing — it is the price of having the money earlier. Paying extra on the highest-rate loan first (the "avalanche") is the only guaranteed return you can get at that rate.',
        why: 'Why it matters: every ' + fmt(50000) + ' paid early on this loan saves roughly ' + fmt(Math.round(50000 * e0.apr_bp / 10000)) + ' a year, for every year left.' });
    }
    if (a.net > 0) {
      var yrs = 10, r = 0.07 / 12, n = yrs * 12, fv = a.net * ((Math.pow(1 + r, n) - 1) / r);
      list.push({ k: 'compound', title: 'Compounding', lead: fmt(a.net) + ' a month, kept and invested at 7%, is ' + fmt(Math.round(fv)) + ' in ten years.',
        body: 'You would have put in ' + fmt(a.net * 120) + '; the rest is growth on growth. The first years feel slow; the last years do most of the work.',
        why: 'Why it matters: time is the ingredient you cannot buy later. Starting a year sooner is worth more than starting with more.' });
    }
    if (a.spend > 0 && M.hourly > 0) list.push({ k: 'time', title: 'Money is time', lead: 'An hour of your work is worth about ' + fmt(Math.round(M.hourly)) + '.',
      body: 'Your average month of spending is ' + timeCost(a.spend, M) + '. Seeing a price as hours at your desk is the quickest honest test of whether something is worth it.',
      why: 'Why it matters: prices are abstract; your time is not.' });
    if (!list.length) return null;
    var doy = Math.floor((parse(today) - new Date(parse(today).getFullYear(), 0, 1)) / 864e5);
    return list[doy % list.length];
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtMoney(minor, cur) {
    var n = Math.round((Number(minor) || 0) / 100);
    var s = Math.abs(n).toLocaleString('en-GB');
    return (n < 0 ? '−' : '') + (cur ? cur + ' ' : '') + s;
  }

  /* ------------------------------------------------------- the path */
  /* Reach the target keep-rate within ramp months of the baseline month.
     base = {m, rate} (percent) stored in the profile; null → caller stores
     the returned one. Guards: a month without a credible salary is never
     scored; month-to-date uses the calendar day, not the last row. */
  function pathStatus(M, prof, base, today) {
    if (!M || !M.fullMonths.length) return null;
    var targetRate = prof.target_keep_bp / 100, ramp = prof.ramp_months || 6;
    var avgInc = M.avg.income + M.avg.refund;
    var incOf = function (m) { var q = M.per[m]; return q ? q.income + q.refund : 0; };
    var cands = M.fullMonths.slice().reverse();
    var lm = null;
    for (var i = 0; i < cands.length; i++) if (incOf(cands[i]) >= Math.max(1, avgInc * 0.4)) { lm = cands[i]; break; }
    var skipped = lm ? cands.indexOf(lm) : cands.length;
    var newBase = false;
    if (!base || !M.per[base.m]) { base = { m: M.fullMonths[0], rate: Math.max(0, Math.min(100, M.cashKeptRate)) }; newBase = true; }
    var mtd = null;
    var cur = M.months[M.months.length - 1];
    if (M.lastPartial && cur) {
      var now = parse(today), sameMonth = cur === String(today).slice(0, 7);
      var day = sameMonth ? Math.max(1, now.getDate()) : 30;
      var p = M.per[cur], spent = p.spend + p.debtpay + p.invest;
      var budget = Math.round(M.avg.out * day / 30.44);
      mtd = { day: day, spent: spent, budget: budget, delta: spent - budget, sameMonth: sameMonth };
    }
    if (!lm) return { ok: null, cls: 'warn', lm: null, mtd: mtd, base: base, newBase: newBase, skipped: skipped, latest: cands[0] || null };
    var dm = Math.max(0, Math.round(monthsBetween(parse(base.m + '-01'), parse(lm + '-01'))));
    var should = Math.min(targetRate, base.rate + (targetRate - base.rate) * dm / ramp);
    var pm = M.per[lm], inc = incOf(lm);
    var raw = inc > 0 ? pm.net / inc * 100 : 0;
    var actual = Math.max(-100, Math.min(100, raw));
    var diff = actual - should;
    var amt = Math.round(Math.abs(diff) / 100 * inc);
    var ok = diff >= -2;
    return { ok: ok, should: should, actual: actual, diff: diff, amt: amt, lm: lm, mtd: mtd, base: base, newBase: newBase,
      skipped: skipped, cls: ok ? (diff >= 0 ? 'ok' : 'warn') : 'bad' };
  }

  /* ------------------------------------------------------ projections */
  function mval(p, met) {
    if (!p) return null;
    return met === 'inc' ? p.income + p.refund : met === 'kept' ? p.net : p.spend + p.debtpay + p.invest;
  }
  /* Half recent 3-month run-rate, half same-month-last-year when it exists. */
  function projNext(M, k) {
    var last = M.months[M.months.length - 1], out = [];
    var l3 = M.fullMonths.slice(-3);
    var ra = function (key) { return l3.reduce(function (a, m) { return a + mval(M.per[m], key); }, 0) / (l3.length || 1); };
    for (var i = 1; i <= k; i++) {
      var mm = addMonths(last, i), ly = addMonths(mm, -12), pLY = M.per[ly];
      var o = { m: mm, proj: true };
      ['out', 'inc', 'kept'].forEach(function (key) {
        var r = ra(key), s = pLY ? mval(pLY, key) : null;
        o[key] = Math.round(s != null ? 0.5 * r + 0.5 * s : r);
      });
      if (M.extraDebt) { o.out += M.extraDebt; o.kept -= M.extraDebt; }
      o.seasonal = pLY && mval(pLY, 'out') > M.avg.out ? mval(pLY, 'out') : null;
      if (pLY) { var cats = Object.keys(pLY.byCat).sort(function (a, b) { return pLY.byCat[b] - pLY.byCat[a]; }); o.driver = cats[0] || null; o.driverAmt = cats[0] ? pLY.byCat[cats[0]] : 0; }
      out.push(o);
    }
    return out;
  }
  function cautions(M) {
    var avgOut = M.avg.out, list = [];
    projNext(M, 3).forEach(function (p) {
      if (p.seasonal && p.seasonal > avgOut * 1.15) list.push({ sev: p.seasonal > avgOut * 1.5 ? 'High' : 'Medium', kind: 'seasonal', m: p.m, amt: p.seasonal, driver: p.driver, driverAmt: p.driverAmt, cap: Math.round(avgOut * 1.05) });
    });
    var nM3 = M.fullMonths.slice(-3);
    Object.keys(M.catTotal).forEach(function (c) {
      var all = M.catTotal[c] / (M.fullMonths.length || 1);
      var rec = nM3.reduce(function (a, m) { return a + (M.per[m].byCat[c] || 0); }, 0) / (nM3.length || 1);
      if (rec > all * 1.35 && rec - all >= 10000) list.push({ sev: 'Medium', kind: 'trend', cat: c, rec: Math.round(rec), all: Math.round(all) });
    });
    var surge = M.dailyAvgSpend ? M.postSalDaily / M.dailyAvgSpend : 1;
    if (surge >= 1.15) list.push({ sev: 'Medium', kind: 'surge', x: Math.round(surge * 10) / 10 });
    if (M.borrowShare > 0) list.push({ sev: 'High', kind: 'borrow', share: M.borrowShare });
    return list.sort(function (a, b) { return (a.sev === 'High' ? 0 : 1) - (b.sev === 'High' ? 0 : 1); });
  }

  /* --------------------------------------------------------- CFO view */
  function pl(M) {
    var nM = M.fullMonths.length || 1, g = function (k) { return M.sum(k) / nM; };
    var F = 0, E = 0;
    Object.keys(M.catTotal).forEach(function (c) { var cl = M.catClass(c); if (cl === 'fixed') F += M.catTotal[c]; else if (cl === 'ess') E += M.catTotal[c]; });
    F = Math.round(F / nM); E = Math.round(E / nM);
    var rev = Math.round(g('income') + g('refund')), spend = Math.round(g('spend')), D = Math.max(0, spend - F - E);
    var op = rev - spend, P = Math.round(g('debtpay')), I = Math.round(g('invest')), net = op - P - I;
    return { rev: rev, F: F, E: E, D: D, spend: spend, op: op, opM: rev ? op / rev * 100 : 0, P: P, I: I, net: net, netM: rev ? net / rev * 100 : 0 };
  }
  function cashflow(M) {
    var op = M.totalIncome + M.totalRefund - M.totalSpend;
    var fin = M.totalBorrowed - M.totalDebtpay;
    var inv = -M.totalInvest;
    return { op: op, borrowedIn: M.totalBorrowed, repaid: M.totalDebtpay, fin: fin, inv: inv, net: op + fin + inv };
  }
  function breakeven(M) {
    var p = pl(M), committed = p.F + p.P;
    var day = p.rev > 0 ? Math.min(31, Math.ceil(committed / (p.rev / 30.44))) : 31;
    return { committed: committed, share: p.rev ? committed / p.rev * 100 : 0, day: day, p: p };
  }
  function fees(M) {
    var tot = 0, n = 0;
    M.txns.forEach(function (t) {
      if (t.kind === 'income' || t.amt >= 0) return;
      if (/education|school|rent|utilit|insurance|loan/i.test(t.cat || '') || /school|tuition|college|university|nursery|visa|licen[cs]e|rent/i.test(t.descr)) return;
      if (/\bfees?\b|vat on|interest|finance charge|late payment|penalty/i.test(t.descr)) { tot += -t.amt; n++; }
    });
    return { tot: tot, n: n };
  }
  function controls(M) {
    var lm = M.fullMonths[M.fullMonths.length - 1];
    var tx = M.txns.filter(function (t) { return t.month === lm; });
    var disc = tx.filter(function (t) { return t.kind === 'expense' && M.catClass(t.cat) === 'disc'; });
    var big = disc.filter(function (t) { return -t.amt >= 10000; }).length;
    var micro = tx.filter(function (t) { return t.kind === 'expense' && -t.amt <= 2500; }).length;
    var borrowed = tx.filter(function (t) { return t.kind === 'borrowed'; }).reduce(function (a, t) { return a + t.amt; }, 0);
    var invested = tx.filter(function (t) { return t.kind === 'invest'; }).reduce(function (a, t) { return a - t.amt; }, 0);
    var discSpend = disc.reduce(function (a, t) { return a - t.amt; }, 0);
    var p = pl(M);
    return { lm: lm, rules: [
      { r: 'Purchases of 100+ in want-categories need a 24-hour approval', tgt: '≤ 3 unplanned', act: big + ' purchases', ok: big <= 3 },
      { r: 'Micro-purchases (≤ 25) capped like petty cash', tgt: '≤ 30 / month', act: micro + ' purchases', ok: micro <= 30 },
      { r: 'Discretionary spend inside its envelope', tgt: p.D, act: discSpend, ok: discSpend <= p.D * 1.05, money: true },
      { r: 'Zero new borrowing — expenses are never financed', tgt: 0, act: borrowed, ok: borrowed <= 0, money: true },
      { r: 'Pay-yourself-first transfer leaves on salary day', tgt: 1, act: invested, ok: invested > 0, money: true }
    ] };
  }
  /* Default envelopes from the user's own history: discretionary 80% of
     average, essential 95%, fixed 100%, rounded to the nearest 10 units. */
  function budgetDefaults(M) {
    var nM = M.fullMonths.length || 1, out = {};
    Object.keys(M.catTotal).sort(function (a, b) { return M.catTotal[b] - M.catTotal[a]; }).slice(0, 10).forEach(function (c) {
      var avg = M.catTotal[c] / nM, cl = M.catClass(c);
      out[c] = Math.max(1000, Math.round((cl === 'disc' ? avg * 0.8 : cl === 'ess' ? avg * 0.95 : avg) / 1000) * 1000);
    });
    return out;
  }
  function yearOutlook(M, year) {
    var last = M.months[M.months.length - 1];
    var y = year || last.slice(0, 4);
    var lastIdx = +last.slice(5) - 1;
    var pj = last.slice(0, 4) === y && (11 - lastIdx) > 0 ? projNext(M, 11 - lastIdx) : [];
    var be = breakeven(M), rows = [];
    for (var i = 0; i < 12; i++) {
      var key = y + '-' + String(i + 1).padStart(2, '0'), p = M.per[key];
      if (p) {
        var F = p.debtpay; Object.keys(p.byCat).forEach(function (c) { if (M.catClass(c) === 'fixed') F += p.byCat[c]; });
        rows.push({ m: key, i: i, inn: mval(p, 'inc'), out: mval(p, 'out'), F: F, kept: p.net, status: key === last && M.lastPartial ? 'running' : 'closed' });
      } else if (key > last) {
        var pr = pj.filter(function (x) { return x.m === key; })[0];
        if (pr) rows.push({ m: key, i: i, inn: pr.inc, out: pr.out, F: Math.min(be.committed, pr.out), kept: pr.kept, status: 'projected' });
      }
    }
    return { y: y, rows: rows, committed: be.committed };
  }

  /* --------------------------------------------------------- risks */
  function risks(M) {
    var out = [];
    var R = function (sev, name, why) { out.push({ sev: sev, name: name, why: why }); };
    if (M.cashKeptRate < 10) R(4, 'Savings rate below 10%', 'One bad month wipes out several good ones. This is the root risk behind everything else.');
    if (M.bufferMonths < 2) R(4, 'Emergency buffer under 2 months', 'A car repair or medical bill goes straight onto a credit card — restarting the debt loop.');
    if (M.debtBurden > 25) R(3, 'Debt burden above 25% of income', 'EMIs crowd out saving and investing.');
    if (M.borrowShare > 5) R(3, 'Borrow-to-spend pattern', 'New loans were taken during the period. Borrowing to fund lifestyle compounds against you.');
    if (M.sd > M.avg.income * 0.5) R(2, 'Volatile cash flow', 'Monthly net swings widely — budgeting by feel fails at this volatility.');
    if (M.smallShare > 10) R(2, 'Impulse micro-spending', 'Small buys are ' + pct(M.smallShare) + ' of spending — the leak with the least memory.');
    if (M.totalInvest < M.avg.income) R(2, 'Nothing working for you', 'Total invested is under one month\'s income. Inflation quietly taxes idle cash.');
    return out.sort(function (a, b) { return b.sev - a.sev; });
  }
  function anomalies(M) {
    var exp = M.txns.filter(function (t) { return t.kind === 'expense'; });
    var mean = exp.reduce(function (a, t) { return a - t.amt; }, 0) / (exp.length || 1);
    var sd2 = Math.sqrt(exp.reduce(function (a, t) { return a + ((-t.amt) - mean) * ((-t.amt) - mean); }, 0) / (exp.length || 1));
    return exp.filter(function (t) { return -t.amt > mean + 4 * sd2; }).sort(function (a, b) { return a.amt - b.amt; }).slice(0, 6);
  }

  /* ----------------------------------------------------------- EMIs */
  var LOANISH = /loan|emi|instal|cc_|credit card|finance|mortgage/i;
  /* The k-th due date: start month + k, on the due day (clamped). */
  function emiDueDate(e, k) {
    var p = String(e.start_month).split('-').map(Number);
    var d = new Date(p[0], (p[1] - 1) + k, 1);
    d.setDate(Math.min(+e.due_day || 1, dim(d.getFullYear(), d.getMonth())));
    return d;
  }
  /* A payment for this EMI in month ym: the row Kept posted, or a
     loan-looking row of the same amount (an uploaded statement line). */
  function emiPaymentIn(e, ym, rows) {
    var emi = +e.emi_minor || 0, tol = Math.max(100, Math.round(emi * 0.01)), hit = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (String(r.d).slice(0, 7) !== ym) continue;
      if (String(r.remark || '') === 'emi:' + e.id) return r;
      if (r.amount_minor < 0 && Math.abs(-r.amount_minor - emi) <= tol && (LOANISH.test(r.descr) || /loan|emi/i.test(r.cat || ''))) hit = hit || r;
    }
    return hit;
  }
  function emiDerive(e, rows, today) {
    var now = parse(today), total = Math.max(1, Math.round(+e.total_n || 1)), emi = +e.emi_minor || 0;
    var done = 0, next = null, last = null, thisDue = null, ym = String(today).slice(0, 7);
    for (var k = 0; k < total; k++) {
      var d = emiDueDate(e, k);
      if (iso(d).slice(0, 7) === ym) thisDue = d;
      if (d <= now) { done++; last = d; } else if (!next) next = d;
    }
    var left = total - done, end = emiDueDate(e, total - 1);
    var r = (+e.apr_bp || 0) / 10000 / 12;
    var principal = r > 0 ? emi * (1 - Math.pow(1 + r, -left)) / r : emi * left;
    var pay = thisDue ? emiPaymentIn(e, ym, rows || []) : null;
    var status, cls, daysTo = null;
    if (left <= 0) { status = 'finished'; cls = 'ok'; }
    else if (!thisDue) { status = next ? 'starts ' + next.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'no instalment this month'; cls = 'info'; }
    else if (pay) { status = 'paid this month'; cls = 'ok'; }
    else if (thisDue > now) { daysTo = Math.round((thisDue - now) / 864e5); status = daysTo === 0 ? 'due today' : 'due in ' + daysTo + ' day' + (daysTo === 1 ? '' : 's'); cls = daysTo <= 3 ? 'warn' : 'info'; }
    else { var n = Math.round((now - thisDue) / 864e5); status = 'not recorded — was due ' + n + ' day' + (n === 1 ? '' : 's') + ' ago'; cls = 'bad'; }
    return { total: total, done: done, left: left, emi: emi, end: end, endYm: iso(end).slice(0, 7), next: next, last: last, thisDue: thisDue, pay: pay,
      status: status, cls: cls, progress: total ? done / total : 0, remaining: emi * left, paidAmt: emi * done,
      principal: Math.round(principal), hasApr: (+e.apr_bp || 0) > 0, daysTo: daysTo };
  }
  /* EMI load per month for the next n months, with the months where something ends. */
  function emiTimeline(emis, rows, n, today) {
    n = n || 36;
    var now = parse(today), base = new Date(now.getFullYear(), now.getMonth(), 1);
    var es = emis.map(function (e) { return { e: e, d: emiDerive(e, rows, today) }; }).filter(function (x) { return x.d.left > 0; });
    var months = [];
    for (var i = 0; i < n; i++) {
      var m = new Date(base.getFullYear(), base.getMonth() + i, 1), ym = iso(m).slice(0, 7);
      var load = 0, ends = [];
      es.forEach(function (x) {
        var k0 = monthsBetween(emiDueDate(x.e, 0), m);
        if (k0 >= 0 && k0 < x.d.total) { load += x.d.emi; if (k0 === x.d.total - 1) ends.push(x.e); }
      });
      months.push({ ym: ym, m: m, load: load, ends: ends });
    }
    return months;
  }
  function emiSummary(emis, rows, today) {
    var es = emis.map(function (e, i) { return { e: e, d: emiDerive(e, rows, today), i: i }; }).filter(function (x) { return x.d.left > 0; });
    if (!es.length) return null;
    var monthly = es.reduce(function (a, x) { return a + x.d.emi; }, 0), remaining = es.reduce(function (a, x) { return a + x.d.remaining; }, 0);
    var paidAmt = es.reduce(function (a, x) { return a + x.d.paidAmt; }, 0);
    var end = es.reduce(function (a, x) { return x.d.end > a ? x.d.end : a; }, es[0].d.end);
    var nextEnd = es.slice().sort(function (a, b) { return a.d.end - b.d.end; })[0];
    var due = es.filter(function (x) { return x.d.thisDue && !x.d.pay; }).sort(function (a, b) { return a.d.thisDue - b.d.thisDue; })[0] || null;
    var paid = es.filter(function (x) { return x.d.pay; }).length, dueN = es.filter(function (x) { return x.d.thisDue; }).length;
    return { n: es.length, monthly: monthly, remaining: remaining, paidAmt: paidAmt, end: end, endYm: iso(end).slice(0, 7),
      monthsLeft: monthsBetween(parse(today), end) + 1, nextEnd: nextEnd, due: due, paid: paid, dueN: dueN, items: es,
      unrecorded: es.filter(function (x) { return x.d.cls === 'bad'; }) };
  }
  /* Loans for the payoff simulation, from the user's EMI records. */
  function loansFromEmis(emis, rows, today) {
    return emis.map(function (e) { var d = emiDerive(e, rows, today); if (d.left <= 0) return null;
      return { id: e.id, name: e.name, emi: d.emi, balance: d.principal, apr: (+e.apr_bp || 0) / 100, aprEst: !d.hasApr, left: d.left }; }).filter(Boolean);
  }
  /* Snowball vs avalanche. extra = minor units per month on top of minimums. */
  function simulate(loans, extra, strategy) {
    var L = loans.map(function (l) { return { id: l.id, apr: l.apr, bal: l.balance, minPay: l.emi > 0 ? l.emi : Math.max(10000, l.balance * 0.03) }; });
    var month = 0, interest = 0, series = [L.reduce(function (a, l) { return a + l.bal; }, 0)], killed = [];
    while (L.some(function (l) { return l.bal > 0; }) && month < 240) {
      month++;
      L.forEach(function (l) { if (l.bal > 0) { var i = l.bal * (l.apr / 100 / 12); l.bal += i; interest += i; } });
      L.forEach(function (l) { if (l.bal > 0) { l.bal -= Math.min(l.minPay, l.bal); } });
      var ex = extra;
      var order = L.filter(function (l) { return l.bal > 0; }).sort(strategy === 'snow' ? function (a, b) { return a.bal - b.bal; } : function (a, b) { return b.apr - a.apr; });
      for (var j = 0; j < order.length && ex > 0; j++) { var p = Math.min(ex, order[j].bal); order[j].bal -= p; ex -= p; }
      L.forEach(function (l) { if (l.bal <= 50) { if (killed.indexOf(l.id) < 0) killed.push(l.id); l.bal = 0; } });
      series.push(Math.round(L.reduce(function (a, l) { return a + l.bal; }, 0)));
    }
    return { months: month, interest: Math.round(interest), series: series, killed: killed };
  }

  /* ------------------------------------------------------- recurring */
  function stepDate(d, freq) {
    var n = new Date(d.getTime());
    if (freq === 'weekly') n.setDate(n.getDate() + 7);
    else if (freq === 'yearly') n.setFullYear(n.getFullYear() + 1);
    else { var day = n.getDate(); n.setMonth(n.getMonth() + 1); if (n.getDate() < day) n.setDate(0); }
    return n;
  }
  /* Committed money in the next `days`: EMI due dates and rule occurrences. */
  function upcoming(emis, rules, days, today) {
    var start = parse(today), end = new Date(start.getTime() + days * 864e5), items = [];
    emis.forEach(function (e) {
      var total = Math.max(1, +e.total_n || 1);
      for (var k = 0; k < total; k++) { var d = emiDueDate(e, k); if (d < start) continue; if (d > end) break;
        items.push({ d: iso(d), kind: 'emi', descr: e.name + ' EMI', amount_minor: -Math.abs(e.emi_minor), cat: 'Loan', ref: e.id }); }
    });
    rules.forEach(function (r) {
      var d = parse(r.start_d), stop = r.end_d ? parse(r.end_d) : null, guard = 0;
      while (d <= end && (!stop || d <= stop) && guard++ < 800) {
        if (d >= start) items.push({ d: iso(d), kind: 'recurring', descr: r.descr, amount_minor: r.amount_minor, cat: r.cat, ref: r.id });
        d = stepDate(d, r.freq);
      }
    });
    items.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    return items;
  }

  /* ------------------------------------------------------- life plan */
  function fvMonthly(s, annualPct, years) { var r = annualPct / 100 / 12, n = years * 12; return r ? s * ((Math.pow(1 + r, n) - 1) / r) : s * n; }
  function fvLump(v, annualPct, years) { return v * Math.pow(1 + annualPct / 100, years); }
  function realRate(p) { return ((1 + p.ret / 100) / (1 + p.infl / 100) - 1) * 100; }
  /* p = profile_json merged with defaults; amounts in minor units. */
  function lifePlan(M, p, today) {
    var inc = M.avg.income + M.avg.refund, keep = Math.max(0, M.cashKeptRate);
    var sNow = inc * keep / 100, s20 = inc * 0.2, s40 = inc * 0.4;
    var yearsToRet = Math.max(1, p.retireAge - p.age), rr = realRate(p);
    var annualExp = (M.avg.spend + M.avg.debtpay) * 12, corpus = annualExp * 25;
    var path = function (s) { return { y5: fvLump(p.nw, rr, 5) + fvMonthly(s, rr, 5), y10: fvLump(p.nw, rr, 10) + fvMonthly(s, rr, 10),
      y20: fvLump(p.nw, rr, 20) + fvMonthly(s, rr, 20), ret: fvLump(p.nw, rr, yearsToRet) + fvMonthly(s, rr, yearsToRet) }; };
    var A = path(sNow), B = path(s20), C = path(s40);
    var year = parse(today).getFullYear();
    var kids = (p.kids || []).map(function (by, i) {
      var yrs = Math.max(0, by + 18 - year), cost = fvLump(p.kidCost, p.infl, yrs), have = fvLump(p.nw, rr, yrs) + fvMonthly(sNow, rr, yrs);
      return { i: i + 1, yrs: yrs, cost: Math.round(cost), have: Math.round(Math.min(have, cost)), covered: have >= cost, pctCovered: cost ? have / cost * 100 : 100 };
    });
    var majors = (p.majors || []).map(function (m) { var yrs = Math.max(0, m[1] - year); return { label: m[0], year: m[1], amt: m[2], need: Math.round(m[2] / Math.max(1, yrs * 12)), ok: Math.round(m[2] / Math.max(1, yrs * 12)) <= sNow }; });
    var lost = fvMonthly(s20, rr, yearsToRet) - fvMonthly(s20, rr, Math.max(0, yearsToRet - 1));
    return { keep: keep, rr: rr, retireAge: p.retireAge, yearsToRet: yearsToRet, sNow: Math.round(sNow), corpus: Math.round(corpus),
      paths: [{ label: 'Current path — ' + pct(keep) + ' kept', v: A, cls: 'bad' }, { label: 'Disciplined — 20%', v: B, cls: '' }, { label: 'Extreme — 40%', v: C, cls: 'good' }],
      covNow: corpus > 0 ? A.ret / corpus * 100 : 0, cov20: corpus > 0 ? B.ret / corpus * 100 : 0,
      monthsRet: A.ret / Math.max(1, annualExp / 12), kids: kids, majors: majors, lost: Math.round(lost) };
  }

  var KeptEngine = {
    iso: iso, parse: parse, dim: dim, addMonths: addMonths, monthsBetween: monthsBetween, monthShort: monthShort, monthLong: monthLong,
    hash: hash, classify: classify, normMerchant: normMerchant, defaultCatClass: defaultCatClass,
    build: build, monthStatus: monthStatus, pathStatus: pathStatus, mval: mval, projNext: projNext, cautions: cautions,
    pl: pl, cashflow: cashflow, breakeven: breakeven, fees: fees, controls: controls, budgetDefaults: budgetDefaults, yearOutlook: yearOutlook,
    risks: risks, anomalies: anomalies,
    emiDueDate: emiDueDate, emiPaymentIn: emiPaymentIn, emiDerive: emiDerive, emiTimeline: emiTimeline, emiSummary: emiSummary,
    loansFromEmis: loansFromEmis, simulate: simulate, stepDate: stepDate, upcoming: upcoming, lifePlan: lifePlan, pct: pct,
    committedThisMonth: committedThisMonth, timeCost: timeCost, weekSummary: weekSummary, lesson: lesson, fmtMoney: fmtMoney
  };
  root.KeptEngine = KeptEngine;
})(typeof window !== 'undefined' ? window : globalThis);
