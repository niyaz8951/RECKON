/* DECIDED's maths (decided/decided-engine.js): open/due/reviewed, calibration
   buckets, the verdict, the lesson. Pure. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(resolve(ROOT, 'decided/decided-engine.js'), 'utf8'), ctx);
const E = ctx.DecidedEngine;

let n = 0;
const dec = (o) => Object.assign({ id: 'dec_' + (++n), title: 'D' + n, domain: 'life', stakes: 'medium', reversible: 1, confidence: 70, decided_on: '2026-09-01', review_on: '2026-10-01', status: 'open' }, o);
const reviewed = (conf, hit, score, extra) => dec(Object.assign({ confidence: conf, status: 'reviewed', as_expected: hit ? 1 : 0, outcome_score: score || 3, reviewed_at: '2026-10-02T00:00:00Z', outcome: 'x' }, extra || {}));

t('build: open, due, upcoming, reviewed; deleted rows ignored', () => {
  const M = E.build([dec({ review_on: '2026-10-10' }), dec({ review_on: '2026-10-20' }), dec({ review_on: '2026-10-15' }), reviewed(70, true), dec({ deleted_at: 'x' })], '2026-10-15');
  eq(M.all.length, 4); eq(M.open.length, 3); eq(M.due.length, 2); eq(M.upcoming.length, 1); eq(M.reviewed.length, 1);
  eq(M.due[0].review_on, '2026-10-10', 'oldest due first');
});
t('calibration: mean confidence vs hit-rate, gap, Brier, buckets', () => {
  const list = [reviewed(80, true), reviewed(80, false), reviewed(80, true), reviewed(80, false), reviewed(60, true), reviewed(90, true, 5), reviewed(95, false, 1)];
  const M = E.build(list, '2026-10-15');
  eq(M.n, 7); eq(M.hits, 4); eq(Math.round(M.meanConf), 81); eq(Math.round(M.hitRate), 57);
  ok(M.gap > 20, 'overconfident: ' + M.gap);
  ok(M.brier > 0.2 && M.brier < 0.5, 'brier ' + M.brier);
  const b80 = M.buckets.filter((b) => b.bucket === '80–89')[0];
  eq(b80.n, 4); eq(b80.hit, 50);
  eq(M.better, 1); eq(M.worse, 1); eq(Math.round(M.meanScore * 100) / 100, 3);
  eq(E.verdict(M).tone, 'bad'); ok(/Overconfident by/.test(E.verdict(M).text));
});
t('verdict is honest about thin data and recognises the calibrated and the timid', () => {
  eq(E.verdict(E.build([], '2026-10-15')).tone, 'info');
  eq(E.verdict(E.build([reviewed(70, true), reviewed(70, false)], '2026-10-15')).tone, 'info');
  const good = E.build([reviewed(70, true), reviewed(70, true), reviewed(70, false), reviewed(70, true), reviewed(70, false), reviewed(70, true), reviewed(70, true), reviewed(70, false), reviewed(70, true), reviewed(70, true)], '2026-10-15');
  eq(E.verdict(good).tone, 'good');
  const timid = E.build([reviewed(55, true), reviewed(55, true), reviewed(55, true), reviewed(55, true), reviewed(55, true)], '2026-10-15');
  eq(E.verdict(timid).tone, 'warn'); ok(/Underconfident/.test(E.verdict(timid).text));
});
t('byDomain and own lessons', () => {
  const M = E.build([reviewed(80, true, 4, { domain: 'money', lesson: 'Wait for the sale.' }), reviewed(80, false, 2, { domain: 'money' }), dec({ domain: 'work' })], '2026-10-15');
  const money = M.byDomain.filter((x) => x.key === 'money')[0];
  eq(money.n, 2); eq(money.hit, 50); eq(money.total, 2);
  eq(M.byDomain.filter((x) => x.key === 'work')[0].n, 0);
  eq(M.lessons.length, 1);
  const seen = {}; for (let d = 1; d <= 14; d++) seen[E.lesson(M, '2026-10-' + String(d).padStart(2, '0')).k] = 1;
  ok(seen.own && seen.calibration && seen.premortem, Object.keys(seen).join(','));
});
t('dates and buckets', () => {
  eq(E.addDays('2026-10-15', 30), '2026-11-14'); eq(E.daysBetween('2026-10-01', '2026-10-15'), 14);
  eq(E.bucketOf(50), '50–59'); eq(E.bucketOf(79), '70–79'); eq(E.bucketOf(99), '90–100');
  eq(E.domainOf('nope').key, 'life');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
