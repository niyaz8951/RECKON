/* KEPT engine: the maths on invented data — keep-rate, pace, the path, EMI
   rings and timeline, the dedupe hash, projections, and the import column
   mapper. Every figure here is made up; nothing resembles a real ledger. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + e.message); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };

// The engine and the importer are classic scripts; load them into a bare
// context the way the page does, without a DOM.
const ctx = vm.createContext({ console });
vm.runInContext(readFileSync(resolve(ROOT, 'kept/kept-engine.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(resolve(ROOT, 'kept/kept-import.js'), 'utf8'), ctx);
const E = ctx.KeptEngine, IM = ctx.KeptImport;

/* ------------------------------------------------------------ hash */
t('hash is stable and keyed on date|amount|description', () => {
  const a = E.hash('2026-03-04', -42000, 'CITY HYPERMARKET');
  eq(a, E.hash('2026-03-04', -42000, 'CITY HYPERMARKET'));
  ok(a !== E.hash('2026-03-05', -42000, 'CITY HYPERMARKET'), 'date changes hash');
  ok(a !== E.hash('2026-03-04', -42001, 'CITY HYPERMARKET'), 'amount changes hash');
  ok(a !== E.hash('2026-03-04', -42000, 'CITY HYPERMARKET 2'), 'description changes hash');
  ok(/^t[0-9a-z]+$/.test(a));
});
// The data layer's copy lives in kept/kept-core.js; compare by value.
import { createRequire } from 'node:module';
const server = createRequire(import.meta.url)(resolve(ROOT, 'kept/kept-core.js'));
t('hash matches the server implementation (same djb2)', () => {
  eq(server.txHash('2026-03-04', -42000, 'CITY HYPERMARKET'), E.hash('2026-03-04', -42000, 'CITY HYPERMARKET'));
  eq(server.classify({ descr: 'HOME LOAN EMI', cat: 'Loan', amount_minor: -85000 }), E.classify({ descr: 'HOME LOAN EMI', cat: 'Loan', amount_minor: -85000 }));
});

/* -------------------------------------------------------- classify */
t('classify: salary is income, loan disbursement is borrowed, SIP is invest', () => {
  eq(E.classify({ descr: 'SALARY — ACME', cat: 'Income', amount_minor: 950000 }), 'income');
  eq(E.classify({ descr: 'PERSONAL LOAN DISBURSAL', cat: 'Income', amount_minor: 2000000 }), 'borrowed');
  eq(E.classify({ descr: 'CASHBACK REWARD', cat: 'Income', amount_minor: 4500 }), 'refund');
  eq(E.classify({ descr: 'SIP INDEX FUND', cat: 'Investment', amount_minor: -50000 }), 'invest');
  eq(E.classify({ descr: 'HOME LOAN EMI', cat: 'Loan', amount_minor: -85000 }), 'debtpay');
  eq(E.classify({ descr: 'CITY HYPERMARKET', cat: 'Grocery', amount_minor: -42000 }), 'expense');
});

/* ------------------------------------------------------------ model */
// Four invented months: income 10,000.00; spend varies; EMI 850.00; SIP 500.00.
function month(ym, spend) {
  return [
    { d: ym + '-01', descr: 'SALARY — ACME', amount_minor: 1000000, cat: 'Income' },
    { d: ym + '-03', descr: 'GREENVIEW RENT', amount_minor: -300000, cat: 'Rent' },
    { d: ym + '-04', descr: 'HOME LOAN EMI', amount_minor: -85000, cat: 'Loan' },
    { d: ym + '-05', descr: 'CITY HYPERMARKET', amount_minor: -spend, cat: 'Grocery' },
    { d: ym + '-14', descr: 'INDEX FUND SIP', amount_minor: -50000, cat: 'Investment' },
    { d: ym + '-18', descr: 'SUNRISE CAFETERIA', amount_minor: -1400, cat: 'Food' }
  ];
}
const rows = [].concat(month('2026-01', 200000), month('2026-02', 220000), month('2026-03', 180000), month('2026-04', 210000));
const TODAY = '2026-05-10';
const M = E.build(rows.concat([{ d: '2026-05-02', descr: 'CITY HYPERMARKET', amount_minor: -30000, cat: 'Grocery' }]), { today: TODAY });

