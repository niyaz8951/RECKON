/* SPENT's maths (spent/spent-engine.js): a day as minutes by class, the
   keep-rate for time, today's status, the week, the lesson. Pure. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(resolve(ROOT, 'spent/spent-engine.js'), 'utf8'), ctx);
const E = ctx.SpentEngine;
const P = E.profileOf({});

t('hm formats minutes the way a person reads them', () => {
  eq(E.hm(0), '0m'); eq(E.hm(45), '45m'); eq(E.hm(60), '1h'); eq(E.hm(135), '2h 15m'); eq(E.hm(-30), '−30m'); eq(E.hm(65), '1h 05m');
});
t('profileOf fills defaults and drops unknown classes', () => {
  eq(P.cats.length, 13); eq(P.target_bp, 2000); eq(P.weekend.join(','), '5,6');
  const q = E.profileOf({ cats: [{ key: 'sleep', name: 'Sleep', cls: 'fixed' }, { key: 'x', name: 'X', cls: 'nope' }], target_bp: 30000 });
  eq(q.cats[1].cls, 'leak'); eq(q.target_bp, 10000);
});
t('dayStats: classes, waking minutes, keep-rate', () => {
  const s = E.dayStats({ sleep: 420, work: 540, commute: 60, meals: 90, family: 120, learning: 60, screen: 90, bogus: 999 }, P);
  eq(s.total, 1380); eq(s.sleep, 420); eq(s.waking, 1020); eq(s.cls.fixed, 1020); eq(s.cls.ess, 90); eq(s.cls.mine, 180); eq(s.cls.leak, 90);
  eq(Math.round(s.rate * 10) / 10, 17.6); eq(s.unallocated, 60); eq(s.blocks.bogus, undefined);
});
t('cleanBlocks refuses negatives and caps at a day; usual() follows weekend days', () => {
  const b = E.cleanBlocks({ sleep: -5, work: 9999, family: '30' }, P);
  eq(b.sleep, undefined); eq(b.work, 1440); eq(b.family, 30);
  eq(E.usual('2026-10-16', P).work, undefined, 'Friday is a weekend day in the default profile');
  eq(E.usual('2026-10-14', P).work, 540, 'Wednesday is a weekday');
});
t('todayStatus: committed, free, still needed, reachable', () => {
  // 09:00 on a weekday with 7h sleep logged and 1h family already.
  const ts = E.todayStatus({ sleep: 420, family: 60 }, P, 9 * 60, '2026-10-14');
  eq(ts.left, 900); eq(ts.committed, 540 + 60 + 90 + 45, 'work, commute, meals, chores still to come'); eq(ts.free, 900 - 735);
  eq(ts.reserve, 204, '20% of 17h waking'); eq(ts.stillNeeded, 144); eq(ts.reachable, true);
  const late = E.todayStatus({ sleep: 420, work: 540, commute: 60, meals: 90, chores: 45, screen: 120 }, P, 23 * 60, '2026-10-14');
  const blank = E.todayStatus({}, P, 30, '2026-10-14'); eq(blank.stats.waking, 1020, 'waking sized from the usual night'); eq(blank.reachable, true);
  eq(late.free, 60); eq(late.stillNeeded, 204); eq(late.reachable, false);
});
function days(n, from, blocks) { const out = []; for (let i = 0; i < n; i++) out.push({ d: E.addDays(from, i), blocks: typeof blocks === 'function' ? blocks(i) : blocks }); return out; }
t('build: averages, streak, best day, prior week', () => {
  const list = days(10, '2026-10-05', (i) => ({ sleep: 420, work: 540, commute: 60, meals: 90, family: 60 + i * 10, screen: 100 - i * 5 }));
  const M = E.build(list, P, '2026-10-14');
  eq(M.n, 10); eq(M.streak, 10); eq(M.best.d, '2026-10-14'); eq(M.week.n, 7); eq(M.prevWeek.n, 3);
  ok(M.week.kept > M.prevWeek.kept, 'family grows');
  ok(M.week.rate > 0 && M.week.rate < 100); eq(Math.round(M.week.cat.sleep), 420);
  const gap = E.build(list.filter((x) => x.d !== '2026-10-14' && x.d !== '2026-10-13'), P, '2026-10-14');
  eq(gap.streak, 0, 'a gap of two days ends the streak');
  eq(E.build([], P, '2026-10-14').n, 0);
});
t('weekRows: seven days ending today, empty where nothing was logged', () => {
  const M = E.build(days(3, '2026-10-12', { sleep: 420, family: 60 }), P, '2026-10-14');
  const w = E.weekRows(M, '2026-10-14');
  eq(w.length, 7); eq(w[0].d, '2026-10-08'); eq(w[6].d, '2026-10-14'); eq(w[6].row.s.kept, 60); eq(w[0].row, null);
});
t('lesson rotates and prices time when KEPT provides an hourly rate', () => {
  const M = E.build(days(10, '2026-10-05', { sleep: 400, work: 540, commute: 70, meals: 90, family: 60, screen: 120 }), P, '2026-10-14');
  const seen = {};
  for (let d = 1; d <= 20; d++) { const l = E.lesson(M, '2026-10-' + String(d).padStart(2, '0'), 5000, (m) => 'AED ' + Math.round(m / 100)); seen[l.k] = 1; ok(l.lead && l.why); }
  ok(seen.commute && seen.screen && seen.sleep && seen.money, Object.keys(seen).join(','));
  eq(E.lesson(E.build([], P, '2026-10-14'), '2026-10-14'), null);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
