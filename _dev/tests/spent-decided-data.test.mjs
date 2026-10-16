/* SPENT's and DECIDED's data layers against real Postgres (PGlite +
   supabase/schema.sql), every query as the signed-in person with row-level
   security on. All data invented. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { freshDb, ROOT } from './_pg.mjs';

const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };

const S = await freshDb();
for (const f of ['assets/js/db.js', 'assets/js/routes-core.js', 'spent/spent-engine.js', 'spent/spent-data.js', 'decided/decided-engine.js', 'decided/decided-data.js']) require(resolve(ROOT, f));
const D = globalThis.TNData, SE = globalThis.SpentEngine;
const owner = await S.signUp('owner@example.com', 'Owner');
const uid = await S.signUp('tester@example.com', 'Tester');
await S.admin("update public.profiles set status = 'active' where id = $1", [uid]);
const as = (id) => D._use({ db: S.asUser(id), auth: { session: async () => (id ? { user: { id } } : null), signOut: async () => {} } });
as(uid);
async function call(path, method, body, query) {
  try { return { status: 200, body: await D.handle(method, path + (query ? '?' + query : ''), body) }; }
  catch (e) { return { status: e.status || 500, body: { error: e.message } }; }
}
const today = SE.iso(new Date()), yday = SE.addDays(today, -1);

/* ----------------------------------------------------------------- SPENT */
await t('spent: bootstrap creates the profile with defaults', async () => {
  const r = await call('/api/spent/bootstrap', 'GET');
  eq(r.status, 200, r.body.error); eq(r.body.profile.cats.length, 13); eq(r.body.profile.target_bp, 2000); eq(r.body.days.length, 0); eq(r.body.today, today);
  eq((await S.admin('select count(*)::int as n from public.spent_profile where user_id = $1', [uid]))[0].n, 1);
});
await t('spent: a day is written once and updated in place; junk is cleaned', async () => {
  let r = await call('/api/spent/day', 'PUT', { d: yday, blocks: { sleep: 420, work: 540, family: '60', bogus: 99, screen: -5 }, note: 'ok' });
  eq(r.status, 200, r.body.error); eq(r.body.day.blocks.family, 60); eq(r.body.day.blocks.bogus, undefined); eq(r.body.day.blocks.screen, undefined); eq(r.body.day.note, 'ok');
  r = await call('/api/spent/day', 'PUT', { d: yday, blocks: { sleep: 450, work: 540 } });
  eq(r.body.day.blocks.sleep, 450); eq(r.body.day.blocks.family, undefined);
  eq((await S.admin('select count(*)::int as n from public.spent_days where user_id = $1', [uid]))[0].n, 1, 'one row per day');
  eq((await call('/api/spent/day', 'PUT', { d: yday, blocks: { sleep: 900, work: 900 } })).status, 400, 'more than 24 hours');
  eq((await call('/api/spent/day', 'PUT', { d: SE.addDays(today, 3), blocks: { sleep: 1 } })).status, 400, 'the future');
  eq((await call('/api/spent/day', 'PUT', { d: 'nope', blocks: {} })).status, 400);
});
await t('spent: days are listed by range and come back in bootstrap', async () => {
  await call('/api/spent/day', 'PUT', { d: today, blocks: { sleep: 400 } });
  const r = await call('/api/spent/days', 'GET', null, 'from=' + yday + '&to=' + today);
  eq(r.body.days.length, 2); eq(r.body.days[0].d, yday);
  eq((await call('/api/spent/days', 'GET', null, 'from=' + today)).body.days.length, 1);
  eq((await call('/api/spent/bootstrap', 'GET')).body.days.length, 2);
});
await t('spent v2: a check-in stamps confirmed_at; sources are kept beside the minutes and cleaned', async () => {
  const d = SE.addDays(today, -3);
  let r = await call('/api/spent/day', 'PUT', { d, blocks: { sleep: 420, work: 540, family: 90 }, src: { sleep: 'confirmed', work: 'assumed', family: 'focus', bogus: 'confirmed', screen: 'nonsense' } });
  eq(r.status, 200, r.body.error);
  eq(r.body.day.confirmed_at, null, 'not checked in yet');
  eq(JSON.stringify(r.body.day.src), JSON.stringify({ sleep: 'confirmed', work: 'assumed', family: 'focus' }));
  eq(r.body.day.blocks._src, undefined, 'sources never leak into the minutes');
  eq(SE.srcOf(r.body.day, 'work'), 'assumed');
  r = await call('/api/spent/day', 'PUT', { d, blocks: { sleep: 420, work: 540, family: 90 }, src: { work: 'confirmed' }, confirmed: true });
  ok(/^\d{4}-\d{2}-\d{2}T/.test(r.body.day.confirmed_at), 'stamped: ' + r.body.day.confirmed_at);
  eq(SE.srcOf(r.body.day, 'family'), 'confirmed', 'a checked-in day: unlisted keys are confirmed');
  const stamp = r.body.day.confirmed_at;
  // An old page (no src) keeps the sources already stored, and the check-in.
  r = await call('/api/spent/day', 'PUT', { d, blocks: { sleep: 430, work: 540, family: 90 } });
  eq(r.body.day.src.work, 'confirmed'); eq(r.body.day.confirmed_at, stamp);
  const raw = JSON.parse((await S.admin('select blocks_json from public.spent_days where user_id = $1 and d = $2', [uid, d]))[0].blocks_json);
  eq(raw._src.work, 'confirmed'); eq(raw.sleep, 430);
  // A pre-v2 row (no _src) reads as confirmed.
  r = await call('/api/spent/days', 'GET', null, 'from=' + yday + '&to=' + yday);
  eq(r.body.days[0].src, null); eq(SE.srcOf(r.body.days[0], 'work'), 'confirmed');
});
await t('spent v2: a project without the new column gets a plain instruction, not a database error', async () => {
  await S.admin('alter table public.spent_days rename column confirmed_at to confirmed_at_x');
  try {
    const r = await call('/api/spent/day', 'PUT', { d: SE.addDays(today, -4), blocks: { sleep: 420 }, src: {}, confirmed: true });
    eq(r.status, 503); ok(/run supabase\/schema\.sql/.test(r.body.error), r.body.error);
  } finally { await S.admin('alter table public.spent_days rename column confirmed_at_x to confirmed_at'); }
});
await t('countdowns: create, validate, one pinned at a time, soft delete and restore, kept to their owner', async () => {
  let r = await call('/api/spent/goals', 'POST', { title: '  Python course ', due_on: SE.addDays(today, 30), target_min: 2400, cat: 'learning', pinned: true });
  eq(r.status, 200, r.body.error); const a = r.body.goal;
  eq(a.title, 'Python course'); eq(a.start_on, today); eq(a.target_min, 2400); eq(a.pinned, true);
  r = await call('/api/spent/goals', 'POST', { title: 'Trip', due_on: SE.addDays(today, 10), pinned: true });
  eq(r.body.goal.target_min, null); eq(r.body.goal.cat, null);
  const b = r.body.goal;
  let boot = await call('/api/spent/bootstrap', 'GET');
  eq(boot.body.goals.length, 2); eq(boot.body.goals.filter((g) => g.pinned).map((g) => g.id).join(), b.id, 'pinning one unpins the other');
  eq((await call('/api/spent/goals', 'POST', { title: '', due_on: today })).status, 400);
  eq((await call('/api/spent/goals', 'POST', { title: 'x', due_on: 'soon' })).status, 400);
  eq((await call('/api/spent/goals', 'POST', { title: 'x', due_on: today, target_min: -5 })).status, 400);
  eq((await call('/api/spent/goals', 'POST', { title: 'x', due_on: today, cat: 'nope' })).status, 400);
  r = await call('/api/spent/goals/' + a.id, 'PUT', { done: true, title: 'Python, part 1' });
  ok(r.body.goal.done_at); eq(r.body.goal.title, 'Python, part 1'); eq(r.body.goal.due_on, a.due_on, 'a partial update keeps the rest');
  eq((await call('/api/spent/goals/' + b.id, 'DELETE')).status, 200);
  eq((await call('/api/spent/bootstrap', 'GET')).body.goals.length, 1, 'deleted goals leave the list');
  eq((await call('/api/spent/goals/' + b.id, 'PUT', { title: 'x' })).status, 404, 'a deleted goal cannot be edited');
  r = await call('/api/spent/goals/' + b.id, 'PUT', { restore: true });
  eq(r.status, 200); eq((await call('/api/spent/bootstrap', 'GET')).body.goals.length, 2, 'Undo brings it back');
  as(owner); await S.admin("update public.profiles set status = 'active' where id = $1", [owner]);
  eq((await call('/api/spent/goals/' + a.id, 'PUT', { title: 'mine now' })).status, 404, 'someone else\'s goal is invisible');
  eq((await call('/api/spent/bootstrap', 'GET')).body.goals.length, 0);
  as(uid);
});
await t('focus: one session at a time; stopping adds its minutes to the day as focus; discard adds nothing', async () => {
  const goals = (await call('/api/spent/bootstrap', 'GET')).body.goals, course = goals.find((g) => g.cat === 'learning'), trip = goals.find((g) => !g.cat);
  eq((await call('/api/spent/focus/start', 'POST', { goal_id: trip.id })).status, 400, 'a goal without a category needs one');
  let r = await call('/api/spent/focus/start', 'POST', { goal_id: course.id });
  eq(r.status, 200, r.body.error); const s1 = r.body.session;
  eq(s1.cat, 'learning'); eq(s1.d, today); eq(s1.ended_at, null);
  r = await call('/api/spent/focus/start', 'POST', { cat: 'exercise' });
  eq(r.body.already, true); eq(r.body.session.id, s1.id, 'the running one comes back');
  eq((await call('/api/spent/bootstrap', 'GET')).body.focus.active.id, s1.id, 'bootstrap knows it is running (reload resumes)');
  await S.admin('update public.focus_sessions set started_at = $1 where id = $2', [new Date(Date.now() - 40 * 60000).toISOString(), s1.id]);
  // Today already has a confirmed sleep; learning becomes focus.
  await call('/api/spent/day', 'PUT', { d: today, blocks: { sleep: 420 }, src: { sleep: 'confirmed' } });
  r = await call('/api/spent/focus/stop', 'POST', { id: s1.id });
  eq(r.status, 200, r.body.error); eq(r.body.session.minutes, 40);
  eq(r.body.day.blocks.learning, 40); eq(r.body.day.src.learning, 'focus'); eq(r.body.day.blocks.sleep, 420);
  eq(SE.srcOf(r.body.day, 'learning'), 'focus');
  r = await call('/api/spent/focus/stop', 'POST', { id: s1.id });
  eq(r.body.day, null, 'stopping twice adds nothing twice');
  const boot = await call('/api/spent/bootstrap', 'GET');
  eq(boot.body.focus.active, null); eq(boot.body.focus.recent.length, 1);
  // A forgotten timer counts ten hours at most; a discarded one counts nothing.
  const s2 = (await call('/api/spent/focus/start', 'POST', { cat: 'making' })).body.session;
  await S.admin('update public.focus_sessions set started_at = $1, d = $3 where id = $2', [new Date(Date.now() - 20 * 3600000).toISOString(), s2.id, SE.addDays(today, -5)]);
  r = await call('/api/spent/focus/stop', 'POST', { id: s2.id });
  eq(r.body.session.minutes, 600); eq(r.body.day.d, SE.addDays(today, -5), 'counted on the day it started');
  const s3 = (await call('/api/spent/focus/start', 'POST', { cat: 'making' })).body.session;
  r = await call('/api/spent/focus/stop', 'POST', { id: s3.id, discard: true });
  eq(r.body.discarded, true);
  eq((await S.admin('select count(*)::int as n from public.focus_sessions where id = $1', [s3.id]))[0].n, 0);
});
await t('focus never takes a day past 24 hours: assumed minutes make room first', async () => {
  const d = SE.addDays(today, -6);
  await call('/api/spent/day', 'PUT', { d, blocks: { sleep: 480, work: 600, screen: 300 }, src: { sleep: 'confirmed', work: 'confirmed', screen: 'assumed' } });
  const s = (await call('/api/spent/focus/start', 'POST', { cat: 'learning' })).body.session;
  await S.admin('update public.focus_sessions set started_at = $1, d = $3 where id = $2', [new Date(Date.now() - 120 * 60000).toISOString(), s.id, d]);
  const r = await call('/api/spent/focus/stop', 'POST', { id: s.id });
  eq(SE.total(r.body.day.blocks), 1440, 'exactly full'); eq(r.body.day.blocks.learning, 120); eq(r.body.day.blocks.work, 600);
  ok(r.body.day.blocks.screen < 300, 'assumed screen time shrank: ' + r.body.day.blocks.screen);
});
await t('without the phase-2 tables SPENT still boots and says what to run', async () => {
  await S.admin('alter table public.goals rename to goals_x');
  try {
    const r = await call('/api/spent/bootstrap', 'GET');
    eq(r.status, 200, r.body.error); eq(r.body.needsSchema, 'goals'); eq(r.body.goals.length, 0); ok(r.body.days.length > 0);
  } finally { await S.admin('alter table public.goals_x rename to goals'); }
});
await t('spent: profile edits are validated and kept', async () => {
  let r = await call('/api/spent/profile', 'PUT', { target_bp: 2500, weekend: [0, 6], rules: { weekday: { sleep: 450, work: 600, nope: 10 }, weekend: { sleep: 500 } } });
  eq(r.status, 200, r.body.error); eq(r.body.profile.target_bp, 2500); eq(r.body.profile.weekend.join(','), '0,6'); eq(r.body.profile.rules.weekday.work, 600); eq(r.body.profile.rules.weekday.nope, undefined);
  eq((await call('/api/spent/profile', 'PUT', { rules: { weekday: { sleep: 900, work: 900 } } })).status, 400);
  eq((await call('/api/spent/profile', 'PUT', { cats: [{ key: 'work', name: 'Work', cls: 'fixed' }, { key: 'x', name: 'X', cls: 'mine' }, { key: 'y', name: 'Y', cls: 'leak' }] })).status, 400, 'sleep stays');
  r = await call('/api/spent/profile', 'PUT', { cats: [{ key: 'sleep', name: 'Sleep', cls: 'fixed' }, { key: 'work', name: 'Work', cls: 'fixed' }, { key: 'deen', name: 'Deen', cls: 'mine', icon: 'sun' }] });
  eq(r.body.profile.cats.length, 3); eq(r.body.profile.cats[2].cls, 'mine');
  eq((await call('/api/spent/bootstrap', 'GET')).body.profile.cats.length, 3, 'persisted');
});

