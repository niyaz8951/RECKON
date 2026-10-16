/* SPENT page in jsdom: the real index.html with global.js, deck.js, the
   engine, the model and spent.js, over an in-memory /api/spent/*. A scripted
   person checks in on a usual day (≤ 6 interactions, ≤ 20 seconds), then
   on a day that was not usual (a "no" opens the dial), edits a day by hand,
   and the screens are walked. The clock is pinned so the evening check-in
   can be tested opening by itself. Data invented. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { installApi } from './_stub-api.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const HTML = readFileSync(resolve(ROOT, 'spent/index.html'), 'utf8');
const TODAY = '2026-10-15';   // a Thursday

const vmE = await import('node:vm');
const ectx = { console }; ectx.window = ectx; vmE.createContext(ectx);
vmE.runInContext(readFileSync(resolve(ROOT, 'spent/spent-engine.js'), 'utf8'), ectx);
const E = ectx.SpentEngine;

/* Six weeks of steady confirmed history (Sun–Thu work). */
function history() {
  const out = [];
  for (let i = 42; i >= 1; i--) {
    const d = E.addDays(TODAY, -i), dw = E.dow(d), we = dw === 5 || dw === 6;
    const b = we ? { sleep: 480, meals: 120, chores: 90, family: 300, screen: 120 } : { sleep: 420, work: 540, commute: 60, meals: 90, chores: 45, family: 90, screen: 90 };
    out.push({ d, blocks: b, src: null, note: '', confirmed_at: null, updated_at: d });
  }
  return out;
}

