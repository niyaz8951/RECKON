/* KEPT's recurrence detector and the cards it feeds (kept/kept-recur.js),
   against a 13-month seeded Dubai ledger (invented): what repeats is found,
   what does not is left alone, heads-ups come ~30 days before a yearly or
   quarterly bill, the set-aside spreads the next bill over the days left,
   and look-backs fire only on a real change. Pure. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['kept/kept-engine.js', 'kept/kept-recur.js']) vm.runInContext(readFileSync(resolve(ROOT, f), 'utf8'), ctx);
const R = ctx.KeptRecur, KE = ctx.KeptEngine;

/* ---------------------------------------------- 13 months, Dubai, invented */
let rnd = 7; const r = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
const rows = []; let id = 0;
const add = (d, descr, amount, cat, remark) => rows.push({ id: 'ktx_' + (++id), d, descr, amount_minor: Math.round(amount), cat, remark: remark || '' });
const months = []; for (let i = 0; i < 14; i++) { const d = new Date(2025, 8 + i, 1); months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }   // 2025-09 … 2026-10
for (const ym of months) {
  const last = ym === '2026-10';
  add(ym + '-01', 'SALARY ACME TRADING LLC', 1850000, 'Income');
  add(ym + '-0' + (2 + Math.floor(r() * 3)), 'GREENVIEW PROPERTIES RENT', -650000, 'Rent');
  if (!last || true) add(ym + '-10', 'POS 4417 NETFLIX.COM DUBAI ARE', -5600, 'Subscriptions');
  add(ym + '-06', 'DEWA BILL ' + ym, -(38000 + Math.round(r() * 30000)), 'Utilities');                         // varies too much to be "the same"
  for (const day of ['05', '12']) add(ym + '-' + day, 'CARREFOUR MOE ' + Math.floor(r() * 9000), -(30000 + r() * 25000), 'Grocery');
  add(ym + '-15', 'CAR LOAN EMI', -180000, 'Loan', 'emi:kemi_1');                                              // KEPT posted it: known already
  if (ym <= '2026-06') add(ym + '-11', 'SPOTIFY P0' + ym.slice(5), -2199, 'Subscriptions');                       // stopped in June
  add(ym + '-20', 'ZOMATO ORDER', -(4000 + r() * 6000), 'Dining');
}
// Dining doubled in September 2026 (for the look-back).
for (let k = 0; k < 6; k++) add('2026-09-2' + k, 'ZOMATO ORDER #' + k, -9000, 'Dining');
// Yearly and quarterly.
add('2024-11-14', 'AXA CAR INSURANCE RENEWAL', -230000, 'Insurance');
add('2025-11-12', 'AXA CAR INSURANCE RENEWAL', -240000, 'Insurance');
for (const d of ['2025-09-07', '2025-12-08', '2026-03-07', '2026-06-08', '2026-09-07']) add(d, 'GEMS SCHOOL FEES TERM', -1250000, 'School');
add('2026-02-02', 'FITNESS FIRST ANNUAL', -320000, 'Health');                                                  // once: not a pattern yet

const TODAY = '2026-10-17';
const found = R.detect(rows, TODAY);
const by = (k) => found.find((p) => p.key === k);

