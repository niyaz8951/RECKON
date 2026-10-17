/* The AI layer without a network: the contract (ai-contract.js) against
   every recorded eval case, the runner (functions/ai/run.js) with a stub
   fetch — retry once on an invalid answer, next provider on 429/timeout,
   nothing unvalidated out, logs without content — and the weekly letter's
   facts and plain version (assets/js/letter.js), which must pass the same
   grounding check a model's letter does. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const ctx = { console, setTimeout, clearTimeout, AbortController, Date, JSON, Promise }; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['supabase/functions/_shared/ai-contract.js', 'supabase/functions/ai/prompts/lesson-1.js', 'supabase/functions/ai/prompts/letter-1.js', 'supabase/functions/ai/run.js',
  'spent/spent-engine.js', 'decided/decided-engine.js', 'assets/js/letter.js']) vm.runInContext(readFileSync(resolve(ROOT, f), 'utf8'), ctx, { filename: f });
const C = ctx.AIContract, R = ctx.AIRun, L = ctx.TNLetter;
const lessonEvals = JSON.parse(readFileSync(resolve(ROOT, '_dev/ai-evals/lesson.json'), 'utf8'));
const letterEvals = JSON.parse(readFileSync(resolve(ROOT, '_dev/ai-evals/letter.json'), 'utf8'));

/* --------------------------------------------------------------- contract */
await t('numbersIn: figures normalised; grounding finds only what the input lacks', () => {
  eq(C.numbersIn('AED 1,240, 12% and 3.5h on 7 days').join(), '1240,12,3.5,7');
  eq(C.ungrounded('kept 22% of AED 1,240', { a: 'AED 1240', b: '22%' }).length, 0);
  eq(C.ungrounded('kept 23%', { b: '22%' }).join(), '23');
});
await t('evals: every recorded lesson case gets the verdict it was written for (' + lessonEvals.cases.length + ' cases)', () => {
  ok(lessonEvals.cases.length >= 20);
  for (const c of lessonEvals.cases) { const v = C.validate('lesson', c.recorded, c.input); eq(v.ok, c.valid, c.id + ' ' + JSON.stringify(v.errors || '')); }
  const quoted = lessonEvals.cases.find((c) => /^“/.test(c.recorded.lesson));
  ok(!/^“/.test(C.validate('lesson', quoted.recorded, quoted.input).value.lesson), 'quotes stripped');
});
await t('evals: every recorded letter case gets its verdict; ten fact sets, invented figures and thin letters rejected', () => {
  eq(letterEvals.cases.filter((c) => c.valid).length, 10);
  for (const c of letterEvals.cases) { const v = C.validate('letter', c.recorded, c.facts); eq(v.ok, c.valid, c.id + ' ' + JSON.stringify(v.errors || '')); }
  ok(/not in the facts \(14\)/.test(C.validate('letter', letterEvals.cases.find((c) => c.id === 'W11').recorded, letterEvals.cases[0].facts).errors.join()));
});
await t('limits: unknown task, oversized input, a lesson with nothing to go on', () => {
  ok(C.limits('poem', {}).length); ok(C.limits('lesson', { title: 'x', outcome: 'y'.repeat(5000) }).join().includes('too large'));
  ok(C.limits('lesson', { title: 'x' }).join().includes('what happened'));
  eq(C.limits('lesson', lessonEvals.cases[0].input).length, 0);
});
await t('parseJSON: plain, fenced, or wrapped in a sentence', () => {
  eq(C.parseJSON('{"a":1}').a, 1); eq(C.parseJSON('```json\n{"a":2}\n```').a, 2); eq(C.parseJSON('Sure! {"a":3} hope that helps').a, 3); eq(C.parseJSON('nope'), null);
});
await t('prompts: versioned, and a lesson prompt carries only that decision\'s own words', () => {
  eq(C.VERSIONS.lesson, 'lesson-1'); ok(ctx.AIPrompts['lesson-1'] && ctx.AIPrompts['letter-1']);
  const u = ctx.AIPrompts['lesson-1'].user({ ...lessonEvals.cases[0].input, secret: 'salary 18500' });
  ok(!/secret|18500/.test(u), 'unknown fields are not sent'); ok(/Riyadh/.test(u));
  ok(/Every number you write must appear in the facts/.test(ctx.AIPrompts['letter-1'].system));
});

