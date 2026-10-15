/* KEPT — the core.
   =============================================================================
   Pure functions shared by the page, the data layer and the tests: the
   dedupe hash, the classifier, the default categories, date and EMI maths,
   the monthly aggregates and the findings engine ("What KEPT noticed").
   No I/O here — kept-data.js does the reading and writing.

   (Formerly server code; on GitHub Pages it all runs in the browser.) Loaded as a
   plain script it sets window.KeptCore; in Node, require() returns it. */
(function (root) {
  'use strict';

/* ================================================ hash, classify, dates */
/* The dedupe hash, the transaction classifier and the default category
   list. They match kept-engine.js exactly (the tests check), which is what
   lets the page and the data layer agree on "this is the same transaction". */

/* ------------------------------------------------------------- dedupe */
/* Same date + amount + description is the same transaction. djb2 over
   "d|amount_minor|descr(60)" — small, stable, and identical to the
   browser's KeptEngine.hash so an import preview can show what will merge. */
function txHash(d, amountMinor, descr) {
  const s = String(d) + '|' + String(Math.round(Number(amountMinor) || 0)) + '|' + String(descr || '').slice(0, 60);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 't' + (h >>> 0).toString(36);
}

/* ------------------------------------------------------------ classify */
const LOAN_RX = /loan|emi|cc_|expensetoemi/i;
const REFUND_RX = /cashback|refund|reversal|rebate/i;
const SALARY_RX = /salary|payroll|wage/i;

function normMerchant(s) {
  const t = String(s || '').toUpperCase().replace(/\s+/g, ' ')
    .replace(/\b(DUBAI|SHARJAH|ABU DHABI|RIYADH|JEDDAH|ARE|UAE|SAU|SA|AE|LLC|L\.L\.C)\b/g, '')
    .replace(/\d{4,}/g, '').replace(/[*#-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || String(s || '').toUpperCase();
}

/* income | borrowed | refund | expense | debtpay | invest | transfer.
   Borrowed money is never income: a loan disbursement is future salary. */
function classify(t) {
  const descr = String(t.descr || ''), cat = String(t.cat || ''), amt = Number(t.amount_minor) || 0;
  if (amt > 0) {
    if (LOAN_RX.test(descr) && !SALARY_RX.test(descr)) return 'borrowed';
    if (REFUND_RX.test(descr)) return 'refund';
    if (/income|salary/i.test(cat)) {
      if (SALARY_RX.test(descr) || /rent|bonus|freelance|dividend|interest|transfer from/i.test(descr)) return 'income';
      if (/[A-Z]{3,}.*(ARE|UAE|DUBAI|\.AE|\.COM)/i.test(descr) || amt < 15000) return 'refund';
      return 'income';
    }
    if (/refund|cashback/i.test(cat)) return 'refund';
    return 'refund';
  }
  if (/self transfer|transfer/i.test(cat)) return 'transfer';
  if (/investment|invest/i.test(cat) || /^SIP\b/i.test(descr)) return 'invest';
  if (/loan|emi/i.test(cat)) return LOAN_RX.test(descr) ? 'debtpay' : 'expense';
  return 'expense';
}

/* ------------------------------------------------------ categories */
/* The default list seeded for every new user. icon names live in the global
   registry under kept-; cls drives the P&L split (fixed / essential /
   discretionary) and the budget defaults. */
const DEFAULT_CATEGORIES = [
  { name: 'Food',          icon: 'kept-food',          flow: 'out', cls: 'disc' },
  { name: 'Grocery',       icon: 'kept-grocery',       flow: 'out', cls: 'ess' },
  { name: 'Transport',     icon: 'kept-transport',     flow: 'out', cls: 'ess' },
  { name: 'Fuel',          icon: 'kept-fuel',          flow: 'out', cls: 'ess' },
  { name: 'Car',           icon: 'kept-car',           flow: 'out', cls: 'ess' },
  { name: 'Rent',          icon: 'kept-home',          flow: 'out', cls: 'fixed' },
  { name: 'Utilities',     icon: 'kept-utilities',     flow: 'out', cls: 'fixed' },
  { name: 'Medicine',      icon: 'kept-medicine',      flow: 'out', cls: 'ess' },
  { name: 'Education',     icon: 'kept-education',     flow: 'out', cls: 'fixed' },
  { name: 'Insurance',     icon: 'kept-shield',        flow: 'out', cls: 'fixed' },
  { name: 'Shopping',      icon: 'kept-shopping',      flow: 'out', cls: 'disc' },
  { name: 'Clothing',      icon: 'kept-clothing',      flow: 'out', cls: 'disc' },
  { name: 'Electronics',   icon: 'kept-phone',         flow: 'out', cls: 'disc' },
  { name: 'Entertainment', icon: 'kept-entertainment', flow: 'out', cls: 'disc' },
  { name: 'Personal',      icon: 'kept-shopping',      flow: 'out', cls: 'disc' },
  { name: 'Travel',        icon: 'kept-travel',        flow: 'out', cls: 'disc' },
  { name: 'Laundry',       icon: 'kept-laundry',       flow: 'out', cls: 'ess' },
  { name: 'Loan',          icon: 'kept-bank',          flow: 'out', cls: 'fixed' },
  { name: 'Investment',    icon: 'kept-invest',        flow: 'out', cls: 'disc' },
  { name: 'Fees',          icon: 'kept-fees',          flow: 'out', cls: 'disc' },
  { name: 'Misc',          icon: 'kept-misc',          flow: 'out', cls: 'disc' },
  { name: 'Income',        icon: 'kept-salary',        flow: 'in',  cls: 'income' },
  { name: 'Refund',        icon: 'kept-salary',        flow: 'in',  cls: 'income' }
];


/* --------------------------------------------------------- profile */
const PROFILE_DEFAULTS = {
  age: 32, retireAge: 60, ret: 7, infl: 3, nw: 0, kids: [], majors: [], kidCost: 25000000, name: ''
};




/* ---------------------------------------------------------- dates */
function todayISO(d) {
  const x = d || new Date();
  return x.getUTCFullYear() + '-' + String(x.getUTCMonth() + 1).padStart(2, '0') + '-' + String(x.getUTCDate()).padStart(2, '0');
}
function dim(y, m0) { return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate(); }
/* The k-th due date of an EMI: start month + k, on the due day, clamped. */
function emiDueDate(e, k) {
  const [y, m] = String(e.start_month).split('-').map(Number);
  const d = new Date(Date.UTC(y, (m - 1) + k, 1));
  d.setUTCDate(Math.min(Number(e.due_day) || 1, dim(d.getUTCFullYear(), d.getUTCMonth())));
  return d;
}
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

/* -------------------------------------------------- posting jobs */
const LOANISH = /loan|emi|instal|cc_|credit card|finance|mortgage/i;

/* A payment for this EMI in month ym: the row Kept posted (remark emi:<id>),
   or a loan-looking row of the same amount — an uploaded statement line is
   recognised rather than counted twice. */
function emiPaymentIn(e, ym, rows) {
  const emi = Number(e.emi_minor) || 0, tol = Math.max(100, Math.round(emi * 0.01));
  let hit = null;
  for (const r of rows) {
    if (String(r.d).slice(0, 7) !== ym) continue;
    if (String(r.remark || '') === 'emi:' + e.id) return r;
    if (r.amount_minor < 0 && Math.abs(-r.amount_minor - emi) <= tol &&
        (LOANISH.test(r.descr) || /loan|emi/i.test(r.cat || ''))) hit = hit || r;
  }
  return hit;
}


function stepDate(d, freq) {
  const n = new Date(d.getTime());
  if (freq === 'weekly') n.setUTCDate(n.getUTCDate() + 7);
  else if (freq === 'yearly') n.setUTCFullYear(n.getUTCFullYear() + 1);
  else { const day = n.getUTCDate(); n.setUTCMonth(n.getUTCMonth() + 1); if (n.getUTCDate() < day) n.setUTCDate(0); }
  return n;
}



/* ---------------------------------------------------- validation */
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isMonth = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));
function intMinor(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}
function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); }

