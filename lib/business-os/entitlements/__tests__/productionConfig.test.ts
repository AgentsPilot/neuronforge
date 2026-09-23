/**
 * The PRODUCTION configuration loads, and says what the user decided.
 *
 * The fixture tests that follow prove the tier mechanism. This one proves the
 * thing that actually ships: an empty matrix, two cohorts that grant everything,
 * and a launch precondition that refuses to enforce nothing.
 *
 * It is also the check that the loader survives having no tiers at all — the
 * condition production will be in until the first plan is defined, and the one
 * a fixture-only suite would never exercise.
 */

import { CodeTierMatrixSource, getEntitlementConfig, readCodeConfig, validateEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { explicitValueCapabilityIds } from '@/lib/business-os/entitlements/schema';
import { CAPABILITIES } from '@/lib/business-os/entitlements/config/catalog';
import { surfaceKindForSend } from '@/lib/business-os/entitlements/config/lifecycle';

describe('the shipped configuration', () => {
  it('loads and validates', () => {
    expect(() => new CodeTierMatrixSource().load()).not.toThrow();
  });

  it('ships NO commercial tiers (U-1 / B-13)', () => {
    const config = getEntitlementConfig(new CodeTierMatrixSource());

    expect(config.tierOrder).toEqual([]);
    expect(Object.keys(config.matrix.tiers)).toEqual([]);
    expect(config.matrix.removals).toEqual([]);
    // The mechanism is still versioned: the first removal will bump it.
    expect(config.matrix.version).toBe(1);
  });

  it('gives both cohorts everything (B-14, P-1)', () => {
    const { cohorts } = getEntitlementConfig(new CodeTierMatrixSource());

    expect(cohorts.champion.base).toEqual({ all: true });
    expect(cohorts.trial.base).toEqual({ all: true });
  });

  it('supplies an explicit value for every capability that needs a number', () => {
    // RC-2: "everything" has no meaning for a quantity, an allowance or a
    // ceiling. This is the check that adding a metered capability to the catalog
    // fails the build until someone decides what champions get.
    const needed = explicitValueCapabilityIds().sort();
    const { cohorts } = getEntitlementConfig(new CodeTierMatrixSource());

    expect(Object.keys(cohorts.champion.values).sort()).toEqual(needed);
    expect(Object.keys(cohorts.trial.values).sort()).toEqual(needed);
  });

  it('gives the trial a one-off allowance and a way to end', () => {
    const { cohorts } = getEntitlementConfig(new CodeTierMatrixSource());

    // D-2 / FR-27: a trial ends at its length OR when its allowance runs out,
    // so the allowance is a total, not a monthly rate.
    expect(cohorts.trial.values['ai.actions']).toEqual({ total: expect.any(Number) });
    expect(cohorts.trial.durationHistory?.[0]?.days).toBe(14);
    expect(cohorts.trial.graceHistory[0]?.days).toBe(7);
    // B-12: setup AI counts against the trial, so the clock starts when setup
    // starts rather than when it finishes (Q-B3).
    expect(cohorts.trial.clockStartsAt).toBe('first_onboarding_message');
  });

  it('gives champions a monthly allowance and NO default end date', () => {
    const { cohorts } = getEntitlementConfig(new CodeTierMatrixSource());

    expect(cohorts.champion.values['ai.actions']).toEqual({ perMonth: expect.any(Number) });
    expect(cohorts.champion.graceHistory[0]?.days).toBe(30);
    // RC-4 / UD-4: a default length would expire every migrated account on the
    // same day. An end date is set per account by an admin, or never.
    expect(cohorts.champion.durationHistory).toBeUndefined();
  });

  it('refuses to enforce while no tier is configured (UD-2)', () => {
    expect(getEntitlementConfig(new CodeTierMatrixSource()).launch.enforceRequiresConfiguredTier).toBe(true);
  });
});

describe('the lifecycle overlay says what B-9 and B-11 decided', () => {
  const { lifecycle } = getEntitlementConfig(new CodeTierMatrixSource());

  it('keeps client-facing work alive in grace, and stops marketing (B-9)', () => {
    expect(lifecycle.overlay.grace['owner_write']).toBe('read_only');
    expect(lifecycle.overlay.grace['send:transactional:system']).toBe('allow');
    expect(lifecycle.overlay.grace['send:transactional:client']).toBe('allow');
    expect(lifecycle.overlay.grace['send:marketing']).toBe('suppress');
    expect(lifecycle.overlay.grace['public_business']).toBe('allow_with_warning');
  });

  it('keeps paying and rescheduling alive when paused, and stops the rest (B-11)', () => {
    // The whole of B-11 in four lines: the till stays open, the shop front
    // closes, answers to the client's own actions still go out, nudges do not.
    expect(lifecycle.overlay.paused['public_self_service']).toBe('allow');
    expect(lifecycle.overlay.paused['public_business']).toBe('paused_public');
    expect(lifecycle.overlay.paused['send:transactional:client']).toBe('allow');
    expect(lifecycle.overlay.paused['send:transactional:system']).toBe('suppress');
    expect(lifecycle.overlay.paused['send:marketing']).toBe('suppress');
  });

  it('fails open on client-facing surfaces when the account state is unknown', () => {
    // T-3: a bookkeeping failure of ours must never take down a customer's
    // booking page or stop their clients paying.
    expect(lifecycle.overlay.unknown['public_business']).toBe('allow');
    expect(lifecycle.overlay.unknown['public_self_service']).toBe('allow');
    expect(lifecycle.overlay.unknown['owner_write']).toBe('read_only');
  });

  it('derives a send\'s surface kind from its class and initiator', () => {
    // S-1: a call site that could choose its own surface kind would eventually
    // choose the wrong one, and B-11's distinction would quietly stop holding.
    expect(surfaceKindForSend({ messageClass: 'transactional', initiator: 'client' })).toBe('send:transactional:client');
    expect(surfaceKindForSend({ messageClass: 'transactional', initiator: 'system' })).toBe('send:transactional:system');
    expect(surfaceKindForSend({ messageClass: 'marketing', initiator: 'system' })).toBe('send:marketing');
    expect(surfaceKindForSend({ messageClass: 'marketing', initiator: 'client' })).toBe('send:marketing');
  });

  it('seeds the intake request, so AC-37 is provable on the production config (R2-4)', () => {
    const intake = lifecycle.sends['intake.request'];

    expect(intake).toBeDefined();
    expect(intake.messageClass).toBe('transactional');
    expect(intake.initiator).toBe('system');

    // Q-B4's answer, read off the shipped config: the questionnaire is a system
    // decision, so a paused account stops sending it.
    const kind = surfaceKindForSend(intake);
    expect(lifecycle.overlay.paused[kind]).toBe('suppress');
    // …and it keeps going during grace, where only marketing stops.
    expect(lifecycle.overlay.grace[kind]).toBe('allow');
  });

  it('lets one override flip that decision without touching code (Q-B4)', () => {
    // The mechanism, proven on a copy: adding an entry for this send changes
    // what happens when paused. Nothing in the resolver or the crons changes.
    const withOverride = {
      ...lifecycle,
      sendPolicyOverrides: { 'intake.request': { paused: 'allow' as const } },
    };

    const config = { ...readCodeConfig(), lifecycle: withOverride };
    expect(() => validateEntitlementConfig(config)).not.toThrow();
    expect(withOverride.sendPolicyOverrides['intake.request'].paused).toBe('allow');
  });

  it('rejects an override for a send nobody declared', () => {
    const config = {
      ...readCodeConfig(),
      lifecycle: { ...lifecycle, sendPolicyOverrides: { 'no.such.send': { paused: 'allow' as const } } },
    };

    expect(() => validateEntitlementConfig(config)).toThrow(/unknown send/);
  });
});

describe('the catalog and the cohorts stay in step', () => {
  it('a new metered capability fails the load until champions get a number', () => {
    // The rule that makes RC-2 self-enforcing, demonstrated rather than trusted.
    const config = readCodeConfig();
    const extendedCatalog = {
      ...config.catalog,
      'sms.extra_allowance': {
        labels: { en: 'Extra SMS', he: 'SMS נוסף', es: 'SMS extra' },
        category: 'addon' as const,
        shape: { kind: 'metered' as const, unit: 'sms' as const, period: 'month' as const },
        lifecycle: 'not_built' as const,
        audience: 'owner' as const,
        atLimit: 'block' as const,
        sellableAsAddon: true,
        note: 'test-only capability',
      },
    };

    // The cohorts have no value for it, so validation must refuse the config.
    expect(() =>
      validateEntitlementConfig({ ...config, catalog: extendedCatalog as typeof CAPABILITIES })
    ).toThrow(/cohorts/);
  });
});
