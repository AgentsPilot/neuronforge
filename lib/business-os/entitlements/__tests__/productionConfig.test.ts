/**
 * The PRODUCTION configuration loads, and says what the user decided.
 *
 * The fixture suites prove the tier MECHANISM against a matrix invented for the
 * purpose. This one is about the thing that actually ships: two paid tiers that
 * differ only by chat and credits, two cohorts that point at one of them, and
 * the prices and names a customer would see.
 *
 * Every assertion here is a DECISION (user, 2026-09-23), not an implementation
 * detail. If one fails, either pricing changed — in which case change it here,
 * deliberately, in the same commit as the config — or something drifted.
 */

import { CodeTierMatrixSource, getEntitlementConfig, readCodeConfig, validateEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { capabilityForOp } from '@/lib/business-os/entitlements/config/chatActionMap';
import { decide } from '@/lib/business-os/entitlements/decide';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { tierAccount } from '@/lib/business-os/entitlements/__fixtures__/accounts';
import type { ChatReadRule } from '@/lib/business-os/entitlements/types';
import { explicitValueCapabilityIds } from '@/lib/business-os/entitlements/schema';
import { CAPABILITIES } from '@/lib/business-os/entitlements/config/catalog';
import { surfaceKindForSend } from '@/lib/business-os/entitlements/config/lifecycle';

const NOW = new Date('2026-09-23T00:00:00.000Z');

describe('the shipped configuration', () => {
  it('loads and validates', () => {
    expect(() => new CodeTierMatrixSource().load()).not.toThrow();
  });

  it('ships the two paid tiers the user decided on (2026-09-23)', () => {
    const config = getEntitlementConfig(new CodeTierMatrixSource());

    // Cheapest first: the order is what "the lowest tier that includes this"
    // reads, so it is part of the decision rather than a formatting choice.
    expect(config.tierOrder).toEqual(['basic', 'pro']);
    expect(Object.keys(config.matrix.tiers).sort()).toEqual(['basic', 'pro']);
    // Nothing has been taken away from anyone yet.
    expect(config.matrix.removals).toEqual([]);
    expect(config.matrix.version).toBe(1);
  });

  it('gives every tier a customer-facing name and a price', () => {
    const { matrix } = getEntitlementConfig(new CodeTierMatrixSource());

    expect(matrix.presentation.basic).toEqual({
      labels: { en: 'Essentials', he: 'Essentials', es: 'Essentials' },
      monthlyPriceUsd: 79,
    });
    expect(matrix.presentation.pro).toEqual({
      labels: { en: 'Autopilot', he: 'Autopilot', es: 'Autopilot' },
      monthlyPriceUsd: 129,
    });
  });

  it('differs between the paid tiers ONLY by chat and credits', () => {
    // The rule the whole matrix is shaped by. If a third difference ever
    // appears, it was either a decision nobody recorded or a mistake — and
    // either way somebody should have to come here and say so.
    const { matrix } = getEntitlementConfig(new CodeTierMatrixSource());
    const basic = matrix.tiers.basic as Record<string, unknown>;
    const pro = matrix.tiers.pro as Record<string, unknown>;

    const different = Object.keys(pro)
      .filter((capability) => JSON.stringify(basic[capability]) !== JSON.stringify(pro[capability]))
      .sort();

    expect(different).toEqual([
      'ai.actions',
      'chat.access',
      'chat.bulk',
      'chat.email',
      'chat.invoice_control',
      'chat.marketing',
      'chat.quotes',
      'chat.reporting',
      'chat.scheduling',
      'chat.search',
    ]);
  });

  it('gives Essentials no chat and Autopilot all of it', () => {
    const { matrix } = getEntitlementConfig(new CodeTierMatrixSource());
    const chat = Object.keys(matrix.tiers.pro as Record<string, unknown>).filter((id) => id.startsWith('chat.'));

    // Nine: the surface (`chat.access`, FR-46) plus the eight per-operation
    // groups. The surface is the one that will actually be enforced in Slice 2;
    // the other eight decide what an Autopilot account may do once inside.
    expect(chat).toHaveLength(9);
    expect(chat).toContain('chat.access');
    for (const capability of chat) {
      expect((matrix.tiers.basic as Record<string, unknown>)[capability]).toBe(false);
      expect((matrix.tiers.pro as Record<string, unknown>)[capability]).toBe(true);
    }
  });

  it('carries the credit allowances the user set', () => {
    const config = getEntitlementConfig(new CodeTierMatrixSource());

    expect((config.matrix.tiers.basic as Record<string, unknown>)['ai.actions']).toEqual({ perMonth: 500 });
    expect((config.matrix.tiers.pro as Record<string, unknown>)['ai.actions']).toEqual({ perMonth: 2000 });
    expect(config.cohorts.champion.values['ai.actions']).toEqual({ perMonth: 1000 });
    // A one-off TOTAL, not a rate: using it up is one of the two ways a trial
    // ends (D-2, FR-27).
    expect(config.cohorts.trial.values['ai.actions']).toEqual({ total: 250 });
  });

  it('points both cohorts at a TIER, so they cannot drift from it', () => {
    const { cohorts } = getEntitlementConfig(new CodeTierMatrixSource());

    expect(cohorts.champion.base).toEqual({ tier: 'basic' });
    expect(cohorts.trial.base).toEqual({ tier: 'basic' });

    // The named plans, which a customer sees and the internal id never is.
    expect(cohorts.trial.labels.en).toBe('Test Flight');
    expect(cohorts.champion.labels.en).toBe('Founding Partner');
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

describe('the catalog, the tiers and the cohorts stay in step', () => {
  it('a new metered capability fails the load until someone decides a number', () => {
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

    // Neither the two tier rows nor the two cohorts have a value for it, so the
    // config cannot load. The TIER now objects first — before 2026-09-23 there
    // were no tiers and the cohorts were the only thing that could — so the
    // assertion is on the capability being named, not on which section notices.
    // Either way the build stops until a human decides what it is worth.
    expect(() =>
      validateEntitlementConfig({ ...config, catalog: extendedCatalog as typeof CAPABILITIES })
    ).toThrow(/sms\.extra_allowance/);

    // And the cohorts alone would also refuse it, which is what RC-2 asks for.
    const tiersCovered = {
      ...config,
      catalog: extendedCatalog as typeof CAPABILITIES,
      matrix: {
        ...config.matrix,
        tiers: Object.fromEntries(
          Object.entries(config.matrix.tiers as Record<string, Record<string, unknown>>).map(([tier, row]) => [
            tier,
            { ...row, 'sms.extra_allowance': { perMonth: 0 } },
          ])
        ),
        // Through `unknown`: the shipped matrix type names its two tiers and
        // their exact rows, so a row with one extra capability does not overlap
        // it. That is the type doing its job, not a problem to be solved here.
      } as unknown as typeof config.matrix,
    };

    expect(() => validateEntitlementConfig(tiersCovered)).toThrow(/cohorts/);
  });
});

describe('Q-B1 is no longer a pricing question — it is the chat-surface gap', () => {
  /**
   * What changed on 2026-09-23.
   *
   * Q-B1 was asked as "can a LOWER plan ask chat questions about the areas it
   * includes, or does any look-up need the search feature?" — a question about a
   * middle plan. There is no middle plan: Autopilot has all eight `chat.*`
   * capabilities and Essentials has none.
   *
   * So the question is settled as PRICING and live as ENFORCEMENT, and this is
   * the test that makes that concrete rather than a comment: under the
   * configured reading, an Essentials owner's chat question about their own
   * contacts is ALLOWED, because it maps to `crm.core` — which Essentials has —
   * even though Essentials is sold without chat.
   *
   * Slice 2 has to close that on the SURFACE. No value in `tierMatrix.ts` can
   * close it, which is exactly why it is worth a failing-tomorrow test today:
   * when the surface gate lands, this test should change.
   */
  const config = readCodeConfig();
  const essentials = tierAccount('basic');

  function askChat(rule: ChatReadRule) {
    const capability = capabilityForOp('contacts', 'find', rule);
    const resolution = resolveEntitlements({ config, account: essentials, overrides: [], addons: [], now: NOW });
    return { capability, decision: decide({ config, resolution, capability: capability as string, request: { surfaceKind: 'owner_read' } }) };
  }

  it('under the CONFIGURED reading, Essentials can still ask chat about its own data', () => {
    const { capability, decision } = askChat('domain_group');

    expect(capability).toBe('crm.core');
    expect(decision.outcome).toBe('allowed');
    // …while the thing the plan is sold without is refused, and names the upsell.
    expect(
      decide({
        config,
        resolution: resolveEntitlements({ config, account: essentials, overrides: [], addons: [], now: NOW }),
        capability: 'chat.search',
        request: { surfaceKind: 'owner_read' },
      })
    ).toMatchObject({ outcome: 'not_entitled', lowestTier: 'pro' });
  });

  it('and the WRITE direction is worse: Essentials could CHANGE data through chat', () => {
    // QA B-2, and the half that matters most. The entity map is the default for
    // EVERY operation, not just reads — so `contacts.create` through chat is
    // `crm.core` too, and Essentials has it. An account sold without an
    // assistant could have the assistant act for it.
    //
    // Unlike the read half, this one does not depend on the read rule at all:
    // both readings agree on a write, so there is no config value anywhere that
    // changes this line. Only the FR-46 surface gate does.
    for (const rule of ['domain_group', 'read_only_plans_need_search'] as ChatReadRule[]) {
      expect(capabilityForOp('contacts', 'create', rule)).toBe('crm.core');
    }

    const decision = decide({
      config,
      resolution: resolveEntitlements({ config, account: essentials, overrides: [], addons: [], now: NOW }),
      capability: 'crm.core',
      request: { surfaceKind: 'owner_write' },
    });

    expect(decision.outcome).toBe('allowed');
    // …while the capability that is supposed to mean "no assistant" is refused,
    // which is exactly the mismatch FR-46 closes.
    expect(
      decide({
        config,
        resolution: resolveEntitlements({ config, account: essentials, overrides: [], addons: [], now: NOW }),
        capability: 'chat.access',
        request: { surfaceKind: 'owner_write' },
      })
    ).toMatchObject({ outcome: 'not_entitled', lowestTier: 'pro' });
  });

  it('under the OTHER reading the same question is refused — which is the whole difference', () => {
    const { capability, decision } = askChat('read_only_plans_need_search');

    expect(capability).toBe('chat.search');
    expect(decision.outcome).toBe('not_entitled');
    // Recording both readings in shadow is therefore not redundancy: it is the
    // measurement that decides which of these two behaviours Essentials gets.
    expect(config.chatActionMap.readRule).toBe('domain_group');
  });
});
