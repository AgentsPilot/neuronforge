/**
 * SA MF-1 (invite-only signup Slice 1b): `redactRecipientInLogs`.
 * Slice 2a (SA F-4, R-2, R-9): `redactInLogs` and `platformSenderAddress()`.
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

import { platformSenderAddress, sendEmail } from '../emailTransport';

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

// ── Slice 2a ────────────────────────────────────────────────────────────────

const TOKEN = 'Abc_def-GHIjklMNOpqrSTUvwxYZ0123456789abcde';
const LINK = `https://app.example.com/invite#t=${TOKEN}`;

describe('redactInLogs (SA F-4, R-9)', () => {
  it('a provider error that echoes the link, an escaped link and the token is scrubbed in every log line and the returned error', async () => {
    resendOnly();
    const encoded = encodeURIComponent(LINK);
    const escaped = LINK.replace(/&/g, '&amp;').replace(/#/g, '&#35;');
    fetchAnswering(false, `{"message":"rejected body near ${LINK} / ${encoded} / ${escaped} / raw ${TOKEN}"}`);

    const result = await sendEmail({ ...base, redactInLogs: [TOKEN, LINK] });

    expect(result.sent).toBe(false);
    const text = JSON.stringify(logged);
    expect(logged.some((entry) => entry.level === 'error')).toBe(true);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('invite#t=');
    expect(text).toContain('[redacted]');
    expect(result.error).not.toContain(TOKEN);
    expect(result.error).toContain('[redacted]');
  });

  it('combines with redactRecipientInLogs', async () => {
    resendOnly();
    fetchAnswering(false, `bad ${ADDRESS} ${LINK}`);
    const result = await sendEmail({ ...base, redactRecipientInLogs: true, redactInLogs: [TOKEN, LINK] });
    const text = JSON.stringify(logged) + String(result.error);
    expect(text).not.toContain(ADDRESS);
    expect(text).not.toContain(TOKEN);
    expect(text).toContain('[email]');
    expect(text).toContain('[redacted]');
  });

  it('covers the SMTP and Gmail catch blocks too', async () => {
    process.env = {
      ...ENV,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      GMAIL_USER: 'g@example.com',
      GMAIL_CLIENT_ID: 'id',
      GMAIL_CLIENT_SECRET: 'secret',
      GMAIL_REFRESH_TOKEN: 'refresh',
    };
    delete process.env.RESEND_API_KEY;
    mockSendMail.mockRejectedValue(new Error(`refused: ${LINK}`));
    const result = await sendEmail({ ...base, redactInLogs: [TOKEN, LINK] });
    expect(result.sent).toBe(false);
    expect(JSON.stringify(logged) + String(result.error)).not.toContain(TOKEN);
  });

  it('ignores empty strings, and the mail itself still carries the link', async () => {
    resendOnly();
    fetchAnswering(true, '');
    const result = await sendEmail({ ...base, html: `<a href="${LINK}">Accept</a>`, redactInLogs: ['', TOKEN, LINK] });
    expect(result.sent).toBe(true);
    const [, init] = ((global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0]) as [string, { body: string }];
    expect(JSON.parse(init.body).html).toContain(LINK);
  });

  it('without the option, a provider error text is unchanged', async () => {
    resendOnly();
    fetchAnswering(false, `raw ${TOKEN}`);
    const result = await sendEmail(base);
    expect(result.error).toContain(TOKEN);
  });
});

describe('platformSenderAddress (SA R-2: fails closed, never the NeuronForge default)', () => {
  it.each([
    ['unset', undefined, undefined],
    ['blank', '   ', undefined],
    ['unparseable', 'not an address', undefined],
    ['a name with no address', 'AgentPilot <>', undefined],
    ['a dangling bracket', 'AgentPilot <team@example.com', undefined],
    ['two at signs', 'a@b@example.com', undefined],
    ['a quoted display name', '"X" <a@b.io>', 'a@b.io'],
    ['a plain display name', 'AgentPilot <team@agentpilot.example>', 'team@agentpilot.example'],
    ['a bare address', 'a@b.io', 'a@b.io'],
    ['a bare address with spaces around it', '  team@agentpilot.example  ', 'team@agentpilot.example'],
  ])('%s → %s', (_label, value, expected) => {
    process.env = { ...ENV };
    if (value === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = value;
    expect(platformSenderAddress()).toBe(expected);
  });

  it('never returns the hard-coded neuronforge.app default', () => {
    process.env = { ...ENV };
    delete process.env.RESEND_FROM_EMAIL;
    expect(platformSenderAddress()).toBeUndefined();
    expect(String(platformSenderAddress())).not.toContain('neuronforge');
  });
});