/* ============================================== aggregates and EMIs */
/* Monthly aggregates, EMI derivation and the upcoming list. */

/* ------------------------------------------------------- aggregation */
/* Per-month totals by kind and by category, all integers in minor units.
   net = income + refund − spend − debtpay − invest: what stayed. */
function aggregate(rows, today) {
  const t = today || todayISO();
  const per = {};
  const months = [];
  for (const r of rows) {
    const m = String(r.d).slice(0, 7);
    if (!per[m]) { per[m] = { income: 0, borrowed: 0, refund: 0, spend: 0, debtpay: 0, invest: 0, byCat: {}, n: 0 }; months.push(m); }
    const p = per[m], k = classify(r), a = Number(r.amount_minor) || 0;
    p.n++;
    if (k === 'income') p.income += a;
    else if (k === 'borrowed') p.borrowed += a;
    else if (k === 'refund') p.refund += a;
    else if (k === 'debtpay') p.debtpay += -a;
    else if (k === 'invest') p.invest += -a;
    else if (k === 'expense') { p.spend += -a; p.byCat[r.cat || 'Misc'] = (p.byCat[r.cat || 'Misc'] || 0) + (-a); }
  }
  months.sort();
  // Investing counts as kept (see kept-engine.js build()).
  for (const m of months) { const p = per[m]; p.net = p.income + p.refund - p.spend - p.debtpay; }
  // A trailing month with < 40% of the median row count is still running;
  // so is the calendar month we are in, until its last day (same rule as
  // the browser engine, so averages agree on both sides).
  const counts = months.map((m) => per[m].n).sort((a, b) => a - b);
  const med = counts[Math.floor(counts.length / 2)] || 1;
  const last = months[months.length - 1];
  const lastDay = last ? String(new Date(Date.UTC(+last.slice(0, 4), +last.slice(5, 7), 0)).getUTCDate()) : '';
  const lastPartial = !!last && (per[last].n < med * 0.4 || (t.slice(0, 7) === last && t.slice(8, 10) !== lastDay));
  const fullMonths = lastPartial ? months.slice(0, -1) : months;
  const n = fullMonths.length || 1;
  const sum = (k) => fullMonths.reduce((a, m) => a + per[m][k], 0);
  const avg = {};
  for (const k of ['income', 'borrowed', 'refund', 'spend', 'debtpay', 'invest', 'net']) avg[k] = Math.round(sum(k) / n);
  const catTotal = {};
  for (const m of fullMonths) for (const [c, v] of Object.entries(per[m].byCat)) catTotal[c] = (catTotal[c] || 0) + v;
  const catAvg = {};
  for (const [c, v] of Object.entries(catTotal)) catAvg[c] = Math.round(v / n);
  const keepRateBp = avg.income > 0 ? Math.round(avg.net / avg.income * 10000) : 0;
  return { months, fullMonths, lastPartial, per, avg, catTotal, catAvg, keepRateBp };
}

/* Average by category over the last k full months (recent habit). */
function recentCatAvg(agg, k) {
  const ms = agg.fullMonths.slice(-k);
  const out = {};
  for (const m of ms) for (const [c, v] of Object.entries(agg.per[m].byCat)) out[c] = (out[c] || 0) + v;
  for (const c of Object.keys(out)) out[c] = Math.round(out[c] / (ms.length || 1));
  return out;
}

