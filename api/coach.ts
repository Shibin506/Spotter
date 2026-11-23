// Vercel Function: POST /api/coach. Set GROQ_API_KEY (or GEMINI_API_KEY), and optionally GROQ_MODEL /
// GEMINI_MODEL, in the project's environment variables.
import { allow, coach, envFrom } from './_coach';

declare const process: { env: Record<string, string | undefined> };

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!allow(ip)) return Response.json({ error: 'too many requests, try again later' }, { status: 429 });
  const r = await coach(await request.text(), envFrom(process.env));
  return Response.json(r.body, { status: r.status });
}