async function boot({ hour = 10, seen = true, days = history(), goals = [], focus = [], wake = true } = {}) {
  const db = { days: Object.fromEntries(days.map((x) => [x.d, x])), profile: E.profileOf({}), puts: [], goals: goals.map((g) => ({ ...g })), focus: focus.map((f) => ({ ...f })) };
  let win = null;
  const nowIso = () => new win.Date().toISOString();
  const json = (body, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => body });
  async function fakeFetch(url, opts) {
    const u = new URL(url, 'https://reckon.test'), m = (opts && opts.method) || 'GET', b = opts && opts.body ? JSON.parse(opts.body) : {};
    if (u.pathname === '/api/auth/me') return json({ user: { id: 'u1', email: 't@example.com', name: 'Tester', role: 'user', status: 'active' } });
    if (u.pathname === '/api/spent/bootstrap') return json({ profile: db.profile, days: Object.values(db.days), today: TODAY, goals: db.goals.filter((g) => !g.deleted_at),
      focus: { active: db.focus.find((f) => !f.ended_at) || null, recent: db.focus.filter((f) => f.ended_at) } });
    if (u.pathname === '/api/spent/goals' && m === 'POST') {
      if (!b.title) return json({ error: 'Give the goal a name.' }, 400);
      const g = { id: 'goal_' + (db.goals.length + 1), title: b.title, due_on: b.due_on, start_on: TODAY, target_min: b.target_min, cat: b.cat, pinned: !!b.pinned, done_at: null, deleted_at: null };
      if (g.pinned) db.goals.forEach((x) => { x.pinned = false; });
      db.goals.push(g); return json({ ok: true, goal: g });
    }
    const gm = u.pathname.match(/^\/api\/spent\/goals\/(.+)$/);
    if (gm) {
      const g = db.goals.find((x) => x.id === gm[1]);
      if (m === 'DELETE') { g.deleted_at = 'now'; g.pinned = false; return json({ ok: true }); }
      if (b.restore) g.deleted_at = null;
      if (b.done !== undefined) g.done_at = b.done ? 'now' : null;
      for (const k of ['title', 'due_on', 'target_min', 'cat', 'pinned']) if (b[k] !== undefined) g[k] = b[k];
      return json({ ok: true, goal: g });
    }
    if (u.pathname === '/api/spent/focus/start') {
      const run = db.focus.find((f) => !f.ended_at); if (run) return json({ ok: true, session: run, already: true });
      const g = db.goals.find((x) => x.id === b.goal_id);
      const f = { id: 'foc_' + (db.focus.length + 1), goal_id: b.goal_id || null, cat: (g && g.cat) || b.cat, d: TODAY, started_at: nowIso(), ended_at: null, minutes: null };
      db.focus.push(f); return json({ ok: true, session: f });
    }
    if (u.pathname === '/api/spent/focus/stop') {
      const f = db.focus.find((x) => x.id === b.id);
      if (b.discard) { db.focus = db.focus.filter((x) => x !== f); return json({ ok: true, session: null, day: null, discarded: true }); }
      f.ended_at = nowIso(); f.minutes = Math.round((Date.parse(f.ended_at) - Date.parse(f.started_at)) / 60000);
      const prev = db.days[f.d] || { d: f.d, blocks: {}, src: {}, confirmed_at: null };
      const row = { ...prev, blocks: { ...prev.blocks, [f.cat]: (prev.blocks[f.cat] || 0) + f.minutes }, src: prev.src ? { ...prev.src, [f.cat]: 'focus' } : null };
      db.days[f.d] = row; return json({ ok: true, session: f, day: row });
    }
    if (u.pathname === '/api/spent/day' && m === 'PUT') {
      db.puts.push(b);
      const prev = db.days[b.d];
      const row = { d: b.d, blocks: E.cleanBlocks(b.blocks, db.profile), src: b.src || (prev && prev.src) || null, note: b.note || '', confirmed_at: b.confirmed ? '2026-10-15T17:00:00.000Z' : (prev && prev.confirmed_at) || null, updated_at: 'now' };
      db.days[b.d] = row; return json({ ok: true, day: row });
    }
    if (u.pathname === '/api/spent/profile') return json({ ok: true, profile: Object.assign(db.profile, b) });
    return json({ error: 'no route ' + u.pathname }, 404);
  }
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(String(e && e.message))) errors.push(String(e && e.message)); });
  vc.on('error', (m) => errors.push(String(m)));
  const dom = new JSDOM(HTML, { url: 'https://reckon.test/spent/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window; win = w;
  if (wake) Object.defineProperty(w.navigator, 'wakeLock', { configurable: true, value: { request: async (kind) => { w.__wake = (w.__wake || 0) + 1; w.__wakeKind = kind; return { release: async () => { w.__wake--; }, addEventListener() {} }; } } });
  // Pin the clock: today at `hour`:05 local.
  w.eval(`(function(){var R=Date;var b=new R('${TODAY}T00:00:00');b.setHours(${hour},5,0,0);var off=b-R.now();function D(...a){return a.length?new R(...a):new R(R.now()+off)};D.now=()=>R.now()+off;D.parse=R.parse;D.UTC=R.UTC;D.prototype=R.prototype;window.Date=D;})();`);
  w.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  if (seen) { w.localStorage.setItem('sp-deck:' + TODAY, '1'); w.localStorage.setItem('sp-deck:' + E.addDays(TODAY, -1), '1'); }
  installApi(w, fakeFetch);
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  for (const f of ['assets/js/global.js', 'assets/js/deck.js', 'spent/spent-engine.js', 'spent/spent-model.js', 'spent/spent-goals.js', 'spent/spent.js']) w.eval(readFileSync(resolve(ROOT, f), 'utf8'));
  const ready = new Promise((r) => w.document.addEventListener('spent:ready', r, { once: true }));
  await Promise.race([ready, tick(4000).then(() => { throw new Error('spent:ready never fired'); })]);
  await tick(20);
  const d = w.document;
  return { w, d, db, errors, $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)] };
}
/* A person: every tap counts as one interaction. */
function person(env) {
  let n = 0;
  return {
    get n() { return n; },
    async tap(sel) { const el = typeof sel === 'string' ? env.$(sel) : sel; if (!el) throw new Error('nothing to tap: ' + sel); el.click(); n++; await tick(200); }
  };
}