/* --------------------------------------------------------------- DECIDED */
let id1;
await t('decided: log, list, edit', async () => {
  let r = await call('/api/decided/decisions', 'POST', { title: 'Take the Riyadh role', choice: 'Yes', expected: 'Harder, better money', confidence: 80, domain: 'work', stakes: 'high', reversible: 0, review_on: SE.addDays(today, 90), options: ['Stay', 'Go', ''] });
  eq(r.status, 200, r.body.error); id1 = r.body.decision.id; ok(id1.startsWith('dec_'));
  eq(r.body.decision.status, 'open'); eq(r.body.decision.decided_on, today); eq(r.body.decision.reversible, false); eq(r.body.decision.options.length, 2);
  eq((await call('/api/decided/decisions', 'POST', { title: '', confidence: 70, review_on: today })).status, 400);
  eq((await call('/api/decided/decisions', 'POST', { title: 'x', confidence: 120, review_on: today })).status, 400);
  eq((await call('/api/decided/decisions', 'POST', { title: 'x', confidence: 70, review_on: '2020-01-01' })).status, 400, 'review before decision');
  r = await call('/api/decided/decisions', 'PUT', { id: id1, confidence: 70, domain: 'nope' });
  eq(r.status, 200, r.body.error); eq(r.body.decision.confidence, 70); eq(r.body.decision.domain, 'work', 'unknown domain keeps the old one'); eq(r.body.decision.title, 'Take the Riyadh role');
  eq((await call('/api/decided/bootstrap', 'GET')).body.decisions.length, 1);
});
await t('decided: review, reopen, delete', async () => {
  eq((await call('/api/decided/review', 'POST', { id: id1, outcome: '', outcome_score: 3, as_expected: 1 })).status, 400);
  eq((await call('/api/decided/review', 'POST', { id: id1, outcome: 'Fine', outcome_score: 9, as_expected: 1 })).status, 400);
  let r = await call('/api/decided/review', 'POST', { id: id1, outcome: 'Harder than I thought, money as expected.', outcome_score: 2, as_expected: 0, lesson: 'Halve the optimism.' });
  eq(r.status, 200, r.body.error); eq(r.body.decision.status, 'reviewed'); eq(r.body.decision.as_expected, 0); ok(r.body.decision.reviewed_at);
  eq((await call('/api/decided/decisions', 'PUT', { id: id1, title: 'x' })).status, 400, 'reviewed is history');
  r = await call('/api/decided/reopen', 'POST', { id: id1 });
  eq(r.body.decision.status, 'open'); eq(r.body.decision.reviewed_at, null);
  eq((await call('/api/decided/decisions', 'DELETE', null, 'id=' + id1)).status, 200);
  eq((await call('/api/decided/bootstrap', 'GET')).body.decisions.length, 0);
  eq((await S.admin('select count(*)::int as n from public.decisions where id = $1 and deleted_at is not null', [id1]))[0].n, 1, 'soft-deleted');
  eq((await call('/api/decided/decisions', 'DELETE', null, 'id=' + id1)).status, 404);
});
await t('isolation: another account sees none of it, and a pending account gets 403', async () => {
  as(owner);
  eq((await call('/api/spent/bootstrap', 'GET')).body.days.length, 0);
  eq((await call('/api/decided/bootstrap', 'GET')).body.decisions.length, 0);
  eq((await call('/api/decided/review', 'POST', { id: id1, outcome: 'hack', outcome_score: 3, as_expected: 1 })).status, 404);
  const p = await S.signUp('pending@example.com', 'P');
  as(p);
  eq((await call('/api/spent/bootstrap', 'GET')).status, 403);
  as(null);
  eq((await call('/api/decided/bootstrap', 'GET')).status, 401);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
