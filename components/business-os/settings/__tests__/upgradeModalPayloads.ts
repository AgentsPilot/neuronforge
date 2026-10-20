/**
 * @jest-environment node
 */
/**
 * Real `my-plan` payloads for the upgrade modal tests (UM-1a workplan §9.4):
 * the REAL plan view builder plus the REAL purchase view, with fakes only at
 * the purchase view's ports, through JSON as the browser receives them. So a
 * drift in the server's `comparison` (or any other field) fails the modal's
 * tests rather than passing against a hand-made fixture.
 *
 * Tier ids are read from config (`tierOrder`); cohort ids appear only here, in
 * `__tests__` (C-7).
 */

// The purchase view's module graph reaches the Supabase clients; nothing here talks to them.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { buildCustomerPlanView } from '@/lib/business-os/entitlements/customerPlanView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import { billingEndsWhen, readPlanPurchaseView } from '@/lib/business-os/billing/planPurchaseView';

export type Lang = 'en' | 'he' | 'es';

export const CONFIG = readCodeConfig();
export const LOWER = CONFIG.tierOrder[0];
export const TOP = CONFIG.tierOrder[CONFIG.tierOrder.length - 1];
export const TRIAL = 'trial';
export const FOUNDING_PARTNER = 'champion';
const USER = '11111111-1111-4111-8111-111111111111';

export interface PayloadOptions {
  planId?: string;
  language?: Lang;
  billingRow?: Record<string, unknown> | null;
  switchesOn?: boolean;
  buyable?: readonly string[];
  cohortExpiresAt?: string | null;
}

export async function payloadFor(options: PayloadOptions = {}): Promise<PlanPayload> {
  const { planId = LOWER, language = 'en', billingRow = null, switchesOn = true, buyable, cohortExpiresAt } = options;
  const now = new Date();
  const account = previewAccountFor(CONFIG, planId, now);
  const resolution = resolveEntitlements({
    config: CONFIG,
    account: cohortExpiresAt === undefined ? account : { ...account, cohortExpiresAt },
    overrides: [],
    addons: [],
    now,
  });
  const view = buildCustomerPlanView({ resolution, unavailable: false, now, config: CONFIG, locale: language });
  const purchase = await readPlanPurchaseView(
    { userId: USER, accountId: USER, snapshot: { unavailable: false, resolution } },
    {
      switches: () => ({ checkoutEnabled: switchesOn, pricesEnabled: switchesOn }),
      billing: { findByUser: async () => ({ data: billingRow as never, error: null }) },
      mode: () => 'test',
      ...(buyable ? { buyableTiers: () => buyable } : {}),
      logger: { warn: () => {} },
    }
  );
  const recordEndsWhen = view.kind === 'tier' ? billingEndsWhen(purchase?.billing ?? null) : null;
  return JSON.parse(JSON.stringify({ ...view, endsWhen: recordEndsWhen ?? view.endsWhen, purchase }));
}

/** Our record for an owner who pays for `boughtTier`. */
export const payingRow = (boughtTier: string = LOWER, overrides: Record<string, unknown> = {}) => ({
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  endedAt: null,
  boughtTier,
  stripeSubscriptionId: 'sub_own',
  ...overrides,
});

export const inSixtyDays = () => new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

/*
 * Self-check, as `app/admin/finance/__tests__/financeRequestPins.ts` does: Jest
 * collects every file under `__tests__`, and the check is worth having — the
 * modal's tests are vacuous if the server stopped sending `comparison`.
 */
describe('upgrade modal fixtures (self-check)', () => {
  it('the real payload carries the server comparison, one column per shown plan', async () => {
    const payload = await payloadFor();
    expect(payload.comparison?.planIds).toEqual((payload.plans ?? []).map((choice) => choice.planId));
    expect(payload.comparison?.sections.length).toBeGreaterThan(0);
  });
});
