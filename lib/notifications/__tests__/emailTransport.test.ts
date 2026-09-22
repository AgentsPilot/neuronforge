/**
 * D9 — the transport must send proper multipart/alternative (HTML + plaintext).
 * A caller that supplies ONLY `html` must still produce both a `html` and a
 * non-empty `text` part on every provider (Resend + nodemailer).
 */

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
}));

// The consent gate. Mocked so these tests state what they are asserting: the
// transport's behaviour given a verdict, not the repository's behaviour.
const gateCheck = jest.fn(async () => ({ allowed: true }) as { allowed: boolean; reason?: string });
jest.mock('@/lib/consent/marketingGate', () => ({
  marketingGate: { check: (...args: unknown[]) => gateCheck(...(args as [])) },
}));

import { sendEmail, htmlToText } from '../emailTransport';

const HTML =
  '<!DOCTYPE html><html><head><style>.x{color:red}</style></head>' +
  '<body><h1>Calibration passed</h1><p>Vendor: Wolt &amp; Expedia</p>' +
  '<br><div>All set</div></body></html>';

const ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ENV };
  jest.clearAllMocks();
});

describe('htmlToText (D9 plaintext generation)', () => {
  it('strips tags/style and decodes entities into readable text', () => {
    const text = htmlToText(HTML);
    expect(text).toContain('Calibration passed');
    expect(text).toContain('Vendor: Wolt & Expedia');
    expect(text).toContain('All set');
    expect(text).not.toContain('<');
    expect(text).not.toContain('color:red'); // <style> content removed
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});

describe('sendEmail — Resend path sends both html and text', () => {
  it('auto-generates a text part when the caller supplies only html', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    (global as any).fetch = fetchMock;

    const result = await sendEmail({ kind: 'transactional', to: ['u@example.com'], subject: 'Result', html: HTML });

    expect(result).toEqual({ sent: true, provider: 'resend' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toBe(HTML);
    expect(typeof body.text).toBe('string');
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.text).toContain('Calibration passed');
  });

  it('honors a caller-supplied text part verbatim', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    (global as any).fetch = fetchMock;

    await sendEmail({ kind: 'transactional', to: ['u@example.com'], subject: 'Result', html: HTML, text: 'CUSTOM PLAINTEXT' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe('CUSTOM PLAINTEXT');
  });
});

describe('sendEmail — nodemailer path sends both html and text', () => {
  it('passes both parts to sendMail (Resend not configured)', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.GMAIL_USER = 'sys@example.com';
    process.env.GMAIL_CLIENT_ID = 'id';
    process.env.GMAIL_CLIENT_SECRET = 'secret';
    process.env.GMAIL_REFRESH_TOKEN = 'refresh';

    const result = await sendEmail({ kind: 'transactional', to: ['u@example.com'], subject: 'Result', html: HTML });

    expect(result).toEqual({ sent: true, provider: 'gmail' });
    const arg = mockSendMail.mock.calls[0][0];
    expect(arg.html).toBe(HTML);
    expect(typeof arg.text).toBe('string');
    expect(arg.text.length).toBeGreaterThan(0);
    expect(arg.text).toContain('Calibration passed');
  });
});

/**
 * The consent gate.
 *
 * These assert on the TRANSPORT MOCKS, not just on the returned object. A gate
 * that returns `blocked` while still handing the message to Resend would pass a
 * return-value assertion and fail the only thing that matters.
 */
describe('sendEmail — the marketing consent gate', () => {
  const MARKETING = {
    kind: 'marketing' as const,
    ownerUserId: 'owner-1',
    to: ['client@example.com'],
    subject: 'Come back',
    html: HTML,
  };

  it('touches no transport when the recipient has not consented', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    gateCheck.mockResolvedValue({ allowed: false, reason: 'no_consent' });

    const result = await sendEmail(MARKETING);

    expect(result).toEqual({ sent: false, provider: 'none', blocked: 'no_consent' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('refuses a marketing send addressed to more than one person', async () => {
    // Consent is held per person, so a multi-recipient marketing send cannot be
    // checked. It is refused rather than approximated — and the gate is never
    // even asked.
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;

    const result = await sendEmail({ ...MARKETING, to: ['a@example.com', 'b@example.com'] });

    expect(result.blocked).toBe('multi_recipient');
    expect(gateCheck).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends when consent is on record', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    (global as any).fetch = fetchMock;
    gateCheck.mockResolvedValue({ allowed: true });

    const result = await sendEmail(MARKETING);

    expect(result.sent).toBe(true);
    expect(result.blocked).toBeUndefined();
    // Counted by endpoint: resolving the business sender also uses fetch, and
    // asserting on the total would be measuring Supabase, not the gate.
    const resendCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('resend'));
    expect(resendCalls).toHaveLength(1);
  });

  it('never asks the gate about a transactional send', async () => {
    // The booking confirmation path must be untouched by any of this.
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    (global as any).fetch = fetchMock;
    gateCheck.mockResolvedValue({ allowed: false, reason: 'no_consent' });

    const result = await sendEmail({
      kind: 'transactional',
      to: ['client@example.com'],
      subject: 'Your booking is confirmed',
      html: HTML,
    });

    expect(result.sent).toBe(true);
    expect(gateCheck).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('resend'))).toHaveLength(1);
  });
});
