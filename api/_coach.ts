// The AI coach note: takes a finished set's numbers (never video) and asks Gemini for a short tip.
// Kept apart from coach.ts so it can be unit-tested without the Vercel runtime.

const EXERCISES = ['squat', 'pushup', 'deadlift', 'lunge', 'ohp', 'plank'] as const;
const MAX_BODY = 16_000;
/** Both providers speak the OpenAI chat-completions format. */
export const PROVIDERS = {
  groq: { endpoint: 'https://api.groq.com/openai/v1/chat/completions', models: 'https://api.groq.com/openai/v1/models', model: 'llama-3.3-70b-versatile' },
  gemini: { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', models: null, model: 'gemini-3.5-flash' },
} as const;
export type ProviderName = keyof typeof PROVIDERS;

export const SYSTEM = `You are a concise, encouraging strength coach. You get the numbers from one set tracked by a phone camera:
per-rep timing, joint angles, depth (how far the hip got below or above parallel), bar speed in m/s,
speed loss (0..1), and form flags.
Reply with exactly three short lines, no headings, no markdown:
1) what went well, citing a number; 2) the one thing to fix first, citing the rep(s); 3) a concrete cue or plan for the next set.
Do not diagnose injuries or give medical advice. Do not invent numbers that are not in the data.`;

export interface CoachEnv {
  apiKey: string | undefined;
  provider?: ProviderName;
  model?: string;
  fetch?: typeof fetch;
}

/** Picks the provider from whichever key is set: Groq first, then Gemini. */
export function envFrom(e: Record<string, string | undefined>): CoachEnv {
  const groq = e.GROQ_API_KEY ?? e.Groq ?? e.GROQ;
  if (groq) return { apiKey: groq, provider: 'groq', model: e.GROQ_MODEL };
  return { apiKey: e.GEMINI_API_KEY, provider: 'gemini', model: e.GEMINI_MODEL };
}

/** When the default model has been retired, choose a current general chat model from the provider's list. */
async function pickModel(f: typeof fetch, url: string, apiKey: string): Promise<string | null> {
  const res = await f(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return null;
  const ids = (((await res.json()) as { data?: { id: string }[] }).data ?? []).map((m) => m.id);
  const prefer = [/llama-3\.3-70b/, /gpt-oss-120b/, /llama-4/, /llama/, /gpt-oss/];
  for (const re of prefer) {
    const hit = ids.find((id) => re.test(id) && !/guard|whisper|tts|vision/.test(id));
    if (hit) return hit;
  }
  return null;
}

type Result = { status: number; body: { note?: string; error?: string } };

/** "3 cm below parallel" / "6 cm above parallel (too shallow)": words, so the model can't flip the sign. */
export function depthText(cm: number | null): string | null {
  if (cm === null) return null;
  return cm >= 0 ? `${Math.round(cm)} cm below parallel` : `${Math.round(-cm)} cm above parallel (too shallow)`;
}

/** Checks the payload is a plausible set summary and strips it to known fields. */
export function validate(raw: unknown): { ok: boolean; data?: unknown; error?: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'expected a JSON object' };
  const r = raw as Record<string, unknown>;
  if (!EXERCISES.includes(r.exercise as (typeof EXERCISES)[number])) return { ok: false, error: 'unknown exercise' };
  const reps = Array.isArray(r.reps) ? r.reps : [];
  if (reps.length > 60) return { ok: false, error: 'too many reps' };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const clean = reps.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      index: num(o.index), downSec: num(o.downSec), upSec: num(o.upSec), minAngle: num(o.minAngle), depth: depthText(num(o.hipBelowKneeCm)),
      velocity: num(o.velocity), velocityLoss: num(o.velocityLoss), maxLean: num(o.maxLean),
      faults: Array.isArray(o.faults) ? o.faults.filter((f) => typeof f === 'string').slice(0, 8) : [],
    };
  });
  const hold = r.hold && typeof r.hold === 'object' ? r.hold : null;
  if (!clean.length && !hold) return { ok: false, error: 'no reps or hold to coach' };
  return { ok: true, data: { exercise: r.exercise, view: r.view === 'front' ? 'front' : 'side', weightKg: num(r.weightKg), hold, reps: clean } };
}

export async function coach(bodyText: string, env: CoachEnv): Promise<Result> {
  if (!env.apiKey) return { status: 503, body: { error: 'AI coach is not configured' } };
  if (bodyText.length > MAX_BODY) return { status: 413, body: { error: 'set data too large' } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { status: 400, body: { error: 'invalid JSON' } };
  }
  const v = validate(parsed);
  if (!v.ok) return { status: 400, body: { error: v.error ?? 'invalid set data' } };

  const f = env.fetch ?? fetch;
  const provider = env.provider ?? 'gemini';
  const p = PROVIDERS[provider];
  const call = (model: string) =>
    f(p.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(v.data) }],
        // Room for reasoning models to think before the three lines; and ask them to keep it short.
        max_tokens: 1500,
        ...(provider === 'gemini' || /gpt-oss|qwen3|deepseek-r1/.test(model) ? { reasoning_effort: 'low' } : {}),
        temperature: 0.4,
      }),
    });
  let model = env.model ?? workingModel.get(provider) ?? p.model;
  let res = await call(model);
  if (!res.ok && (res.status === 400 || res.status === 404) && !env.model && p.models) {
    const other = await pickModel(f, p.models, env.apiKey);
    if (other) {
      model = other;
      res = await call(model);
    }
  }
  if (res.ok) workingModel.set(provider, model);
  let note = res.ok ? await noteOf(res) : null;
  if (res.ok && !note) note = await call(model).then((r) => (r.ok ? noteOf(r) : null)); // one retry on an empty reply
  if (!res.ok) return { status: 502, body: { error: `model error ${res.status}` } };
  if (!note) return { status: 502, body: { error: 'empty reply' } };
  return { status: 200, body: { note: note.replace(/[*#`]/g, '').slice(0, 1200) } };
}

/** The model that last worked per provider, so a retired default isn't retried on every request. */
const workingModel = new Map<ProviderName, string>();

async function noteOf(res: Response): Promise<string | null> {
  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  return data.choices?.[0]?.message?.content?.trim() || null;
}

/** A small per-instance limit, so a public endpoint can't burn through the key. */
const hits = new Map<string, number[]>();
export function allow(ip: string, now = Date.now(), perHour = 30): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= perHour) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}