t('normKey: card noise, numbers and city names fall away', () => {
  eq(R.normKey('POS 4417 NETFLIX.COM DUBAI ARE'), 'NETFLIX COM');
  eq(R.normKey('Netflix.com'), 'NETFLIX COM');
  eq(R.normKey('CARREFOUR MOE 1234'), 'CARREFOUR MOE');
  eq(R.normKey('AXA CAR INSURANCE RENEWAL'), 'AXA CAR INSURANCE');
});
t('detect: monthly, quarterly and yearly payments are found with their next date', () => {
  const nf = by('NETFLIX COM'); ok(nf, 'netflix: ' + found.map((p) => p.key).join(', '));
  eq(nf.freq, 'monthly'); eq(nf.amount, 5600); eq(nf.next_d, '2026-11-10');
  const ins = by('AXA CAR INSURANCE'); ok(ins); eq(ins.freq, 'yearly'); eq(ins.n, 2); eq(ins.next_d, '2026-11-12'); eq(ins.amount, 235000);
  eq(ins.label, 'Axa Car Insurance');
  ok(/2 times, a year apart, each within 15%/.test(ins.why), ins.why);
  const sch = by('GEMS SCHOOL FEES'); ok(sch); eq(sch.freq, 'quarterly'); eq(sch.next_d, '2026-12-07');
  ok(by('GREENVIEW PROPERTIES RENT') && by('GREENVIEW PROPERTIES RENT').freq === 'monthly', 'rent drifts 2–4th: still monthly');
});
t('detect: leaves alone what does not repeat cleanly, what KEPT posted, what stopped, and what happened once', () => {
  ok(!by('CARREFOUR MOE'), 'groceries come twice a month');
  ok(!found.some((p) => /DEWA/.test(p.key)), 'DEWA varies by more than 15%');
  ok(!by('CAR LOAN EMI'), 'EMI rows are already known');
  ok(!found.some((p) => /SPOTIFY/.test(p.key)), 'stopped in June');
  ok(!by('FITNESS FIRST ANNUAL'), 'one payment is not a pattern');
  ok(!found.some((p) => p.key.startsWith('SALARY')), 'income is not a bill');
});
t('headsUps: car insurance ~26 days out gets one card with its reason; monthly bills and far-off ones do not', () => {
  const cards = R.headsUps(found, [], TODAY, { avgSpend: 900000 });
  eq(cards.length, 1, cards.map((c) => c.key).join(','));
  const c = cards[0];
  eq(c.type, 'heads-up'); eq(c.key, 'AXA CAR INSURANCE');
  eq(c.title, 'Axa Car Insurance was 2,400 on 12 Nov last year.');
  eq(c.perDay, Math.ceil(235000 / 26)); ok(/Set aside 90 a day/.test(c.body), c.body);
  eq(c.eyebrow, 'Coming up · 26 days'); ok(c.why.startsWith('Shown because'));
  ok(c.score > 0.4 && c.score <= 1, 'score ' + c.score);
  eq(R.headsUps(found, [], '2026-11-20').map((x) => x.key).join(), 'GEMS SCHOOL FEES', 'school fees 17 days before the term');
  eq(R.headsUps(found, [], '2026-09-01').length, 0, 'nothing within 30 days');
});
t('headsUps: an answered pattern stays quiet', () => {
  eq(R.headsUps(found, [{ key: 'AXA CAR INSURANCE', status: 'dismissed' }], TODAY).length, 0);
  eq(R.headsUps(found, [{ key: 'AXA CAR INSURANCE', status: 'reserved' }], TODAY).length, 0);
  eq(R.headsUps(found, [{ key: 'AXA CAR INSURANCE', status: 'confirmed' }], TODAY).length, 1, 'confirmed but not reserved still offers the set-aside');
});
t('setAside: a reserved bill holds back its daily share for the rest of the month; after it is paid the fund restarts', () => {
  const ans = [{ key: 'AXA CAR INSURANCE', status: 'reserved', reserve_from: TODAY, amount_minor: 235000, next_d: '2026-11-12' }];
  const s = R.setAside(found, ans, TODAY);
  eq(s.items.length, 1); eq(s.items[0].perDay, Math.ceil(235000 / 26));
  eq(s.total, Math.round(235000 / 26 * 14), '14 days left in October');
  const nov = R.setAside(found, ans, '2026-11-01');
  eq(nov.total, Math.round(235000 / 26 * 11), 'November: up to the 12th');
  // Paid on the 12th: next year's bill, spread from that payment.
  const paid = rows.concat([{ id: 'p', d: '2026-11-12', descr: 'AXA CAR INSURANCE RENEWAL', amount_minor: -245000, cat: 'Insurance' }]);
  const f2 = R.detect(paid, '2026-11-13');
  eq(f2.find((p) => p.key === 'AXA CAR INSURANCE').next_d, '2027-11-12');
  const after = R.setAside(f2, ans, '2026-11-13');
  ok(after.items[0].perDay < 700 && after.items[0].perDay > 600, 'about a 365th: ' + after.items[0].perDay);
  eq(R.setAside(found, [], TODAY).total, 0, 'nothing reserved, nothing held');
});
t('lookback: early in the month, the biggest category move against last month and last year; quiet after the 10th', () => {
  const M = KE.build(rows, { today: '2026-10-03' });
  const cards = R.lookback(M, '2026-10-03', { targetBp: 2000 });
  const dining = cards.find((c) => /^cat:month:2026-09:Dining$/.test(c.key));
  ok(dining, cards.map((c) => c.key).join(', '));
  ok(/^Dining: .* in September — \d+% more than August\.$/.test(dining.title), dining.title);
  ok(/moved by \d+%/.test(dining.why));
  ok(cards.every((c) => c.score > 0 && c.score <= 1));
  eq(R.lookback(M, '2026-10-15').length, 0);
  eq(R.lookback(null, '2026-10-03').length, 0);
});
t('lookback: a keep-rate target crossed gets its own card', () => {
  const per = { '2026-08': { income: 1000000, refund: 0, spend: 850000, debtpay: 0, byCat: {} }, '2026-09': { income: 1000000, refund: 0, spend: 750000, debtpay: 0, byCat: {} } };
  const cards = R.lookback({ per, months: ['2026-08', '2026-09'] }, '2026-10-02', { targetBp: 2000 });
  eq(cards.length, 1); eq(cards[0].title, 'September kept 25% — over your 20% target.');
});
t('importCard: only while under three months are on file', () => {
  eq(R.importCard({ months: ['2026-09', '2026-10'] }).length, 1);
  ok(/2 months/.test(R.importCard({ months: ['2026-09', '2026-10'] })[0].why));
  eq(R.importCard({ months: months }).length, 0);
  eq(R.importCard(null)[0].key, 'import');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
