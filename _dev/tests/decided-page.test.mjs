/* DECIDED page in jsdom: the real index.html with global.js, deck.js and the
   DECIDED scripts over an in-memory /api/decided/*. Open shows each open
   decision's countdown (days to go, share of the wait gone) and, when
   nothing is due, the nearest look-back as the hero. Due decisions are
   reviewed as a deck: as expected? → 1–5 dial → what happened → lesson.
   With AI on, the lesson card offers a suggestion that fills the box (the
   Edge Function is stubbed); with it off there is no button. Clock pinned. */
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
const HTML = readFileSync(resolve(ROOT, 'decided/index.html'), 'utf8');
const TODAY = '2026-10-17';

const dec = (o) => ({ id: o.id, title: o.title, context: '', options: [], choice: o.choice || '', expected: o.expected || '', confidence: o.confidence || 75, domain: o.domain || 'life', stakes: 'medium', reversible: 1,
  decided_on: o.decided_on, review_on: o.review_on, status: 'open', outcome: null, outcome_score: null, as_expected: null, lesson: null, reviewed_at: null, deleted_at: null });

async function boot({ decisions, ai = false, aiReply } = {}) {
  const db = { list: decisions.map((d) => ({ ...d })), reviews: [], invokes: [] };
  const json = (body, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => body });
  async function fakeFetch(url, opts) {
    const u = new URL(url, 'https://reckon.test'), m = (opts && opts.method) || 'GET', b = opts && opts.body ? JSON.parse(opts.body) : {};
    if (u.pathname === '/api/auth/me') return json({ user: { id: 'u1', email: 'n@example.com', name: 'Niyaz', role: 'user', status: 'active', ai_on: ai } });
    if (u.pathname === '/api/decided/bootstrap') return json({ decisions: db.list });
    if (u.pathname === '/api/decided/review') {
      db.reviews.push(b);
      const d = db.list.find((x) => x.id === b.id);
      Object.assign(d, { status: 'reviewed', outcome: b.outcome, as_expected: b.as_expected, outcome_score: b.outcome_score, lesson: b.lesson || null, reviewed_at: TODAY + 'T18:00:00Z' });
      return json({ ok: true, decision: d });
    }
    return json({ error: 'no route ' + u.pathname }, 404);
  }
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(String(e && e.message))) errors.push(String(e && e.message)); });
  vc.on('error', (m) => errors.push(String(m)));
  const dom = new JSDOM(HTML, { url: 'https://reckon.test/decided/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.eval(`(function(){var R=Date;var b=new R('${TODAY}T00:00:00');b.setHours(20,5,0,0);var off=b-R.now();function D(...a){return a.length?new R(...a):new R(R.now()+off)};D.now=()=>R.now()+off;D.parse=R.parse;D.UTC=R.UTC;D.prototype=R.prototype;window.Date=D;})();`);
  w.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  installApi(w, fakeFetch);
  w.TNData.invoke = async (name, body) => { db.invokes.push({ name, body }); return aiReply ? aiReply(body) : { ok: false, error: 'No suggestion this time.' }; };
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  for (const f of ['assets/js/global.js', 'assets/js/deck.js', 'supabase/functions/_shared/ai-contract.js', 'assets/js/ai.js', 'decided/decided-engine.js', 'decided/decided.js']) w.eval(readFileSync(resolve(ROOT, f), 'utf8'));
  for (let i = 0; i < 100 && !(w.DECIDED && w.DECIDED.state.M); i++) await tick(20);
  await tick(20);
  const d = w.document;
  return { w, d, db, errors, $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)] };
}

const riyadh = dec({ id: 'd1', title: 'Take the Riyadh role', expected: 'Harder first six months, better money', confidence: 75, decided_on: '2026-10-01', review_on: '2026-10-31', domain: 'work' });
const car = dec({ id: 'd2', title: 'Buy the car now', expected: 'Prices go up next year', confidence: 80, decided_on: '2026-09-01', review_on: '2026-10-15', domain: 'money' });
const run = dec({ id: 'd3', title: 'Start the morning run', expected: '3 times a week by December', confidence: 70, decided_on: '2026-09-20', review_on: '2026-10-17', domain: 'health' });

