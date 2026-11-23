// Vercel Function: POST /api/coach. Set GEMINI_API_KEY (and optionally GEMINI_MODEL) in the project settings.
import { allow, coach } from './_coach';

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!allow(ip)) return Response.json({ error: 'too many requests, try again later' }, { status: 429 });
  const r = await coach(await request.text(), { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL });
  return Response.json(r.body, { status: r.status });
}
