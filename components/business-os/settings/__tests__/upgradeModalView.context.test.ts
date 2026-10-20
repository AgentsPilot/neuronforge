/**
 * @jest-environment node
 *
 * `upgradeModalView(plan, context)` (upgrade modal UM-2, workplan §6, §11.1) on
 * REAL payloads (`upgradeModalPayloads`). What is pinned:
 *   - no context / `settings`: the UM-1b output, field for field;
 *   - UM-FR8: the context changes the headline, subheading and highlight only;
 *   - `locked_feature`: the caller's plan highlighted, offered or not (UM-BQ4's
 *     locked-action clause, O-1), one column only; fallbacks to `settings`;
 *   - `founding_partner`: only on `free_access` + an offer (UM-FR9), AC-UM5.
 */

import { BUTTON_ACTIONS, upgradeModalView } from '@/components/business-os/settings/upgradeModalView';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import type { UpgradeModalContext } from '@/components/business-os/settings/upgradeModalContext';

import { FOUNDING_PARTNER, LOWER, TOP, TRIAL, inSixtyDays, payingRow, payloadFor } from './upgradeModalPayloads';

const LOCKED = (planId: string): UpgradeModalContext => ({ kind: 'locked_feature', planId });
const FP: UpgradeModalContext = { kind: 'founding_partner' };
const SETTINGS: UpgradeModalContext = { kind: 'settings' };

const highlighted = (payload: PlanPayload, context: UpgradeModalContext) =>
  upgradeModalView(payload, context).columns.filter((entry) => entry.highlightReason !== null);

/** The UM-1b fields, without the UM-2 additions. */
const um1bShape = (view: ReturnType<typeof upgradeModalView>) => ({
  available: view.available,
  sections: view.sections,
  headline: view.headline,
  somethingOffered: view.somethingOffered,
  hasActions: view.hasActions,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose: the UM-2 field
  columns: view.columns.map(({ highlightReason, ...rest }) => rest),
});

async function fixtures(): Promise<Array<[string, PlanPayload]>> {
  return [
    ['trial', await payloadFor({ planId: TRIAL })],
    ['open-ended Founding Partner', await payloadFor({ planId: FOUNDING_PARTNER })],
    ['Founding Partner with an end date', await payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays() })],
    ['Essentials renewing', await payloadFor({ billingRow: payingRow(LOWER) })],
    ['top plan renewing', await payloadFor({ planId: TOP, billingRow: payingRow(TOP) })],
    ['admin-assigned own plan', await payloadFor({ planId: TOP, buyable: [TOP] })],
  ];
}

describe('UM-2: settings is UM-1b, and the context never changes the offer', () => {
  it('no context and settings: the UM-1b output, field for field (regression pin)', async () => {
    for (const [name, payload] of await fixtures()) {
      const none = upgradeModalView(payload);
      const settings = upgradeModalView(payload, SETTINGS);
      expect({ name, view: um1bShape(settings) }).toEqual({ name, view: um1bShape(none) });
      expect(settings).toMatchObject({ variant: 'settings', subheading: 'default', lockedPlan: null });
      // Outside locked_feature, highlightReason is the Recommended rule.
      for (const entry of settings.columns) expect(entry.highlightReason).toBe(entry.isRecommended ? 'recommended' : null);
    }
  });

  it('UM-FR8: every fixture × every context: action, chip, note, somethingOffered, hasActions equal; sections identical', async () => {
    for (const [name, payload] of await fixtures()) {
      const base = upgradeModalView(payload);
      const offer = (view: typeof base) =>
        view.columns.map(({ planId, action, comingSoon, ownPlanNote, unavailableBecause }) => ({ planId, action, comingSoon, ownPlanNote, unavailableBecause }));
      for (const context of [SETTINGS, FP, LOCKED(TOP), LOCKED(LOWER)]) {
        const view = upgradeModalView(payload, context);
        expect({ name, context, offer: offer(view) }).toEqual({ name, context, offer: offer(base) });
        expect(view.somethingOffered).toBe(base.somethingOffered);
        expect(view.hasActions).toBe(base.hasActions);
        expect(view.sections).toBe(base.sections);
      }
    }
  });
});