await t('Today before the check-in: the usual day, faded, one primary button', async () => {
  const P = await boot({ hour: 10 });
  const { $, $$ } = P;
  eq(P.w.SPENT.state.screen, 'today');
  ok(/if it goes like a usual Thursday/.test($('#today-hero .kp-hero__label').textContent), $('#today-hero .kp-hero__label').textContent);
  ok($$('#today-bar .sp-bar__seg.is-assumed').length >= 5, 'assumed parts faded');
  ok(/assumed from a usual Thursday/.test($('#today-note').textContent));
  eq($('#checkin').textContent, 'Check in'); ok($('#checkin').classList.contains('btn--primary'));
  ok(/tonight/.test($('#checkin-sub').textContent));
  ok($('#edit-open'), 'Edit day link'); eq($('[data-screen="edit"]').hidden, true, 'the 12 rows are not on Today');
  eq($$('#sp-bar [data-screen]').length, 4, 'four tabs');
  ok(!$('.deck'), 'no deck in the morning when yesterday is done');
  eq(P.errors.length, 0, P.errors.join());
});

await t('usual day: check in, yes, done — three taps, all confirmed, well under 20 seconds', async () => {
  const P = await boot({ hour: 21 });
  const me = person(P), t0 = Date.now();
  await me.tap('#checkin');
  ok(P.$('.deck'), 'deck open');
  eq(P.$('.deck-card__title').textContent, 'Was today a usual Thursday?');
  ok(P.$('.deck-card__reason').textContent.length > 10, 'every card says why');
  await me.tap('[data-deck="yes"]');
  ok(P.$('.deck-card--info'), 'summary straight after a yes');
  ok(/yours today/.test(P.$('.deck-card__title').textContent), P.$('.deck-card__title').textContent);
  ok(/usual Thursday/.test(P.$('.deck-card__text').textContent));
  await me.tap([...P.$$('.deck__foot .deck-btn')].find((b) => b.textContent === 'Done'));
  await tick(100);
  ok(me.n <= 6, 'interactions ' + me.n); eq(me.n, 3);
  ok(Date.now() - t0 < 20000);
  const put = P.db.puts.at(-1);
  eq(put.d, TODAY); eq(put.confirmed, true);
  ok(Object.values(put.src).every((s) => s === 'confirmed'), 'every category confirmed');
  eq(put.blocks.work, 540); eq(put.blocks.family, 90);
  ok(!P.$('.deck'));
  ok(/checked in/.test(P.$('#today-hero .kp-hero__sub').textContent), P.$('#today-hero .kp-hero__sub').textContent);
  eq(P.$$('#today-bar .is-assumed').length, 0, 'nothing faded any more');
  eq(P.$('#checkin').textContent, 'Check in again');
  eq(P.errors.length, 0, P.errors.join());
});

await t('not a usual day: "no" brings the parts that differ; a "no" to one opens the dial; unasked parts stay assumed', async () => {
  const P = await boot({ hour: 21 });
  await P.$('#checkin').click(); await tick(150);
  P.$('[data-deck="no"]').click(); await tick(200);
  const titles = [];
  ok(P.$('.deck-card--question'), 'follow-up questions');
  // Family: say no, then set 3h on the dial.
  for (let i = 0; i < 6 && !P.$('.deck-card--info'); i++) {
    const title = P.$('.deck-card__title').textContent; titles.push(title);
    if (P.$('.deck-card--dial')) {
      eq(P.$$('[data-preset]').length, 3, 'three presets');
      P.$('[data-preset]:last-child').click();
      P.$('[data-deck="set"]').click();
    } else if (/family/.test(title)) P.$('[data-deck="no"]').click();
    else P.$('[data-deck="yes"]').click();
    await tick(200);
  }
  ok(titles.some((x) => /family/.test(x)), titles.join(' | '));
  ok(titles.some((x) => /How much family/.test(x)), 'dial for family: ' + titles.join(' | '));
  ok(titles.length <= 6, 'within budget (5 questions + 1 dial)');
  const put = P.db.puts.at(-1);
  eq(put.confirmed, true); eq(put.src.family, 'confirmed');
  ok(put.blocks.family !== 90, 'family changed: ' + put.blocks.family);
  ok(Object.values(put.src).some((s) => s === 'assumed'), 'what was not asked stays assumed');
  ok(E.total(put.blocks) <= 1440);
});

