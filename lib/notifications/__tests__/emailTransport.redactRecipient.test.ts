/**
 * SA MF-1 (invite-only signup Slice 1b): `redactRecipientInLogs`.
 *
 * With the option set, no log line holds the recipient address: not the
 * "attempting" line, not "Email sent", and not a provider error that echoes the
 * address back (Resend does). The returned error text is scrubbed too. Without
 * the option, every other sender's logging is exactly as before.
 */

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push({ level, args });
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/consent/marketingGate', () => ({
  marketingGate: { check: async () => ({ allowed: true }) },
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
}));

import { sendEmail } from '../emailTransport';

const ADDRESS = 'invitee@example.com';
const ENV = { ...process.env };

function resendOnly() {
  process.env = { ...ENV, RESEND_API_KEY: 're_test_key' };
  delete process.env.SMTP_HOST;
  delete process.env.GMAIL_USER;
}

function fetchAnswering(ok: boolean, text: string) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok,
    status: ok ? 200 : 422,
    text: async () => text,
    json: async () => ({ id: 'msg_1' }),
  }));
}

const base = { kind: 'transactional' as const, to: [ADDRESS], subject: 'Your AgentPilot sign-up code', html: '<p>123456</p>' };

beforeEach(() => {
  logged.length = 0;
});

afterEach(() => {
  process.env = { ...ENV };
  jest.clearAllMocks();
});

describe('redactRecipientInLogs: true', () => {
  it('a successful send logs the recipient masked, never the address', async () => {
    resendOnly();
    fetchAnswering(true, '');
    const result = await sendEmail({ ...base, redactRecipientInLogs: true });
    expect(result.sent).toBe(true);
    const text = JSON.stringify(logged);
    expect(text).not.toContain(ADDRESS);
    expect(text).toContain('i•••@example.com');
  });

  it('a provider error that echoes the address is scrubbed in every log line and in the returned error', async () => {
    resendOnly();
    fetchAnswering(false, `{"message":"Invalid \`to\` field: ${ADDRESS} is not allowed"}`);
    const result = await sendEmail({ ...base, redactRecipientInLogs: true });
    expect(result.sent).toBe(false);
    const text = JSON.stringify(logged);
    expect(logged.some((entry) => entry.level === 'error')).toBe(true);
    expect(text).not.toContain(ADDRESS);
    expect(text).toContain('[email]');
    expect(result.error).not.toContain(ADDRESS);
  });

  it('the mail itself still goes to the real address', async () => {
    resendOnly();
    fetchAnswering(true, '');
    await sendEmail({ ...base, redactRecipientInLogs: true });
    const [, init] = ((global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0]) as [string, { body: string }];
    expect(JSON.parse(init.body).to).toEqual([ADDRESS]);
  });
});

describe('without the option, behaviour is unchanged', () => {
  it('logs the recipient as before, including a provider error text', async () => {
    resendOnly();
    fetchAnswering(false, `bad recipient ${ADDRESS}`);
    await sendEmail(base);
    const text = JSON.stringify(logged);
    expect(text).toContain(ADDRESS);
    const attempt = logged.find((entry) => entry.args[1] === 'Attempting to send email');
    expect((attempt?.args[0] as { to: string[] }).to).toEqual([ADDRESS]);
  });
});
