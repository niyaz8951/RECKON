// RECKON — the one Edge Function: AI, optional, off by default.
// =============================================================================
// POST /functions/v1/ai   { task: 'lesson' | 'letter', input, cache_key? }
//
// The only server code in RECKON. What it does, in order:
//   1. The caller's JWT → their profile: active, and AI switched on by them.
//   2. A letter already written for this week comes back from ai_cache.
//   3. Daily cap per person (AI_DAILY_CAP, default 30) in ai_usage.
//   4. run.js: limits → providers in order (8 s each) → validate → one
//      retry → next provider. Nothing unvalidated leaves this function.
//   5. A letter is cached; the result carries its prompt version.
// Keys live only as Supabase secrets. Logs carry task, provider, latency
// and outcome — never what anyone wrote.
//
// Deploy (see SETUP.md §8):
//   supabase functions deploy ai
//   supabase secrets set GROQ_API_KEY=… GEMINI_API_KEY=… OPENROUTER_API_KEY=…
import { createClient } from 'jsr:@supabase/supabase-js@2';
import '../_shared/ai-contract.js';
import './prompts/lesson-1.js';
import './prompts/letter-1.js';
import './run.js';

// deno-lint-ignore no-explicit-any
const G = globalThis as any;
const CORS = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') || '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('authorization') || '';
  const asUser = createClient(url, anon, { global: { headers: { authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json({ error: 'Sign in again.', fallback: true }, 401);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: prof } = await admin.from('profiles').select('id,status,ai_on').eq('id', who.user.id).maybeSingle();
  if (!prof || prof.status !== 'active') return json({ error: 'This account is not active.', fallback: true }, 403);
  if (prof.ai_on !== 1) return json({ error: 'AI is switched off in Account.', fallback: true }, 403);

  let body: { task?: string; input?: unknown; cache_key?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad request.', fallback: true }, 400); }
  const task = String(body.task || '');
  if (!G.AIContract.VERSIONS[task]) return json({ error: 'Unknown task.', fallback: true }, 400);
  const version = G.AIContract.VERSIONS[task];
  const cacheKey = task === 'letter' ? String(body.cache_key || '').slice(0, 40) : '';

  if (cacheKey) {
    const { data: hit } = await admin.from('ai_cache').select('output_json,provider,prompt_version')
      .eq('user_id', prof.id).eq('task', task).eq('key', cacheKey).eq('prompt_version', version).maybeSingle();
    if (hit) return json({ ok: true, value: JSON.parse(hit.output_json), provider: hit.provider, prompt_version: hit.prompt_version, cached: true });
  }

  const cap = Number(Deno.env.get('AI_DAILY_CAP') || 30);
  const day = new Date().toISOString().slice(0, 10), usageId = prof.id + '|' + day + '|' + task;
  const { data: use } = await admin.from('ai_usage').select('n').eq('id', usageId).maybeSingle();
  if ((use?.n || 0) >= cap) return json({ error: 'That is today\'s AI limit — write your own, it is better anyway.', fallback: true }, 429);
  await admin.from('ai_usage').upsert({ id: usageId, user_id: prof.id, day, task, n: (use?.n || 0) + 1, updated_at: new Date().toISOString() });

  const env = Deno.env.toObject();
  const out = await G.AIRun.run({
    task, input: body.input, providers: G.AIRun.providersFor(task, env), fetch, timeoutMs: 8000,
    log: (line: unknown) => console.log(JSON.stringify(line)),   // task, provider, ms, ok — no content
  });
  if (!out.ok) return json({ ok: false, error: out.error, fallback: true }, 200);

  if (cacheKey) {
    await admin.from('ai_cache').upsert({ id: 'aic_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20), user_id: prof.id, task, key: cacheKey,
      prompt_version: out.prompt_version, provider: out.provider, output_json: JSON.stringify(out.value) }, { onConflict: 'user_id,task,key' });
  }
  return json({ ok: true, value: out.value, provider: out.provider, prompt_version: out.prompt_version });
});
