/**
 * GET /api/admin/business-os/credits/accounts/[accountId]/boost
 * (credits boost slice 6a; workplan §3.1; SA C-4, Q-7; 2a I-2, C-5; 2b N-3).
 *
 * The admin gate is real (with `getUser` and the access service mocked); the
 * tenant check and the boost repository are mocked; `boostAdminView` is REAL,
 * so the payload is exactly what the route would send.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

const logged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec = (...a: unknown[]) => void logged.push(a);
    const logger: Record<string, unknown> = { info: rec, warn: rec, error: rec, debug: rec };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockIsTenant = jest.fn();
jest.mock('@/lib/business-os/entitlements/adminOps', () => ({
  isBusinessOsTenant: (...args: unknown[]) => mockIsTenant(...args),
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({ businessProfileRepository: {} }));
jest.mock('@/lib/repositories/OnboardingConversationRepository', () => ({ onboardingConversationRepository: {} }));
jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({ businessOsAccountPlanRepository: {} }));

const mockRepo = {
  listForAccount: jest.fn(),
  findActiveCapOverride: jest.fn(),
  listCapOverrides: jest.fn(),
};
jest.mock('@/lib/repositories/BusinessOsBoostPurchaseRepository', () => ({ businessOsBoostPurchaseRepository: mockRepo }));

import { GET } from '../route';
import type { BusinessOsBoostPurchase } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import type { AdminBoostView } from '@/lib/business-os/boost/boostAdminViewTypes';

const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-22222222222b', email: 'customer@example.com' };
const ACCOUNT = 'abcdef99-9999-4999-8999-99999999999f';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const env = process.env as Record<string, string | undefined>;
const savedKey = env.STRIPE_SECRET_KEY;

const call = (accountId: string, query = '') =>
  GET(new NextRequest(`http://localhost/api/admin/business-os/credits/accounts/${accountId}/boost${query}`), { params: { accountId } });

const asAdmin = (user = ADMIN) => {
  mockGetUser.mockResolvedValue(user);
  mockIsAdmin.mockResolvedValue(true);
};

function purchase(n: number, patch: Partial<BusinessOsBoostPurchase> = {}): BusinessOsBoostPurchase {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    accountId: ACCOUNT,
    livemode: false,
    status: 'paid',
    packageId: 'plus',
    packageVersion: 1,
    retailVersion: 1,
    creditValueVersion: 1,
    priceMinor: 2500,
    currency: 'USD',
    taxExclusive: true,
    creditsBase: 12500,
    creditsBonus: 1250,
    creditsTotal: 13750,
    checkoutExpiresAt: '2026-10-01T12:30:00.000Z',
    stripeCheckoutSessionId: `cs_test_${n}`,
    stripePaymentIntentId: `pi_test${n}`,
    stripeChargeId: `ch_test${n}`,
    receiptUrl: 'https://pay.stripe.com/receipts/x',
    amountSubtotalMinor: 2500,
    amountTaxMinor: 0,
    amountTotalMinor: 2500,
    amountRefundedMinor: 0,
    stripeDisputeId: null,
    flagReason: null,
    lotId: '77777777-7777-4777-8777-777777777777',
    paidAt: '2026-10-01T12:05:00.000Z',
    statusChangedAt: '2026-10-01T12:05:00.000Z',
    createdAt: `2026-10-0${n}T12:00:00.000Z`,
    updatedAt: '2026-10-01T12:05:00.000Z',
    ...patch,
  };
}

const OVERRIDE = {
  id: '55555555-5555-4555-8555-555555555555',
  accountId: ACCOUNT,
  capMinor: 50000,
  currency: 'USD',
  reason: 'annual prepay customer',
  actorAdminId: ADMIN.id,
  createdAt: '2026-10-02T09:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  env.STRIPE_SECRET_KEY = 'sk_live_test_only_value';
  mockIsTenant.mockResolvedValue(true);
  mockRepo.listForAccount.mockImplementation(async (_id: string, options: { livemode: boolean }) => ({
    data: options.livemode ? [purchase(3, { livemode: true, stripePaymentIntentId: 'pi_live3' })] : [purchase(1), purchase(2, { status: 'flagged_mismatch', flagReason: 'amount_mismatch', lotId: null })],
    error: null,
  }));
  mockRepo.findActiveCapOverride.mockResolvedValue({ data: OVERRIDE, error: null });
  mockRepo.listCapOverrides.mockResolvedValue({
    data: [
      { ...OVERRIDE, endedAt: null, endedByAdminId: null, endedReason: null },
      { ...OVERRIDE, id: '66666666-6666-4666-8666-666666666666', capMinor: 30000, createdAt: '2026-09-01T09:00:00.000Z', endedAt: '2026-10-02T09:00:00.000Z', endedByAdminId: ADMIN.id, endedReason: 'replaced' },
    ],
    error: null,
  });
});

afterAll(() => {
  env.STRIPE_SECRET_KEY = savedKey;
});

describe('the gate comes first, and nothing is read on a denial', () => {
  const nothingRead = () => {
    expect(mockIsTenant).not.toHaveBeenCalled();
    expect(mockRepo.listForAccount).not.toHaveBeenCalled();
    expect(mockRepo.findActiveCapOverride).not.toHaveBeenCalled();
    expect(mockRepo.listCapOverrides).not.toHaveBeenCalled();
  };

  it('signed out → 401', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call(ACCOUNT)).status).toBe(401);
    nothingRead();
  });

  it('not an admin → 403; a throwing admin check → 403; a throwing auth lookup → 401', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call(ACCOUNT)).status).toBe(403);
    mockIsAdmin.mockRejectedValue(new Error('down'));
    expect((await call(ACCOUNT)).status).toBe(403);
    mockGetUser.mockRejectedValue(new Error('cookie'));
    expect((await call(ACCOUNT)).status).toBe(401);
    nothingRead();
  });

  it('source: requireAdmin is the first statement of GET', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const body = code.match(/export async function GET\([^)]*\)\s*\{([\s\S]*)$/)![1];
    expect(body.trim().startsWith('const gate = await requireAdmin(')).toBe(true);
  });
});

describe('the order of checks (the 11c order)', () => {
  it('a non-uuid path → 400, nothing read', async () => {
    asAdmin();
    const response = await call('not-a-uuid');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'invalid_account_id' });
    expect(mockIsTenant).not.toHaveBeenCalled();
  });

  it('the platform account → 409 before any read', async () => {
    asAdmin();
    const response = await call(PLATFORM);
    expect(response.status).toBe(409);
    expect(mockIsTenant).not.toHaveBeenCalled();
    expect(mockRepo.listForAccount).not.toHaveBeenCalled();
  });

  it('not a tenant → 404; the tenant check failing → 500; neither reads a purchase', async () => {
    asAdmin();
    mockIsTenant.mockResolvedValueOnce(false);
    expect((await call(ACCOUNT)).status).toBe(404);
    mockIsTenant.mockResolvedValueOnce(null);
    expect((await call(ACCOUNT)).status).toBe(500);
    expect(mockRepo.listForAccount).not.toHaveBeenCalled();
  });

  it('the account comes ONLY from the path, lower-cased; the query string is ignored', async () => {
    asAdmin();
    await call(ACCOUNT.toUpperCase(), `?accountId=${CUSTOMER.id}&userId=${CUSTOMER.id}`);
    expect(mockIsTenant.mock.calls[0][0].accountId).toBe(ACCOUNT);
    for (const [id] of mockRepo.listForAccount.mock.calls) expect(id).toBe(ACCOUNT);
    expect(mockRepo.findActiveCapOverride).toHaveBeenCalledWith(ACCOUNT);
    expect(mockRepo.listCapOverrides).toHaveBeenCalledWith(ACCOUNT);
  });
});

describe('the payload', () => {
  it('both modes (SA Q-7), newest first, each row with its own mode; the cap with default, override and history', async () => {
    asAdmin();
    const response = await call(ACCOUNT);
    expect(response.status).toBe(200);
    // SA N-1: never stored by a browser or a proxy.
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const { data } = (await response.json()) as { data: AdminBoostView };
    expect(mockRepo.listForAccount.mock.calls.map(([, options]) => options)).toEqual([
      { livemode: false, limit: 50 },
      { livemode: true, limit: 50 },
    ]);
    expect(data.serverMode).toBe('live');
    expect(data.isOwnAccount).toBe(false);
    if (data.purchases.status !== 'ok') throw new Error('expected ok');
    expect(data.purchases.rows.map((row) => [row.createdAt.slice(0, 10), row.livemode])).toEqual([
      ['2026-10-03', true],
      ['2026-10-02', false],
      ['2026-10-01', false],
    ]);
    expect(data.purchases.rows[1]).toMatchObject({ status: 'flagged_mismatch', flagReason: 'amount_mismatch' });
    expect(data.purchases.truncated).toEqual({ test: false, live: false });
    if (data.cap.status !== 'ok') throw new Error('expected ok');
    expect(data.cap.default).toEqual({ amountMinor: 15000, currency: 'USD', windowDays: 30 });
    expect(data.cap.active).toMatchObject({ amountMinor: 50000, reason: 'annual prepay customer', actorAdminId: ADMIN.id });
    expect(data.cap.history.map((change) => change.endedReason)).toEqual([null, 'replaced']);
  });

  it('pins the keys: no email, no secret, no client secret, no receipt link, ids only for Stripe', async () => {
    asAdmin();
    const { data } = (await (await call(ACCOUNT)).json()) as { data: AdminBoostView };
    expect(Object.keys(data).sort()).toEqual(['accountId', 'cap', 'isOwnAccount', 'purchases', 'serverMode']);
    if (data.purchases.status !== 'ok') throw new Error('expected ok');
    expect(Object.keys(data.purchases.rows[0]).sort()).toEqual(
      [
        'amountRefundedMinor',
        'amountTaxMinor',
        'amountTotalMinor',
        'checkoutExpiresAt',
        'createdAt',
        'creditsTotal',
        'currency',
        'flagReason',
        'id',
        'livemode',
        'lotId',
        'packageId',
        'packageVersion',
        'paidAt',
        'priceMinor',
        'status',
        'statusChangedAt',
        'stripe',
      ].sort()
    );
    expect(Object.keys(data.purchases.rows[0].stripe).sort()).toEqual(['chargeId', 'checkoutSessionId', 'disputeId', 'paymentIntentId']);
    const text = JSON.stringify(data);
    for (const banned of ['email', 'secret', 'receipt', 'accountId":"2222']) expect(text).not.toContain(banned);
  });

  it('a full mode is reported as truncated', async () => {
    asAdmin();
    mockRepo.listForAccount.mockImplementation(async (_id: string, options: { livemode: boolean }) => ({
      data: options.livemode ? [] : Array.from({ length: 50 }, (_, i) => purchase(1, { id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })),
      error: null,
    }));
    const { data } = (await (await call(ACCOUNT)).json()) as { data: AdminBoostView };
    expect(data.purchases.status === 'ok' && data.purchases.truncated).toEqual({ test: true, live: false });
  });

  it('each block fails on its own: purchases error with the cap shown, and the reverse', async () => {
    asAdmin();
    mockRepo.listForAccount.mockResolvedValueOnce({ data: null, error: new Error('down') });
    let { data } = (await (await call(ACCOUNT)).json()) as { data: AdminBoostView };
    expect(data.purchases).toEqual({ status: 'error' });
    expect(data.cap.status).toBe('ok');

    mockRepo.listCapOverrides.mockResolvedValueOnce({ data: null, error: new Error('down') });
    ({ data } = (await (await call(ACCOUNT)).json()) as { data: AdminBoostView });
    expect(data.cap).toEqual({ status: 'error' });
    expect(data.purchases.status).toBe('ok');
  });

  it('no active override → active null (the default applies); the admin viewing their own account is told', async () => {
    asAdmin({ id: ACCOUNT, email: 'ops@example.com' });
    mockRepo.findActiveCapOverride.mockResolvedValueOnce({ data: null, error: null });
    const { data } = (await (await call(ACCOUNT)).json()) as { data: AdminBoostView };
    expect(data.cap.status === 'ok' && data.cap.active).toBeNull();
    expect(data.isOwnAccount).toBe(true);
  });

  it('an unreadable Stripe key → serverMode null, the rest unchanged', async () => {
    asAdmin();
    delete env.STRIPE_SECRET_KEY;
    const { data } = (await (await call(ACCOUNT)).json()) as { data: AdminBoostView };
    expect(data.serverMode).toBeNull();
    expect(data.purchases.status).toBe('ok');
  });

  it('logs ids, statuses and counts only: no reason, no Stripe id, no email', async () => {
    asAdmin();
    await call(ACCOUNT);
    const text = JSON.stringify(logged);
    for (const banned of ['annual prepay', 'pi_test', 'cs_test', '@']) expect(text).not.toContain(banned);
  });
});

describe('source guards', () => {
  // Comments stripped: the header explains what the route does NOT use.
  const code = fs
    .readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('never names a …ForWebhook finder or the reconcile read (2a SA C-5)', () => {
    expect(code).not.toMatch(/ForWebhook|listForReconcile/);
  });

  it('reads no request body and writes nothing', () => {
    expect(code).not.toMatch(/request\.(json|text|formData)\(/);
    expect(code).not.toMatch(/\b(setCapOverride|endCapOverride|credit|transition|recordReceipt|logAndFlush)\(/);
  });

  it('exports only route fields (Next.js rejects any other export from route.ts)', () => {
    const exported = [...code.matchAll(/^export (?:async function|const) (\w+)/gm)].map((m) => m[1]).sort();
    expect(exported).toEqual(['GET', 'dynamic', 'runtime']);
  });
});
