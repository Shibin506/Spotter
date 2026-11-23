// The AI coach note: takes a finished set's numbers (never video) and asks Gemini for a short tip.
// Kept apart from coach.ts so it can be unit-tested without the Vercel runtime.

const EXERCISES = ['squat', 'pushup', 'deadlift', 'lunge', 'ohp', 'plank'] as const;
const MAX_BODY = 16_000;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export const SYSTEM = `You are a concise, encouraging strength coach. You get the numbers from one set tracked by a phone camera:
per-rep timing, joint angles, hipBelowKneeCm (positive = hip that far below the knee, i.e. deep enough;
negative = hip that far ABOVE parallel, i.e. too shallow), bar speed in m/s, speed loss (0..1), and form flags.
Reply with exactly three short lines, no headings, no markdown:
1) what went well, citing a number; 2) the one thing to fix first, citing the rep(s); 3) a concrete cue or plan for the next set.
Do not diagnose injuries or give medical advice. Do not invent numbers that are not in the data.`;

export interface CoachEnv {
  apiKey: string | undefined;
  model?: string;
  fetch?: typeof fetch;
}

type Result = { status: number; body: { note?: string; error?: string } };

/** Checks the payload is a plausible set summary and strips it to known fields. */
export function validate(raw: unknown): { ok: true; data: unknown } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'expected a JSON object' };
  const r = raw as Record<string, unknown>;
  if (!EXERCISES.includes(r.exercise as (typeof EXERCISES)[number])) return { ok: false, error: 'unknown exercise' };
  const reps = Array.isArray(r.reps) ? r.reps : [];
  if (reps.length > 60) return { ok: false, error: 'too many reps' };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const clean = reps.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      index: num(o.index), downSec: num(o.downSec), upSec: num(o.upSec), minAngle: num(o.minAngle), hipBelowKneeCm: num(o.hipBelowKneeCm),
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
  if (!v.ok) return { status: 400, body: { error: v.error } };

  const res = await (env.fetch ?? fetch)(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.apiKey}` },
    body: JSON.stringify({
      model: env.model ?? 'gemini-3.5-flash',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(v.data) }],
      max_tokens: 1500,
      reasoning_effort: 'low',
      temperature: 0.4,
    }),
  });
  if (!res.ok) return { status: 502, body: { error: `model error ${res.status}` } };
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const note = data.choices?.[0]?.message?.content?.trim();
  if (!note) return { status: 502, body: { error: 'empty reply' } };
  return { status: 200, body: { note: note.replace(/[*#`]/g, '').slice(0, 1200) } };
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
