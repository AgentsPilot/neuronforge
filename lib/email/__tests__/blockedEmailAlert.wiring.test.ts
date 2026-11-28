/**
 * PROD-1 S3.3c (QA): the real transport refusal drives the real alert helper.
 *
 * blockedEmailAlert.test.ts proves the helper with the transport mocked. This
 * proves the wiring: a send `sendEmail` refuses reaches `alertBlockedEmail`,
 * and the alert itself then passes the transport's own gates and goes out to
 * the allowed admin (AC-2), only once per 10 minutes (AC-4), with no full
 * client address in the alert or in any log line (AC-6).
 *
 * Only the seams are mocked (admin list, logger, nodemailer, Supabase, fetch);
 * nothing here reaches a database or the network.
 */

const listAdminEmails = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ listAdminEmails }) },
}));

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: jest.fn() })) },
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

import { sendEmail } from '@/lib/notifications/emailTransport';
import { ALERT_THROTTLE_MS, resetBlockedEmailAlertThrottle } from '@/lib/email/blockedEmailAlert';

const ENV = { ...process.env };
const fetchMock = jest.fn();
const CLIENT = 'dana.client@customer.example';
const ADMIN = 'admin@team.example';
const REFUSED = { sent: false, provider: 'none', blocked: 'recipient_not_allowlisted' };

beforeEach(() => {
  process.env = {
    ...ENV,
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    EMAIL_RECIPIENT_ALLOWLIST: '@team.example',
    RESEND_API_KEY: 're_test_key',
  };
  resetBlockedEmailAlertThrottle();
  listAdminEmails.mockReset().mockResolvedValue([ADMIN]);
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => '{"id":"m1"}',
    json: async () => ({ id: 'm1' }),
  });
  (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  mockLogged.length = 0;
});

afterAll(() => {
  process.env = { ...ENV };
});

it('a refused send still returns the refusal, and the admin gets one masked alert through the provider', async () => {
  const result = await sendEmail({ kind: 'transactional', to: [CLIENT], subject: 'Your booking', html: '<p>h</p>' });

  expect(result).toEqual(REFUSED);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.to).toEqual([ADMIN]);
  expect(body.subject).toBe('[preview] An email was blocked by the allow-list (email_transport)');
  expect(body.text).toContain('d***@customer.example');
  expect(JSON.stringify(body)).not.toContain(CLIENT);
  expect(JSON.stringify(mockLogged)).not.toContain(CLIENT);
});

it('a second refusal within ten minutes sends no second alert; after the window it does', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(5_000_000);
  try {
    await sendEmail({ kind: 'transactional', to: [CLIENT], subject: 's', html: '<p>h</p>' });
    expect(await sendEmail({ kind: 'transactional', to: [CLIENT], subject: 's', html: '<p>h</p>' })).toEqual(REFUSED);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(5_000_000 + ALERT_THROTTLE_MS);
    await sendEmail({ kind: 'transactional', to: [CLIENT], subject: 's', html: '<p>h</p>' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    now.mockRestore();
  }
});

it('without VERCEL=1 the refusal reads no admin list and touches no provider', async () => {
  delete process.env.VERCEL;
  expect(await sendEmail({ kind: 'transactional', to: [CLIENT], subject: 's', html: '<p>h</p>' })).toEqual(REFUSED);
  expect(listAdminEmails).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('an admin-list failure never changes the refusal', async () => {
  listAdminEmails.mockRejectedValue(new Error('db down'));
  expect(await sendEmail({ kind: 'transactional', to: [CLIENT], subject: 's', html: '<p>h</p>' })).toEqual(REFUSED);
  expect(fetchMock).not.toHaveBeenCalled();
});
