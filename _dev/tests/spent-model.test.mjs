/* SPENT's model (spent/spent-model.js) and the engine's v2 parts: where
   minutes came from, assumed days weighing less, the usual day learned per
   weekday, the questions the check-in asks. Pure. Thirteen months of an
   invented Dubai life (Sun–Thu work, Fri/Sat weekend) as the record. */
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
vm.runInContext(readFileSync(resolve(ROOT, 'spent/spent-model.js'), 'utf8'), ctx);
const E = ctx.SpentEngine, SM = ctx.SpentModel;
const P = E.profileOf({});
const TODAY = '2026-10-16';   // a Friday

/* 13 months, deterministic. Weekdays: sleep 7h, work 9h, commute 1h, meals,
   chores, family ~1h30, screen ~1h30. Thursdays: exercise is a coin flip.
   Six weeks ago Tuesday gym (1h) started. Weekends: family ~5h, friends. */
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function history(days = 396) {
  const out = [];
  for (let i = days; i >= 1; i--) {
    const d = E.addDays(TODAY, -i), dw = E.dow(d), we = dw === 5 || dw === 6;
    const b = we ? { sleep: 480, meals: 120, chores: 90, family: 300 + Math.round(rnd() * 4) * 15, friends: 60, screen: 120 }
      : { sleep: 420, work: 540, commute: 60, meals: 90, chores: 45, family: 90 + Math.round(rnd() * 2) * 15, screen: 90 };
    if (dw === 4 && rnd() < 0.5) b.exercise = 60;
    if (dw === 2 && i <= 42) b.exercise = 60;
    out.push({ d, blocks: b, src: {}, confirmed_at: d + 'T20:00:00Z' });
  }
  return out;
}
const H = history();