await t('closing the deck saves nothing and says so', async () => {
  const P = await boot({ hour: 21 });
  P.$('#checkin').click(); await tick(100);
  P.$('[data-deck="close"]').click(); await tick(100);
  eq(P.db.puts.length, 0);
  ok(/Nothing saved/.test(P.$('#toast-region').textContent), P.$('#toast-region').textContent);
});

await t('the evening check-in opens by itself once; the morning one is for yesterday', async () => {
  const ev = await boot({ hour: 21, seen: false });
  ok(ev.$('.deck'), 'opened after 19:00');
  eq(ev.$('.deck-card__title').textContent, 'Was today a usual Thursday?');
  ev.$('[data-deck="close"]').click(); await tick(100);
  eq(ev.w.localStorage.getItem('sp-deck:' + TODAY), '1', 'remembered: closing it is an answer');
  const days = history().filter((x) => x.d !== E.addDays(TODAY, -1));
  const mo = await boot({ hour: 9, seen: false, days });
  ok(mo.$('.deck'), 'opened before noon');
  eq(mo.$('.deck-card__title').textContent, 'Was yesterday a usual Wednesday?');
  mo.$('[data-deck="close"]').click(); await tick(100);
  eq(mo.$('#checkin').textContent, 'Check in for yesterday');
});

await t('Edit day: the full list, assumed rows marked, a step confirms that row, Done confirms the day', async () => {
  const P = await boot({ hour: 15 });
  P.$('#edit-open').click(); await tick(50);
  eq(P.$('[data-screen="edit"]').hidden, false); ok(P.d.body.classList.contains('is-pushed'));
  eq(P.$$('#day-rows .sp-row').length, 13, 'all categories');
  ok(P.$$('#day-rows .sp-row.is-assumed').length === 13, 'today is all assumed');
  ok(/Assumed from a usual Thursday/.test(P.$('#day-status').textContent));
  P.$('#day-rows .sp-row[data-cat="exercise"] [data-step="15"]').click(); await tick(800);
  let put = P.db.puts.at(-1);
  eq(put.blocks.exercise, 15); eq(put.src.exercise, 'confirmed'); eq(put.src.work, 'assumed'); eq(put.confirmed, undefined);
  ok(!P.$('#day-rows .sp-row[data-cat="exercise"]').classList.contains('is-assumed'));
  P.$('#edit-done').click(); await tick(100);
  put = P.db.puts.at(-1);
  eq(put.confirmed, true); ok(Object.values(put.src).every((s) => s === 'confirmed'));
  eq(P.w.SPENT.state.screen, 'today', 'back where it came from');
});

await t('Clear has Undo instead of a confirmation', async () => {
  const P = await boot({ hour: 15 });
  P.$('#edit-open').click(); await tick(50);
  P.$('#day-clear').click(); await tick(50);
  eq(Object.keys(P.w.SPENT.state.days[TODAY].blocks).length, 0);
  const undo = P.$('.toast__undo'); ok(undo, 'undo offered');
  undo.click(); await tick(50);
  eq(P.w.SPENT.state.days[TODAY].blocks.work, 540, 'restored');
});

