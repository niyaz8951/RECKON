/* RECKON — the AI contract, one file for both sides.
   =============================================================================
   Loaded by the Edge Function (as a module, for its side effect) and by the
   pages and tests (as a plain script). It holds what a model's answer must
   look like and the checks every answer passes before anyone sees it:

     validate(task, output, input) → { ok, value, errors }
       lesson   { lesson: one line, 8–160 characters; confidence 0–1 }
       letter   { letter: 110–200 words; suggestion: one line ≤ 160 chars }
     Every number in the output must already be in the input (grounding):
     the model writes words, never figures of its own.

     numbersIn(text)   the figures in a piece of text, normalised ("1,240"
                       and "1240" are the same; "12%" is 12)
     limits(input)     inputs are capped in size before anything is sent

   Pure; no network. Prompts live in supabase/functions/ai/prompts/. */
(function (root) {
  'use strict';

  var VERSIONS = { lesson: 'lesson-1', letter: 'letter-1' };
  var MAX_INPUT = 4000;            // characters of JSON a request may carry

  function numbersIn(text) {
    var out = [], m, rx = /\d[\d,]*(?:\.\d+)?/g, s = String(text == null ? '' : text);
    while ((m = rx.exec(s))) {
      out.push(String(Number(m[0].replace(/,+$/, '').replace(/,/g, ''))));
    }
    return out;
  }
  function allStrings(x, acc) {
    acc = acc || [];
    if (x == null) return acc;
    if (typeof x === 'string' || typeof x === 'number') acc.push(String(x));
    else if (Array.isArray(x)) x.forEach(function (v) { allStrings(v, acc); });
    else if (typeof x === 'object') Object.keys(x).forEach(function (k) { allStrings(x[k], acc); });
    return acc;
  }
  /* Figures in the output that the input does not have. */
  function ungrounded(outText, input) {
    var have = {};
    numbersIn(allStrings(input).join(' ')).forEach(function (n) { have[n] = 1; });
    return numbersIn(outText).filter(function (n) { return !have[n]; });
  }
  function words(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }
  function oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/^["“'‘]+|["”'’]+$/g, '').trim(); }

  function limits(task, input) {
    var errs = [];
    if (!VERSIONS[task]) errs.push('unknown task');
    var json = ''; try { json = JSON.stringify(input || {}); } catch (e) { errs.push('input is not JSON'); }
    if (json.length > MAX_INPUT) errs.push('input too large');
    if (task === 'lesson') {
      if (!input || !String(input.title || '').trim()) errs.push('a lesson needs the decision');
      if (!input || !String(input.outcome || '').trim()) errs.push('a lesson needs what happened');
    }
    if (task === 'letter' && (!input || !input.week)) errs.push('a letter needs the week');
    return errs;
  }

  function validate(task, out, input) {
    var errors = [];
    if (!out || typeof out !== 'object' || Array.isArray(out)) return { ok: false, errors: ['output is not a JSON object'] };
    if (task === 'lesson') {
      var l = oneLine(out.lesson), c = out.confidence == null ? null : Number(out.confidence);
      if (!l) errors.push('lesson: missing');
      else {
        if (l.length < 8) errors.push('lesson: too short');
        if (l.length > 160) errors.push('lesson: longer than 160 characters');
        if (/https?:\/\/|www\./i.test(l)) errors.push('lesson: contains a link');
      }
      if (c != null && !(c >= 0 && c <= 1)) errors.push('confidence: must be 0–1');
      var u1 = ungrounded(l, input);
      if (u1.length) errors.push('lesson: numbers not in the decision (' + u1.join(', ') + ')');
      return errors.length ? { ok: false, errors: errors } : { ok: true, value: { lesson: l, confidence: c == null ? null : Math.round(c * 100) / 100 } };
    }
    if (task === 'letter') {
      var body = String(out.letter == null ? '' : out.letter).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
      var sug = oneLine(out.suggestion), n = words(body);
      if (!body) errors.push('letter: missing');
      else if (n < 110 || n > 200) errors.push('letter: ' + n + ' words, needs 120–180');
      if (!sug) errors.push('suggestion: missing');
      else if (sug.length > 160) errors.push('suggestion: longer than 160 characters');
      if (/https?:\/\/|www\./i.test(body + ' ' + sug)) errors.push('letter: contains a link');
      var u2 = ungrounded(body + ' ' + sug, input);
      if (u2.length) errors.push('letter: numbers not in the facts (' + u2.join(', ') + ')');
      return errors.length ? { ok: false, errors: errors } : { ok: true, value: { letter: body, suggestion: sug } };
    }
    return { ok: false, errors: ['unknown task'] };
  }

  /* A model's raw text → the JSON object inside it (models sometimes wrap
     it in prose or a code fence). */
  function parseJSON(text) {
    var s = String(text == null ? '' : text).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) { /* fall through */ }
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a > -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* fall through */ } }
    return null;
  }

  root.AIContract = { VERSIONS: VERSIONS, MAX_INPUT: MAX_INPUT, numbersIn: numbersIn, ungrounded: ungrounded, words: words, limits: limits, validate: validate, parseJSON: parseJSON };
})(typeof window !== 'undefined' ? window : globalThis);
