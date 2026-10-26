/**
 * @jest-environment node
 *
 * `upgradeModalView` (upgrade modal UM-1a, workplan §5.2a, §9.4): one case per
 * account state, on REAL payloads (`upgradeModalPayloads`), so the rules are
 * proven against what the server sends rather than a hand-made shape.
 *
 * What is pinned:
 *   - `sections` is the server's array BY IDENTITY (C-21);
 *   - columns follow `comparison.planIds`, joined to `plans` by id;
 *   - "Your plan" only for a tier, by id equality (C-22);
 *   - the action slot: the server's offer first, "Current plan" only when
 *     nothing is offered for the current column (C-22);
 *   - recommended per amended UM-SA4 (UM-BQ4): the last shown plan that is offered and not current;
 *   - the headline, with W-1 (the own plan offered is not "something to choose").
 */

import { upgradeModalView } from '@/components/business-os/settings/upgradeModalView';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';

import { FOUNDING_PARTNER, LOWER, TOP, TRIAL, inSixtyDays, payingRow, payloadFor } from './upgradeModalPayloads';

const column = (payload: PlanPayload, planId: string) => {
  const found = upgradeModalView(payload).columns.find((entry) => entry.planId === planId);
  if (!found) throw new Error(`no column for ${planId}`);
  return found;
};


describe('C-21: the table is the server’s', () => {
  it('sections are returned by identity, and the columns follow comparison.planIds', async () => {
    const payload = await payloadFor();
    const view = upgradeModalView(payload);
    expect(view.available).toBe(true);
    expect(view.sections).toBe(payload.comparison!.sections);
    expect(view.columns.map((entry) => entry.planId)).toEqual(payload.comparison!.planIds);
    for (const entry of view.columns) {
      const choice = payload.plans!.find((plan) => plan.planId === entry.planId)!;
      expect(entry.name).toBe(choice.name);
      expect(entry.monthlyPriceUsd).toBe(choice.monthlyPriceUsd);
    }
  });

  it('a reversed planIds order is kept as sent (the UI never re-orders)', async () => {
    const payload = await payloadFor();
    const reversed = [...payload.comparison!.planIds].reverse();
    const view = upgradeModalView({ ...payload, comparison: { ...payload.comparison!, planIds: reversed } });
    expect(view.columns.map((entry) => entry.planId)).toEqual(reversed);
  });

  it.each([
    ['comparison: null', (p: PlanPayload) => ({ ...p, comparison: null })],
    ['no comparison key (an older payload)', (p: PlanPayload) => {
      const rest: PlanPayload = { ...p };
      delete rest.comparison;
      return rest;
    }],
    ['empty planIds', (p: PlanPayload) => ({ ...p, comparison: { ...p.comparison!, planIds: [] } })],
    ['a planId missing from plans', (p: PlanPayload) => ({ ...p, comparison: { ...p.comparison!, planIds: [...p.comparison!.planIds, 'unknown-plan'] } })],
  ])('%s → not available, no columns, no sections', async (_name, mutate) => {
    const view = upgradeModalView(mutate(await payloadFor()));
    expect(view.available).toBe(false);
    expect(view.columns).toEqual([]);
    expect(view.sections).toEqual([]);
  });
});

