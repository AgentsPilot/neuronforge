/**
 * `active: false` changes NOTHING. Held here, because the name invites the
 * opposite assumption.
 *
 * **This file is where the decision gets recorded.** When the user decides what
 * "inactive" should do, the assertion for each surface it then affects is
 * removed IN THE SAME CHANGE — and only that one. Until then nothing may read
 * the flag except the admin Tiers card.
 *
 * The user added an `active` flag to all four plans on 2026-09-29 as an **FYI
 * only** — an operator's marker on the admin Tiers card. What inactive should DO
 * (stop new assignments? hide the plan from customers? affect accounts already on
 * it?) is deliberately undecided.
 *
 * Without this suite, the next person reads "inactive" and wires it into the
 * resolver, or hides the plan, believing that was always the intent. So every
 * surface that decides or tells a customer anything is run twice — once with all
 * four plans active, once with all four inactive — and must be byte-identical:
 *
 *   - the RESOLUTION of an account on each plan (what it can do);
 *   - the customer's "Your plan" PAYLOAD;
 *   - the Founding Partner PILL;
 *   - the SHADOW REPORT's static section;
 *   - whether an INVITE may still carry the plan (`isInviteGrantAvailable`) —
 *     "don't offer an inactive plan" is the likeliest next thought, and this is
 *     exactly where it would go;
 *   - the PLAN OFFER the anonymous invite page shows a prospective customer
 *     (`describePlanOffer`).
 *
 * The one surface that is allowed to differ is the admin Tiers view — that is
 * where the marker lives — and the last test pins that it does, so this suite
 * cannot pass by the flag simply never being read.
 *
 */

