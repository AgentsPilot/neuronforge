/**
 * Where a client lands when they press Reply.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MISTAKE THIS EXISTS TO STOP.
 *
 * Reply-To was the account LOGIN email, unconditionally. So every client of
 * every business on the platform replied to whatever address the owner signed
 * up with, which for most people is a personal Gmail — while
 * `business_profiles.email` held the address they had deliberately published.
 *
 * Found on a live account where the two disagreed: the generated privacy policy
 * told clients in writing to write to `ips@testIPS.com`, and Reply-To pointed
 * at the owner's personal Gmail. One business, two faces, and the one the
 * policy named was not the one anybody could reach.
 *
 * It is a compliance question as much as a tidiness one. CAN-SPAM §7704(a)(1)
 * wants header information that identifies the sender honestly; GDPR wants a
 * valid address for objections, because somebody replying "stop emailing me"
 * has to land where the business reads.
 *
 * Asserted on the SENT payload, because the failure worth catching is the
 * header that actually left.
 * ─────────────────────────────────────────────────────────────────────────────
 */

process.env.BOOKING_TOKEN_SECRET = process.env.BOOKING_TOKEN_SECRET || 'test-token-secret';

const getUserById = jest.fn();
const profileRow = jest.fn();

jest.mock('@/lib/logger', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => log };
  return { createLogger: () => log };
});

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    auth: { admin: { getUserById: (...a: unknown[]) => getUserById(...(a as [])) } },
    from() {
      const chain: Record<string, unknown> = {
        maybeSingle: async () => profileRow(),
      };
      for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain;
      return chain;
    },
  },
}));

let sendEmail: typeof import('../emailTransport').sendEmail;

const sent: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  ({ sendEmail } = await import('../emailTransport'));
});

beforeEach(() => {
  sent.length = 0;
  getUserById.mockResolvedValue({ data: { user: { email: 'owner-personal@gmail.test' } } });

  global.fetch = jest.fn(async (_url: unknown, init: { body?: string } = {}) => {
    sent.push(JSON.parse(init.body ?? '{}'));
    return { ok: true, status: 200, json: async () => ({ id: 'm1' }), text: async () => '' } as unknown as Response;
  }) as unknown as typeof fetch;
});

const base = {
  kind: 'transactional' as const,
  to: ['client@example.test'],
  subject: 'Your appointment',
  html: '<html><body><p>Hi</p></body></html>',
  ownerUserId: 'owner-1',
};

describe('Reply-To', () => {
  it('is the address the business published', async () => {
    profileRow.mockResolvedValue({
      data: { company_name: 'Dana Fitness', email: 'hello@danafitness.test' },
    });

    await sendEmail({ ...base });

    expect(sent[0].reply_to).toBe('hello@danafitness.test');
    /* And the owner's personal address was never even looked up. */
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('falls back to the account address when the business set none', async () => {
    /* Never empty: a mail with no reply path is the no-reply mailbox the
       regulators single out, and an owner who has not filled this in still has
       to be reachable. */
    profileRow.mockResolvedValue({ data: { company_name: 'Dana Fitness', email: null } });

    await sendEmail({ ...base });

    expect(sent[0].reply_to).toBe('owner-personal@gmail.test');
  });

  it('ignores a blank business address rather than sending an empty header', async () => {
    profileRow.mockResolvedValue({ data: { company_name: 'Dana Fitness', email: '   ' } });

    await sendEmail({ ...base });

    expect(sent[0].reply_to).toBe('owner-personal@gmail.test');
  });

  it('still carries the business NAME on the envelope', async () => {
    /* The two are separate: the From name is the business, the address stays on
       the domain this platform can sign for. */
    profileRow.mockResolvedValue({
      data: { company_name: 'Dana Fitness', email: 'hello@danafitness.test' },
    });

    await sendEmail({ ...base });

    expect(String(sent[0].from)).toContain('"Dana Fitness"');
  });
});