t('srcOf: no map = pre-v2 = confirmed; an entry wins; else the check-in decides', () => {
  eq(E.srcOf({ blocks: { sleep: 1 } }, 'sleep'), 'confirmed');
  eq(E.srcOf({ src: { sleep: 'focus' } }, 'sleep'), 'focus');
  eq(E.srcOf({ src: {}, confirmed_at: 'x' }, 'work'), 'confirmed');
  eq(E.srcOf({ src: {}, confirmed_at: null }, 'work'), 'assumed');
  eq(E.srcOf({ src: { work: 'bogus' }, confirmed_at: null }, 'work'), 'assumed');
});
t('with no record the model is the Usual day rules, and nothing is "known"', () => {
  const m = SM.fit([], P, TODAY);
  const p = m.predictDay('2026-10-15');   // Thursday
  for (const k of Object.keys(P.rules.weekday)) eq(p.blocks[k], P.rules.weekday[k], k);
  eq(Object.keys(p.blocks).length, Object.keys(P.rules.weekday).length);
  eq(p.conf.work.from, 'rules'); eq(p.conf.work.high, false);
  const w = m.predictDay('2026-10-17');   // Saturday
  eq(w.blocks.sleep, 480); eq(w.blocks.work, undefined);
});
t('thirteen months in: steady parts are known, the prediction follows the record', () => {
  const m = SM.fit(H, P, TODAY);
  const p = m.predictDay('2026-10-14');   // Wednesday
  eq(p.blocks.work, 540); eq(p.blocks.sleep, 420); ok(p.conf.work.high && p.conf.sleep.high, 'steady = high confidence');
  ok(p.conf.work.n >= 50, 'every Wednesday counted');
  ok(Math.abs(p.blocks.family - 105) <= 15, 'family about 1h45: ' + p.blocks.family);
  const sat = m.predictDay('2026-10-17');
  ok(sat.blocks.family >= 300 && sat.blocks.family <= 360, 'weekend family ~5h: ' + sat.blocks.family);
  eq(sat.blocks.work, undefined, 'no work learned for Saturdays');
});
t('half-life four weeks: a routine six weeks old already carries about two thirds of the weight (Tuesday gym)', () => {
  const m = SM.fit(H, P, TODAY);
  const tue = m.predictDay('2026-10-20');
  ok(tue.blocks.exercise >= 35 && tue.blocks.exercise <= 50, 'Tuesday exercise predicted: ' + tue.blocks.exercise);
  ok(m.questionsFor('2026-10-20', 5).some((q) => q.key === 'exercise'), 'and, still settling, it is asked about');
  const mon = m.predictDay('2026-10-19');
  eq(mon.blocks.exercise, undefined, 'Monday unchanged');
});
t('assumed minutes never teach the model', () => {
  const fake = [];
  for (let i = 1; i <= 30; i++) fake.push({ d: E.addDays(TODAY, -i), blocks: { sleep: 300, work: 900 }, src: {}, confirmed_at: null });
  const m = SM.fit(fake, P, TODAY);
  eq(m.predictDay('2026-10-14').blocks.work, 540, 'still the rule');
  eq(m.samples(3, 'work'), 0);
  const mixed = fake.map((x) => ({ ...x, src: { sleep: 'confirmed' } }));
  eq(SM.fit(mixed, P, TODAY).samples(3, 'sleep') > 0, true, 'a confirmed key in an unconfirmed day still counts');
});
t('questions: a known weekday asks one thing; a varying category is asked with its reason', () => {
  const m = SM.fit(H, P, TODAY);
  const wed = m.questionsFor('2026-10-14', 5);
  eq(wed[0].kind, 'usual'); eq(wed[0].title, 'Was today a usual Wednesday?');
  ok(wed.length <= 2, 'quiet on a steady day: ' + wed.map((q) => q.title).join(' | '));
  const thu = m.questionsFor('2026-10-15', 5, { when: 'yesterday' });
  eq(thu[0].title, 'Was yesterday a usual Thursday?');
  const ex = thu.find((q) => q.key === 'exercise');
  ok(ex, 'exercise is asked on Thursdays');
  eq(ex.reason, 'Asked because exercise varies on Thursdays.');
  ok(/^About \d/.test(ex.title) || /^Any exercise/.test(ex.title), ex.title);
});
t('questions: never more than the budget, new users are asked about the big blocks and what is theirs', () => {
  const m = SM.fit([], P, TODAY);
  const q = m.questionsFor('2026-10-15', 5);
  eq(q.length, 5); eq(q[0].kind, 'usual');
  ok(q.slice(1).every((x) => /nothing on record/.test(x.reason)));
  ok(q.some((x) => x.key === 'work') && q.some((x) => x.cls === 'mine'), q.map((x) => x.key).join());
  eq(m.questionsFor('2026-10-15', 2).length, 2); eq(m.questionsFor('2026-10-15', 0).length, 0);
  ok(!m.questionsFor('2026-10-15', 5, { exclude: ['work'] }).some((x) => x.key === 'work'), 'exclude');
});
t('followUps after "not a usual day": biggest variable parts first, excluding what was asked', () => {
  const m = SM.fit(H, P, TODAY);
  const f = m.followUps('2026-10-16', 3, { exclude: ['family'] });
  eq(f.length, 3); ok(!f.some((x) => x.key === 'family'));
  ok(f.every((x) => /was not a usual Friday/.test(x.reason)));
  eq(m.followUps('2026-10-16', 0).length, 0);
});
t('fitDay keeps a day inside 24 hours, shrinking drift first and never a locked category', () => {
  const b = SM.fitDay({ sleep: 480, work: 600, family: 300, screen: 240 }, P, { family: 1 });
  ok(E.total(b) <= 1440, 'total ' + E.total(b)); eq(b.family, 300); eq(b.work, 600);
  ok((b.screen || 0) < 240);
  const same = { sleep: 420, work: 540 };
  eq(JSON.stringify(SM.fitDay(same, P, {})), JSON.stringify(same));
});
t('dial presets and range; verdict wording', () => {
  eq(SM.presetsFor({ mean: 60 }).join(), '30,60,90');
  eq(SM.presetsFor({ mean: 0 }).join(), '30,60,120');
  eq(SM.presetsFor({ mean: 20 }).join(), '15,30');   // duplicates removed
  eq(SM.dialMax({ mean: 540 }, { cls: 'fixed' }), 1080);
  eq(SM.dialMax({ mean: 60 }, { cls: 'mine' }), 480);
  eq(SM.verdict(200, 120, 'Thursday'), '3h 20m yours — 1h 20m more than a usual Thursday.');
  eq(SM.verdict(120, 125, 'Friday'), '2h yours — about a usual Friday.');
});
t('build: assumed days fill gaps, weigh about a third, and are counted as assumed', () => {
  const rows = [
    { d: '2026-10-10', blocks: { sleep: 420, family: 120 }, src: null },                         // pre-v2: confirmed
    { d: '2026-10-12', blocks: { sleep: 420, family: 60 }, src: {}, confirmed_at: 'x' }
  ];
  const M = E.build(rows, P, TODAY, { assume: () => ({ sleep: 420, family: 600 }) });
  ok(M.byD['2026-10-11'] && M.byD['2026-10-11'].assumed, 'gap filled');
  eq(M.byD['2026-10-16'], undefined, 'today is never assumed in');
  eq(M.confirmedN, 2); eq(M.n, 6);
  ok(M.week.assumed > 0.5 && M.week.assumed < 0.75, 'share ' + M.week.assumed);
  // Weighted: 2 confirmed (120, 60) + 4 assumed (600) at 0.35.
  const want = (120 + 60 + 4 * 0.35 * 600) / (2 + 4 * 0.35);
  ok(Math.abs(M.week.kept - want) < 0.01, M.week.kept + ' vs ' + want);
  eq(M.streak, 0, 'streak counts checked-in days only');
  eq(M.best.d, '2026-10-10', 'best day is a real one');
  const plain = E.build(rows, P, TODAY);
  eq(plain.n, 2, 'without assume nothing is invented');
});
t('confirmedShare: by minutes, with a checked-in empty day counted as confirmed', () => {
  eq(E.confirmedShare({ blocks: { sleep: 400, family: 100 }, src: { family: 'confirmed' }, confirmed_at: null }, P), 0.2);
  eq(E.confirmedShare({ blocks: {}, src: {}, confirmed_at: 'x' }, P), 1);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
