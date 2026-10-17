/* npm run eval:live — the eval inputs against the real providers.
   Needs the keys in the environment (the same names as the Supabase
   secrets): GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, and
   optionally the *_MODEL overrides. Prints, per task and provider, how
   many answers passed the contract on the first or second try and the
   median latency. Sends only the invented eval data in this folder. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '../..');
const ctx = { console, setTimeout, clearTimeout, AbortController, Date, JSON, Promise, fetch }; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['supabase/functions/_shared/ai-contract.js', 'supabase/functions/ai/prompts/lesson-1.js', 'supabase/functions/ai/prompts/letter-1.js', 'supabase/functions/ai/run.js'])
  vm.runInContext(readFileSync(resolve(ROOT, f), 'utf8'), ctx, { filename: f });
const R = ctx.AIRun;
const only = process.argv[2];   // optional: lesson | letter
for (const task of ['lesson', 'letter']) {
  if (only && only !== task) continue;
  const evals = JSON.parse(readFileSync(resolve(ROOT, '_dev/ai-evals/' + task + '.json'), 'utf8')).cases.filter((c) => c.valid);
  const provs = R.providersFor(task, process.env);
  if (!provs.length) { console.log(task + ': no keys in the environment — skipped'); continue; }
  for (const p of provs) {
    let okN = 0; const ms = [];
    for (const c of evals) {
      const r = await R.run({ task, input: c.input || c.facts, providers: [p], fetch, timeoutMs: 8000, log: (l) => { if (l.ok) ms.push(l.ms); } });
      if (r.ok) okN++; else console.log('  ' + c.id + ' ✗ ' + r.error);
      if (process.env.SHOW) console.log('  ' + c.id + ' → ' + JSON.stringify(r.value || r.error));
    }
    ms.sort((a, b) => a - b);
    console.log(`${task} · ${p.name} (${p.model}): ${okN}/${evals.length} valid (${Math.round(okN / evals.length * 100)}%) · median ${ms[Math.floor(ms.length / 2)] || '—'} ms`);
  }
}