describe('per account state (§9.4)', () => {
  it('Trial: no current column, both plans offered (slot empty in UM-1a), TOP recommended (UM-BQ4), headline choose', async () => {
    const payload = await payloadFor({ planId: TRIAL });
    const view = upgradeModalView(payload);
    expect(payload.kind).not.toBe('tier');
    expect(view.columns.some((entry) => entry.isCurrent)).toBe(false);
    // UM-1b §13: 'offered' is split by the server's offer kind; a trial chooses.
    expect(view.columns.every((entry) => entry.action === 'choose')).toBe(true);
    expect(view.hasActions).toBe(true);
    // UM-BQ4: the top plan, although the server's nextPlanUp for a trial is the lower one.
    expect(column(payload, TOP).isRecommended).toBe(true);
    expect(column(payload, LOWER).isRecommended).toBe(false);
    expect(view.headline).toBe('choose');
    expect(view.somethingOffered).toBe(true);
  });

  it('UM-BQ4: the top plan not offered → the highest offered plan (LOWER) is recommended', async () => {
    const base = await payloadFor({ planId: TRIAL });
    const payload: PlanPayload = { ...base, purchase: { ...base.purchase!, offer: { kind: 'choose', tiers: [LOWER] } } };
    expect(column(payload, LOWER).isRecommended).toBe(true);
    expect(column(payload, TOP).isRecommended).toBe(false);
  });

  it('UM-BQ4: nextPlanUp naming LOWER while TOP is offered → TOP (nextPlanUp no longer decides)', async () => {
    const base = await payloadFor({ planId: TRIAL });
    expect(base.purchase?.offer).toEqual({ kind: 'choose', tiers: expect.arrayContaining([TOP]) });
    const payload: PlanPayload = { ...base, nextPlanUp: { ...base.nextPlanUp!, planId: LOWER } };
    expect(column(payload, TOP).isRecommended).toBe(true);
    expect(column(payload, LOWER).isRecommended).toBe(false);
  });

  it('Founding Partner, no end date: no current column, no ribbon, nothing offered, headline compare', async () => {
    const payload = await payloadFor({ planId: FOUNDING_PARTNER });
    expect(payload.purchase?.offer.kind).toBe('none');
    const view = upgradeModalView(payload);
    expect(view.columns.some((entry) => entry.isCurrent || entry.isRecommended)).toBe(false);
    expect(view.columns.every((entry) => entry.action === 'none')).toBe(true);
    expect(view.headline).toBe('compare');
    expect(view.somethingOffered).toBe(false);
  });

  it('Founding Partner with an end date: no current column, TOP recommended (UM-BQ4), headline choose', async () => {
    const payload = await payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays() });
    const view = upgradeModalView(payload);
    expect(view.columns.some((entry) => entry.isCurrent)).toBe(false);
    expect(column(payload, TOP).isRecommended).toBe(true);
    expect(column(payload, LOWER).isRecommended).toBe(false);
    expect(view.headline).toBe('choose');
  });

  it('Essentials, renewing: "Your plan" with the Current plan label, the plan above recommended and offered, headline choose', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    expect(payload.purchase?.upgrade?.tiers).toContain(TOP);
    const view = upgradeModalView(payload);
    expect(column(payload, LOWER)).toMatchObject({ isCurrent: true, isRecommended: false, action: 'current_label' });
    expect(column(payload, TOP)).toMatchObject({ isCurrent: false, isRecommended: true, action: 'upgrade', ownPlanNote: null });
    expect(view.headline).toBe('choose');
  });

  it('Essentials, cancelling: whatever the server sends for upgrade decides the ribbon and headline', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER, { cancelAtPeriodEnd: true }) });
    const view = upgradeModalView(payload);
    const offered = (payload.purchase?.upgrade?.tiers ?? []).includes(TOP);
    expect(column(payload, TOP).isRecommended).toBe(offered);
    expect(view.headline).toBe(offered ? 'choose' : 'compare');
    // Both branches, regardless of today's server answer.
    const withoutUpgrade = upgradeModalView({ ...payload, purchase: { ...payload.purchase!, upgrade: null } });
    expect(withoutUpgrade.columns.some((entry) => entry.isRecommended)).toBe(false);
    expect(withoutUpgrade.headline).toBe('compare');
    const withUpgrade = upgradeModalView({ ...payload, purchase: { ...payload.purchase!, upgrade: { tiers: [TOP] } } });
    expect(withUpgrade.headline).toBe('choose');
  });

  it('Autopilot, renewing: "Your plan" + label, no ribbon, headline top_plan, the lower plan not "coming soon"', async () => {
    const payload = await payloadFor({ planId: TOP, billingRow: payingRow(TOP) });
    const view = upgradeModalView(payload);
    expect(column(payload, TOP)).toMatchObject({ isCurrent: true, action: 'current_label' });
    expect(view.columns.some((entry) => entry.isRecommended)).toBe(false);
    expect(view.headline).toBe('top_plan');
    expect(column(payload, LOWER)).toMatchObject({ comingSoon: false, action: 'none' });
  });

  it('C-22 / W-1: an admin-assigned tier offered only its own plan: "Your plan", the slot (not the label), headline top_plan', async () => {
    const payload = await payloadFor({ planId: TOP, buyable: [TOP] });
    expect(payload.purchase?.offer).toEqual({ kind: 'choose', tiers: [TOP] });
    const view = upgradeModalView(payload);
    expect(column(payload, TOP)).toMatchObject({ isCurrent: true, isRecommended: false, action: 'pay_for', ownPlanNote: 'choose' });
    expect(view.somethingOffered).toBe(false);
    expect(view.headline).toBe('top_plan');
  });

  it('W-1: an admin-assigned lower tier offered only its own plan reads compare, not choose', async () => {
    const payload = await payloadFor({ planId: LOWER, buyable: [LOWER] });
    const view = upgradeModalView(payload);
    expect(column(payload, LOWER).action).toBe('pay_for');
    // "See plans": there IS a button (its own plan's "Pay for"), although nothing else is offered.
    expect(view.hasActions).toBe(true);
    expect(view.somethingOffered).toBe(false);
    expect(view.headline).toBe('compare');
  });

  it('purchase: null → nothing offered, no ribbon, no label slot taken by an offer', async () => {
    const payload = { ...(await payloadFor()), purchase: null };
    const view = upgradeModalView(payload);
    expect(view.columns.some((entry) => entry.isRecommended)).toBe(false);
    expect(column(payload, LOWER).action).toBe('current_label');
    expect(view.headline).toBe('compare');
  });

  it('nextPlanUp not available to buy → "coming soon" and the server reason on that column only (SA Q-1)', async () => {
    const base = await payloadFor({ billingRow: payingRow(LOWER) });
    const reason = { key: 'plan.next.unavailable_reason_probe' };
    const nextId = base.nextPlanUp!.planId;
    const payload: PlanPayload = {
      ...base,
      plans: base.plans!.map((choice) => (choice.planId === nextId ? { ...choice, availableToBuy: false } : choice)),
      nextPlanUp: { ...base.nextPlanUp!, availableToBuy: false, actionUnavailableBecause: reason },
      // As the server would send it: a plan that cannot be bought is not offered as an upgrade.
      purchase: { ...base.purchase!, upgrade: null },
    };
    expect(column(payload, nextId)).toMatchObject({ comingSoon: true, unavailableBecause: reason, action: 'none' });
    for (const entry of upgradeModalView(payload).columns.filter((c) => c.planId !== nextId)) {
      expect(entry).toMatchObject({ comingSoon: false, unavailableBecause: null });
    }
  });
});