await t('nothing due: the nearest look-back is the hero, as a countdown; every open card shows days to go and a track', async () => {
  const P = await boot({ decisions: [riyadh, dec({ id: 'd4', title: 'Learn Python', decided_on: '2026-10-10', review_on: '2027-01-10' })] });
  const hero = P.$('#open-wrap .dc-hero');
  ok(hero, 'countdown hero');
  eq(P.$('.dc-hero .kp-hero__big').textContent, '14 days');
  ok(/Take the Riyadh role/.test(P.$('.dc-hero .kp-hero__sub').textContent));
  ok(/Decided 16 days ago · 30-day wait/.test(P.$('.dc-hero .kp-hero__sub').textContent));
  ok(/53%/.test(P.$('.dc-hero .kp-ring__c').textContent), 'ring = share of the wait gone');
  const counts = P.$$('.dc-count');
  eq(counts.length, 2);
  eq(P.$('.dc-count__head b').textContent, '14 days to go');
  eq(P.$('.dc-count__track').getAttribute('aria-valuenow'), '16');
  eq(P.$('.dc-count__track i').style.width, '53%');
  eq(P.errors.length, 0, P.errors.join());
});
await t('due: the hero says so with one button; the deck walks a review in four cards and saves it', async () => {
  const P = await boot({ decisions: [riyadh, car] });
  ok(P.$('#dc-lookback'), 'Look back now');
  ok(/1 decision reached its review date/.test(P.$('#open-wrap .kp-hero--warn').textContent));
  P.$('#dc-lookback').click(); await tick(200);
  ok(P.$('.deck'), 'deck open');
  eq(P.$('.deck-card__title').textContent, 'Did “Buy the car now” go as you expected?');
  ok(/1 Sep · you were 80% sure/.test(P.$('.deck-card__eyebrow').textContent));
  ok(/You expected: Prices go up next year/.test(P.$('.deck-card__text').textContent));
  ok(/^Due 15 Oct — you set this look-back on 1 Sep\./.test(P.$('.deck-card__reason').textContent), P.$('.deck-card__reason').textContent);
  P.$('[data-deck="no"]').click(); await tick(200);
  ok(P.$('.deck-card--dial'), 'how it compared');
  eq(P.$('.deck-dial__v').textContent, 'As expected');
  P.$('[data-preset="2"]').click(); await tick(20);
  eq(P.$('.deck-dial__v').textContent, 'Worse');
  P.$('[data-deck="set"]').click(); await tick(200);
  eq(P.$('.deck-card__title').textContent, 'What happened, in a line?');
  P.$('.deck-text').value = 'Prices dropped in March.';
  P.$('[data-deck="set"]').click(); await tick(200);
  eq(P.$('.deck-card__title').textContent, 'What would you tell yourself, back then?');
  ok(!P.$('[data-assist]'), 'no AI button when AI is off');
  P.$('.deck-text').value = 'Start from how often price forecasts are right.';
  P.$('[data-deck="set"]').click(); await tick(250);
  eq(P.db.reviews.length, 1);
  const r = P.db.reviews[0];
  eq(r.id, 'd2'); eq(r.as_expected, 0); eq(r.outcome_score, 2); eq(r.outcome, 'Prices dropped in March.'); eq(r.lesson, 'Start from how often price forecasts are right.');
  ok(P.$('.deck-card--info'), 'summary'); ok(/1 reviewed/.test(P.$('.deck-card__title').textContent));
  P.$('[data-deck="info"]').click(); await tick(250);
  ok(!P.$('.deck'));
  ok(!P.$('#dc-lookback'), 'nothing due any more');
  eq(P.db.invokes.length, 0, 'AI was never called');
  eq(P.errors.length, 0, P.errors.join());
});
await t('skip on the first card leaves a decision due; skipping the text cards still saves an honest outcome', async () => {
  const P = await boot({ decisions: [car, run] });
  P.$('#dc-lookback').click(); await tick(200);
  P.$('[data-deck="skip"]').click(); await tick(200);
  eq(P.$('.deck-card__title').textContent, 'Did “Start the morning run” go as you expected?');
  P.$('[data-deck="yes"]').click(); await tick(200);
  P.$('[data-deck="set"]').click(); await tick(200);     // dial: as expected
  P.$('[data-deck="skip"]').click(); await tick(200);    // what happened: skipped
  P.$('[data-deck="skip"]').click(); await tick(250);    // lesson: skipped
  eq(P.db.reviews.length, 1); eq(P.db.reviews[0].id, 'd3');
  eq(P.db.reviews[0].outcome, 'Went broadly as expected.'); eq(P.db.reviews[0].outcome_score, 3); eq(P.db.reviews[0].lesson, '');
  P.$('[data-deck="info"]').click(); await tick(250);
  ok(P.$('#dc-lookback'), 'the skipped one is still due');
});
await t('AI on: the lesson card offers a suggestion from this decision\'s own words; it fills the box, the person saves', async () => {
  const P = await boot({ decisions: [car], ai: true, aiReply: (b) => ({ ok: true, value: { lesson: 'You felt 80% sure about a price forecast; start from how often they are right.', confidence: 0.7 }, provider: 'groq', prompt_version: 'lesson-1' }) });
  P.$('#dc-lookback').click(); await tick(200);
  P.$('[data-deck="no"]').click(); await tick(200);
  P.$('[data-deck="set"]').click(); await tick(200);
  P.$('.deck-text').value = 'Prices dropped in March.';
  P.$('[data-deck="set"]').click(); await tick(200);
  ok(P.$('[data-assist]'), 'Suggest one');
  ok(/only uses this decision/.test(P.$('.deck-card__reason').textContent));
  P.$('[data-assist]').click(); await tick(60);
  eq(P.db.invokes.length, 1); eq(P.db.invokes[0].name, 'ai'); eq(P.db.invokes[0].body.task, 'lesson');
  const sent = P.db.invokes[0].body.input;
  eq(sent.outcome, 'Prices dropped in March.'); eq(sent.confidence, 80); ok(!('id' in sent) && !('context' in sent), 'only what the lesson needs');
  eq(P.$('.deck-text').value, 'You felt 80% sure about a price forecast; start from how often they are right.');
  eq(P.db.reviews.length, 0, 'a suggestion saves nothing');
  P.$('[data-deck="set"]').click(); await tick(250);
  eq(P.db.reviews[0].lesson, 'You felt 80% sure about a price forecast; start from how often they are right.');
});
await t('AI on but the answer fails the contract (an invented figure): nothing is shown, the box stays the person\'s', async () => {
  const P = await boot({ decisions: [car], ai: true, aiReply: () => ({ ok: true, value: { lesson: 'Prices fell 12%, you lost AED 9,000.' }, provider: 'groq' }) });
  P.$('#dc-lookback').click(); await tick(200);
  P.$('[data-deck="no"]').click(); await tick(200);
  P.$('[data-deck="set"]').click(); await tick(200);
  P.$('.deck-text').value = 'Prices dropped.'; P.$('[data-deck="set"]').click(); await tick(200);
  P.$('[data-assist]').click(); await tick(60);
  eq(P.$('.deck-text').value, ''); eq(P.$('.deck-assist__note').textContent, 'No suggestion this time.');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
