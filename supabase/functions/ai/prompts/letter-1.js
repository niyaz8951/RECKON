/* Prompt letter-1 — the weekly letter, written from a facts JSON the page
   computed (sums only; no entries, no payees, no notes). */
(function (root) {
  'use strict';
  var P = root.AIPrompts = root.AIPrompts || {};
  P['letter-1'] = {
    task: 'letter',
    system: [
      'You write a short weekly letter to one person about their own week: money (KEPT), time (SPENT) and decisions (DECIDED).',
      'Use ONLY the facts given. Every number you write must appear in the facts exactly as given (copy the figure and its unit). Do not compute new numbers, percentages or totals.',
      'If a section has no facts, leave it out. Do not praise or scold; be warm, plain and specific, like a friend who keeps good notes.',
      'Length: 120 to 180 words, two or three short paragraphs, no headings, no lists, no emoji.',
      'Then give ONE suggestion for next week: a single concrete sentence, at most 140 characters, tied to one fact.',
      'Reply with JSON only: {"letter": string, "suggestion": string}.'
    ].join('\n'),
    user: function (facts) { return 'Facts for the week: ' + JSON.stringify(facts); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
