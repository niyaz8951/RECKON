/* CardEngine (assets/js/cards.js): one card a day, learned from feedback. Pure. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(resolve(ROOT, 'assets/js/cards.js'), 'utf8'), ctx);
const C = ctx.TNCards;

const TODAY = '2026-10-17';
const card = (type, key, score) => ({ app: 'kept', type, key, score, title: type + ' ' + key, why: 'because' });
const fb = (type, key, verdict, d) => ({ app: 'kept', type, card_key: key, verdict, d: d || TODAY });

t('no history: the highest score wins; below the floor nothing shows', () => {
  eq(C.forDate([card('lookback', 'a', 0.5), card('heads-up', 'b', 0.8)], [], TODAY).key, 'b');
  eq(C.forDate([card('import', 'i', 0.1)], [], TODAY), null, 'quiet is a feature');
  eq(C.forDate([], [], TODAY), null);
});
t('weights: useful lifts a type, not-useful sinks it twice as hard, ignoring nudges it down, old feedback fades', () => {
  const W = C.weights([fb('heads-up', 'x', 'useful', '2026-10-01'), fb('heads-up', 'y', 'acted', '2026-10-05'), fb('lookback', 'z', 'not', '2026-10-10')], TODAY);
  ok(W['heads-up'] > 1, 'heads-up ' + W['heads-up']); ok(W.lookback < 0.7, 'lookback ' + W.lookback);
  const ign = C.weights([fb('lookback', 'a', 'shown', '2026-10-01'), fb('lookback', 'b', 'shown', '2026-10-08'), fb('lookback', 'c', 'shown', '2026-10-12')], TODAY);
  ok(ign.lookback < 1 && ign.lookback > 0.5, 'ignored ' + ign.lookback);
  const old = C.weights([fb('lookback', 'z', 'not', '2025-10-10')], TODAY);
  ok(old.lookback > W.lookback, 'a year-old "not" weighs less: ' + old.lookback);
  const floor = C.weights(Array.from({ length: 30 }, (_, i) => fb('import', 'i' + i, 'not', TODAY)), TODAY);
  eq(floor.import, 0.2, 'never below 0.2');
});
t('learning changes the pick: a type the person waves away loses to one they act on', () => {
  const cands = [card('lookback', 'l', 0.7), card('heads-up', 'h', 0.6)];
  eq(C.forDate(cands, [], TODAY).key, 'l');
  const hist = [fb('lookback', 'old1', 'not', '2026-09-02'), fb('lookback', 'old2', 'not', '2026-10-01'), fb('heads-up', 'old3', 'useful', '2026-09-20')];
  const pick = C.forDate(cands, hist, TODAY);
  eq(pick.key, 'h'); ok(pick.adjusted > 0.6, 'adjusted ' + pick.adjusted);
});
t('a card answered "not useful" stays away 30 days; one acted on is done', () => {
  const cands = [card('heads-up', 'h', 0.9), card('lookback', 'l', 0.5)];
  eq(C.forDate(cands, [fb('heads-up', 'h', 'not', '2026-10-01')], TODAY).key, 'l');
  eq(C.forDate(cands, [fb('heads-up', 'h', 'not', '2026-09-01')], TODAY).key, 'h', 'after 30 days it may come back');
  eq(C.forDate(cands, [fb('heads-up', 'h', 'acted', '2026-06-01')], TODAY).key, 'l');
});
t('one card a day: today\'s card stays put; once it is answered the day is quiet', () => {
  const cands = [card('lookback', 'l', 0.5), card('heads-up', 'h', 0.9)];
  eq(C.forDate(cands, [fb('lookback', 'l', 'shown')], TODAY).key, 'l', 'shown first today, stays');
  eq(C.forDate(cands, [fb('lookback', 'l', 'shown'), fb('lookback', 'l', 'useful')], TODAY), null);
  eq(C.forDate(cands, [{ ...fb('lookback', 'l', 'useful'), app: 'decided' }], TODAY, { app: 'kept' }).key, 'h', 'another app\'s answers do not count');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
