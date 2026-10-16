/* Countdowns (spent/spent-goals.js): progress from confirmed category
   minutes or Focus sessions, days left, the pace needed against the pace
   of the last seven days, a projected finish, one verdict in words. Pure. */
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
vm.runInContext(readFileSync(resolve(ROOT, 'spent/spent-goals.js'), 'utf8'), ctx);
const E = ctx.SpentEngine, G = ctx.SpentGoals;
const TODAY = '2026-10-16';
const day = (d, learning, src) => ({ d, blocks: { sleep: 420, learning }, src: src === undefined ? null : src, confirmed_at: src ? 'x' : null });
const course = { id: 'g1', title: 'Python course', start_on: '2026-10-02', due_on: '2026-11-15', target_min: 2400, cat: 'learning' };

t('progress counts confirmed category minutes from the start date, never assumed ones', () => {
  const days = [day('2026-10-01', 600), day('2026-10-05', 60), day('2026-10-10', 90, { learning: 'focus' }), { d: '2026-10-12', blocks: { learning: 300 }, src: {}, confirmed_at: null }];
  const st = G.status(course, days, [], TODAY);
  eq(st.total, 150, 'before the start and assumed minutes are left out');
});
t('a goal without a category counts only its own Focus sessions', () => {
  const g = { id: 'g2', title: 'Book', start_on: '2026-10-10', due_on: '2026-10-30', target_min: 600, cat: null };
  const sessions = [{ goal_id: 'g2', d: '2026-10-12', ended_at: 'x', minutes: 50 }, { goal_id: 'g2', d: '2026-10-13', ended_at: null, minutes: null }, { goal_id: 'other', d: '2026-10-12', ended_at: 'x', minutes: 99 }];
  eq(G.status(g, [day('2026-10-12', 500)], sessions, TODAY).total, 50);
});
t('pace: needed per day over the days left (today included) vs the last seven days', () => {
  const days = []; for (let i = 0; i < 7; i++) days.push(day(E.addDays(TODAY, -i), 60));   // an hour a day this week
  const st = G.status(course, days, [], TODAY);
  eq(st.total, 420); eq(st.daysLeft, 30); eq(st.remaining, 1980);
  ok(Math.abs(st.need - 1980 / 31) < 0.01, 'need ' + st.need);
  eq(st.actual, 60);
  eq(st.state, 'behind', 'an hour a day lands after the date');
  eq(st.projected, E.addDays(TODAY, 32));
  const s = G.say(st);
  eq(s.head, '30 days left');
  ok(/^1h 05m a day needed · 1h a day lately\. Behind — at this pace it lands 17 Nov\.$/.test(s.sub), s.sub);
});
t('on track when the recent pace covers what is needed', () => {
  const days = []; for (let i = 0; i < 7; i++) days.push(day(E.addDays(TODAY, -i), 120));
  const st = G.status(course, days, [], TODAY);
  eq(st.state, 'on-track'); ok(/On track to finish/.test(G.say(st).sub));
});
t('a new goal is not called behind in its first days; its line says the pace to aim for', () => {
  const g = Object.assign({}, course, { start_on: E.addDays(TODAY, -1) });
  const st = G.status(g, [], [], TODAY);
  eq(st.state, 'new'); ok(/a day gets 40h done by 15 Nov/.test(G.say(st).sub), G.say(st).sub);
});
t('date-only, done, due today and overdue', () => {
  eq(G.status({ id: 'a', title: 'Trip', due_on: '2026-10-20', start_on: TODAY }, [], [], TODAY).state, 'date');
  eq(G.say(G.status({ id: 'a', title: 'Trip', due_on: TODAY, start_on: TODAY }, [], [], TODAY)).head, 'Due today');
  eq(G.say(G.status({ id: 'a', title: 'Trip', due_on: '2026-10-17', start_on: TODAY }, [], [], TODAY)).head, 'Due tomorrow');
  const done = G.status(Object.assign({}, course, { target_min: 60 }), [day('2026-10-05', 90)], [], TODAY);
  eq(done.state, 'done'); eq(done.pct, 1);
  const late = G.status(Object.assign({}, course, { due_on: '2026-10-10' }), [day('2026-10-05', 90)], [], TODAY);
  eq(late.state, 'overdue'); eq(G.say(late).head, '6 days past');
  eq(G.status(Object.assign({}, course, { done_at: 'x' }), [], [], TODAY).state, 'done');
});
t('hero is the pinned open goal; the list is by date with done ones last; behind needs a category', () => {
  const goals = [
    Object.assign({}, course, { id: 'a', pinned: true }),
    { id: 'b', title: 'Trip', start_on: TODAY, due_on: '2026-10-20' },
    Object.assign({}, course, { id: 'c', due_on: '2026-10-25', done_at: 'x' }),
    Object.assign({}, course, { id: 'd', deleted_at: 'x' })
  ];
  eq(G.hero(goals, [], [], TODAY).goal.id, 'a');
  eq(G.hero([Object.assign({}, goals[0], { done_at: 'x' })], [], [], TODAY), null, 'a done goal leaves the hero');
  eq(G.list(goals, [], [], TODAY).map((x) => x.goal.id).join(), 'b,a,c');
  const week = []; for (let i = 0; i < 7; i++) week.push(day(E.addDays(TODAY, -i), 10));
  eq(G.behind(goals, week, [], TODAY).map((x) => x.goal.id).join(), 'a');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