await t('Week: assumed days marked; tapping a day opens Edit day for it, back returns to Week', async () => {
  const days = history().filter((x) => x.d !== E.addDays(TODAY, -2));
  const P = await boot({ hour: 15, days });
  P.$('#sp-bar [data-screen="week"]').click(); await tick(50);
  ok(P.$('#week-wrap .sp-week__day.is-assumed'), 'the missing day is assumed, not empty');
  ok(/checked in/.test(P.$('#week-wrap .eyebrow').textContent));
  P.$('#week-wrap [data-day="' + E.addDays(TODAY, -2) + '"]').click(); await tick(50);
  eq(P.w.SPENT.state.screen, 'edit'); eq(P.$('#edit-back-label').textContent, 'This week');
  eq(P.$('#sp-bar [aria-current="page"]').getAttribute('data-screen'), 'week', 'the tab stays lit');
  P.$('#edit-back').click(); await tick(50);
  eq(P.w.SPENT.state.screen, 'week');
});

await t('Insights and Usual day render; a mostly assumed record says so', async () => {
  const sparse = history().filter((x, i) => i % 5 === 0);
  const P = await boot({ hour: 15, days: sparse });
  P.$('#sp-bar [data-screen="insights"]').click(); await tick(50);
  ok(/Mostly assumed/.test(P.$('#ins-wrap').textContent), 'honest about assumptions');
  P.$('#sp-bar [data-screen="settings"]').click(); await tick(50);
  eq(P.$$('#rule-rows .sp-row').length, 13);
  eq(P.$('#sp-title').textContent, 'Usual day');
  eq(P.errors.length, 0, P.errors.join());
});

await t('a brand-new person: no record, no deck in the morning, Insights says what to do', async () => {
  const P = await boot({ hour: 9, seen: false, days: [] });
  ok(!P.$('.deck'), 'nothing to ask about yesterday yet');
  eq(P.$('#checkin').textContent, 'Check in');
  P.$('#sp-bar [data-screen="insights"]').click(); await tick(20);
  ok(/Check in tonight/.test(P.$('#ins-wrap').textContent));
});

await t('countdowns: an empty list says what one is; adding one through the sheet puts it on Today', async () => {
  const P = await boot({ hour: 15 });
  ok(/goal with a date/.test(P.$('#goals-note').textContent));
  P.$('#goal-add').click(); await tick(20);
  ok(P.$('#goal-sheet').hasAttribute('open'));
  eq(P.$('#gs-pin').checked, true, 'the first goal goes on Today by default');
  eq(P.$('#gs-cat').value, 'learning');
  P.$('#gs-name').value = 'Finish the Python course'; P.$('#gs-hours').value = '40'; P.$('#gs-due').value = '2026-11-14';
  P.$('#goal-form').dispatchEvent(new P.w.Event('submit', { cancelable: true })); await tick(50);
  ok(!P.$('#goal-sheet').hasAttribute('open'));
  eq(P.db.goals[0].target_min, 2400); eq(P.db.goals[0].cat, 'learning');
  eq(P.$$('#goals-list .sp-goal').length, 1);
  ok(P.$('#today-hero .sp-hero--goal'), 'pinned goal takes the hero');
  eq(P.$('#today-hero .kp-hero__big').textContent, '30 days left');
  ok(/Yours today/.test(P.$('#today-hero .sp-hero__yours').textContent), 'today\'s hours stay, as one line');
  eq(P.errors.length, 0, P.errors.join());
});

await t('deleting a countdown has Undo', async () => {
  const P = await boot({ hour: 15, goals: [{ id: 'g1', title: 'Trip', due_on: '2026-10-30', start_on: TODAY, target_min: null, cat: null, pinned: false }] });
  P.$('[data-goal-edit="g1"]').click(); await tick(20);
  P.$('#gs-delete').click(); await tick(50);
  eq(P.$$('#goals-list .sp-goal').length, 0);
  P.$('.toast__undo').click(); await tick(50);
  eq(P.$$('#goals-list .sp-goal').length, 1, 'back');
});

