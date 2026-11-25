/**
 * PROD-1b (A7), workplan 11.2: `sendEmail` applies the recipient guard before
 * the consent gate, the sender lookup and all three providers (SA-E3), refuses
 * with a final `blocked` result (SA-E2), and logs counts only (SA-E2, SA
 * condition 11: no address, no subject).
 */

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'smtp-1', accepted: ['x'], rejected: [] });
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
}));

const mockGateCheck = jest.fn(async () => ({ allowed: true, basis: 'consent' }));
jest.mock('@/lib/consent/marketingGate', () => ({
  marketingGate: { check: (...args: unknown[]) => mockGateCheck(...(args as [])) },
}));

const mockFrom = jest.fn();
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: (...args: unknown[]) => mockFrom(...args), auth: { admin: { getUserById: jest.fn() } } },
}));

const mockLogged: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => mockLogged.push(args);
  logger.child = () => logger;
  return { createLogger: () => logger, logger };
});

import { sendEmail } from '../emailTransport';

const ENV = { ...process.env };
const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"m1"}', json: async () => ({ id: 'm1' }) });

const ALL_PROVIDERS = {
  RESEND_API_KEY: 're_test_key',
  SMTP_HOST: 'smtp.team.example',
  SMTP_PORT: '587',
  SMTP_USER: 'relay',
  SMTP_PASS: 'pw',
  GMAIL_USER: 'sys@team.example',
  GMAIL_CLIENT_ID: 'id',
  GMAIL_CLIENT_SECRET: 's',
  GMAIL_REFRESH_TOKEN: 't',
};

function setEnv(vercelEnv: string | undefined, list: string | undefined, providers: Record<string, string> = ALL_PROVIDERS): void {
  process.env = { ...ENV, ...providers };
  delete process.env.VERCEL_ENV;
  delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
  if (vercelEnv !== undefined) process.env.VERCEL_ENV = vercelEnv;
  if (list !== undefined) process.env.EMAIL_RECIPIENT_ALLOWLIST = list;
}

const CLIENT = 'dana.client@customer.example';
const SUBJECT = 'Your booking with Dana Client';
const base = { kind: 'transactional' as const, subject: SUBJECT, html: '<p>h</p>' };
const REFUSED = { sent: false, provider: 'none', blocked: 'recipient_not_allowlisted' };

beforeEach(() => {
  (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  mockLogged.length = 0;
});

afterEach(() => {
  process.env = { ...ENV };
  jest.clearAllMocks();
});

function expectNothingTouched(): void {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mockSendMail).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockGateCheck).not.toHaveBeenCalled();
}

describe('guard on: refused before any provider', () => {
  it('non-production, recipient not listed: blocked, no provider, no database, no consent gate', async () => {
    setEnv('preview', '@team.example');
    const result = await sendEmail({ ...base, to: [CLIENT] });
    expect(result).toEqual(REFUSED);
    expectNothingTouched();
  });

  it('non-production, list unset: nobody (fail closed)', async () => {
    setEnv(undefined, undefined);
    expect(await sendEmail({ ...base, to: ['qa@team.example'] })).toEqual(REFUSED);
    expectNothingTouched();
  });

  it('production with the list set: a recipient not on it is refused (SA-E1)', async () => {
    setEnv('production', '@team.example');
    expect(await sendEmail({ ...base, to: [CLIENT] })).toEqual(REFUSED);
    expectNothingTouched();
  });

  it('production with the list set but empty or whitespace: nobody (SA-E2, D-13)', async () => {
    for (const list of ['', '   ']) {
      setEnv('production', list);
      expect(await sendEmail({ ...base, to: ['qa@team.example'] })).toEqual(REFUSED);
    }
    expectNothingTouched();
  });

  it('the refusal line has counts and the kind, never an address or the subject', async () => {
    setEnv('preview', '@team.example');
    await sendEmail({ ...base, to: [CLIENT, 'qa@team.example'] });
    const refusal = mockLogged.find((args) => args[1] === 'Email not sent: recipient not on the allow-list');
    expect(refusal?.[0]).toEqual({
      reason: 'recipient_not_allowed',
      isProduction: false,
      recipientCount: 2,
      refusedCount: 1,
      kind: 'transactional',
    });
    const everything = JSON.stringify(mockLogged);
    expect(everything).not.toContain('customer.example');
    expect(everything).not.toContain('dana');
    expect(everything).not.toContain(SUBJECT);
  });

  it('a refused send asked twice is refused twice; the transport never retries (SA-E2)', async () => {
    setEnv('preview', '@team.example');
    expect(await sendEmail({ ...base, to: [CLIENT] })).toEqual(REFUSED);
    expect(await sendEmail({ ...base, to: [CLIENT] })).toEqual(REFUSED);
    expectNothingTouched();
  });

  it('a keyed send is refused by the guard, before the "key cannot be honoured" warning', async () => {
    setEnv('preview', '@team.example', { SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p' });
    expect(await sendEmail({ ...base, to: [CLIENT], idempotencyKey: 'export:1:1' })).toEqual(REFUSED);
    expect(JSON.stringify(mockLogged)).not.toContain('idempotency_unsupported');
    expectNothingTouched();
  });

  it('a marketing send is refused before the consent gate', async () => {
    setEnv('preview', '@team.example');
    const result = await sendEmail({ kind: 'marketing', ownerUserId: 'owner-1', to: [CLIENT], subject: 'S', html: '<p>h</p>' });
    expect(result).toEqual(REFUSED);
    expectNothingTouched();
  });

  it('an .invalid recipient is still refused as invalid_recipient first', async () => {
    setEnv('preview', '@team.example');
    expect((await sendEmail({ ...base, to: ['x@deleted.invalid'] })).blocked).toBe('invalid_recipient');
  });
});

describe('allowed sends go out as before', () => {
  it('non-production, recipient listed: sent through Resend (happy path)', async () => {
    setEnv('preview', '@team.example');
    const result = await sendEmail({ ...base, to: ['qa@team.example'] });
    expect(result).toEqual({ sent: true, provider: 'resend', providerMessageId: 'm1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('non-production, listed, SMTP only: the guard does not stand in the way of SMTP', async () => {
    setEnv('preview', '@team.example', { SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p' });
    expect((await sendEmail({ ...base, to: ['qa@team.example'] })).provider).toBe('smtp');
  });

  it('production with the list set: a listed recipient is sent', async () => {
    setEnv('production', 'qa@team.example');
    expect((await sendEmail({ ...base, to: ['qa@team.example'] })).sent).toBe(true);
  });

  it('production, list absent: anyone, exactly as today (guard off)', async () => {
    setEnv('production', undefined);
    const result = await sendEmail({ ...base, to: [CLIENT] });
    expect(result.sent).toBe(true);
    expect(JSON.stringify(mockLogged)).not.toContain('not on the allow-list');
  });
});
