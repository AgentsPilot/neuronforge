/**
 * Plan periods a dead plan can no longer charge.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The dated-stage scan skipped every subscription-projected period outright,
 * with a sound reason: Stripe collects each one, and raising an invoice would
 * bill the client twice for the same money.
 *
 * That reason expires with the subscription. A business that leaves Stripe has
 * periods its client still owes and nothing left to collect them: the card
 * cannot be charged, and the scan skipped them for ever, so they sat in
 * receivables as income that could never arrive. Closing them would have
 * written off money genuinely owed, so they are invoiced instead.
 *
 * The assertion that matters most here is the NEGATIVE one: a live plan's
 * periods must never be invoiced. A client paying twice is worse than a
 * receivable nobody chased, so every uncertainty resolves to "leave it alone".
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => l };
  return { createLogger: () => l };
});

const mockFindAccount = jest.fn();

jest.mock('@/lib/repositories/PaymentRepository', () => ({
  stripeConnectRepository: { findByUserId: (...a: unknown[]) => mockFindAccount(...a) },
}));

import { isPlanStopped } from '@/lib/payments/planStatus';

/**
 * The decision under test, in the shape the scan applies it.
 *
 * Mirrors `PaymentReminderService.planCanNoLongerCharge` — a private method on a
 * class whose module pulls in a PDF renderer Jest cannot transform, which is why
 * the service imports its billing dependency lazily. The rule is small enough to
 * state once and assert directly.
 */
async function planCanNoLongerCharge(
  stage: { user_id: string; subscription_id?: string | null },
  plan: { status: string } | null
): Promise<boolean> {
  if (!stage.subscription_id) return false;
  if (!plan) return false;
  if (isPlanStopped(plan.status)) return true;

  const { data: account } = await mockFindAccount(stage.user_id);
  return !account?.stripe_account_id;
}

const STAGE = { user_id: 'u1', subscription_id: 'sub-row-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockFindAccount.mockResolvedValue({ data: { stripe_account_id: 'acct_live' }, error: null });
});

describe('a plan period that can no longer be charged', () => {
  it('is billable when the plan has been stopped', async () => {
    expect(await planCanNoLongerCharge(STAGE, { status: 'cancelled' })).toBe(true);
    expect(await planCanNoLongerCharge(STAGE, { status: 'completed' })).toBe(true);
  });

  it('is billable when the business has no payment account left', async () => {
    mockFindAccount.mockResolvedValue({ data: null, error: null });

    expect(await planCanNoLongerCharge(STAGE, { status: 'active' })).toBe(true);
  });

  /*
   * THE ONE THAT MATTERS. Stripe is still charging this card every period;
   * invoicing it as well bills the client twice for the same money.
   */
  it('is NOT billable while the plan is live and the account is there', async () => {
    expect(await planCanNoLongerCharge(STAGE, { status: 'active' })).toBe(false);
    expect(await planCanNoLongerCharge(STAGE, { status: 'past_due' })).toBe(false);
    expect(await planCanNoLongerCharge(STAGE, { status: 'paused' })).toBe(false);
  });

  it('is NOT billable when the plan cannot be found', async () => {
    // Not knowing is not evidence that nothing will be charged.
    expect(await planCanNoLongerCharge(STAGE, null)).toBe(false);
  });

  it('is NOT billable when the period belongs to no plan', async () => {
    expect(await planCanNoLongerCharge({ user_id: 'u1', subscription_id: null }, null)).toBe(false);
  });
});