const topCats = (byCat, n) => Object.entries(byCat || {}).sort((a, b) => b[1] - a[1]).slice(0, n)
  .map(([cat, amount_minor]) => ({ cat, amount_minor }));

/* ----------------------------------------------------------- EMIs */
function deriveEmi(e, rows, today) {
  const now_ = new Date((today || todayISO()) + 'T00:00:00Z');
  const total = Math.max(1, Number(e.total_n) || 1);
  let done = 0, next = null, thisDue = null;
  const ym = todayISO(now_).slice(0, 7);
  for (let k = 0; k < total; k++) {
    const d = emiDueDate(e, k);
    if (todayISO(d).slice(0, 7) === ym) thisDue = d;
    if (d <= now_) done++; else if (!next) next = d;
  }
  const left = total - done;
  const end = emiDueDate(e, total - 1);
  const paid = thisDue && rows ? !!emiPaymentIn(e, ym, rows) : false;
  return {
    id: e.id, name: e.name, lender: e.lender || '', emi_minor: e.emi_minor, currency: e.currency,
    total_n: total, paid_n: done, left_n: left, remaining_minor: left * e.emi_minor,
    next_due: next ? todayISO(next) : null, end_month: todayISO(end).slice(0, 7),
    due_this_month: thisDue ? todayISO(thisDue) : null, paid_this_month: paid, apr_bp: e.apr_bp || 0
  };
}

/* ------------------------------------------------------- upcoming */
/* The deterministic part of "upcoming expenses": every EMI due date and
   recurring occurrence in the next `days`, plus categories that ran hot in
   the same month last year. */
function upcomingList(emis, rules, agg, days, today) {
  const start = new Date((today || todayISO()) + 'T00:00:00Z');
  const end = new Date(start.getTime() + days * 864e5);
  const items = [];
  for (const e of emis) {
    const total = Math.max(1, Number(e.total_n) || 1);
    for (let k = 0; k < total; k++) {
      const d = emiDueDate(e, k);
      if (d < start) continue;
      if (d > end) break;
      items.push({ d: todayISO(d), kind: 'emi', descr: e.name + ' EMI', amount_minor: -Math.abs(e.emi_minor), cat: 'Loan', ref: e.id });
    }
  }
  for (const r of rules) {
    let d = new Date(r.start_d + 'T00:00:00Z');
    const stop = r.end_d ? new Date(r.end_d + 'T00:00:00Z') : null;
    let guard = 0;
    while (d <= end && (!stop || d <= stop) && guard++ < 800) {
      if (d >= start) items.push({ d: todayISO(d), kind: 'recurring', descr: r.descr, amount_minor: r.amount_minor, cat: r.cat, ref: r.id });
      d = stepDate(d, r.freq);
    }
  }
  items.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  // Seasonal: same calendar months a year ago, categories ≥ 30% above their average.
  const seasonal = [];
  const startYm = todayISO(start).slice(0, 7), endYm = todayISO(end).slice(0, 7);
  const months = startYm === endYm ? [startYm] : [startYm, endYm];
  for (const ym of months) {
    const ly = addMonths(ym, -12), p = agg.per[ly];
    if (!p) continue;
    for (const [c, v] of Object.entries(p.byCat)) {
      const a = agg.catAvg[c] || 0;
      if (a > 0 && v >= a * 1.3 && v - a >= 5000) seasonal.push({ month: ym, cat: c, last_year_minor: v, avg_minor: a });
    }
  }
  const committed = items.reduce((s, i) => s + (i.amount_minor < 0 ? -i.amount_minor : 0), 0);
  const income = items.reduce((s, i) => s + (i.amount_minor > 0 ? i.amount_minor : 0), 0);
  return { from: todayISO(start), to: todayISO(end), days, items, seasonal, committed_minor: committed, expected_in_minor: income };
}



/* ----------------------------------------------------- the pack */

/* ==================================================== findings */
/**
 * KEPT findings — the things in a ledger a person tends to miss.
 * =============================================================================
 * Pure code over the person's rows, EMIs and rules. Every figure is
 * computed, and each finding carries its own plain "why" and "action".
 *
 *   computeFindings({ rows, emis, rules, prof, today }) →
 *     { month, today, currency, summary_text: [..], items: [finding], fingerprint, enough_data }
 *
 *   finding = { id, kind, severity: 'high'|'medium'|'low'|'good', score,
 *               title, facts: [string], figures: {..}, why, action, rows: [ids], sig }
 *
 * `facts` are display strings with the money already formatted. `id` is stable for
 * the same thing across days (kind + merchant/category), and `sig` changes
 * when its figures change, so a dismissed finding comes back only if it got
 * different.
 */

const FEE_RX = /\b(fees?|charges?|penalty|late payment|finance charge|interest charged|annual fee|overlimit|vat on)\b/i;
const FIXED_CATS = new Set(['Rent', 'Loan', 'Education', 'Insurance', 'Utilities']);
const SEV_RANK = { high: 0, medium: 1, low: 2, good: 3 };

/* ------------------------------------------------------------ format */
function fmtMoney(minor, cur) {
  const n = Math.abs(Number(minor) || 0) / 100;
  // Whole units from 10 up (a daily average of 58.76 reads as noise);
  // cents only on small amounts, where they are the amount.
  const whole = n >= 10 || Number.isInteger(n);
  const s = n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return (cur ? cur + ' ' : '') + s;
}
const pctTxt = (x) => Math.round(x) + '%';
function monthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function monthOnly(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
}
function dayMonth(d) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const isSystem = (r) => /^(recurring|emi):/.test(String(r.remark || ''));
const keyOf = (r) => (r.merchant || normMerchant(r.descr)).slice(0, 40);