await t('Focus: start from a goal, full-screen timer with the screen kept awake; a reload resumes it; Stop adds the minutes', async () => {
  const goals = [{ id: 'g1', title: 'Python course', due_on: '2026-11-14', start_on: '2026-09-20', target_min: 2400, cat: 'learning', pinned: true }];
  const P = await boot({ hour: 15, goals });
  P.$('[data-goal-focus="g1"]').click(); await tick(60);
  ok(P.$('#focus-screen'), 'timer on screen'); eq(P.$('#focus-what').textContent, 'Python course');
  ok(/Learning/.test(P.$('.focus__eyebrow').textContent));
  eq(P.w.__wake, 1, 'screen wake lock held'); eq(P.w.__wakeKind, 'screen');
  // Forty minutes later the app is opened again: same server state, new page.
  const run = P.db.focus[0]; run.started_at = new Date(Date.parse(run.started_at) - 40 * 60000).toISOString();
  const Q = await boot({ hour: 15, goals, focus: P.db.focus, days: Object.values(P.db.days) });
  ok(Q.$('#focus-screen'), 'resumed after reload');
  ok(/^(39:5\d|40:0\d)$/.test(Q.$('#focus-clock').textContent), Q.$('#focus-clock').textContent);
  ok(!Q.$('.deck'), 'no check-in on top of a running timer');
  Q.$('#focus-stop').click(); await tick(80);
  ok(!Q.$('#focus-screen')); eq(Q.w.__wake, 0, 'lock released');
  eq(Q.w.SPENT.state.days[TODAY].blocks.learning, 40);
  ok(/40m of learning added to today/.test(Q.$('#toast-region').textContent), Q.$('#toast-region').textContent);
  ok(!Q.$$('#today-bar .sp-bar__seg--mine').every((x) => x.classList.contains('is-assumed')), 'focus minutes are solid, not assumed');
  ok(Q.$$('#today-bar .is-assumed').length > 0, 'the rest of the day is still the usual');
});

await t('Focus without a wake lock still runs; a category is asked for when the goal has none; discard adds nothing', async () => {
  const P = await boot({ hour: 15, wake: false, goals: [{ id: 'g2', title: 'Book draft', due_on: '2026-12-01', start_on: TODAY, target_min: 600, cat: null }] });
  P.$('#focus-open').click(); await tick(20);
  ok(P.$('#focus-sheet').hasAttribute('open'));
  P.$('[data-focus-goal="g2"]').click(); await tick(20);
  ok(/no category/.test(P.$('#fs-list').textContent), 'asks which part of the day it is');
  P.$('[data-focus-cat="making"]').click(); await tick(60);
  ok(P.$('#focus-screen')); eq(P.db.focus[0].cat, 'making'); eq(P.db.focus[0].goal_id, 'g2');
  P.$('#focus-discard').click(); await tick(60);
  ok(!P.$('#focus-screen')); eq(P.db.focus.length, 0);
  ok(/Discarded/.test(P.$('#toast-region').textContent));
});

await t('check-in: a countdown that is behind gets its own question, even after "yes, usual"', async () => {
  const goals = [{ id: 'g1', title: 'Python course', due_on: '2026-11-14', start_on: '2026-09-20', target_min: 2400, cat: 'learning', pinned: false }];
  const P = await boot({ hour: 21, goals });
  P.$('#checkin').click(); await tick(150);
  P.$('[data-deck="yes"]').click(); await tick(200);
  eq(P.$('.deck-card__title').textContent, 'Put time into Python course today?');
  ok(/behind/.test(P.$('.deck-card__reason').textContent));
  P.$('[data-deck="yes"]').click(); await tick(200);
  ok(P.$('.deck-card--dial'), 'yes → how much');
  P.$('[data-deck="set"]').click(); await tick(200);
  ok(P.$('.deck-card--info'));
  const put = P.db.puts.at(-1);
  ok(put.blocks.learning > 0, 'learning recorded: ' + put.blocks.learning); eq(put.src.learning, 'confirmed');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