t('build: months, full months and the running partial month', () => {
  eq(M.months.length, 5); eq(M.fullMonths.length, 4); eq(M.lastPartial, true);
});
t('build: per-month totals and net in minor units (investing counts as kept)', () => {
  const p = M.per['2026-01'];
  eq(p.income, 1000000); eq(p.spend, 300000 + 200000 + 1400); eq(p.debtpay, 85000); eq(p.invest, 50000);
  eq(p.net, 1000000 - 501400 - 85000);
});
t('build: keep-rate is net over income across full months', () => {
  const avgSpend = (501400 + 521400 + 481400 + 511400) / 4;
  const expected = (1000000 - avgSpend - 85000) / 1000000 * 100;
  ok(Math.abs(M.cashKeptRate - expected) < 0.01, 'keep-rate ' + M.cashKeptRate + ' vs ' + expected);
  ok(M.score > 0 && M.score <= 100);
});
t('monthStatus: pace and kept-so-far for the running month', () => {
  const st = E.monthStatus(M, 2000, TODAY);
  eq(st.month, '2026-05'); eq(st.live, true); eq(st.day, 10);
  eq(st.out, 30000); eq(st.inn, 0); eq(st.salaryIn, false); eq(st.rate, null);
  eq(st.pace, Math.round(M.avg.out * 10 / 30.44));
});
t('monthStatus: once salary lands the rate and gap are measured against the target', () => {
  const M2 = E.build(rows.concat([{ d: '2026-05-01', descr: 'SALARY — ACME', amount_minor: 1000000, cat: 'Income' }, { d: '2026-05-02', descr: 'CITY HYPERMARKET', amount_minor: -30000, cat: 'Grocery' }]), { today: TODAY });
  const st = E.monthStatus(M2, 2000, TODAY);
  eq(st.salaryIn, true); eq(st.keptNow, 970000); eq(st.rate, 97); eq(st.onTarget, true);
  eq(st.allowance, 1000000 * 0.8 - 30000);
});
t('pathStatus: scores the latest full month against the ramp', () => {
  const ps = E.pathStatus(M, { target_keep_bp: 2000, ramp_months: 6 }, null, TODAY);
  eq(ps.lm, '2026-04'); eq(ps.newBase, true); eq(ps.base.m, '2026-01');
  ok(typeof ps.ok === 'boolean'); ok(ps.actual > 30, 'actual keep-rate well above target → on path'); eq(ps.ok, true);
});
t('pathStatus: a month with no salary is skipped, not scored', () => {
  const noSal = rows.filter((r) => !(r.d.startsWith('2026-04') && r.cat === 'Income'));
  const Mx = E.build(noSal, { today: TODAY });
  const ps = E.pathStatus(Mx, { target_keep_bp: 2000, ramp_months: 6 }, null, TODAY);
  eq(ps.lm, '2026-03'); eq(ps.skipped, 1);
});
t('projNext: three projected months, kept = inc − out + invested', () => {
  const pj = E.projNext(M, 3);
  eq(pj.length, 3); eq(pj[0].m, '2026-06');
  pj.forEach((p) => eq(p.kept, p.inc - p.out + 50000));
});
t('a loan with no payment history yet is counted in the forecast', () => {
  const M2 = E.build(rows, { today: '2026-05-10', catClass: () => 'disc', emiMonthly: 85000 + 120000 });
  eq(M2.extraDebt, 120000); eq(M2.fc.out, M.fc.out + 120000);
  eq(E.projNext(M2, 1)[0].out, E.projNext(M, 1)[0].out + 120000);
});
t('monthShort never reads as a day: "Sep 2026", not "Sept 26"', () => {
  eq(E.monthShort('2026-09'), 'Sep 2026'); eq(E.monthShort('2026-01'), 'Jan 2026');
});
t('monthStatus: committed EMIs count, safe-to-spend keeps the target', () => {
  const M2 = E.build(rows.concat([{ d: '2026-05-01', descr: 'SALARY — ACME', amount_minor: 1000000, cat: 'Income' }, { d: '2026-05-03', descr: 'CITY HYPERMARKET', amount_minor: -100000, cat: 'Grocery' }]), { today: '2026-05-10', catClass: () => 'disc' });
  const st = E.monthStatus(M2, 2000, '2026-05-10', { debt: 85000, other: 0 });
  eq(st.committed, 85000); eq(st.keptNow, 900000);
  eq(st.reserve, 200000);
  eq(st.safe, 1000000 - 100000 - 85000 - 200000);
  ok(st.projKept < st.keptNow - 85000, 'projection assumes the usual pace for the days left');
  ok(st.safePerDay > 0 && st.safePerDay <= st.safe);
});
t('committedThisMonth: only what is still due this month', () => {
  const emis = [{ id: 'e1', name: 'Car', emi_minor: 165000, total_n: 48, due_day: 20, start_month: '2025-03', apr_bp: 399, auto_post: 1 },
                { id: 'e2', name: 'Old', emi_minor: 95000, total_n: 36, due_day: 5, start_month: '2024-01', apr_bp: 650, auto_post: 1 }];
  const c = E.committedThisMonth(emis, [], '2026-10-14');
  eq(c.debt, 165000, 'the 5th has passed; the 20th is still to come'); eq(c.other, 0);
  eq(E.committedThisMonth(emis, [], '2026-10-25').debt, 0);
});
t('timeCost: money as hours at work', () => {
  const M2 = E.build(rows, { today: '2026-05-10', catClass: () => 'disc' });   // 10,000/month → ~56.8/hour
  eq(E.timeCost(-5682, M2), '1h'); ok(/day/.test(E.timeCost(-210000, M2))); eq(E.timeCost(-100, M2), '1 min');
  eq(E.timeCost(-5000, { hourly: 0 }), null);
});
t('weekSummary and lesson draw on the record', () => {
  const w = E.weekSummary(rows, '2026-04-20');
  eq(w.cur, 1400, 'cafeteria on the 18th'); eq(w.top, 'Food'); eq(w.daysLogged, 2, 'the SIP on the 14th and the cafeteria');
  const l = E.lesson(M, { currency: 'AED' }, [], '2026-05-10');
  ok(l && l.title && l.lead && /AED/.test(l.lead), JSON.stringify(l));
  const seen = {}; for (let d = 1; d < 40; d++) { const x = E.lesson(M, { currency: 'AED' }, [{ name: 'Car', emi_minor: 165000, apr_bp: 399 }], '2026-01-' + String(Math.min(28, d)).padStart(2, '0')); seen[x.k] = 1; }
  ok(Object.keys(seen).length >= 4, 'rotates through several ideas: ' + Object.keys(seen));
});
t('fees: school fees and licences are not bank charges', () => {
  const r2 = rows.concat([{ d: '2026-02-07', descr: 'SCHOOL FEES - GEMS', amount_minor: -185000, cat: 'Education' }, { d: '2026-02-09', descr: 'CARD ANNUAL FEE', amount_minor: -31500, cat: 'Misc' }, { d: '2026-02-10', descr: 'VISA RENEWAL FEES', amount_minor: -50000, cat: 'Misc' }]);
  const f = E.fees(E.build(r2, { today: '2026-05-10', catClass: () => 'disc' }));
  eq(f.n, 1); eq(f.tot, 31500);
});
t('pl / cashflow / breakeven agree with the totals', () => {
  const p = E.pl(M);
  eq(p.rev, 1000000); eq(p.F, 300000); eq(p.P, 85000); eq(p.I, 50000);
  eq(p.net, p.rev - p.spend - p.P - p.I);
  const cf = E.cashflow(M); eq(cf.op, M.totalIncome + M.totalRefund - M.totalSpend);
  const be = E.breakeven(M); eq(be.committed, 385000); ok(be.day >= 1 && be.day <= 31);
});
t('budgetDefaults round to the nearest 10 units and never go below 10', () => {
  const b = E.budgetDefaults(M);
  Object.values(b).forEach((v) => { eq(v % 1000, 0); ok(v >= 1000); });
  eq(b.Rent, 300000);
});