/* ------------------------------------------------------------- main */
function computeFindings({ rows, emis = [], rules = [], prof, today }) {
  const t = today || todayISO();
  const cur = (prof && prof.currency) || 'AED';
  const ym = t.slice(0, 7), day = Number(t.slice(8, 10));
  const daysIn = dim(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1);
  const agg = aggregate(rows, t);
  const full = agg.fullMonths;
  const lastFull = full[full.length - 1] || null;
  const avgIn = agg.avg.income + agg.avg.refund;
  const avgOut = agg.avg.spend + agg.avg.debtpay + agg.avg.invest;
  const base = Math.max(avgIn, avgOut, 100000);            // what "a lot" is measured against
  const M = (m) => fmtMoney(m, cur);
  const ex = rows.filter((r) => classify(r) === 'expense' && !isSystem(r));
  const items = [];
  // Red ("needs a look") is kept for what is actually wrong or urgent: a
  // late salary, a real spike, falling income or keep-rate. Something that
  // is merely large — your rent repeating — is never red.
  const CAP = { subscription: 'medium', price_creep: 'medium', duplicate: 'medium', small_leaks: 'medium', fees: 'medium',
    one_off: 'medium', payday: 'medium', seasonal: 'medium', hygiene: 'low' };
  const add = (f) => {
    f.score = Math.max(0, f.score || 0);
    if (!f.severity) f.severity = f.score >= 0.25 ? 'high' : f.score >= 0.08 ? 'medium' : 'low';
    const cap = CAP[f.kind];
    if (cap && SEV_RANK[f.severity] < SEV_RANK[cap]) f.severity = cap;
    f.sig = djb2(JSON.stringify(f.figures || {}));
    items.push(f);
  };
  const enough = full.length >= 2;

  /* -------------------------------------------- regular merchants */
  // Charged in at least three of the last four full months (or the current
  // one), at most twice a month, at a steady amount: a subscription, a
  // membership, a bill. Covered by a rule or an EMI → not news.
  const last4 = full.slice(-4);
  const recent = new Set(last4.concat([ym]));
  const ruleKeys = rules.map((r) => normMerchant(r.descr));
  const byMer = new Map();
  for (const r of ex) {
    const m = r.d.slice(0, 7);
    if (!recent.has(m)) continue;
    const k = keyOf(r);
    if (!byMer.has(k)) byMer.set(k, { k, rows: [], months: {} });
    const g = byMer.get(k);
    g.rows.push(r); g.months[m] = (g.months[m] || 0) + 1;
  }
  for (const g of byMer.values()) {
    const months = Object.keys(g.months).sort();
    if (months.length < 3 || Object.values(g.months).some((n) => n > 2)) continue;
    const amts = g.rows.map((r) => -r.amount_minor);
    const med = median(amts);
    if (med < 500) continue;
    const sorted = g.rows.slice().sort((a, b) => (a.d < b.d ? -1 : 1));
    const earlier = sorted.slice(0, -1).map((r) => -r.amount_minor), latest = -sorted[sorted.length - 1].amount_minor;
    const earlyMed = median(earlier);
    const steady = earlier.every((a) => a >= earlyMed * 0.85 && a <= earlyMed * 1.15);
    if (!steady) continue;
    const rise = earlyMed > 0 ? (latest - earlyMed) / earlyMed : 0;
    const crept = rise >= 0.08 && latest - earlyMed >= 500;
    const covered = ruleKeys.some((k) => k && (k === g.k || g.k.includes(k) || k.includes(g.k)));
    const cat = sorted[sorted.length - 1].cat || 'Misc';
    if (cat === 'Loan') continue;
    const name = sorted[sorted.length - 1].descr;
    if (!covered && FIXED_CATS.has(cat)) {
      // Rent, utilities, school fees: not something to cancel, just something
      // the forecast should know about.
      add({ id: 'regular:' + g.k, kind: 'subscription', severity: 'low', title: name + ' repeats every month — make it a recurring rule',
        facts: ['About ' + M(med) + ' a month, every month'],
        figures: { monthly_minor: med, months: months.length },
        why: 'KEPT only counts it in Upcoming and the forecast once it is a rule, so next month looks lighter than it will be.',
        action: 'Add it as a recurring rule on the EMIs screen.',
        score: 0.02, rows: sorted.slice(-3).map((r) => r.id), merchant: g.k, cat });
      continue;
    }
    if (!covered) {
      const inFull = months.filter((m) => m !== ym).length, thisMonth = months.includes(ym);
      const facts = ['About ' + M(med) + ' a month, in ' + inFull + ' of the last ' + last4.length + ' months' + (thisMonth ? ' and again this month' : ''), M(med * 12) + ' a year'];
      if (crept) facts.push('Last charge ' + M(latest) + ', up from ' + M(earlyMed) + ' (+' + pctTxt(rise * 100) + ')');
      add({ id: 'regular:' + g.k, kind: 'subscription', title: 'A regular charge you haven\'t set up: ' + name,
        facts, figures: { monthly_minor: med, yearly_minor: med * 12, months: months.length, latest_minor: latest, earlier_minor: earlyMed },
        why: 'It repeats every month but isn\'t a recurring rule in KEPT, so it isn\'t counted in Upcoming or the forecast — and repeating charges are the easiest money to stop noticing.',
        action: 'If you still use it, add it as a recurring rule on the EMIs screen. If you don\'t, cancel it.',
        score: (med * 12) / (base * 12) * 2, rows: sorted.slice(-4).map((r) => r.id), merchant: g.k, cat });
    } else if (crept) {
      add({ id: 'creep:' + g.k, kind: 'price_creep', title: name + ' went up',
        facts: [M(earlyMed) + ' → ' + M(latest) + ' (+' + pctTxt(rise * 100) + ')', '+' + M((latest - earlyMed) * 12) + ' a year'],
        figures: { before_minor: earlyMed, after_minor: latest, yearly_minor: (latest - earlyMed) * 12 },
        why: 'Price rises on regular charges rarely come with a notice you read, and your recurring rule still holds the old amount.',
        action: 'Update the recurring rule to the new amount, and check whether a cheaper plan exists.',
        score: ((latest - earlyMed) * 12) / (base * 12) * 3, rows: sorted.slice(-3).map((r) => r.id), merchant: g.k, cat });
    }
  }

  /* ------------------------------------------- possible double charge */
  const since45 = addDays(t, -45);
  const recentEx = ex.filter((r) => r.d >= since45).sort((a, b) => (a.d < b.d ? -1 : 1));
  const seenDup = new Set();
  for (let i = 0; i < recentEx.length; i++) {
    const a = recentEx[i];
    if (seenDup.has(a.id) || -a.amount_minor < 2000) continue;
    for (let j = i + 1; j < recentEx.length; j++) {
      const b = recentEx[j];
      if (daysBetween(a.d, b.d) > 3) break;
      if (b.amount_minor !== a.amount_minor || keyOf(a) !== keyOf(b) || seenDup.has(b.id)) continue;
      // Daily habits (the same coffee, the same taxi fare) repeat by design.
      if (/^(Food|Transport|Fuel|Grocery)$/.test(a.cat || '') && -a.amount_minor < 10000) continue;
      seenDup.add(a.id); seenDup.add(b.id);
      add({ id: 'dup:' + a.id + ':' + b.id, kind: 'duplicate', severity: 'medium', title: 'Possible double charge: ' + a.descr,
        facts: [M(-a.amount_minor) + ' on ' + dayMonth(a.d) + ' and again on ' + dayMonth(b.d)],
        figures: { amount_minor: -a.amount_minor, d1: a.d, d2: b.d },
        why: 'Same merchant, same amount, days apart. It may be two real purchases — or one purchase billed twice.',
        action: 'Check the bank statement. If it left twice, ask the merchant or the bank to reverse one.',
        score: -a.amount_minor / base, rows: [a.id, b.id], merchant: keyOf(a), cat: a.cat });
      break;
    }
  }

  /* -------------------------------------------- categories this month */
  // Day 7 onwards, this month against a usual month; earlier than that,
  // last full month against the months before it.
  const catAvg = agg.catAvg;
  const perMonthCount = {};
  for (const r of ex) if (full.includes(r.d.slice(0, 7))) perMonthCount[r.cat] = (perMonthCount[r.cat] || 0) + 1;
  if (enough && day >= 7 && agg.per[ym]) {
    const so = agg.per[ym].byCat;
    const spikes = [];
    for (const [c, v] of Object.entries(so)) {
      const avg = catAvg[c] || 0;
      if (avg <= 0 || FIXED_CATS.has(c)) continue;
      const left = daysIn - day;
      const freq = (perMonthCount[c] || 0) / full.length >= 6;   // frequent enough to project
      const projected = freq ? Math.round(v / day * daysIn) : v;
      const over = v >= avg ? v - avg : projected - avg;
      if (over < Math.max(avg * 0.25, base * 0.03)) continue;
      spikes.push({ c, v, avg, projected, already: v >= avg, left, over });
    }
    spikes.sort((a, b) => b.over - a.over).slice(0, 3).forEach((s) => add({
      id: 'spike:' + ym + ':' + s.c, kind: 'category_spike',
      title: s.already ? s.c + ' is already past a usual month' : s.c + ' is on course to run high',
      facts: s.already
        ? [M(s.v) + ' so far vs ' + M(s.avg) + ' in a usual month', s.left + ' days of ' + monthOnly(ym) + ' still to go']
        : [M(s.v) + ' in ' + day + ' days — on course for about ' + M(s.projected), 'A usual month is ' + M(s.avg)],
      figures: { so_far_minor: s.v, avg_minor: s.avg, projected_minor: s.projected, day },
      why: s.already ? 'Everything spent on ' + s.c + ' from here is above your normal.' : 'At this pace the month ends well above your normal for ' + s.c + '.',
      action: 'Look at the ' + s.c + ' list on Spend for what is different this month, and set a cap for the rest of it.',
      score: s.over / base * 1.5, cat: s.c }));
  } else if (enough && lastFull && full.length >= 3) {
    const before = full.slice(0, -1);
    for (const [c, v] of Object.entries(agg.per[lastFull].byCat)) {
      if (FIXED_CATS.has(c)) continue;
      const avgB = Math.round(before.reduce((s, m) => s + (agg.per[m].byCat[c] || 0), 0) / before.length);
      if (avgB <= 0 || v < avgB * 1.4 || v - avgB < base * 0.03) continue;
      add({ id: 'spike:' + lastFull + ':' + c, kind: 'category_spike', title: c + ' ran high in ' + monthOnly(lastFull),
        facts: [M(v) + ' vs ' + M(avgB) + ' in the months before (+' + pctTxt((v - avgB) / avgB * 100) + ')'],
        figures: { month_minor: v, avg_minor: avgB },
        why: 'One heavy month is noise; two in a row becomes the new normal without anyone deciding it.',
        action: 'Decide whether ' + monthOnly(lastFull) + ' was a one-off, and if not, give ' + c + ' a budget line.',
        score: (v - avgB) / base, cat: c });
    }
  }

  /* -------------------------------------------------------- improving */
  if (enough && lastFull && full.length >= 3) {
    const before = full.slice(0, -1);
    let best = null;
    for (const [c, avgAll] of Object.entries(catAvg)) {
      if (FIXED_CATS.has(c)) continue;
      const avgB = Math.round(before.reduce((s, m) => s + (agg.per[m].byCat[c] || 0), 0) / before.length);
      const v = agg.per[lastFull].byCat[c] || 0;
      const saved = avgB - v;
      if (avgB > 0 && saved >= avgB * 0.25 && saved >= base * 0.03 && (!best || saved > best.saved)) best = { c, v, avgB, saved };
    }
    if (best) add({ id: 'better:' + lastFull + ':' + best.c, kind: 'improving', severity: 'good', title: best.c + ' came down in ' + monthOnly(lastFull),
      facts: [M(best.v) + ' vs ' + M(best.avgB) + ' before — ' + M(best.saved) + ' kept'],
      figures: { month_minor: best.v, avg_minor: best.avgB, saved_minor: best.saved },
      why: 'Whatever changed is working. Kept for a year, it is ' + M(best.saved * 12) + '.',
      action: 'Move ' + M(best.saved) + ' to savings now, so the win does not get spent somewhere else.',
      score: best.saved / base, cat: best.c });
  }

  /* --------------------------------------------------- small purchases */
  if (enough && lastFull) {
    const cap = Math.max(1000, Math.round(avgIn * 0.005));
    const small = ex.filter((r) => r.d.slice(0, 7) === lastFull && -r.amount_minor <= cap);
    const total = small.reduce((s, r) => s - r.amount_minor, 0);
    if (small.length >= 15 && total >= base * 0.03) {
      const mer = {};
      for (const r of small) { const k = r.descr; mer[k] = (mer[k] || 0) + 1; }
      const top = Object.entries(mer).sort((a, b) => b[1] - a[1])[0];
      const facts = [small.length + ' purchases under ' + M(cap) + ' in ' + monthOnly(lastFull), 'Together ' + M(total) + ' — ' + M(total * 12) + ' a year at that rate'];
      if (top && top[1] >= 4) facts.push(top[0] + ': ' + top[1] + ' times');
      add({ id: 'small:' + lastFull, kind: 'small_leaks', title: 'Small purchases added up in ' + monthOnly(lastFull), facts,
        figures: { count: small.length, total_minor: total, cap_minor: cap },
        why: 'None of them is worth thinking about on its own, which is exactly why together they slip past.',
        action: top && top[1] >= 4 ? 'Pick the one that repeats most (' + top[0] + ') and halve how often it happens.' : 'Pick the category these cluster in and set a weekly cap.',
        score: total / base * 0.8, rows: small.slice(-6).map((r) => r.id) });
    }
  }

  /* -------------------------------------------------------------- fees */
  const since90 = addDays(t, -90);
  // School fees, visa fees and licence renewals are costs of living, not
  // bank charges; they never belong in this finding.
  const NOT_FEE_CAT = /loan|emi|education|school|rent|utilit|insurance|government|visa/i;
  const NOT_FEE_RX = /school|tuition|college|university|nursery|visa|licen[cs]e|rent|parking|salik|toll|membership|gym/i;
  const fees = rows.filter((r) => r.amount_minor < 0 && r.d >= since90 && (r.cat === 'Fees' || FEE_RX.test(r.descr || '')) && !NOT_FEE_CAT.test(r.cat || '') && !NOT_FEE_RX.test(r.descr || ''));
  if (fees.length) {
    const tot = fees.reduce((s, r) => s - r.amount_minor, 0);
    add({ id: 'fees:' + ym, kind: 'fees', title: 'Bank fees and charges',
      facts: [M(tot) + ' in the last 3 months, ' + fees.length + ' charge' + (fees.length === 1 ? '' : 's'), 'About ' + M(tot * 4) + ' a year at this rate'],
      figures: { total_minor: tot, count: fees.length },
      why: 'Fees buy nothing. Most are avoidable — late fees with autopay, card fees by asking for a waiver.',
      action: 'Open the list below, find the biggest one, and call the bank about it this week.',
      score: tot * 4 / (base * 12) * 3, rows: fees.slice(-6).map((r) => r.id) });
  }

  /* ---------------------------------------------------- large one-offs */
  if (enough) {
    const since30 = addDays(t, -30);
    const catMed = {};
    for (const r of ex) (catMed[r.cat] = catMed[r.cat] || []).push(-r.amount_minor);
    const big = ex.filter((r) => r.d >= since30 && !FIXED_CATS.has(r.cat) && -r.amount_minor >= 3 * median(catMed[r.cat] || [0]) && -r.amount_minor >= avgOut * 0.1)
      .sort((a, b) => a.amount_minor - b.amount_minor).slice(0, 2);
    for (const r of big) {
      const m = median(catMed[r.cat] || [0]);
      add({ id: 'big:' + r.id, kind: 'one_off', title: 'A large ' + (r.cat || 'Misc') + ' purchase: ' + r.descr,
        facts: [M(-r.amount_minor) + ' on ' + dayMonth(r.d) + (m > 0 ? ' — ' + Math.round(-r.amount_minor / m) + '× your usual ' + (r.cat || 'Misc') + ' purchase' : '')],
        figures: { amount_minor: -r.amount_minor, typical_minor: m },
        why: 'A one-off this size moves the whole month. It is worth being sure it was a choice and not a habit starting.',
        action: 'If it was planned, nothing to do. If not, decide which category gives it back this month.',
        score: -r.amount_minor / base * 0.6, rows: [r.id], cat: r.cat });
    }
  }

  /* ------------------------------------------------------------ salary */
  const salaryRows = rows.filter((r) => classify(r) === 'income' && (SALARY_RX.test(r.descr || '') || r.amount_minor >= agg.avg.income * 0.5));
  const salaryDays = salaryRows.filter((r) => full.slice(-4).includes(r.d.slice(0, 7))).map((r) => Number(r.d.slice(8, 10)));
  if (enough && salaryDays.length >= 2) {
    const usual = median(salaryDays);
    const arrived = salaryRows.some((r) => r.d.slice(0, 7) === ym);
    if (!arrived && day > usual + 2) add({ id: 'salary-late:' + ym, kind: 'salary', severity: 'high', title: 'Salary hasn\'t landed yet this month',
      facts: ['It usually arrives around the ' + ordinal(usual) + '; today is the ' + ordinal(day)],
      figures: { usual_day: usual, day },
      why: 'Either it is late, or it arrived and isn\'t in KEPT yet — both change what this month looks like.',
      action: 'Check the bank. If it came in, add it (or import the statement) so the keep-rate is honest.',
      score: 1 });
  }
  if (enough && lastFull && full.length >= 3) {
    const before = full.slice(0, -1);
    const avgB = Math.round(before.reduce((s, m) => s + agg.per[m].income, 0) / before.length);
    const v = agg.per[lastFull].income;
    if (avgB > 0 && v < avgB * 0.85) add({ id: 'income-drop:' + lastFull, kind: 'income', title: 'Income was lower in ' + monthOnly(lastFull),
      facts: [M(v) + ' vs ' + M(avgB) + ' in a usual month (−' + pctTxt((avgB - v) / avgB * 100) + ')'],
      figures: { month_minor: v, avg_minor: avgB },
      why: 'Spending rarely drops on its own when income does, so the gap comes out of what you keep.',
      action: 'If it is a one-off, nothing to change. If it will repeat, lower the spending budget to match.',
      score: (avgB - v) / base });
  }

  /* ---------------------------------------------------- after payday */
  if (enough && salaryRows.length >= 2) {
    const windows = new Set();
    for (const r of salaryRows) if (full.slice(-3).includes(r.d.slice(0, 7))) for (let k = 0; k < 3; k++) windows.add(addDays(r.d, k));
    const last3 = new Set(full.slice(-3));
    let inW = 0, outW = 0, nIn = 0, nOut = 0;
    const days = {};
    for (const r of ex) if (last3.has(r.d.slice(0, 7)) && !FIXED_CATS.has(r.cat)) days[r.d] = (days[r.d] || 0) - r.amount_minor;
    for (const m of last3) for (let dd = 1; dd <= dim(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1); dd++) {
      const d = m + '-' + String(dd).padStart(2, '0'), v = days[d] || 0;
      if (windows.has(d)) { inW += v; nIn++; } else { outW += v; nOut++; }
    }
    if (nIn && nOut && outW > 0) {
      const x = (inW / nIn) / (outW / nOut);
      if (x >= 2) add({ id: 'payday', kind: 'payday', title: 'Spending jumps right after salary',
        facts: ['The 3 days after payday run ' + (Math.round(x * 10) / 10) + '× your normal daily spend', M(Math.round(inW / nIn)) + ' a day then, ' + M(Math.round(outW / nOut)) + ' on other days'],
        figures: { ratio_x10: Math.round(x * 10), payday_daily_minor: Math.round(inW / nIn), other_daily_minor: Math.round(outW / nOut) },
        why: 'Money that has just arrived feels like more than it is. That feeling is gone by the third day; the spending isn\'t.',
        action: 'Move savings out on salary day itself, before the first purchase — a standing order is easiest.',
        score: ((inW / nIn) - (outW / nOut)) * 3 * 12 / (base * 12) });
    }
  }

  /* ------------------------------------------------- keep-rate trend */
  if (full.length >= 6) {
    const rate = (ms) => { const i = ms.reduce((s, m) => s + agg.per[m].income + agg.per[m].refund, 0); const n = ms.reduce((s, m) => s + agg.per[m].net, 0); return i > 0 ? n / i * 100 : null; };
    const now3 = rate(full.slice(-3)), prev3 = rate(full.slice(-6, -3));
    if (now3 != null && prev3 != null && prev3 - now3 >= 5) add({ id: 'keeprate:' + lastFull, kind: 'trend', title: 'You are keeping less than you were',
      facts: ['Keep-rate ' + pctTxt(prev3) + ' → ' + pctTxt(now3) + ' (last 3 months vs the 3 before)'],
      figures: { before_bp: Math.round(prev3 * 100), after_bp: Math.round(now3 * 100) },
      why: 'A slide of a few points a quarter is invisible month to month and large over a year.',
      action: 'Spend → All time shows which categories grew; the top one is usually most of the slide.',
      score: (prev3 - now3) / 100 * 3 });
  }

  /* ------------------------------------------------------ EMI ending */
  for (const e of emis) {
    const d = deriveEmi(e, rows, t);
    if (d.left_n >= 1 && d.left_n <= 3) {
      const after = addMonths(d.end_month, 1);
      add({ id: 'emi-end:' + e.id, kind: 'emi_ending', severity: 'good', title: e.name + ' finishes soon',
        facts: ['Last instalment in ' + monthName(d.end_month), M(e.emi_minor) + ' a month is yours again from ' + monthName(after)],
        figures: { emi_minor: e.emi_minor, end_month: d.end_month },
        why: 'Freed-up money with no plan becomes lifestyle within two months, and nobody decides that it should.',
        action: 'Set a standing order of ' + M(e.emi_minor) + ' into savings starting ' + monthName(after) + ' — today, while it is still a plan.',
        score: e.emi_minor / base });
    }
  }

  /* --------------------------------------------------- next month */
  const next = addMonths(ym, 1), ly = addMonths(next, -12);
  if (agg.per[ly] && enough) {
    let worst = null;
    for (const [c, v] of Object.entries(agg.per[ly].byCat)) {
      const a = catAvg[c] || 0;
      if (a > 0 && v >= a * 1.3 && v - a >= base * 0.05 && (!worst || v - a > worst.v - worst.a)) worst = { c, v, a };
    }
    if (worst) add({ id: 'seasonal:' + next + ':' + worst.c, kind: 'seasonal', title: monthOnly(next) + ' is usually expensive for ' + worst.c,
      facts: ['Last ' + monthOnly(next) + ': ' + M(worst.v) + ' on ' + worst.c + ' vs ' + M(worst.a) + ' in a usual month'],
      figures: { last_year_minor: worst.v, avg_minor: worst.a },
      why: 'Expenses that come once a year always feel like a surprise, even when they happen every year.',
      action: 'Set aside ' + M(worst.v - worst.a) + ' this month so ' + monthOnly(next) + ' doesn\'t come out of savings.',
      score: (worst.v - worst.a) / base });
  }

  /* --------------------------------------------------- uncategorised */
  const since60 = addDays(t, -60);
  const misc = ex.filter((r) => r.d >= since60 && (!r.cat || r.cat === 'Misc'));
  const miscTot = misc.reduce((s, r) => s - r.amount_minor, 0);
  if (misc.length >= 5 || (misc.length && miscTot >= base * 0.05)) add({ id: 'misc:' + ym, kind: 'hygiene', severity: 'low', title: misc.length + ' recent entries have no category',
    facts: [M(miscTot) + ' over the last 60 days sits in Misc'],
    figures: { count: misc.length, total_minor: miscTot },
    why: 'Everything in Misc is invisible to the category view, the budget and this analysis.',
    action: 'Insights → Categorise proposes a category for each; approve the ones that are right.',
    score: 0.01, rows: misc.slice(-6).map((r) => r.id) });

  // A big purchase that is most of a category's spike is one story, not two.
  for (const big of items.filter((f) => f.kind === 'one_off')) {
    const spike = items.find((f) => f.kind === 'category_spike' && f.cat === big.cat && f.id.indexOf('spike:' + ym) === 0);
    if (spike && big.figures.amount_minor >= (spike.figures.so_far_minor - spike.figures.avg_minor) * 0.5) {
      spike.facts.push('Mostly one purchase: ' + big.facts[0].replace(/ — .*$/, '') + ' (' + big.title.replace(/^A large .*? purchase: /, '') + ')');
      spike.rows = (spike.rows || []).concat(big.rows);
      spike.sig = djb2(JSON.stringify(spike.figures) + big.id);
      items.splice(items.indexOf(big), 1);
    }
  }
  items.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || (b.score - a.score));
  // Ten things to look at, and up to two pieces of good news always make
  // the cut — an analysis that only ever scolds stops being read.
  const good = items.filter((f) => f.severity === 'good').slice(0, 2);
  const top = items.filter((f) => f.severity !== 'good').slice(0, 10).concat(good);

  /* The month in a few sentences with the money already written. */
  const curP = agg.per[ym];
  const summary_text = [
    monthName(ym) + ', day ' + day + ' of ' + daysIn,
    curP ? 'This month so far: in ' + M(curP.income + curP.refund) + ', spent ' + M(curP.spend) + ', EMIs ' + M(curP.debtpay) + ', invested ' + M(curP.invest) : 'Nothing recorded this month yet',
    full.length ? 'A usual month (' + full.length + ' full month' + (full.length === 1 ? '' : 's') + ' on file): in ' + M(avgIn) + ', spending ' + M(agg.avg.spend) + ', EMIs ' + M(agg.avg.debtpay) : 'No complete month on file yet',
    full.length ? 'Keep-rate across full months: ' + pctTxt(agg.keepRateBp / 100) + '; target ' + pctTxt((prof && prof.target_keep_bp || 2000) / 100) : ''
  ].filter(Boolean);

  return {
    month: ym, today: t, currency: cur, enough_data: enough, full_months: full.length,
    summary_text, items: top,
    fingerprint: djb2(JSON.stringify(top.map((f) => [f.id, f.sig])) + summary_text.slice(1).join('|'))
  };
}

function addDays(d, n) {
  const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function ordinal(n) { n = Number(n); const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  var KeptCore = { txHash: txHash, normMerchant: normMerchant, classify: classify, DEFAULT_CATEGORIES: DEFAULT_CATEGORIES, PROFILE_DEFAULTS: PROFILE_DEFAULTS, todayISO: todayISO, dim: dim, emiDueDate: emiDueDate, addMonths: addMonths, emiPaymentIn: emiPaymentIn, stepDate: stepDate, isDate: isDate, isMonth: isMonth, intMinor: intMinor, str: str, aggregate: aggregate, recentCatAvg: recentCatAvg, deriveEmi: deriveEmi, upcomingList: upcomingList, computeFindings: computeFindings, fmtMoney: fmtMoney };
  if (typeof module !== 'undefined' && module.exports) module.exports = KeptCore;
  root.KeptCore = KeptCore;
})(typeof window !== 'undefined' ? window : globalThis);
