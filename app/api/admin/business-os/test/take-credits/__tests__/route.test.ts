/**
 * POST /api/admin/business-os/test/take-credits (TEST ONLY, slice TC-1).
 *
 * The admin gate's dependencies, the tenant check, the charge repository and
 * the audit flush are mocked; the Zod schema, the platform check and the
 * account seam are real.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

// The gate records refused access on its own; not this route's audit entry.
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn().mockResolvedValue(undefined) }));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args),
}));

const mockIsTenant = jest.fn();
jest.mock('@/lib/business-os/entitlements/adminOps', () => ({
  isBusinessOsTenant: (...args: unknown[]) => mockIsTenant(...args),
}));

const mockRecordCharge = jest.fn();
jest.mock('@/lib/repositories/BusinessOsCreditChargeRepository', () => ({
  businessOsCreditChargeRepository: { recordCharge: (...args: unknown[]) => mockRecordCharge(...args) },
}));
jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({ businessOsAccountPlanRepository: {} }));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({ businessProfileRepository: {} }));
jest.mock('@/lib/repositories/OnboardingConversationRepository', () => ({ onboardingConversationRepository: {} }));

import { POST } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { currentCreditValue } from '@/lib/business-os/entitlements/config/creditValue';

const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.com' };
// Hex letters on purpose, so an upper-cased id really differs (W11b-1 precedent).
const ACCOUNT = 'abcdef99-9999-4999-8999-99999999999f';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const REQUEST_ID = 'abcdef11-2222-4333-8444-555555555555';
const PERIOD = '2026-10-01T00:00:00+00:00';
const FLAG = 'BUSINESS_OS_TEST_CREDIT_TOOLS_ENABLED';
const originalFlag = process.env[FLAG];

const validBody = (overrides: Record<string, unknown> = {}) => ({
  accountId: ACCOUNT,
  amount: 50,
  reason: 'QA low-credit test',
  requestId: REQUEST_ID,
  ...overrides,
});

const call = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/admin/business-os/test/take-credits', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' },
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  process.env[FLAG] = 'true';
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  mockIsTenant.mockResolvedValue(true);
  mockLogAndFlush.mockResolvedValue(undefined);
  mockRecordCharge.mockResolvedValue({
    data: { recorded: true, periodStart: PERIOD, anchorSource: 'plan' },
    error: null,
  });
});

afterAll(() => {
  if (originalFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = originalFlag;
});

const expectNothingWritten = () => {
  expect(mockRecordCharge).not.toHaveBeenCalled();
  expect(mockLogAndFlush).not.toHaveBeenCalled();
};

describe('happy path', () => {
  it('records one test charge with the exact fields and one flushed audit entry', async () => {
    const res = await call(validBody({ accountId: ACCOUNT.toUpperCase(), requestId: REQUEST_ID.toUpperCase() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { accountId: ACCOUNT, credits: 50, periodStart: PERIOD, recorded: true, status: 'taken' },
    });

    expect(mockRecordCharge).toHaveBeenCalledTimes(1);
    expect(mockRecordCharge).toHaveBeenCalledWith({
      actionId: REQUEST_ID,
      accountId: ACCOUNT,
      groupId: REQUEST_ID,
      service: 'test_harness',
      actionType: 'test_take_credits',
      trigger: 'external',
      outcome: 'succeeded',
      credits: 50,
      costUsd: 0,
      creditValueVersion: currentCreditValue().version,
      isFallbackPriced: false,
    });

    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entry] = mockLogAndFlush.mock.calls[0];
    expect(entry).toMatchObject({
      action: AUDIT_EVENTS.BOS_TEST_CREDITS_TAKEN,
      entityType: 'business_os_credit_period',
      entityId: ACCOUNT,
      userId: ACCOUNT,
      actorId: ADMIN.id,
      severity: 'warning',
      details: {
        credits: 50,
        reason: 'QA low-credit test',
        actionId: REQUEST_ID,
        periodStart: PERIOD,
        anchorSource: 'plan',
        service: 'test_harness',
        testOnly: true,
        correlationId: 'corr-1',
      },
    });
  });

  it('a replay (recorded: false) says already recorded and writes no audit entry', async () => {
    mockRecordCharge.mockResolvedValue({ data: { recorded: false, periodStart: PERIOD, anchorSource: 'plan' }, error: null });
    const res = await call(validBody());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ recorded: false, status: 'already_recorded', credits: null });
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });
});

describe('refusals', () => {
  it('401 when signed out', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call(validBody());
    expect(res.status).toBe(401);
    expectNothingWritten();
  });

  it('403 for a non-admin', async () => {
    mockIsAdmin.mockResolvedValue(false);
    const res = await call(validBody());
    expect(res.status).toBe(403);
    expectNothingWritten();
    expect(mockIsTenant).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'false', 'yes'])('404 not_enabled when the switch is %p', async (value) => {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    const res = await call(validBody());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_enabled');
    expectNothingWritten();
    expect(mockIsTenant).not.toHaveBeenCalled();
  });

  it.each([
    ['amount 0', validBody({ amount: 0 })],
    ['a fraction', validBody({ amount: 1.5 })],
    ['over the ceiling', validBody({ amount: 100_001 })],
    ['a short reason', validBody({ reason: '  a ' })],
    ['an extra key', validBody({ userId: ACCOUNT })],
    ['a non-uuid request id', validBody({ requestId: 'abc' })],
    ['a non-uuid account', validBody({ accountId: 'nope' })],
    ['a non-JSON body', 'not json'],
  ])('400 for %s', async (_label, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_input');
    expectNothingWritten();
  });

  it('403 own_account on the admin\'s own account', async () => {
    const res = await call(validBody({ accountId: ADMIN.id.toUpperCase() }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('own_account');
    expectNothingWritten();
  });

  it('409 platform_account on the platform account', async () => {
    const res = await call(validBody({ accountId: PLATFORM }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('platform_account');
    expectNothingWritten();
    expect(mockIsTenant).not.toHaveBeenCalled();
  });

  it('404 not_a_tenant for an account that is not a Business OS tenant', async () => {
    mockIsTenant.mockResolvedValue(false);
    const res = await call(validBody());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_a_tenant');
    expectNothingWritten();
  });

  it('500 when the tenant check cannot answer', async () => {
    mockIsTenant.mockResolvedValue(null);
    const res = await call(validBody());
    expect(res.status).toBe(500);
    expectNothingWritten();
  });

  it('500 and no audit entry when the charge write fails', async () => {
    mockRecordCharge.mockResolvedValue({ data: null, error: new Error('rpc down') });
    const res = await call(validBody());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('charge_write_failed');
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });
});