import { buildAdminPlansView } from '@/lib/business-os/entitlements/adminPlansView';
import { buildCustomerPlanView } from '@/lib/business-os/entitlements/customerPlanView';
import { planBadgeFor } from '@/lib/business-os/entitlements/planBadge';
import { planActive, previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { buildShadowReport } from '@/lib/business-os/entitlements/report';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig, type EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { describePlanOffer } from '@/lib/business-os/entitlements/planOfferView';
import { INVITE_TYPES, INVITE_TYPE_IDS } from '@/lib/business-os/entitlements/config/invites';
import { isInviteGrantAvailable } from '@/lib/business-os/invites/inviteOffer';

const NOW = new Date('2026-09-29T00:00:00.000Z');
const PLAN_IDS = ['trial', 'champion', 'basic', 'pro'] as const;

/** The real config with every plan's `active` set to `value` — a clone, never a mutation. */
function withAllActive(value: boolean): EntitlementConfig {
  const config = readCodeConfig();
  const presentation = config.matrix.presentation as Record<string, Record<string, unknown>>;
  const cohorts = config.cohorts as unknown as Record<string, Record<string, unknown>>;

  return {
    ...config,
    matrix: {
      ...config.matrix,
      presentation: Object.fromEntries(
        Object.entries(presentation).map(([id, entry]) => [id, { ...entry, active: value }])
      ),
    },
    cohorts: Object.fromEntries(Object.entries(cohorts).map(([id, entry]) => [id, { ...entry, active: value }])),
  } as unknown as EntitlementConfig;
}

const ACTIVE = withAllActive(true);
const INACTIVE = withAllActive(false);

/**
 * Every grant an invite can carry today, read from the invite config rather
 * than listed here, so a plan made invitable later is covered without an edit.
 */
const INVITABLE_GRANTS = INVITE_TYPE_IDS.flatMap((type) =>
  (INVITE_TYPES[type].grantIds as readonly string[]).map((grantId) => ({
    grant_kind: INVITE_TYPES[type].grantKind,
    grant_id: grantId,
  }))
);

function resolutionFor(config: EntitlementConfig, planId: string) {
  return resolveEntitlements({
    config,
    account: previewAccountFor(config, planId, NOW),
    overrides: [],
    addons: [],
    now: NOW,
  });
}

describe('`active: false` changes nothing a customer or the product can see', () => {
  it('the fixture really did flip every plan — non-vacuity first', () => {
    // Every assertion below passes trivially if the clone failed to set the flag.
    // These are the SAME two objects every surface below is handed, the invite
    // ones included, so this covers all of them.
    for (const planId of PLAN_IDS) {
      expect(planActive(ACTIVE, planId)).toBe(true);
      expect(planActive(INACTIVE, planId)).toBe(false);
    }
    // And the invite checks below have something to check: every invitable
    // grant is one of the four plans flipped above.
    expect(INVITABLE_GRANTS.length).toBeGreaterThan(0);
    for (const grant of INVITABLE_GRANTS) {
      expect(PLAN_IDS as readonly string[]).toContain(grant.grant_id);
    }
  });

  it.each(PLAN_IDS)('the RESOLUTION of an account on %s is identical', (planId) => {
    // What the account can DO. The one that matters most.
    expect(JSON.stringify(resolutionFor(INACTIVE, planId))).toBe(JSON.stringify(resolutionFor(ACTIVE, planId)));
  });

  it.each(PLAN_IDS)('the customer PAYLOAD for %s is identical', (planId) => {
    const on = buildCustomerPlanView({
      resolution: resolutionFor(ACTIVE, planId),
      unavailable: false,
      now: NOW,
      config: ACTIVE,
    });
    const off = buildCustomerPlanView({
      resolution: resolutionFor(INACTIVE, planId),
      unavailable: false,
      now: NOW,
      config: INACTIVE,
    });

    expect(JSON.stringify(off)).toBe(JSON.stringify(on));
    // And the flag is not IN it — the customer allow-list would refuse it, but
    // saying so here keeps the reason next to the rule. Matched as a KEY: the
    // resolver's lifecycle state for a paid plan is the VALUE "active"
    // (`"state":"active"`), which is unrelated and correct.
    expect(JSON.stringify(on)).not.toMatch(/"active":/);
  });

  it.each(PLAN_IDS)('the Founding Partner PILL for %s is identical', (planId) => {
    expect(JSON.stringify(planBadgeFor(resolutionFor(INACTIVE, planId), INACTIVE))).toBe(
      JSON.stringify(planBadgeFor(resolutionFor(ACTIVE, planId), ACTIVE))
    );
  });

  it.each(INVITABLE_GRANTS.map((grant) => [`${grant.grant_kind}:${grant.grant_id}`, grant] as const))(
    'whether an INVITE may carry %s is identical — and still yes',
    (_name, grant) => {
      expect(isInviteGrantAvailable(INACTIVE, grant)).toBe(isInviteGrantAvailable(ACTIVE, grant));
      // Pinned as `true`, not just equal: an inactive plan is still invitable.
      expect(isInviteGrantAvailable(INACTIVE, grant)).toBe(true);
    }
  );

  it.each(PLAN_IDS)('the PLAN OFFER a prospective customer sees for %s is identical', (planId) => {
    // What the anonymous invite page shows. The flag must not reach it either.
    const on = describePlanOffer(ACTIVE, planId, NOW);
    const off = describePlanOffer(INACTIVE, planId, NOW);

    expect(JSON.stringify(off)).toBe(JSON.stringify(on));
    expect(JSON.stringify(on)).not.toMatch(/"active":/);
    // Non-vacuity: a real offer, not an empty one.
    expect(on.included.length).toBeGreaterThan(0);
  });

  it('the SHADOW REPORT static section is identical', async () => {
    const rows = PLAN_IDS.map((planId, index) => ({
      user_id: `acct-${index}`,
      tier: planId === 'basic' || planId === 'pro' ? planId : null,
      plan_version: planId === 'basic' || planId === 'pro' ? 1 : 0,
      tier_expires_at: null,
      cohort: planId === 'trial' || planId === 'champion' ? planId : null,
      cohort_expires_at: null,
      onboarding_started_at: '2026-09-01T00:00:00.000Z',
      profile_created_at: '2026-09-01T00:00:00.000Z',
      trial_started_at: planId === 'trial' ? '2026-09-20T00:00:00.000Z' : null,
      trial_ends_at: null,
      grace_ends_at: null,
      period_anchor: '2026-09-01T00:00:00.000Z',
      origin: 'backfill',
      updated_by_admin_id: null,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    }));

    const reportWith = (config: EntitlementConfig) =>
      buildShadowReport({
        config,
        now: () => NOW,
        planRepository: {
          async pagePlans(options: { afterUserId?: string | null } = {}) {
            const after = options.afterUserId;
            return { data: rows.filter((row) => !after || row.user_id > after), error: null };
          },
          async findTenantsMissingPlanRow() {
            return {
              data: { checked: 4, count: 0, missing: [], withProfile: 0, onboardingOnly: 0, truncated: false, scope: 'x' },
              error: null,
            };
          },
          async findRecentOnboardedPlans() {
            return { data: [], error: null };
          },
        } as never,
        shadowRepository: { async findWindow() { return { data: [], error: null }; } } as never,
      });

    const on = await reportWith(ACTIVE);
    const off = await reportWith(INACTIVE);

    expect(JSON.stringify(off.static)).toBe(JSON.stringify(on.static));
    // Non-vacuity: four accounts were really scanned.
    expect(on.static.accountsScanned).toBe(4);
  });

  it('…and the admin Tiers view DOES differ — so the flag is really read', () => {
    // The one place the marker is meant to appear. Without this, every assertion
    // above would also pass if `active` were never read by anything at all.
    const readBoth = (config: EntitlementConfig) => {
      const original = jest.requireActual('@/lib/business-os/entitlements/source');
      const spy = jest.spyOn(original, 'getEntitlementConfig').mockReturnValue(config);
      try {
        return buildAdminPlansView(NOW).plans.map((plan) => ({ id: plan.id, active: plan.active }));
      } finally {
        spy.mockRestore();
      }
    };

    expect(readBoth(ACTIVE).every((plan) => plan.active)).toBe(true);
    expect(readBoth(INACTIVE).every((plan) => !plan.active)).toBe(true);
    expect(readBoth(ACTIVE)).toHaveLength(4);
  });
});
