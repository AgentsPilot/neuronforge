/**
 * `List-Unsubscribe`, and who is allowed to carry it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Added after Exchange Online quarantined a morning briefing as "High
 * Confidence Phish" while SPF, DKIM and DMARC all PASSED. Authentication was
 * never the question — the filter was reading everything else, and an absent
 * List-Unsubscribe is one of the things it reads as "not a sender who behaves
 * properly".
 *
 * The rule these tests hold is which mail may carry it. Recurring mail the
 * recipient switched on, yes. A booking confirmation, never: the client cannot
 * unsubscribe from the confirmation of an appointment they just made, and
 * offering the option invites them to try.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const sent: Array<Record<string, unknown>> = [];

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }),
}));

jest.mock('@/lib/consent/marketingGate', () => ({
  MARKETING_SENDING_ENABLED: false,
  MarketingGate: class { async check() { return { allowed: true }; } },
}));

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@example.test' } } }) } },
    from() {
      const chain: Record<string, unknown> = { maybeSingle: async () => ({ data: null, error: null }) };
      for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain;
      return chain;
    },
  },
}));

// Capture what reaches the provider.
global.fetch = jest.fn(async (_url: unknown, init: { body?: string } = {}) => {
  sent.push(JSON.parse(init.body ?? '{}'));
  return { ok: true, json: async () => ({ id: 'msg-1' }), text: async () => '' } as unknown as Response;
}) as unknown as typeof fetch;

let sendEmail: typeof import('../emailTransport').sendEmail;

beforeAll(async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  ({ sendEmail } = await import('../emailTransport'));
});

beforeEach(() => { sent.length = 0; });

const base = { to: ['client@example.test'], subject: 'Hello', html: '<p>Hi</p>', kind: 'transactional' as const };

describe('List-Unsubscribe', () => {
  it('is set when the send supplies a place to unsubscribe', async () => {
    await sendEmail({ ...base, unsubscribeUrl: 'https://app.example.test/settings?section=preferences' });

    expect(sent[0].headers).toEqual({
      'List-Unsubscribe': '<https://app.example.test/settings?section=preferences>',
    });
  });

  it('wraps the URL in angle brackets, as RFC 2369 requires', async () => {
    // A bare URL is ignored by the very clients this exists to satisfy.
    await sendEmail({ ...base, unsubscribeUrl: 'https://x.test/off' });

    const header = (sent[0].headers as Record<string, string>)['List-Unsubscribe'];
    expect(header.startsWith('<')).toBe(true);
    expect(header.endsWith('>')).toBe(true);
  });

  it('is absent from mail that supplies none', async () => {
    // A booking confirmation. The client did not subscribe to it and cannot
    // leave it.
    await sendEmail({ ...base });

    expect(sent[0].headers).toBeUndefined();
  });

  it('is absent for an empty or blank URL rather than sent empty', async () => {
    await sendEmail({ ...base, unsubscribeUrl: '   ' });

    expect(sent[0].headers).toBeUndefined();
  });

  it('does not advertise one-click, which has no endpoint behind it', async () => {
    /*
     * RFC 8058 one-click requires a URL that unsubscribes on an unauthenticated
     * POST. Declaring it without that endpoint is worse than declaring nothing:
     * the client posts, nothing happens, and the sender looks broken.
     */
    await sendEmail({ ...base, unsubscribeUrl: 'https://x.test/off' });

    expect(sent[0].headers).not.toHaveProperty('List-Unsubscribe-Post');
  });
});