/* ------------------------------------------------------------- EMIs */
const emi = { id: 'kemi_1', name: 'Car loan', emi_minor: 85000, total_n: 48, due_day: 5, start_month: '2024-01', apr_bp: 450 };
t('emiDerive: months left, money left, end month, next due', () => {
  const d = E.emiDerive(emi, [], '2026-05-10');
  eq(d.done, 29); eq(d.left, 19); eq(d.remaining, 19 * 85000); eq(d.endYm, '2027-12');
  eq(E.iso(d.next), '2026-06-05'); eq(d.cls, 'bad', 'due on the 5th, today is the 10th, nothing recorded');
});
t('emiDerive: a posted row or a loan-looking row of the same amount counts as paid', () => {
  const posted = E.emiDerive(emi, [{ d: '2026-05-05', descr: 'Car loan EMI', amount_minor: -85000, cat: 'Loan', remark: 'emi:kemi_1' }], '2026-05-10');
  eq(posted.status, 'paid this month');
  const statement = E.emiDerive(emi, [{ d: '2026-05-06', descr: 'AUTO LOAN INSTALMENT', amount_minor: -85200, cat: 'Loan' }], '2026-05-10');
  eq(statement.status, 'paid this month', 'within 1% tolerance');
});
t('emiDerive: due day clamps to the month length', () => {
  const e31 = { ...emi, due_day: 31, start_month: '2026-01' };
  eq(E.iso(E.emiDueDate(e31, 1)), '2026-02-28');
});
t('emiTimeline: load steps down the month after the last instalment', () => {
  const tl = E.emiTimeline([emi, { ...emi, id: 'kemi_2', name: 'Phone', emi_minor: 20000, total_n: 24, start_month: '2025-01' }], [], 36, '2026-05-10');
  eq(tl.length, 36); eq(tl[0].ym, '2026-05'); eq(tl[0].load, 105000);
  const dec26 = tl.find((x) => x.ym === '2026-12'); eq(dec26.ends.length, 1); eq(dec26.ends[0].id, 'kemi_2');
  eq(tl.find((x) => x.ym === '2027-01').load, 85000);
  eq(tl.find((x) => x.ym === '2027-12').ends[0].id, 'kemi_1');
  eq(tl.find((x) => x.ym === '2028-01').load, 0);
});
t('emiSummary: totals, debt-free month, recorded count', () => {
  const s = E.emiSummary([emi], [], '2026-05-10');
  eq(s.n, 1); eq(s.monthly, 85000); eq(s.endYm, '2027-12'); eq(s.paid, 0); eq(s.dueN, 1); eq(s.unrecorded.length, 1);
});
t('simulate: avalanche never pays more interest than snowball', () => {
  const loans = [{ id: 'a', emi: 85000, balance: 1500000, apr: 4.5 }, { id: 'b', emi: 20000, balance: 300000, apr: 24 }];
  const snow = E.simulate(loans, 50000, 'snow'), ava = E.simulate(loans, 50000, 'ava'), base = E.simulate(loans, 0, 'snow');
  ok(ava.interest <= snow.interest); ok(ava.months <= base.months); eq(ava.killed.length, 2);
});
t('upcoming: EMI due dates and recurring occurrences in the window, sorted', () => {
  const rules = [{ id: 'r1', descr: 'Rent', amount_minor: -300000, cat: 'Rent', freq: 'monthly', start_d: '2025-01-03', end_d: '' },
                 { id: 'r2', descr: 'Salary', amount_minor: 1000000, cat: 'Income', freq: 'monthly', start_d: '2025-01-01', end_d: '' }];
  const u = E.upcoming([emi], rules, 60, '2026-05-10');
  eq(u.length, 2 + 2 + 2); // two EMI dues (Jun 5, Jul 5) + two rents + two salaries
  for (let i = 1; i < u.length; i++) ok(u[i].d >= u[i - 1].d, 'sorted');
  eq(u[0].d, '2026-06-01');
});
t('stepDate: the 31st in a short month lands on the last day', () => {
  eq(E.iso(E.stepDate(E.parse('2026-01-31'), 'monthly')), '2026-02-28');
});
t('lifePlan: a higher keep-rate reaches more of the corpus', () => {
  const L = E.lifePlan(M, { age: 32, retireAge: 60, ret: 7, infl: 3, nw: 0, kids: [2020], majors: [], kidCost: 25000000 }, TODAY);
  ok(L.cov20 >= 0); ok(L.paths[2].v.ret > L.paths[1].v.ret); eq(L.kids.length, 1); eq(L.kids[0].yrs, 12);
});