describe('UM-1b: which button, by the server\'s offer (§4; SA Q-1, Q-3)', () => {
  it('precedence: a plan in both offer.tiers and upgrade.tiers is an upgrade (SA Q-3)', async () => {
    const base = await payloadFor({ planId: TRIAL });
    const payload: PlanPayload = { ...base, purchase: { ...base.purchase!, upgrade: { tiers: [TOP] } } };
    // Non-vacuity: TOP is in both offers.
    expect(payload.purchase!.offer).toMatchObject({ kind: 'choose' });
    expect(payload.purchase!.offer.kind === 'choose' && payload.purchase!.offer.tiers.includes(TOP)).toBe(true);
    expect(column(payload, TOP).action).toBe('upgrade');
    expect(column(payload, LOWER).action).toBe('choose');
  });

  it('SA Q-1: while choosing, a shown plan the server does not offer is "coming soon" (UM-FR3), with no action', async () => {
    const payload = await payloadFor({ planId: TRIAL, buyable: [LOWER] });
    expect(column(payload, TOP)).toMatchObject({ action: 'none', comingSoon: true });
    expect(column(payload, LOWER)).toMatchObject({ action: 'choose', comingSoon: false });
  });

  it('SA Q-1: outside the choose context, a plan on sale but not offered to you is NOT "coming soon"', async () => {
    const payload = await payloadFor({ planId: TOP, billingRow: payingRow(TOP) });
    expect(column(payload, LOWER)).toMatchObject({ action: 'none', comingSoon: false });
    expect(column(payload, TOP)).toMatchObject({ action: 'current_label', comingSoon: false });
    expect(upgradeModalView(payload).hasActions).toBe(false);
  });

  it('the current column never shows the chip, even when its plan cannot be bought', async () => {
    const base = await payloadFor({ planId: TOP, billingRow: payingRow(TOP) });
    const payload: PlanPayload = { ...base, plans: base.plans!.map((choice) => ({ ...choice, availableToBuy: false })) };
    expect(column(payload, TOP)).toMatchObject({ action: 'current_label', comingSoon: false });
  });

  it('ownPlanNote: an upgrade on the CURRENT column carries the upgrade note (plan payments Q-5)', async () => {
    const payload = await payloadFor({ planId: TOP, billingRow: payingRow(LOWER) });
    expect(payload.purchase?.upgrade).toEqual({ tiers: [TOP] });
    expect(column(payload, TOP)).toMatchObject({ isCurrent: true, action: 'upgrade', ownPlanNote: 'upgrade' });
  });
});

