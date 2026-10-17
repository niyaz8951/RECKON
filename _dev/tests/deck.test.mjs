/* The shared deck (assets/js/deck.js) in jsdom: pointer swipes in three
   directions, a drag too short to count springs back, the tap buttons do
   exactly what the swipes do, keyboard, the dial (keys, presets, Set),
   cards added mid-deck, the summary, closing, and reduced motion. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const SRC = readFileSync(resolve(ROOT, 'assets/js/deck.js'), 'utf8');

function env(reduced) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(String(e && e.message))) errors.push(String(e && e.message)); });
  vc.on('error', (m) => errors.push(String(m)));
  const dom = new JSDOM('<!doctype html><html><body><button id="opener">open</button></body></html>', { url: 'https://reckon.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: reduced && /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  w.navigator.vibrate = (ms) => { (w.__buzz = w.__buzz || []).push(ms); return true; };
  w.eval(SRC);
  return { w, d: w.document, errors };
}
function pointer(w, el, type, x, y) {
  const Ev = w.PointerEvent || w.MouseEvent;
  el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
}
async function swipe(w, el, dx, dy) {
  pointer(w, el, 'pointerdown', 200, 400);
  for (let i = 1; i <= 5; i++) pointer(w, el, 'pointermove', 200 + dx * i / 5, 400 + dy * i / 5);
  await tick(60);   // slow enough that it is distance, not a flick, that decides
  pointer(w, el, 'pointerup', 200 + dx, 400 + dy);
}
const qcards = () => [1, 2, 3, 4].map((i) => ({ id: 'q' + i, kind: 'question', title: 'Question ' + i, reason: 'Because ' + i }));

await t('opens full screen as a modal dialog, first card focused on Yes, progress dots', async () => {
  const { w, d, errors } = env(false);
  d.getElementById('opener').focus();
  const deck = w.TNDeck.open({ label: 'Check in', cards: qcards() });
  const el = d.querySelector('.deck');
  ok(el); eq(el.getAttribute('role'), 'dialog'); eq(el.getAttribute('aria-modal'), 'true'); eq(el.getAttribute('aria-label'), 'Check in');
  ok(d.documentElement.classList.contains('deck-open'), 'page scroll locked');
  eq(d.querySelectorAll('.deck-card').length, 1, 'one card at a time');
  eq(d.querySelector('.deck-card__title').textContent, 'Question 1');
  eq(d.querySelector('.deck-card__reason').textContent, 'Because 1');
  eq(d.querySelectorAll('.deck__dots i').length, 4);
  eq(d.activeElement, d.querySelector('.deck-btn--yes'));
  eq([...d.querySelectorAll('.deck__foot .deck-btn')].map((b) => b.textContent).join(','), 'No,Skip,Yes', 'three equal buttons');
  deck.close(); await tick(250);
  ok(!d.querySelector('.deck'), 'removed'); ok(!d.documentElement.classList.contains('deck-open'));
  eq(d.activeElement, d.getElementById('opener'), 'focus restored');
  eq(errors.length, 0, errors.join());
});
await t('swipes: right = yes, left = no, up = skip; a short drag springs back', async () => {
  const { w, d } = env(false);
  const got = [];
  w.TNDeck.open({ cards: qcards(), onAnswer: (c, a) => got.push(c.id + ':' + a) });
  await swipe(w, d.querySelector('.deck-card'), 30, 0); await tick(300);
  eq(got.length, 0, 'too short');
  eq(d.querySelector('.deck-card').style.transform, '', 'sprang back');
  await swipe(w, d.querySelector('.deck-card'), 240, 10); await tick(300);
  await swipe(w, d.querySelector('.deck-card'), -240, 0); await tick(300);
  await swipe(w, d.querySelector('.deck-card'), 0, -260); await tick(300);
  eq(got.join(), 'q1:yes,q2:no,q3:skip');
  ok(w.__buzz && w.__buzz.length >= 3, 'haptic tick on each answer');
});
await t('while dragging, the card follows the finger and the matching hint fades in', async () => {
  const { w, d } = env(false);
  w.TNDeck.open({ cards: qcards() });
  const c = d.querySelector('.deck-card');
  pointer(w, c, 'pointerdown', 200, 400); pointer(w, c, 'pointermove', 140, 402);
  eq(c.getAttribute('data-intent'), 'no'); ok(/translate\(-60px/.test(c.style.transform), c.style.transform);
  ok(+c.style.getPropertyValue('--p') > 0);
  pointer(w, c, 'pointerup', 140, 402);
});
await t('buttons and arrow keys answer exactly like swipes', async () => {
  const { w, d } = env(false);
  const got = [];
  w.TNDeck.open({ cards: qcards(), onAnswer: (c, a) => got.push(a) });
  d.querySelector('[data-deck="yes"]').click(); await tick(300);
  d.querySelector('[data-deck="no"]').click(); await tick(300);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); await tick(300);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await tick(300);
  eq(got.join(), 'yes,no,skip,yes');
});
await t('onAnswer can add a dial next; the dial takes keys, presets and Set', async () => {
  const { w, d } = env(false);
  const got = [];
  w.TNDeck.open({
    cards: qcards().slice(0, 2),
    onAnswer: (c, a, deck) => { got.push(c.id + ':' + (typeof a === 'string' ? a : a.value)); if (c.id === 'q1' && a === 'no') deck.insertNext({ id: 'dial', kind: 'dial', title: 'How much?', value: 60, max: 480, step: 5, presets: [0, 30, 90] }); }
  });
  d.querySelector('[data-deck="no"]').click(); await tick(300);
  const ring = d.querySelector('.deck-dial__ring');
  ok(ring, 'dial shown next'); eq(ring.getAttribute('role'), 'slider'); eq(d.activeElement, ring);
  eq(d.querySelector('.deck-dial__v').textContent, '1h');
  ring.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  eq(ring.getAttribute('aria-valuenow'), '65');
  ring.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
  eq(d.querySelector('.deck-dial__v').textContent, '2h 05m');
  eq(d.querySelectorAll('[data-preset]').length, 3);
  d.querySelector('[data-preset="90"]').click();
  eq(d.querySelector('[data-preset="90"]').getAttribute('aria-pressed'), 'true');
  d.querySelector('[data-deck="set"]').click(); await tick(300);
  eq(got.join(), 'q1:no,dial:90');
  eq(d.querySelector('.deck-card__title').textContent, 'Question 2', 'then the deck carries on');
});
await t('a dial dragged round the ring does not jump at the top', async () => {
  const { w, d } = env(false);
  w.TNDeck.open({ cards: [{ id: 'd', kind: 'dial', title: 'x', value: 0, max: 480 }] });
  const ring = d.querySelector('.deck-dial__ring');
  ring.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 });
  pointer(w, ring, 'pointerdown', 100, 2);                       // top: 0
  pointer(w, ring, 'pointermove', 198, 100);                      // right: a quarter
  eq(ring.getAttribute('aria-valuenow'), '120');
  pointer(w, ring, 'pointermove', 100, 198);                      // bottom: a half
  pointer(w, ring, 'pointermove', 2, 100);                        // left: three quarters
  pointer(w, ring, 'pointermove', 60, 3);                         // nearly round
  pointer(w, ring, 'pointermove', 120, 3);                        // past the top: clamps, no wrap to 0
  eq(ring.getAttribute('aria-valuenow'), '480');
  pointer(w, ring, 'pointerup', 120, 3);
});
await t('clear() ends early; onDone returns the summary; its actions reach onSummary', async () => {
  const { w, d } = env(false);
  let how = null, picked = null;
  w.TNDeck.open({
    cards: qcards(),
    onAnswer: (c, a, deck) => { if (a === 'yes') deck.clear(); },
    onDone: () => ({ title: '3h yours today', body: 'About a usual Thursday.', actions: [{ label: 'Done', value: 'done', primary: true }, { label: 'Edit day', value: 'edit' }] }),
    onSummary: (v) => { picked = v; },
    onClose: (h) => { how = h; }
  });
  d.querySelector('[data-deck="yes"]').click(); await tick(300);
  eq(d.querySelector('.deck-card__title').textContent, '3h yours today');
  eq(d.querySelector('.deck-card__text').textContent, 'About a usual Thursday.');
  ok(d.querySelector('.deck-card--info'));
  [...d.querySelectorAll('.deck__foot .deck-btn')].find((b) => b.textContent === 'Edit day').click();
  await tick(250);
  eq(picked, 'edit'); eq(how, 'done'); ok(!d.querySelector('.deck'));
});
await t('Escape or the close button ends the deck as "closed", without onDone', async () => {
  const { w, d } = env(false);
  let how = null, done = 0;
  w.TNDeck.open({ cards: qcards(), onDone: () => { done++; }, onClose: (h) => { how = h; } });
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick(250);
  eq(how, 'closed'); eq(done, 0); ok(!d.querySelector('.deck'));
});
await t('reduced motion: the deck says so, cards never move with the finger, answers still count', async () => {
  const { w, d, errors } = env(true);
  const got = [];
  w.TNDeck.open({ cards: qcards(), onAnswer: (c, a) => got.push(a) });
  ok(d.querySelector('.deck').classList.contains('deck--reduced'));
  const c = d.querySelector('.deck-card');
  pointer(w, c, 'pointerdown', 200, 400); pointer(w, c, 'pointermove', 420, 400);
  eq(c.style.transform, '', 'no transform under reduced motion');
  pointer(w, c, 'pointerup', 420, 400);
  await tick(200);
  eq(got.join(), 'yes', 'the swipe still answers');
  ok(!d.querySelector('.deck-card.is-flying'), 'faded, not flown');
  const css = readFileSync(resolve(ROOT, 'assets/css/global.css'), 'utf8');
  ok(/\.deck--reduced[^{]*\{[^}]*animation:\s*none/.test(css) && /prefers-reduced-motion: reduce\) \{ \.deck/.test(css), 'css honours it too');
  eq(errors.length, 0, errors.join());
});

await t('text card: Save hands back the words; empty or Skip is "skip"; the assist button fills the box, and a failure says so in one line', async () => {
  const { w, d, errors } = env(true);
  const got = [];
  let calls = 0;
  w.TNDeck.open({ cards: [
    { id: 't1', kind: 'text', title: 'What happened?', placeholder: 'One line' },
    { id: 't2', kind: 'text', title: 'Anything to tell yourself?', assist: { label: 'Suggest one', run: () => { calls++; return calls === 1 ? Promise.reject(new Error('AI is busy — write your own.')) : Promise.resolve('Check the base rate first.'); } } },
    { id: 't3', kind: 'text', title: 'Empty' }
  ], onAnswer: (c, a) => got.push(a) });
  eq(d.activeElement && d.activeElement.className, 'deck-text', 'the box has focus');
  eq(d.querySelector('.deck-text').getAttribute('placeholder'), 'One line');
  d.querySelector('.deck-text').value = '  Went fine, slower than hoped. ';
  d.querySelector('[data-deck="set"]').click(); await tick(200);
  eq(got[0].value, 'Went fine, slower than hoped.');
  ok(!d.querySelector('[data-deck="yes"]'), 'no yes/no on a text card');
  d.querySelector('[data-assist]').click(); await tick(30);
  eq(d.querySelector('.deck-assist__note').textContent, 'AI is busy — write your own.');
  eq(d.querySelector('.deck-text').value, '', 'nothing filled on failure');
  d.querySelector('[data-assist]').click(); await tick(30);
  eq(d.querySelector('.deck-text').value, 'Check the base rate first.');
  ok(/suggestion/.test(d.querySelector('.deck-assist__note').textContent));
  eq(got.length, 1, 'a suggestion is not an answer');
  const ta = d.querySelector('.deck-text');
  ta.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); await tick(200);
  eq(got[1].value, 'Check the base rate first.');
  d.querySelector('[data-deck="set"]').click(); await tick(200);
  eq(got[2], 'skip', 'saving an empty box is a skip');
  eq(errors.length, 0, errors.join());
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