/* ----------------------------------------------------------- import */
t('mapCols: exact then fuzzy header matching', () => {
  const m = IM.mapCols(['Month', 'Txn Date', 'Expense', 'Amount', 'Category', 'Remarks']);
  eq(m.date, 1); eq(m.desc, 2); eq(m.amount, 3); eq(m.cat, 4); eq(m.rem, 5); eq(m.credit, -1);
  const b = IM.mapCols(['Posting Date', 'Narration', 'Debit', 'Credit']);
  eq(b.date, 0); eq(b.desc, 1); eq(b.amount, 2); eq(b.credit, 3);
});
t('rowsFromAOA: header row found, serial dates, amounts to minor units, debit/credit', () => {
  const r = IM.rowsFromAOA([['Statement'], ['Date', 'Narration', 'Debit', 'Credit', 'Category'],
    [46023, 'CITY HYPERMARKET', 420, '', 'Grocery'], ['03/01/2026', 'SALARY', '', '9,500.00', 'Income'], ['2026-01-04', 'empty', '', '', '']]);
  eq(r.headerRow, 1); eq(r.rows.length, 2); eq(r.skipped, 1);
  eq(r.rows[0].d, '2026-01-01'); eq(r.rows[0].amount_minor, -42000);
  eq(r.rows[1].d, '2026-01-03'); eq(r.rows[1].amount_minor, 950000); eq(r.rows[1].cat, 'Income');
  eq(r.mapping.amount, 'Debit');
});
t('rowsFromAOA: a Type column fixes the sign', () => {
  const r = IM.rowsFromAOA([['Date', 'Description', 'Amount', 'Type'], ['2026-02-01', 'A', 10, 'DR'], ['2026-02-02', 'B', 10, 'CR']]);
  eq(r.rows[0].amount_minor, -1000); eq(r.rows[1].amount_minor, 1000);
});
t('rowsFromAOA: no usable header throws a plain message', () => {
  let msg = ''; try { IM.rowsFromAOA([['a', 'b'], [1, 2]]); } catch (e) { msg = e.message; }
  ok(/Could not find/.test(msg));
});
t('sample rows are invented and in the upload layout', () => {
  const s = IM.sampleRows('2026-03-15'); eq(s.length, 16); eq(s[0].d, '2026-03-01'); eq(s[0].amount_minor, 950000);
  const aoa = IM.toAOA(s); eq(aoa[0].join(','), 'Month,Date,Expense,Amount,Category,Remarks'); eq(aoa[1][3], 9500);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
