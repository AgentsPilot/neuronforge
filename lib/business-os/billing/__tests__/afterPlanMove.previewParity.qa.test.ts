/**
 * QA (D3.1 / SX-2b, AC-D31.5): the Cancel drawer's `{until}` and the date the
 * webhook writer stores are the SAME value, for every repeat-cancel count, in
 * both drawer modes:
 *
 *   - period_end: the tier is paid through the period end, Stripe ends the
 *     subscription AT that instant (SA comment 4);
 *   - now (P-7a.4 "Ends now", U-5): a lapsed (past_due) tier ended now.
 *
 * Both sides run for real against the production config: the drawer through
 * `readPlanEndingView` (real `EntitlementService`, fake repository), the
 * writer through `moveToFreeCohortAfterPlan` (fake ports). The row and the
 * count are identical on both sides. No repository is named (RC-15).
 */

import type { Logger } from '@/lib/logger';
import { EntitlementService } from '@/lib/business-os/entitlements/EntitlementService';
import type { fromPlanRow } from '@/lib/business-os/entitlements/account';
import { AFTER_PLAN } from '@/lib/business-os/entitlements/config/afterPlan';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { readPlanEndingView } from '@/lib/business-os/entitlements/planEndingView';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { moveToFreeCohortAfterPlan, type AfterPlanMoveWrite } from '@/lib/business-os/billing/afterPlanMove';

type PlanRow = Parameters<typeof fromPlanRow>[0];

const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const TOP = TIER_ORDER[TIER_ORDER.length - 1];
const PERIOD_END = '2026-11-26T10:00:00.000Z';
const LAPSED_PAID_THROUGH = '2026-11-16T10:00:00.000Z';
const NOW_CANCEL = '2026-11-26T10:00:00.000Z';
const EXPECTED_DAYS = [14, 7, 4, 2, 1, 1, 1];

function planRow(tierExpiresAt: string): PlanRow {
  return {
    user_id: ACCOUNT, tier: TOP, plan_version: 0, tier_expires_at: tierExpiresAt, cohort: AFTER_PLAN.cohort, cohort_expires_at: null,
    onboarding_started_at: '2026-01-01T00:00:00.000Z', profile_created_at: null, trial_started_at: '2026-01-01T00:00:00.000Z',
    trial_ends_at: '2026-01-15T00:00:00.000Z', grace_ends_at: null, period_anchor: '2026-10-26T10:00:00+00:00', origin: 'admin',
    updated_by_admin_id: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-10-26T10:00:00.123456+00:00',
  };
}

const silentLog = (() => {
  const child: Record<string, unknown> = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
  child.child = () => child;
  return child as unknown as Logger;
})();

async function drawerUntil(row: PlanRow, endsAt: string, moves: number, now: string): Promise<string | null> {
  const service = new EntitlementService({
    repository: {
      async findEntitlementInputs() {
        return { data: { plan: row, overrides: [] }, error: null };
      },
      async findEntitlementInputsBatch() {
        return { data: {}, error: null };
      },
      async findAfterPlanMoveState() {
        return { data: { moves, lastSubscriptionId: moves === 0 ? null : 'sub_PREVIOUS' }, error: null };
      },
    },
    now: () => new Date(now),
  });
  const view = await readPlanEndingView({ accountId: ACCOUNT, endsAt, locale: 'en' }, { service });
  return view?.kind === 'free_plan' ? view.until : null;
}

async function writerTrialEnd(row: PlanRow, endedAt: string, moves: number, now: string): Promise<AfterPlanMoveWrite | null> {
  const writes: AfterPlanMoveWrite[] = [];
  await moveToFreeCohortAfterPlan(
    { accountId: ACCOUNT, subscriptionId: 'sub_NEW', livemode: false, stripeEventId: 'evt_qa', endedAt, cancellationReason: 'cancellation_requested' },
    silentLog,
    {
      readMoveInputs: async () => ({ data: { plan: row, moves, lastSubscriptionId: moves === 0 ? null : 'sub_PREVIOUS' }, error: null }),
      writeMove: async (input) => {
        writes.push(input);
        return { data: { outcome: 'applied', moves: input.expected.moves + 1 }, error: null };
      },
      config: () => getEntitlementConfig(),
      recordPlanChange: async () => undefined,
      now: () => new Date(now),
    }
  );
  return writes[0] ?? null;
}

describe('QA AC-D31.5: the drawer {until} equals the stored trial_ends_at', () => {
  it.each(EXPECTED_DAYS.map((days, moves) => [moves, days]))(
    'period_end mode, %i earlier move(s): both read the settlement end + %i days',
    async (moves, days) => {
      const row = planRow(PERIOD_END);
      const now = '2026-11-01T00:00:00.000Z'; // the drawer opens before the period end
      const until = await drawerUntil(row, PERIOD_END, moves, now);
      const write = await writerTrialEnd(row, PERIOD_END, moves, PERIOD_END);
      expect(write).not.toBeNull();
      expect(until).not.toBeNull();
      expect(until).toBe(write!.trialEndsAt);
      // U-3 on a first cancel: period end + 1 settlement day + the halved length.
      expect(Date.parse(write!.trialEndsAt) - Date.parse(PERIOD_END)).toBe((1 + days) * DAY);
    }
  );

  it.each(EXPECTED_DAYS.map((days, moves) => [moves, days]))(
    'now mode (lapsed past_due tier ended now, U-5), %i earlier move(s): both read now + %i days, never "could not work out"',
    async (moves, days) => {
      const row = planRow(LAPSED_PAID_THROUGH);
      const until = await drawerUntil(row, NOW_CANCEL, moves, NOW_CANCEL);
      const write = await writerTrialEnd(row, NOW_CANCEL, moves, NOW_CANCEL);
      expect(write).not.toBeNull();
      expect(until).not.toBeNull();
      expect(until).toBe(write!.trialEndsAt);
      expect(Date.parse(write!.trialEndsAt) - Date.parse(NOW_CANCEL)).toBe(days * DAY);
      expect(write!.trialStartedAt).toBe(NOW_CANCEL);
    }
  );
});