/* ----------------------------------------------------------------- runner */
const good = { lesson: 'You counted the salary and guessed at the travel; price the hardest cost first.', confidence: 0.8 };
const input = lessonEvals.cases[0].input;
function stub(script) {
  const calls = [];
  const f = async (url, opts) => {
    const step = script[calls.length] || script[script.length - 1];
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    if (step === 'hang') return new Promise((_, rej) => opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }));
    if (typeof step === 'number') return { ok: false, status: step, json: async () => ({}) };
    const text = typeof step === 'string' ? step : JSON.stringify(step);
    return { ok: true, status: 200, json: async () => (/googleapis/.test(url) ? { candidates: [{ content: { parts: [{ text }] } }] } : { choices: [{ message: { content: text } }] }) };
  };
  return { f, calls };
}
const provs = R.providersFor('lesson', { GROQ_API_KEY: 'g', OPENROUTER_API_KEY: 'o', GEMINI_API_KEY: 'm' });
await t('providersFor: a lesson never goes to Gemini (free tier may train on it); the letter tries Gemini first; no keys, no providers', () => {
  eq(provs.map((p) => p.name).join(), 'groq,openrouter');
  eq(R.providersFor('letter', { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm' }).map((p) => p.name).join(), 'gemini,groq');
  eq(R.providersFor('lesson', {}).length, 0);
  eq(R.providersFor('lesson', { GROQ_API_KEY: 'g', GROQ_MODEL: 'openai/gpt-oss-120b' })[0].model, 'openai/gpt-oss-120b');
});
await t('run: a valid first answer comes back with provider and prompt version; the request asks for JSON with the key in a header', async () => {
  const s = stub([good]), logs = [];
  const r = await R.run({ task: 'lesson', input, providers: provs, fetch: s.f, log: (l) => logs.push(l) });
  eq(r.ok, true); eq(r.value.lesson, good.lesson); eq(r.provider, 'groq'); eq(r.prompt_version, 'lesson-1');
  eq(s.calls.length, 1); eq(s.calls[0].body.response_format.type, 'json_object'); eq(s.calls[0].headers.authorization, 'Bearer g');
  ok(!JSON.stringify(logs).includes('Riyadh') && !JSON.stringify(logs).includes('salary'), 'logs carry no content');
  eq(logs[0].ok, true); eq(typeof logs[0].ms, 'number');
});
await t('run: an invalid answer is retried once with the errors; the retry fixes it', async () => {
  const s = stub([{ lesson: 'Prices fell 12% so you lost AED 9,000.' }, good]);
  const r = await R.run({ task: 'lesson', input, providers: provs, fetch: s.f });
  eq(r.ok, true); eq(s.calls.length, 2);
  const msgs = s.calls[1].body.messages; ok(/rejected: lesson: numbers not in the decision \(12, 9000\)/.test(msgs[msgs.length - 1].content), msgs[msgs.length - 1].content);
});
await t('run: invalid twice → next provider; 429 and a timeout move on too; all failing → a plain fallback, never the bad text', async () => {
  let s = stub(['not json', 'still not json', good]);
  let r = await R.run({ task: 'lesson', input, providers: provs, fetch: s.f });
  eq(r.ok, true); eq(r.provider, 'openrouter'); eq(s.calls.length, 3);
  s = stub([429, good]); r = await R.run({ task: 'lesson', input, providers: provs, fetch: s.f });
  eq(r.provider, 'openrouter');
  s = stub(['hang', good]); r = await R.run({ task: 'lesson', input, providers: provs, fetch: s.f, timeoutMs: 40 });
  eq(r.ok, true); eq(r.provider, 'openrouter');
  s = stub([500]); r = await R.run({ task: 'lesson', input, providers: provs, fetch: s.f });
  eq(r.ok, false); eq(r.fallback, true); ok(!('value' in r));
  r = await R.run({ task: 'lesson', input, providers: [], fetch: s.f }); eq(r.error, 'AI is not set up yet.');
  r = await R.run({ task: 'lesson', input: { title: 'x' }, providers: provs, fetch: s.f }); eq(r.ok, false);
});
await t('run: Gemini shape for the letter (system instruction, JSON mime type, key in a header)', async () => {
  const c = letterEvals.cases[0];
  const s = stub([c.recorded]);
  const r = await R.run({ task: 'letter', input: c.facts, providers: R.providersFor('letter', { GEMINI_API_KEY: 'm' }), fetch: s.f });
  eq(r.ok, true); eq(r.provider, 'gemini');
  ok(/models\/gemini-2\.5-flash:generateContent$/.test(s.calls[0].url)); eq(s.calls[0].headers['x-goog-api-key'], 'm');
  eq(s.calls[0].body.generationConfig.responseMimeType, 'application/json'); ok(s.calls[0].body.systemInstruction.parts[0].text.length > 50);
});

/* ------------------------------------------------------------ the letter */
await t('week: the last full Sunday–Saturday, whatever day it is now', () => {
  eq(L.week('2026-10-17').from, '2026-10-04'); eq(L.week('2026-10-17').to, '2026-10-10');   // Saturday: the week before
  eq(L.week('2026-10-18').from, '2026-10-11'); eq(L.week('2026-10-18').to, '2026-10-17');   // Sunday: the week just ended
  eq(L.week('2026-10-21').key, '2026-10-11');
});
const wk = L.week('2026-10-18');
const keptRows = [];
for (let d = 4; d <= 17; d++) { const day = '2026-10-' + String(d).padStart(2, '0'); keptRows.push({ d: day, descr: 'CARREFOUR', amount_minor: -(8000 + d * 500), cat: 'Grocery', kind: 'expense' }); }
keptRows.push({ d: '2026-10-13', descr: 'ZOMATO', amount_minor: -12000, cat: 'Dining', kind: 'expense' }, { d: '2026-10-11', descr: 'SALARY', amount_minor: 1850000, cat: 'Income', kind: 'income' }, { d: '2026-10-12', descr: 'SIP', amount_minor: -100000, cat: 'Investment', kind: 'invest' });
const spentDays = ['11', '12', '13', '14', '15', '16', '17'].map((x, i) => ({ d: '2026-10-' + x, blocks: { sleep: 450, work: 540, learning: 30 * i, family: 60 }, src: {}, confirmed_at: i % 2 ? '2026-10-' + x + 'T20:00:00Z' : null }));
const decisions = [{ id: 'a', title: 'Take the Riyadh role', decided_on: '2026-10-12', review_on: '2026-12-12', status: 'open', confidence: 75 }, { id: 'b', title: 'Buy the car', decided_on: '2026-09-01', review_on: '2026-10-15', status: 'open', confidence: 80 }];
const F = L.facts({ kept: { rows: keptRows, profile: { currency: 'AED' } }, spent: { days: spentDays, profile: {} }, decided: { list: decisions } }, wk, '2026-10-18');
await t('facts: sums only, as finished strings; no payees, no entries', () => {
  eq(F.week.from, '11 Oct'); eq(F.week.days, 7);
  eq(F.money.spent, 'AED ' + ((keptRows.filter((r) => r.d >= '2026-10-11' && r.d <= '2026-10-17' && r.kind === 'expense').reduce((s, r) => s - r.amount_minor, 0) / 100).toLocaleString('en-US')));
  eq(F.money.biggest_category, 'Grocery'); ok(/more than the week before/.test(F.money.change));
  ok(!JSON.stringify(F).includes('CARREFOUR') && !JSON.stringify(F).includes('SALARY'), 'no payees');
  eq(F.time.days_on_record, 7); eq(F.time.days_checked_in, 3); eq(F.time.best_day, 'Saturday'); eq(F.time.target, '20%');
  eq(F.decisions.logged_this_week, 1); eq(F.decisions.due_now, 1); eq(F.decisions.next_review, 'Take the Riyadh role');
});
await t('plain: the no-AI letter states only figures from the facts, and an empty week says what to do', () => {
  const P = L.plain(F);
  eq(C.ungrounded(P.letter + ' ' + P.suggestion, F).length, 0, C.ungrounded(P.letter, F).join());
  ok(/^Money: AED/.test(P.letter)); ok(/Decisions: 1 logged/.test(P.letter)); ok(/due/.test(P.suggestion));
  const E = L.facts({}, wk, '2026-10-18');
  ok(!E.money && !E.time && !E.decisions);
  ok(/Nothing was on the record/.test(L.plain(E).letter));
  for (const c of letterEvals.cases.filter((x) => x.valid)) eq(C.ungrounded(L.plain(c.facts).letter, c.facts).length, 0, c.id);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
