/**
 * A public URL that writes to a table has to prove who is calling.
 *
 * Without the signature check anyone who finds this endpoint can mark any
 * message opened, and the engagement figures an owner would act on become
 * whatever a stranger last posted. The three failure modes that matter are a
 * forged signature, a replayed request, and a missing secret.
 */

import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { POST } from '../route';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(),
  }),
}));

const recorded: Array<{ id: string; event: Record<string, unknown> }> = [];

/*
 * What the repository reports back.
 *
 * It used to be a flat `{ data: null, error: null }`, which is what let the
 * route claim a write for a message id that matched nothing: three different
 * outcomes arrived wearing one face, the route inspected only `error`, and
 * every one of them logged "Email delivery event recorded". The mock now
 * carries the outcome, so a test can tell them apart — which is the only way
 * this class of bug is visible from a test at all.
 */
const repositoryOutcome: { value: 'recorded' | 'unmatched' | 'duplicate' } = { value: 'recorded' };

jest.mock('@/lib/repositories/EmailAutomationRepository', () => ({
  emailSendRepository: {
    recordDeliveryEvent: jest.fn(async (id: string, event: Record<string, unknown>) => {
      recorded.push({ id, event });
      return { data: null, error: null, outcome: repositoryOutcome.value };
    }),
  },
}));

const SECRET = 'whsec_' + Buffer.from('a-test-signing-key').toString('base64');

/** A request signed the way Svix signs: `id.timestamp.body`. */
function signed(body: unknown, overrides: { timestamp?: number; signature?: string } = {}) {
  const raw = JSON.stringify(body);
  const id = 'msg_test';
  const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000);

  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64');

  return new NextRequest('https://example.com/api/webhooks/resend', {
    method: 'POST',
    body: raw,
    headers: {
      'svix-id': id,
      'svix-timestamp': String(timestamp),
      'svix-signature': overrides.signature ?? `v1,${expected}`,
    },
  });
}

const openedEvent = {
  type: 'email.opened',
  created_at: '2026-09-23T10:00:00Z',
  data: { email_id: 'resend_abc' },
};

beforeEach(() => {
  recorded.length = 0;
  repositoryOutcome.value = 'recorded';
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
});

describe('POST /api/webhooks/resend', () => {
  it('records an open from a correctly signed request', async () => {
    const response = await POST(signed(openedEvent));

    expect(response.status).toBe(200);
    expect(recorded).toEqual([
      { id: 'resend_abc', event: { openedAt: '2026-09-23T10:00:00Z' } },
    ]);
  });

  it('refuses a forged signature', async () => {
    const response = await POST(signed(openedEvent, { signature: 'v1,not-the-right-signature' }));

    expect(response.status).toBe(401);
    expect(recorded).toEqual([]);
  });

  it('refuses a replayed request, however well signed', async () => {
    // Correctly signed an hour ago. Valid forever without this check.
    const response = await POST(signed(openedEvent, { timestamp: Math.floor(Date.now() / 1000) - 3600 }));

    expect(response.status).toBe(401);
    expect(recorded).toEqual([]);
  });

  it('refuses everything when the secret is not configured', async () => {
    /*
     * Fail closed, like the four insight crons. An unauthenticated endpoint
     * that writes is worse than one that is temporarily down.
     */
    delete process.env.RESEND_WEBHOOK_SECRET;

    const response = await POST(signed(openedEvent));

    expect(response.status).toBe(401);
    expect(recorded).toEqual([]);
  });

  it('treats a click as an open as well', async () => {
    /*
     * A click implies an open and providers do not always send both. Without
     * this a client who clicked straight through reads as never having opened
     * it, which is the opposite of the truth.
     */
    await POST(signed({ ...openedEvent, type: 'email.clicked' }));

    expect(recorded[0].event).toEqual({
      clickedAt: '2026-09-23T10:00:00Z',
      openedAt: '2026-09-23T10:00:00Z',
    });
  });

  it('records a bounce as terminal', async () => {
    await POST(signed({ ...openedEvent, type: 'email.bounced' }));

    expect(recorded[0].event).toMatchObject({ status: 'bounced' });
  });


  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THE ANSWER CLAIMS HAS TO BE TRUE.
   *
   * All three of these answer 200 — no retry can help any of them, and a 404
   * would make the provider retry forever something that can never match. But
   * they are not the same event, and for a while they said they were: a
   * correctly signed webhook naming a message id that matched NO ROW answered
   * `{success: true}` and logged "Email delivery event recorded".
   *
   * That is the failure that hides. If provider ids ever stopped lining up,
   * every request would still be a green 200 in Resend's delivery panel and a
   * success line in the log, while `opened_at` stayed null on every row and
   * nothing anywhere said otherwise.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('what it reports back', () => {
    it('claims a write only when one happened', async () => {
      repositoryOutcome.value = 'recorded';

      const response = await POST(signed(openedEvent));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
    });

    it('says so when no row carries that message id', async () => {
      repositoryOutcome.value = 'unmatched';

      const response = await POST(signed(openedEvent));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, ignored: 'unknown message id' });
    });

    it('says so when the event added nothing new', async () => {
      // A redelivery, or an open older than one already recorded.
      repositoryOutcome.value = 'duplicate';

      const response = await POST(signed(openedEvent));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, ignored: 'already recorded' });
    });

    it('never asks for a retry on any of them', async () => {
      for (const outcome of ['recorded', 'unmatched', 'duplicate'] as const) {
        repositoryOutcome.value = outcome;
        const response = await POST(signed(openedEvent));
        expect(response.status).toBe(200);
      }
    });
  });

  it('acknowledges an event type it does not act on', async () => {
    // 200, not 4xx: the provider must not retry something we chose to ignore.
    const response = await POST(signed({ ...openedEvent, type: 'email.delivery_delayed' }));

    expect(response.status).toBe(200);
    expect(recorded).toEqual([]);
  });

  it('acknowledges an event with no message id', async () => {
    const response = await POST(signed({ type: 'email.opened', data: {} }));

    expect(response.status).toBe(200);
    expect(recorded).toEqual([]);
  });
});
