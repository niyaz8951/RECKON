/* Your week (letter/) in jsdom: with AI off the plain letter, written in
   code, with the numbers under it; with AI on the model's letter (the Edge
   Function stubbed), checked and cached so it reads offline; an answer
   that fails the contract never shows — the plain letter does, and says
   why. Clock pinned to a Sunday. */
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
const HTML = readFileSync(resolve(ROOT, 'letter/index.html'), 'utf8');
const TODAY = '2026-10-18';   // Sunday: the letter covers 11–17 Oct

const rows = [];
for (let d = 4; d <= 17; d++) rows.push({ id: 'k' + d, d: '2026-10-' + String(d).padStart(2, '0'), descr: 'CARREFOUR', amount_minor: -(9000 + d * 400), cat: 'Grocery', kind: 'expense' });
const days = ['11', '12', '13', '14', '15', '16', '17'].map((x, i) => ({ d: '2026-10-' + x, blocks: { sleep: 450, work: 540, learning: 30 * i, family: 60 }, src: {}, confirmed_at: '2026-10-' + x + 'T20:00:00Z' }));

async function boot({ ai = false, reply, storage } = {}) {
  const calls = [];
  const json = (body, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => body });
  async function fakeFetch(url) {
    const u = new URL(url, 'https://reckon.test'); calls.push(u.pathname);
    if (u.pathname === '/api/auth/me') return json({ user: { id: 'u1', email: 'n@example.com', name: 'Niyaz', role: 'user', status: 'active', ai_on: ai } });
    if (u.pathname === '/api/kept/bootstrap') return json({ transactions: rows, profile: { currency: 'AED' } });
    if (u.pathname === '/api/spent/bootstrap') return json({ days, profile: {} });
    if (u.pathname === '/api/decided/bootstrap') return json({ decisions: [] });
    return json({ error: 'no route' }, 404);
  }
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(String(e && e.message))) errors.push(String(e && e.message)); });
  vc.on('error', (m) => errors.push(String(m)));
  const dom = new JSDOM(HTML, { url: 'https://reckon.test/letter/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.eval(`(function(){var R=Date;var b=new R('${TODAY}T00:00:00');b.setHours(9,0,0,0);var off=b-R.now();function D(...a){return a.length?new R(...a):new R(R.now()+off)};D.now=()=>R.now()+off;D.parse=R.parse;D.UTC=R.UTC;D.prototype=R.prototype;window.Date=D;})();`);
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (storage) Object.keys(storage).forEach((k) => w.localStorage.setItem(k, storage[k]));
  installApi(w, fakeFetch);
  const invokes = [];
  w.TNData.invoke = async (name, body) => { invokes.push(body); return reply ? reply(body) : { ok: false, error: 'AI is not set up yet.' }; };
  w.scrollTo = () => {};
  const done = new Promise((r) => w.document.addEventListener('letter:ready', r, { once: true }));
  for (const f of ['assets/js/global.js', 'spent/spent-engine.js', 'decided/decided-engine.js', 'supabase/functions/_shared/ai-contract.js', 'assets/js/ai.js', 'assets/js/letter.js', 'letter/letter-page.js']) w.eval(readFileSync(resolve(ROOT, f), 'utf8'));
  await Promise.race([done, tick(4000).then(() => { throw new Error('letter:ready never fired'); })]);
  const d = w.document;
  return { w, d, calls, invokes, errors, $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)] };
}

await t('AI off: the plain letter, the week it covers, a suggestion, and the numbers it was written from', async () => {
  const P = await boot();
  eq(P.$('#lt-week').textContent, '11 Oct – 17 Oct');
  ok(/^Money: AED [\d,]+ went on spending this week/.test(P.$('#lt-letter p').textContent), P.$('#lt-letter p').textContent);
  ok(/Time: .* was yours by choice/.test(P.$('#lt-letter').textContent));
  ok(P.$('#lt-sug').textContent.length > 10);
  eq(P.$('#lt-by').textContent, 'Written from the numbers below.');
  ok(P.$$('.lt-dl__row').length >= 8); ok(!/CARREFOUR/.test(P.d.body.textContent), 'no payees anywhere');
  eq(P.invokes.length, 0);
  eq(P.errors.length, 0, P.errors.join());
});
let cache;
await t('AI on: the model\'s letter from the sums only, checked, cached for offline', async () => {
  const P = await boot({ ai: true, reply: (b) => {
    const f = b.input;
    const letter = ('This week ' + f.money.spent + ' went on spending, ' + f.money.change + '. ' + f.money.biggest_category + ' was the largest share. ' +
      'On time, ' + f.time.yours_total + ' of the week was yours, about ' + f.time.yours_per_day + ' a day, most on ' + f.time.best_day + '. ' +
      'You checked in on ' + f.time.days_checked_in + ' of ' + f.time.days_on_record + ' days. ').repeat(3);
    return { ok: true, value: { letter, suggestion: 'Keep ' + f.time.best_day + ' as it is.' }, provider: 'gemini', prompt_version: 'letter-1' };
  } });
  eq(P.invokes.length, 1); eq(P.invokes[0].task, 'letter'); eq(P.invokes[0].cache_key, '2026-10-11');
  ok(!JSON.stringify(P.invokes[0].input).includes('CARREFOUR'), 'sums only');
  ok(/^This week AED/.test(P.$('#lt-letter p').textContent));
  ok(/Worded by AI/.test(P.$('#lt-by').textContent));
  cache = P.w.localStorage.getItem('reckon-letter:u1:2026-10-11'); ok(cache && JSON.parse(cache).by === 'ai');
});
await t('offline next time: the cached letter shows without asking anyone', async () => {
  const P = await boot({ ai: true, storage: { 'reckon-letter:u1:2026-10-11': cache }, reply: () => { throw new Error('should not be called'); } });
  eq(P.invokes.length, 0); ok(!P.calls.includes('/api/kept/bootstrap'), 'no data reloaded');
  ok(/Worded by AI/.test(P.$('#lt-by').textContent));
});
await t('AI answer with an invented figure: never shown; the plain letter says why', async () => {
  const P = await boot({ ai: true, reply: () => ({ ok: true, value: { letter: 'You spent 14% more. '.repeat(40), suggestion: 'Spend AED 99 less.' } }) });
  ok(/^Money:/.test(P.$('#lt-letter p').textContent));
  ok(/AI did not answer \(No suggestion this time\), so this is the plain version/.test(P.$('#lt-by').textContent), P.$('#lt-by').textContent);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