describe("LF-2 (live test 2026-10-20): a non-tier account's own plan is its own column", () => {
  it.each([
    ['trial', () => payloadFor({ planId: TRIAL }), TRIAL],
    ['Founding Partner, no end date', () => payloadFor({ planId: FOUNDING_PARTNER }), FOUNDING_PARTNER],
    ['Founding Partner, dated', () => payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays() }), FOUNDING_PARTNER],
  ] as const)('%s: ownColumn from the server (id) and the payload (name, Free); tier columns unchanged', async (_name, make, ownId) => {
    const payload = await make();
    const view = upgradeModalView(payload);
    expect(view.ownColumn).toEqual({ planId: ownId, name: payload.name, free: true });
    // The tier columns and the server's table are untouched (C-21).
    expect(view.columns.map((entry) => entry.planId)).toEqual(payload.comparison!.planIds);
    expect(view.sections).toBe(payload.comparison!.sections);
    expect(view.columns.some((entry) => entry.isCurrent)).toBe(false);
  });

  it('a tier account has no ownColumn: its plan is the column marked current', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    const view = upgradeModalView(payload);
    expect(view.ownColumn).toBeNull();
    expect(column(payload, LOWER).isCurrent).toBe(true);
  });

  it('the own column changes no action, offer or headline (the Founding Partner with no end date is still offered nothing)', async () => {
    const payload = await payloadFor({ planId: FOUNDING_PARTNER });
    const withOwn = upgradeModalView(payload);
    const old: PlanPayload = { ...payload, comparison: { ...payload.comparison!, current: null } };
    const without = upgradeModalView(old);
    expect(without.ownColumn).toBeNull();
    expect({ ...withOwn, ownColumn: null }).toEqual(without);
    expect(withOwn.hasActions).toBe(false);
  });

  it('only what the server sent: no `current` → no own column, even for a cohort', async () => {
    const payload = await payloadFor({ planId: TRIAL });
    const { current: _dropped, ...comparison } = payload.comparison!;
    expect(upgradeModalView({ ...payload, comparison }).ownColumn).toBeNull();
  });
});
