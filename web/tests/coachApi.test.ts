import { describe, expect, it } from 'vitest';
import { allow, coach, validate } from '../../api/_coach';

const set = { exercise: 'squat', view: 'side', reps: [{ index: 1, upSec: 1.1, velocity: 0.6, faults: ['shallow'], secret: 'x' }] };

describe('AI coach endpoint', () => {
  it('says it is not configured without a key', async () => {
    expect((await coach(JSON.stringify(set), { apiKey: undefined })).status).toBe(503);
  });

  it('rejects junk and oversized bodies', async () => {
    const env = { apiKey: 'k', fetch: (() => { throw new Error('should not call'); }) as never };
    expect((await coach('nope', env)).status).toBe(400);
    expect((await coach(JSON.stringify({ exercise: 'bench' }), env)).status).toBe(400);
    expect((await coach('x'.repeat(20_000), env)).status).toBe(413);
  });

  it('sends only known fields to the model and returns its note', async () => {
    let sent: { messages: { content: string }[] } | null = null;
    const fake = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '**Good** depth.\nFix rep 1.\nCue: sit back.' } }] }));
    }) as never;
    const r = await coach(JSON.stringify(set), { apiKey: 'k', fetch: fake });
    expect(r.status).toBe(200);
    expect(r.body.note).toBe('Good depth.\nFix rep 1.\nCue: sit back.');
    expect(sent!.messages[1].content).not.toContain('secret');
    expect(validate(set)).toMatchObject({ ok: true });
  });

  it('rate-limits each caller', () => {
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) expect(allow('1.2.3.4', now + i)).toBe(true);
    expect(allow('1.2.3.4', now + 31)).toBe(false);
    expect(allow('5.6.7.8', now + 31)).toBe(true);
    expect(allow('1.2.3.4', now + 3_700_000)).toBe(true);
  });
});
