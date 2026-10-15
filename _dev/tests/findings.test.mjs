/* KEPT findings (kept/kept-core.js): each detector on an invented ledger,
   the ranking rules, and the signature that brings a dismissed finding
   back. All data invented. */
import { resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '../..');
import { createRequire } from 'node:module';
const { computeFindings, fmtMoney } = createRequire(import.meta.url)(resolve(ROOT, 'kept/kept-core.js'));

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };

/* A ledger of five full months plus the current one up to the 14th. */
function ledger(extra) {
  let n = 0; const rows = [];
  const add = (d, descr, a, cat, remark) => rows.push({ id: 'ktx_' + (++n), d, descr, amount_minor: a, cat, remark: remark || '', merchant: null });
  for (const ym of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
    add(ym + '-25', 'SALARY ACME', 1000000, 'Income');
    add(ym + '-03', 'GREENVIEW RENT', -300000, 'Rent');
    add(ym + '-07', 'CITY HYPER ' + ym, -40000 - (Number(ym.slice(5)) * 700), 'Grocery');
    add(ym + '-12', 'SUNRISE CAFE ' + ym, -15000, 'Food');
  }
  if (extra) extra(add);
  rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return rows;
}
const prof = { currency: 'AED', target_keep_bp: 2000 };
const run = (extra, more) => computeFindings({ rows: ledger(extra), emis: [], rules: [], prof, today: '2026-10-14', ...(more || {}) });
const find = (out, kind) => out.items.filter((f) => f.kind === kind);

