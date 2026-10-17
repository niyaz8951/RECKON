/* RECKON — one AI task, from input to a validated answer.
   =============================================================================
   Used by the Edge Function (index.ts) and by the tests, which hand it a
   stub fetch. Nothing here knows about users, caps or caches.

     AIRun.run({ task, input, providers, fetch, timeoutMs, log })
       → { ok: true, value, provider, prompt_version, ms }
       | { ok: false, error, fallback: true }

   The order of events:
   1. limits(): the input is checked and capped before anything is sent.
   2. Providers in order (the function picks them per task: the letter goes
      to Gemini first — aggregates only; a lesson never does, since a free
      tier may train on what it is sent). A timeout (8 s), a 429 or a 5xx
      moves on to the next provider.
   3. The answer is parsed and validated (ai-contract.js). Invalid → ONE
      retry on the same provider with the errors listed; still invalid →
      the next provider. Nothing unvalidated is ever returned.
   4. The log line has task, provider, latency and outcome — never content.

   Providers: { name, kind: 'openai' | 'gemini', url, key, model }. */
(function (root) {
  'use strict';
  var C = root.AIContract, P = root.AIPrompts;

  function promptFor(task) {
    var v = C.VERSIONS[task], p = P && P[v];
    if (!p) throw new Error('no prompt ' + v);
    return { version: v, system: p.system, user: p.user };
  }

  function request(prov, system, messages) {
    if (prov.kind === 'gemini') {
      return {
        url: prov.url.replace(/\/$/, '') + '/models/' + encodeURIComponent(prov.model) + ':generateContent',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': prov.key },
        body: { systemInstruction: { parts: [{ text: system }] },
          contents: messages.map(function (m) { return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }; }),
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 700 } }
      };
    }
    return {
      url: prov.url.replace(/\/$/, '') + '/chat/completions',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + prov.key },
      body: { model: prov.model, temperature: 0.4, max_tokens: 700, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }].concat(messages) }
    };
  }
  function textOf(prov, data) {
    if (prov.kind === 'gemini') {
      var c = data && data.candidates && data.candidates[0], parts = c && c.content && c.content.parts;
      return parts ? parts.map(function (p) { return p.text || ''; }).join('') : '';
    }
    var ch = data && data.choices && data.choices[0];
    return ch && ch.message ? ch.message.content || '' : '';
  }

  async function call(prov, system, messages, opts) {
    var req = request(prov, system, messages);
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, opts.timeoutMs || 8000);
    try {
      var res = await opts.fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: ctl ? ctl.signal : undefined });
      if (!res.ok) return { fail: res.status === 429 ? 'rate-limited' : 'http ' + res.status };
      var data = await res.json();
      return { text: textOf(prov, data) };
    } catch (e) {
      return { fail: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    } finally { clearTimeout(timer); }
  }

  async function run(o) {
    var task = o.task, input = o.input, log = o.log || function () {};
    var bad = C.limits(task, input);
    if (bad.length) return { ok: false, error: bad.join('; '), fallback: true };
    var pr = promptFor(task), user = pr.user(input);
    var provs = (o.providers || []).filter(function (p) { return p && p.key; });
    if (!provs.length) return { ok: false, error: 'AI is not set up yet.', fallback: true };
    for (var i = 0; i < provs.length; i++) {
      var prov = provs[i], messages = [{ role: 'user', content: user }];
      for (var attempt = 0; attempt < 2; attempt++) {
        var t0 = Date.now(), r = await call(prov, pr.system, messages, o);
        var ms = Date.now() - t0;
        if (r.fail) { log({ task: task, provider: prov.name, ms: ms, ok: false, why: r.fail }); break; }   // next provider
        var parsed = C.parseJSON(r.text), v = C.validate(task, parsed, input);
        if (v.ok) { log({ task: task, provider: prov.name, ms: ms, ok: true, attempt: attempt + 1 }); return { ok: true, value: v.value, provider: prov.name, prompt_version: pr.version, ms: ms }; }
        log({ task: task, provider: prov.name, ms: ms, ok: false, why: 'invalid', attempt: attempt + 1 });
        // One retry with what was wrong; the model's own answer goes back
        // as context so it can fix rather than start over.
        messages = messages.concat([{ role: 'assistant', content: String(r.text || '').slice(0, 2000) },
          { role: 'user', content: 'That answer was rejected: ' + (v.errors || ['not valid JSON']).join('; ') + '. Reply again with JSON only, fixing exactly that.' }]);
      }
    }
    return { ok: false, error: 'No suggestion this time.', fallback: true };
  }

  /* Which providers a task may use, in order, from the secrets present. */
  function providersFor(task, env) {
    var get = function (k) { return env[k] || ''; };
    var groq = { name: 'groq', kind: 'openai', url: 'https://api.groq.com/openai/v1', key: get('GROQ_API_KEY'), model: get('GROQ_MODEL') || 'llama-3.3-70b-versatile' };
    var gemini = { name: 'gemini', kind: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta', key: get('GEMINI_API_KEY'), model: get('GEMINI_MODEL') || 'gemini-2.5-flash' };
    var openrouter = { name: 'openrouter', kind: 'openai', url: 'https://openrouter.ai/api/v1', key: get('OPENROUTER_API_KEY'), model: get('OPENROUTER_MODEL') || 'meta-llama/llama-3.3-70b-instruct:free' };
    var order = task === 'letter' ? [gemini, groq, openrouter] : [groq, openrouter];   // personal words never go to a tier that may train on them
    return order.filter(function (p) { return p.key; });
  }

  root.AIRun = { run: run, providersFor: providersFor, request: request, textOf: textOf };
})(typeof window !== 'undefined' ? window : globalThis);
