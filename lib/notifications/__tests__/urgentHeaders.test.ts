/**
 * The priority headers, and who is allowed to carry them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * There is no "alert" or "notification" class a sender can set on an email.
 * What exists is a priority flag, declared through three headers no standard
 * ever agreed on, and the rule worth holding is not that they are correct —
 * it is WHO SENDS THEM.
 *
 * A sender that flags everything urgent teaches every client and every filter
 * to discount the flag, and high priority on bulk-looking mail is itself a spam
 * signal. So the flag is reserved for a message about money that is already
 * late, and these tests pin both halves: the transport emits all three together
 * when asked, nothing when not, and the two chase senders ask only once the
 * invoice is actually overdue.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const sent: Array<Record<string, unknown>> = [];

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  }),
}));

jest.mock('@/lib/consent/marketingGate', () => ({
  MARKETING_SENDING_ENABLED: false,
  MarketingGate: class {
    async check() {
      return { allowed: true };
    }
  },
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

beforeEach(() => {
  sent.length = 0;
});

const base = {
  to: ['client@example.test'],
  subject: 'Overdue: Invoice INV-00066 for ₪160.00',
  html: '<p>Hi</p>',
  kind: 'transactional' as const,
};

describe('an urgent send', () => {
  it('carries all three priority headers', async () => {
    await sendEmail({ ...base, urgent: true });

    expect(sent[0].headers).toEqual({
      Importance: 'High',
      'X-Priority': '1 (Highest)',
      'X-MSMail-Priority': 'High',
    });
  });

  it('sends them together, because each client reads a different one', async () => {
    /*
     * And because they have to agree: a message claiming High importance and
     * normal priority reads as forged rather than urgent. Two of three is the
     * shape that would arrive from a half-finished edit, so it is named here.
     */
    await sendEmail({ ...base, urgent: true });
    const headers = sent[0].headers as Record<string, string>;

    expect(Object.keys(headers).sort()).toEqual(['Importance', 'X-MSMail-Priority', 'X-Priority']);
  });

  it('does not declare itself bulk, which is the opposite request', async () => {
    /* `Precedence: bulk` tells a client this is automated traffic worth
       deprioritising, and some sort it away. */
    await sendEmail({ ...base, urgent: true });

    expect(sent[0].headers).not.toHaveProperty('Precedence');
  });
});

describe('an ordinary send', () => {
  it('carries no priority headers at all', async () => {
    await sendEmail({ ...base });

    expect(sent[0].headers).toBeUndefined();
  });

  it('and `urgent: false` is the same as not asking', async () => {
    await sendEmail({ ...base, urgent: false });

    expect(sent[0].headers).toBeUndefined();
  });
});

describe('the two headers can coexist', () => {
  it('an urgent send that also offers an unsubscribe carries both', async () => {
    /* They come from two builders composed into one map, and a merge that
       dropped either would be invisible until a client complained. */
    await sendEmail({
      ...base,
      urgent: true,
      unsubscribeUrl: 'https://app.example.test/settings?section=preferences',
    });

    const headers = sent[0].headers as Record<string, string>;

    expect(headers['List-Unsubscribe']).toBe(
      '<https://app.example.test/settings?section=preferences>'
    );
    expect(headers.Importance).toBe('High');
  });
});

describe('only a LATE invoice asks for it', () => {
  /*
   * The rule the flag is worth nothing without. Both chase senders compute
   * `daysOverdue` and must gate on it: this service also sends the pre-due
   * courtesy, and that one arriving with a red exclamation is exactly how a
   * sender trains its readers to ignore the mark.
   */
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

  const senders = [
    'lib/services/PaymentReminderService.ts',
    'lib/services/InsightActionDispatchService.ts',
  ];

  it.each(senders)('%s asks only once the money is late', file => {
    expect(read(file)).toContain('urgent: daysOverdue > 0');
  });

  it.each(senders)('%s never flags unconditionally', file => {
    expect(read(file)).not.toContain('urgent: true');
  });
});
