/**
 * A service's instalment configuration, mirrored to the row the client is shown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The bug this closes: the Services settings wrote instalment fields onto
 * `scheduling_services` and nothing to `payment_plans`, so the server knew the
 * service was a plan and the public dialog did not. A 200 ILS service configured
 * as 2 × 100 quoted 200, charged 200, and banked nothing.
 *
 * The two assertions that matter most are not the happy path:
 *
 *   1. the row written is the OLDEST active one, because that is the one
 *      `loadServicePaymentPlans` quotes — writing the newest would leave the
 *      dialog stale and look fixed;
 *   2. turning instalments off DEACTIVATES and never deletes, because a client's
 *      card may still be charged against a subscription bound to that row.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const mockFindByServiceId = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@/lib/repositories/PaymentPlanRepository', () => ({
  paymentPlanRepository: {
    findByServiceId: (...a: unknown[]) => mockFindByServiceId(...a),
    create: (...a: unknown[]) => mockCreate(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));

import { syncServicePaymentPlan } from '../syncServicePaymentPlan';

const PLAN_SERVICE = {
  id: 'svc_1',
  service_name: 'בדיקת תוכנית תשלומים',
  price: 200,
  currency: 'ILS',
  payment_type: 'installments',
  installment_count: 2,
  installment_frequency: 'weekly',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindByServiceId.mockResolvedValue({ data: [], error: null });
  mockCreate.mockResolvedValue({ data: { id: 'plan_new' }, error: null });
  mockUpdate.mockResolvedValue({ data: { id: 'plan_existing' }, error: null });
});

describe('syncServicePaymentPlan — a service sold in instalments', () => {
  it('creates the row the public dialog reads, with ONE period as the amount', async () => {
    const { result, error } = await syncServicePaymentPlan(PLAN_SERVICE, 'user_1');

    expect(error).toBeNull();
    expect(result?.outcome).toEqual({ action: 'created', planId: 'plan_new' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user_1',
        service_id: 'svc_1',
        total_amount: 200,
        currency: 'ILS',
        installment_count: 2,
        // 100, not 200. This single number is what the dialog quotes and what
        // the payment step charges.
        installment_amount: 100,
        installment_frequency: 'weekly',
        is_active: true,
      })
    );
  });

  it('puts the remainder on the final period, so the first is the base amount', async () => {
    // 1000 over 3 is 333.33, 333.33, 333.34 — the first period is 333.33.
    await syncServicePaymentPlan(
      { ...PLAN_SERVICE, price: 1000, currency: 'USD', installment_count: 3 },
      'user_1'
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ installment_amount: 333.33, total_amount: 1000 })
    );
  });

  it('updates the existing row rather than adding a second', async () => {
    mockFindByServiceId.mockResolvedValue({
      data: [{ id: 'plan_existing', created_at: '2026-09-01T00:00:00Z' }],
      error: null,
    });

    const { result } = await syncServicePaymentPlan(PLAN_SERVICE, 'user_1');

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result?.outcome).toEqual({ action: 'updated', planId: 'plan_existing' });
    expect(mockUpdate).toHaveBeenCalledWith(
      'plan_existing',
      'user_1',
      expect.objectContaining({ installment_amount: 100, is_active: true })
    );
  });

  it('is idempotent: saving twice writes one row, then updates it', async () => {
    await syncServicePaymentPlan(PLAN_SERVICE, 'user_1');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    mockFindByServiceId.mockResolvedValue({
      data: [{ id: 'plan_new', created_at: '2026-09-29T00:00:00Z' }],
      error: null,
    });
    await syncServicePaymentPlan(PLAN_SERVICE, 'user_1');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('carries the service name, so a rename does not leave stale copy on the payment step', async () => {
    await syncServicePaymentPlan({ ...PLAN_SERVICE, service_name: 'Renamed' }, 'user_1');

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed' }));
  });
});

describe('syncServicePaymentPlan — which row gets written', () => {
  /*
   * `findByServiceId` orders created_at DESCENDING; `loadServicePaymentPlans`
   * orders ASCENDING and keeps the first. Writing `data[0]` from the repository
   * would update the NEWEST while the dialog quotes the OLDEST — the original
   * bug wearing a disguise.
   */
  it('writes the OLDEST active row, because that is the one the dialog quotes', async () => {
    mockFindByServiceId.mockResolvedValue({
      data: [
        { id: 'plan_newest', created_at: '2026-09-28T00:00:00Z' },
        { id: 'plan_oldest', created_at: '2026-01-05T00:00:00Z' },
      ],
      error: null,
    });

    const { result } = await syncServicePaymentPlan(PLAN_SERVICE, 'user_1');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toBe('plan_oldest');
    expect(result?.outcome).toEqual({ action: 'updated', planId: 'plan_oldest' });
  });

  it('reports the duplicates and leaves them untouched, because which is right is the owner call', async () => {
    mockFindByServiceId.mockResolvedValue({
      data: [
        { id: 'plan_a', created_at: '2026-01-05T00:00:00Z' },
        { id: 'plan_b', created_at: '2026-02-05T00:00:00Z' },
      ],
      error: null,
    });

    const { result } = await syncServicePaymentPlan(PLAN_SERVICE, 'user_1');

    expect(result?.duplicatePlanIds).toEqual(['plan_b']);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('syncServicePaymentPlan — a service NOT sold in instalments', () => {
  it.each([
    ['a single payment', { payment_type: 'full' }],
    ['a count of one, which is a single payment in a plan costume', { installment_count: 1 }],
    ['a free service', { price: 0 }],
  ])('deactivates the plan row for %s', async (_what, override) => {
    mockFindByServiceId.mockResolvedValue({
      data: [{ id: 'plan_old', created_at: '2026-01-05T00:00:00Z' }],
      error: null,
    });

    const { result } = await syncServicePaymentPlan({ ...PLAN_SERVICE, ...override }, 'user_1');

    expect(result?.outcome).toEqual({ action: 'deactivated', planIds: ['plan_old'] });
    expect(mockUpdate).toHaveBeenCalledWith('plan_old', 'user_1', { is_active: false });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('deactivates rather than deleting, because a live subscription may point at the row', async () => {
    mockFindByServiceId.mockResolvedValue({
      data: [{ id: 'plan_old', created_at: '2026-01-05T00:00:00Z' }],
      error: null,
    });

    await syncServicePaymentPlan({ ...PLAN_SERVICE, payment_type: 'full' }, 'user_1');

    // `payment_plan_installments.payment_plan_id` is a real FK and the client's
    // card is still being charged against it.
    const calls = mockUpdate.mock.calls.map(c => c[2]);
    expect(calls).toEqual([{ is_active: false }]);
  });

  it('does nothing at all when there was never a plan', async () => {
    const { result, error } = await syncServicePaymentPlan(
      { ...PLAN_SERVICE, payment_type: 'full' },
      'user_1'
    );

    expect(error).toBeNull();
    expect(result?.outcome).toEqual({ action: 'none' });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('syncServicePaymentPlan — failures are returned, not thrown', () => {
  it('reports a read failure without inventing a plan', async () => {
    mockFindByServiceId.mockResolvedValue({ data: null, error: new Error('db down') });

    const { result, error } = await syncServicePaymentPlan(PLAN_SERVICE, 'user_1');

    expect(result).toBeNull();
    expect(error?.message).toBe('db down');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('reports a write failure, so the caller can refuse the save', async () => {
    mockCreate.mockResolvedValue({ data: null, error: new Error('insert refused') });

    const { result, error } = await syncServicePaymentPlan(PLAN_SERVICE, 'user_1');

    expect(result).toBeNull();
    expect(error?.message).toBe('insert refused');
  });

  it('reports an insert that returns no row rather than claiming success', async () => {
    mockCreate.mockResolvedValue({ data: null, error: null });

    const { result, error } = await syncServicePaymentPlan(PLAN_SERVICE, 'user_1');

    expect(result).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
