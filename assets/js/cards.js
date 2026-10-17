/* RECKON — cards.js: CardEngine, the one card a screen may show today.
   =============================================================================
   Each app offers candidate cards ({ app, type, key, score 0–1, title, body,
   why, actions }); this file picks at most one. Quiet is a feature: a card
   whose adjusted score is under FLOOR is not shown at all.

   The person teaches it. card_feedback rows say what they made of a card
   (shown · useful · not · acted); a card shown and not answered that day
   counts as ignored. Each card *type* gets a weight from that history,
   with older feedback fading (half-life 60 days), so a type the person
   keeps waving away sinks and one they act on rises. A card answered "not
   useful" stays away for 30 days; one acted on is done.

   Once a card is shown on a day it stays the card for that day (the screen
   does not reshuffle on every visit).

     TNCards.weights(feedback, today)  → { type: weight }
     TNCards.forDate(candidates, feedback, today, { app }) → card | null
   Pure. */
(function (root) {
  'use strict';

  var HALF_LIFE = 60, FLOOR = 0.15, MIN_W = 0.2, MAX_W = 1.5, MUTE_DAYS = 30;

  function parse(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00'); }
  function days(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function fade(d, today) { return Math.pow(0.5, Math.max(0, days(d, today)) / HALF_LIFE); }

  /* Shown-and-not-answered, per card per day. */
  function sightings(feedback) {
    var seen = {};
    (feedback || []).forEach(function (f) {
      var k = f.type + '|' + f.card_key + '|' + f.d;
      seen[k] = seen[k] || { type: f.type, d: f.d, shown: false, answered: false };
      if (f.verdict === 'shown') seen[k].shown = true; else seen[k].answered = true;
    });
    return Object.keys(seen).map(function (k) { return seen[k]; });
  }

  function weights(feedback, today) {
    var acc = {};
    function bump(type, field, w) { acc[type] = acc[type] || { good: 0, bad: 0, ignored: 0 }; acc[type][field] += w; }
    (feedback || []).forEach(function (f) {
      var w = fade(f.d, today);
      if (f.verdict === 'useful' || f.verdict === 'acted') bump(f.type, 'good', w);
      else if (f.verdict === 'not') bump(f.type, 'bad', w);
    });
    sightings(feedback).forEach(function (s) { if (s.shown && !s.answered && s.d < today) bump(s.type, 'ignored', fade(s.d, today)); });
    var out = {};
    Object.keys(acc).forEach(function (t) {
      var a = acc[t];
      // Starts at 1 with no history; each "useful" pulls up, each "not" down
      // twice as hard, each ignore a little.
      var w = (2 + 2 * a.good) / (2 + a.good + 2 * a.bad + 0.5 * a.ignored);
      out[t] = Math.max(MIN_W, Math.min(MAX_W, Math.round(w * 100) / 100));
    });
    return out;
  }

  function forDate(candidates, feedback, today, o) {
    o = o || {};
    var fb = (feedback || []).filter(function (f) { return !o.app || f.app === o.app; });
    // Already shown today and not answered: keep it.
    var todays = fb.filter(function (f) { return f.d === today; });
    var answeredToday = {};
    todays.forEach(function (f) { if (f.verdict !== 'shown') answeredToday[f.type + '|' + f.card_key] = 1; });
    var W = weights(fb, today);
    var muted = {};
    fb.forEach(function (f) {
      if (f.verdict === 'acted') muted[f.type + '|' + f.card_key] = 1;
      if (f.verdict === 'not' && days(f.d, today) < MUTE_DAYS) muted[f.type + '|' + f.card_key] = 1;
    });
    var live = (candidates || []).filter(function (c) { var k = c.type + '|' + c.key; return !muted[k] && !answeredToday[k]; });
    // Answering today's card closes the day's budget: one card a day.
    if (Object.keys(answeredToday).length) return null;
    for (var i = 0; i < todays.length; i++) {
      if (todays[i].verdict !== 'shown') continue;
      for (var j = 0; j < live.length; j++) if (live[j].type === todays[i].type && live[j].key === todays[i].card_key) return Object.assign({}, live[j], { weight: W[live[j].type] || 1 });
    }
    var best = null;
    live.forEach(function (c) {
      var w = W[c.type] || 1, s = (Number(c.score) || 0) * w;
      if (s < FLOOR) return;
      if (!best || s > best.adjusted) best = Object.assign({}, c, { weight: w, adjusted: Math.round(s * 100) / 100 });
    });
    return best;
  }

  root.TNCards = { weights: weights, forDate: forDate, FLOOR: FLOOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TNCards;
})(typeof window !== 'undefined' ? window : globalThis);