await t('money is written the way the page writes it', async () => {
  eq(fmtMoney(123456, 'AED'), 'AED 1,235'); eq(fmtMoney(5876, 'AED'), 'AED 59'); eq(fmtMoney(450, 'AED'), 'AED 4.50'); eq(fmtMoney(-300000, 'INR'), 'INR 3,000');
});
await t('a steady monthly charge with no rule is a subscription finding; a rule for it silences it', async () => {
  const extra = (add) => { for (const ym of ['2026-06', '2026-07', '2026-08', '2026-09']) add(ym + '-05', 'STREAMFLIX', -3900, 'Entertainment'); };
  const a = run(extra);
  const f = find(a, 'subscription').find((x) => /STREAMFLIX/.test(x.title));
  ok(f, 'found'); ok(f.facts[0].includes('AED 39 a month')); ok(f.facts[1].includes('AED 468 a year')); eq(f.figures.months, 4);
  const b = run(extra, { rules: [{ descr: 'Streamflix', amount_minor: -3900 }] });
  ok(!find(b, 'subscription').some((x) => /STREAMFLIX/.test(x.title)), 'covered by a rule');
});
await t('a covered regular charge that went up is a price-creep finding', async () => {
  const extra = (add) => { for (const ym of ['2026-06', '2026-07', '2026-08']) add(ym + '-09', 'GYM PLUS', -25000, 'Personal'); add('2026-09-09', 'GYM PLUS', -29000, 'Personal'); };
  const out = run(extra, { rules: [{ descr: 'GYM PLUS', amount_minor: -25000 }] });
  const f = find(out, 'price_creep')[0];
  ok(f, 'creep found'); ok(/AED 250 → AED 290/.test(f.facts[0])); eq(f.figures.yearly_minor, 48000);
});
await t('rent repeating without a rule is housekeeping, never red; nothing merely large is red', async () => {
  const out = run();
  const r = out.items.find((f) => /GREENVIEW RENT/.test(f.title));
  ok(r, 'rent noticed'); eq(r.severity, 'low'); ok(/make it a recurring rule/.test(r.title));
  ok(out.items.every((f) => f.severity !== 'high' || ['salary', 'category_spike', 'income', 'trend'].includes(f.kind)), 'red only for the urgent kinds');
});
await t('weekly shopping is not mistaken for a subscription', async () => {
  const extra = (add) => { for (const ym of ['2026-06', '2026-07', '2026-08', '2026-09']) for (const d of ['02', '09', '16', '23']) add(ym + '-' + d, 'CORNER MART', -5000, 'Grocery'); };
  ok(!find(run(extra), 'subscription').some((x) => /CORNER MART/.test(x.title)));
});
await t('same merchant, same amount, two days apart is a possible double charge; daily coffee is not', async () => {
  const out = run((add) => { add('2026-10-07', 'APPLE.COM/BILL 1234', -4500, 'Electronics'); add('2026-10-08', 'APPLE.COM/BILL 9876', -4500, 'Electronics');
    add('2026-10-08', 'DAILY BREW', -1500, 'Food'); add('2026-10-09', 'DAILY BREW', -1500, 'Food'); });
  const d = find(out, 'duplicate');
  eq(d.length, 1); ok(/APPLE/.test(d[0].title)); ok(/7 Oct and again on 8 Oct/.test(d[0].facts[0])); eq(d[0].rows.length, 2);
});
await t('a category already past its usual month is flagged; a big one-off inside it is folded into the same story', async () => {
  const out = run((add) => { add('2026-10-02', 'CITY HYPER', -90000, 'Grocery'); add('2026-10-06', 'HOMEWARE MEGASTORE', -250000, 'Shopping');
    for (const ym of ['2026-06', '2026-07', '2026-08', '2026-09']) add(ym + '-20', 'NOON ' + ym, -20000 - Number(ym.slice(5)) * 1000, 'Shopping'); });
  const g = find(out, 'category_spike').find((x) => x.cat === 'Grocery');
  ok(g, 'grocery spike'); ok(/already past a usual month/.test(g.title)); ok(/so far vs/.test(g.facts[0]));
  const sh = find(out, 'category_spike').find((x) => x.cat === 'Shopping');
  ok(sh, 'shopping spike'); ok(sh.facts.some((x) => /Mostly one purchase/.test(x) && /HOMEWARE/.test(x)), 'one-off folded in');
  ok(!find(out, 'one_off').some((x) => /HOMEWARE/.test(x.title)), 'not repeated as its own finding');
});
await t('small purchases that add up are found, with the most repeated one named', async () => {
  const out = run((add) => { for (let d = 1; d <= 20; d++) add('2026-09-' + String(d).padStart(2, '0'), d % 2 ? 'KIOSK TEA' : 'METRO TOPUP ' + d, -1800, d % 2 ? 'Food' : 'Transport'); });
  const f = find(out, 'small_leaks')[0];
  ok(f, 'found'); eq(f.figures.count, 20); ok(f.facts.some((x) => /KIOSK TEA: 10 times/.test(x)));
});
await t('fees in the last 90 days are totalled; "recharge", school fees and visa fees are not bank charges', async () => {
  const out = run((add) => { add('2026-09-20', 'LATE PAYMENT FEE', -25000, 'Misc'); add('2026-08-20', 'ANNUAL FEE CARD', -30000, 'Fees'); add('2026-10-01', 'MOBILE RECHARGE', -5000, 'Utilities');
    add('2026-09-07', 'SCHOOL FEES - GEMS', -185000, 'Education'); add('2026-09-09', 'VISA RENEWAL FEES', -50000, 'Misc'); add('2026-09-11', 'GYM MEMBERSHIP FEE', -20000, 'Personal'); });
  const f = find(out, 'fees')[0];
  ok(f); eq(f.figures.count, 2); eq(f.figures.total_minor, 55000);
});
await t('salary later than usual is high severity and leads the list', async () => {
  const out = computeFindings({ rows: ledger(), emis: [], rules: [], prof, today: '2026-10-29' });
  eq(out.items[0].kind, 'salary'); eq(out.items[0].severity, 'high'); ok(/25th; today is the 29th/.test(out.items[0].facts[0]));
  ok(!computeFindings({ rows: ledger(), emis: [], rules: [], prof, today: '2026-10-14' }).items.some((f) => f.kind === 'salary'), 'not before the usual day');
});
await t('an EMI with three or fewer instalments left is good news, and good news always makes the cut', async () => {
  const extra = (add) => { for (let i = 0; i < 14; i++) add('2026-09-' + String(i + 1).padStart(2, '0'), 'THING ' + i + ' ' + 'X'.repeat(i), -(30000 + i * 500), 'Misc'); };
  const emis = [{ id: 'kemi_1', name: 'Car loan', emi_minor: 120000, total_n: 24, due_day: 5, start_month: '2024-12', currency: 'AED' }];
  const out = computeFindings({ rows: ledger(extra), emis, rules: [], prof, today: '2026-10-14' });
  const e = out.items.find((f) => f.kind === 'emi_ending');
  ok(e, 'emi ending present'); eq(e.severity, 'good'); ok(/AED 1,200 a month is yours again from December 2026/.test(e.facts[1]));
  ok(out.items.length <= 12);
});
await t('a month that was expensive last year is flagged before it comes round', async () => {
  const out = run((add) => { add('2025-11-10', 'FLIGHTS HOME', -400000, 'Travel'); for (const ym of ['2026-06', '2026-07', '2026-08', '2026-09']) add(ym + '-14', 'TAXI ' + ym, -10000, 'Travel'); });
  const s = find(out, 'seasonal')[0];
  ok(s, 'seasonal'); ok(/November is usually expensive for Travel/.test(s.title));
});
await t('too little history: no comparisons are invented, and the pack says so', async () => {
  const rows = [{ id: 'a', d: '2026-10-02', descr: 'X', amount_minor: -1000, cat: 'Food' }];
  const out = computeFindings({ rows, emis: [], rules: [], prof, today: '2026-10-14' });
  eq(out.enough_data, false); ok(!out.items.some((f) => ['category_spike', 'small_leaks', 'payday', 'improving'].includes(f.kind)));
});
await t('ids are stable for the same thing; the signature changes when its figures do', async () => {
  const mk = (amt) => run((add) => { for (const ym of ['2026-06', '2026-07', '2026-08', '2026-09']) add(ym + '-05', 'STREAMFLIX', amt, 'Entertainment'); });
  const a = find(mk(-3900), 'subscription').find((x) => /STREAMFLIX/.test(x.title));
  const b = find(mk(-3900), 'subscription').find((x) => /STREAMFLIX/.test(x.title));
  const c = find(mk(-4900), 'subscription').find((x) => /STREAMFLIX/.test(x.title));
  eq(a.id, b.id); eq(a.sig, b.sig); eq(a.id, c.id); ok(a.sig !== c.sig);
  eq(mk(-3900).fingerprint, mk(-3900).fingerprint); ok(mk(-3900).fingerprint !== mk(-4900).fingerprint);
});
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
