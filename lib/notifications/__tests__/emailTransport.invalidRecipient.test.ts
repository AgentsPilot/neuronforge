/**
 * Data export DE-10b.1 (SA TQ-21, workplan §5, §7.1): `sendEmail` refuses any
 * recipient on the reserved `.invalid` domain, the closed-account placeholder
 * among them, before the consent gate and before any transport. A mixed list
 * is refused whole. The log holds counts only, never an address.
 */

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
}));

const mockGateCheck = jest.fn(async () => ({ allowed: true }));
jest.mock('@/lib/consent/marketingGate', () => ({
  marketingGate: { check: (...args: unknown[]) => mockGateCheck(...(args as [])) },
}));

const mockLogged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => mockLogged.push(args);
  logger.child = () => logger;
  return { createLogger: () => logger, logger };
});

import { isInvalidDomainRecipient, sendEmail } from '../emailTransport';

const ENV = { ...process.env };
const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"m1"}', json: async () => ({ id: 'm1' }) });

beforeEach(() => {
  process.env = { ...ENV, RESEND_API_KEY: 're_test_key' };
  (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  mockLogged.length = 0;
});
afterEach(() => {
  process.env = { ...ENV };
  jest.clearAllMocks();
});

describe('isInvalidDomainRecipient', () => {
  it.each(['x@deleted.invalid', 'x@invalid', 'X@Foo.INVALID', 'deleted-0123456789ab@deleted.invalid', 'a@b.invalid.'])('%s is refused', (address) => {
    expect(isInvalidDomainRecipient(address)).toBe(true);
  });

  it.each(['x@invalid.com', 'x@example.com', 'invalid@example.org', 'x@notinvalid', 'no-at-sign'])('%s is not', (address) => {
    expect(isInvalidDomainRecipient(address)).toBe(false);
  });

  // DE-10b.1 QA E-2, fixed in DE-10b.2: the display-name form.
  it.each(['Dana <deleted-0123456789ab@deleted.invalid>', 'Dana <x@deleted.invalid> ', '<x@invalid>'])('%s (display-name form) is refused', (address) => {
    expect(isInvalidDomainRecipient(address)).toBe(true);
  });

  it.each(['Dana <dana@example.com>', '"Inv Alid" <x@invalid.com>'])('%s (display-name form) is not', (address) => {
    expect(isInvalidDomainRecipient(address)).toBe(false);
  });
});

describe('sendEmail refuses .invalid recipients before any transport', () => {
  it.each(['x@deleted.invalid', 'x@invalid', 'X@Foo.INVALID'])('%s: blocked, no provider call', async (address) => {
    const result = await sendEmail({ kind: 'transactional', to: [address], subject: 'S', html: '<p>h</p>' });
    expect(result).toEqual({ sent: false, provider: 'none', blocked: 'invalid_recipient' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('a mixed list is refused whole', async () => {
    const result = await sendEmail({ kind: 'transactional', to: ['ok@example.com', 'x@deleted.invalid'], subject: 'S', html: '<p>h</p>' });
    expect(result.blocked).toBe('invalid_recipient');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('before the marketing consent gate too', async () => {
    const result = await sendEmail({
      kind: 'marketing',
      to: ['x@deleted.invalid'],
      subject: 'S',
      html: '<p>h</p>',
      ownerUserId: '11111111-1111-4111-8111-111111111111',
    } as Parameters<typeof sendEmail>[0]);
    expect(result.blocked).toBe('invalid_recipient');
    expect(mockGateCheck).not.toHaveBeenCalled();
  });

  it('logs the counts only, never the address', async () => {
    await sendEmail({ kind: 'transactional', to: ['secret-person@deleted.invalid'], subject: 'S', html: '<p>h</p>' });
    const logged = JSON.stringify(mockLogged);
    expect(logged).toContain('invalidRecipients');
    expect(logged).not.toContain('secret-person');
  });

  it('x@invalid.com still sends', async () => {
    const result = await sendEmail({ kind: 'transactional', to: ['x@invalid.com'], subject: 'S', html: '<p>h</p>' });
    expect(result.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
