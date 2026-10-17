/* RECKON — ai.js: the page side of the optional AI layer.
   =============================================================================
   Off unless the person switched it on in Account (profiles.ai_on). Every
   call goes to the one Edge Function, and every answer is checked again
   here against the same contract the function uses (ai-contract.js) before
   anything reaches the screen. Every feature that uses it works without it.

     TNAI.on()                      is AI switched on for this person?
     TNAI.lesson(decisionInput)     → Promise<string>  one-line lesson
     TNAI.letter(facts, weekKey)    → Promise<{ letter, suggestion, provider }>
   Errors carry a sentence a person can read ("write your own this time"). */
(function (root) {
  'use strict';
  var C = root.AIContract;

  function on() { var u = root.TN && root.TN.session && root.TN.session.user; return !!(u && u.ai_on); }
  function err(msg) { var e = new Error(msg); e.fallback = true; return e; }

  async function ask(task, input, cacheKey) {
    if (!on()) throw err('AI is switched off in Account.');
    if (!C) throw err('No suggestion this time.');
    var bad = C.limits(task, input);
    if (bad.length) throw err('Not enough to go on yet.');
    var r = await root.TNData.invoke('ai', { task: task, input: input, cache_key: cacheKey || undefined }, 12000);
    if (!r || !r.ok) throw err((r && r.error) || 'No suggestion this time.');
    var v = C.validate(task, r.value, input);       // belt and braces: never show what does not pass
    if (!v.ok) throw err('No suggestion this time.');
    return Object.assign({}, v.value, { provider: r.provider, prompt_version: r.prompt_version, cached: !!r.cached });
  }

  root.TNAI = {
    on: on,
    ask: ask,
    lesson: function (input) { return ask('lesson', input).then(function (v) { return v.lesson; }); },
    letter: function (facts, weekKey) { return ask('letter', facts, weekKey); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
