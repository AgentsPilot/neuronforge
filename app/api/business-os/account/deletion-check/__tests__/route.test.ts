/**
 * GET /api/business-os/account/deletion-check (data export DE-10b.2; workplan
 * §2.3, §4.2; SA O2-1, V-1, V-2). The real route and blocker mapping over
 * mocked edges: session, throttle, self-service check runner, export facts.
 */

import { NextRequest } from 'next/server';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SECRET_ENV = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMAIL = 'jane.owner@example.org';

const mockLogged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => mockLogged.push(...args);
  logger.child = (...args: unknown[]) => {
    mockLogged.push(...args);
    return logger;
  };
  return { createLogger: () => logger };
});

const mockSession = jest.fn();
jest.mock('@/lib/business-os/account-deletion/sessionSubject', () => {
  const actual = jest.requireActual('@/lib/business-os/account-deletion/sessionSubject');
  return { ...actual, readSessionSubject: () => mockSession() };
});

const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => {
  const actual = jest.requireActual('@/lib/security/rateLimit');
  return { ...actual, rateLimit: (...args: unknown[]) => mockRateLimit(...args) };
});

const mockCheck = jest.fn();
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  runAccountDeletionCheck: (...args: unknown[]) => mockCheck(...args),
  runSelfAccountAnonymise: jest.fn(),
  errorKindFacts: () => ({ kind: null, code: null, name: null }),
}));

const mockFacts = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  BusinessOsDataExportJobRepository: jest.fn().mockImplementation(() => ({ findDeletionFacts: (...args: unknown[]) => mockFacts(...args) })),
}));

import { GET } from '../route';
import { deletionCheckResponseSchema } from '@/lib/business-os/account-deletion/schemas';

const req = () => new NextRequest('http://localhost/api/business-os/account/deletion-check?userId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

const CHECKED = { kind: 'checked', canDelete: true, targetUserId: SUBJECT, blockers: [], notes: [], guards: [], serverMs: 3 };

beforeEach(() => {
  mockLogged.length = 0;
  process.env[FLAG] = 'true';
  process.env[SECRET_ENV] = 's'.repeat(40);
  process.env[KEY_ENV] = 'k'.repeat(48);
  mockSession.mockReset().mockResolvedValue({ id: SUBJECT, email: EMAIL });
  mockRateLimit.mockReset().mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockCheck.mockReset().mockResolvedValue(CHECKED);
  mockFacts.mockReset().mockResolvedValue({ data: { ownerLastExportReadyAt: '2026-10-10T10:00:00Z', ownerExportDownloadedAt: null, adminExportExisted: false }, error: null });
});

afterAll(() => {
  delete process.env[FLAG];
  delete process.env[SECRET_ENV];
  delete process.env[KEY_ENV];
});

async function data(res: Response) {
  const body = await res.json();
  expect(deletionCheckResponseSchema.safeParse(body).success).toBe(true);
  return body.data;
}

describe('the off switch (O2-1)', () => {
  it('200 { enabled: false } before the session is read', async () => {
    delete process.env[FLAG];
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await data(res)).toEqual({ enabled: false });
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockCheck).not.toHaveBeenCalled();
  });
});

describe('auth and throttle', () => {
  it('401 without a session, nothing else', async () => {
    mockSession.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('429 when throttled, before the check', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, hits: 200, degraded: false });
    const res = await GET(req());
    expect(res.status).toBe(429);
    // SA N-2: no-store on the 429 too.
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(mockCheck).not.toHaveBeenCalled();
  });
});

describe('available: false', () => {
  it.each([
    ['no login email (V-1)', () => mockSession.mockResolvedValue({ id: SUBJECT, email: null })],
    ['no cleanup secret', () => delete process.env[SECRET_ENV]],
    ['no fingerprint key', () => delete process.env[KEY_ENV]],
  ])('%s → the engine is not called', async (_name, arrange) => {
    arrange();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await data(res)).toMatchObject({ enabled: true, available: false, blockers: [] });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('a function out of date or a refused secret → available: false', async () => {
    mockCheck.mockResolvedValue({ kind: 'unavailable', reason: 'function_out_of_date', error: null });
    expect(await data(await GET(req()))).toMatchObject({ enabled: true, available: false });
  });
});

describe('the happy path', () => {
  it('checks the SESSION user (the query string is ignored) and returns no email', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await data(res);
    expect(body).toEqual({
      enabled: true,
      available: true,
      blockers: [],
      willKeepBilling: false,
      exportFacts: { lastReadyAt: '2026-10-10T10:00:00Z', downloaded: false },
    });
    expect(mockCheck).toHaveBeenCalledWith({ email: EMAIL, subject: SUBJECT });
    expect(JSON.stringify(body)).not.toContain(EMAIL);
  });

  it('blockers in plain words, notes as willKeepBilling (a legacy trace alone included)', async () => {
    mockCheck.mockResolvedValue({
      ...CHECKED,
      canDelete: false,
      blockers: [{ guard: 'G-8', item: 'no Stripe account connected for client payments', found: 1 }],
      notes: [{ guard: 'G-7', item: 'legacy billing event from Stripe', found: 1 }],
      guards: ['G-8'],
    });
    expect(await data(await GET(req()))).toMatchObject({ blockers: [{ code: 'stripe_connected' }], willKeepBilling: true });
  });

  it('an export facts failure shows "none on record" rather than failing', async () => {
    mockFacts.mockResolvedValue({ data: null, error: new Error('db') });
    expect(await data(await GET(req()))).toMatchObject({ available: true, exportFacts: { lastReadyAt: null, downloaded: false } });
  });
});

describe('failures', () => {
  it('a failed check → 500 without detail', async () => {
    mockCheck.mockResolvedValue({ kind: 'failed', error: new Error(`raw ${EMAIL}`) });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(EMAIL);
    expect(JSON.stringify(mockLogged)).not.toContain(EMAIL);
  });
});