describe('UM-2 §6.2: locked_feature', () => {
  it('+ TOP, Essentials owner (upgrade offered): the lock variant, TOP marked "needed", offered', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    const view = upgradeModalView(payload, LOCKED(TOP));
    expect(view).toMatchObject({ variant: 'locked_feature', headline: 'locked_feature', subheading: 'locked_feature' });
    expect(view.lockedPlan).toEqual({ planId: TOP, name: payload.plans!.find((choice) => choice.planId === TOP)!.name, offered: true });
    expect(highlighted(payload, LOCKED(TOP))).toEqual([expect.objectContaining({ planId: TOP, highlightReason: 'locked_feature', isRecommended: false })]);
  });

  it('AC-UM9: + TOP, open-ended Founding Partner: TOP marked although not offered, no button anywhere', async () => {
    const payload = await payloadFor({ planId: FOUNDING_PARTNER });
    const view = upgradeModalView(payload, LOCKED(TOP));
    expect(view.lockedPlan).toMatchObject({ planId: TOP, offered: false });
    expect(highlighted(payload, LOCKED(TOP)).map((entry) => entry.planId)).toEqual([TOP]);
    expect(view.columns.every((entry) => !BUTTON_ACTIONS.includes(entry.action))).toBe(true);
  });

  it('O-1: + LOWER for a trial marks LOWER, not TOP (the Recommended rule is replaced; one column only)', async () => {
    const payload = await payloadFor({ planId: TRIAL });
    // Non-vacuity: under settings, TOP is the recommended column.
    expect(upgradeModalView(payload).columns.find((entry) => entry.isRecommended)?.planId).toBe(TOP);
    expect(highlighted(payload, LOCKED(LOWER)).map((entry) => [entry.planId, entry.highlightReason])).toEqual([[LOWER, 'locked_feature']]);
    expect(upgradeModalView(payload, LOCKED(LOWER)).columns.some((entry) => entry.isRecommended)).toBe(false);
  });

  it.each([
    ['the current tier', async () => ({ payload: await payloadFor({ billingRow: payingRow(LOWER) }), planId: LOWER })],
    ['an id not in the table', async () => ({ payload: await payloadFor({ planId: TRIAL }), planId: 'not-a-plan' })],
    ['a payload with no comparison', async () => ({ payload: { ...(await payloadFor({ planId: TRIAL })), comparison: null }, planId: TOP })],
  ])('on %s → the settings copy and the normal Recommended rule', async (_name, make) => {
    const { payload, planId } = await make();
    const view = upgradeModalView(payload, LOCKED(planId));
    const settings = upgradeModalView(payload);
    expect(view).toMatchObject({ variant: 'settings', subheading: 'default', lockedPlan: null, headline: settings.headline });
    expect(view.columns.map((entry) => entry.highlightReason)).toEqual(settings.columns.map((entry) => entry.highlightReason));
  });
});

describe('UM-2 §6.3: founding_partner (UM-FR9)', () => {
  it('Founding Partner with an end date (free_access + an offer): its copy, Recommended per amended UM-SA4', async () => {
    const payload = await payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays() });
    expect(payload.purchase?.endsFreeAccessOnPurchase).toBe('free_access');
    const view = upgradeModalView(payload, FP);
    expect(view).toMatchObject({ variant: 'founding_partner', headline: 'founding_partner', subheading: 'founding_partner', lockedPlan: null });
    expect(highlighted(payload, FP)).toEqual([expect.objectContaining({ planId: TOP, highlightReason: 'recommended' })]);
  });

  it.each([
    ['an open-ended Founding Partner (nothing offered)', { planId: FOUNDING_PARTNER }],
    ['a trial', { planId: TRIAL }],
    ['an Essentials owner', { billingRow: payingRow(LOWER) }],
  ] as const)('%s → the settings copy', async (_name, options) => {
    const payload = await payloadFor(options);
    expect(upgradeModalView(payload, FP)).toMatchObject({ variant: 'settings', subheading: 'default', headline: upgradeModalView(payload).headline });
  });

  it('AC-UM5: an open-ended Founding Partner reads "compare" with no button anywhere', async () => {
    const view = upgradeModalView(await payloadFor({ planId: FOUNDING_PARTNER }), FP);
    expect(view.headline).toBe('compare');
    expect(view.hasActions).toBe(false);
  });
});
