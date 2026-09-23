/**
 * The A-2 three-step contract: the ORDER, and the fact that step 0 never says
 * "not entitled".
 *
 * The order is the part worth testing hardest. Any implementation will refuse an
 * account that has nothing; only the right one refuses it for the most
 * actionable reason.
 */

import { fixtureConfig } from '@/lib/business-os/entitlements/__fixtures__/fixtureSource';
import { championAccount, tierAccount, trialAccount, account } from '@/lib/business-os/entitlements/__fixtures__/accounts';
import { decide, failurePolicyFor, isRefusal, overlayFor } from '@/lib/business-os/entitlements/decide';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import type { EntitlementAccount } from '@/lib/business-os/entitlements/account';
import { CAPABILITIES } from '@/lib/business-os/entitlements/config/catalog';
import type { CapabilityDef, SurfaceKind } from '@/lib/business-os/entitlements/types';

const NOW = new Date('2026-09-22T00:00:00.000Z');
const config = fixtureConfig();

function snapshotFor(acct: EntitlementAccount | null) {
  return resolveEntitlements({ config, account: acct, overrides: [], addons: [], now: NOW });
}

function ask(acct: EntitlementAccount | null, capability: string, surfaceKind: SurfaceKind, extra: Record<string, unknown> = {}) {
  return decide({
    config,
    resolution: acct === null ? null : snapshotFor(acct),
    capability,
    request: { surfaceKind, ...extra },
    ...(extra.balance ? { balance: extra.balance as { sufficient: boolean } } : {}),
  });
}

/** A trial that ended, so the account is in grace. */
const inGrace = trialAccount('2026-09-05T00:00:00.000Z');
/** The same trial, long enough ago to be paused. */
const paused = trialAccount('2026-07-01T00:00:00.000Z');

describe('step 0 — no answer is never "no"', () => {
  it('an owner surface gets entitlement_unavailable, never not_entitled', () => {
    const decision = ask(null, 'chat.search', 'owner_write');
    expect(decision.outcome).toBe('entitlement_unavailable');
    expect(decision.outcome).not.toBe('not_entitled');
    expect(decision.lowestTier).toBeNull(); // no upgrade prompt during an outage
  });

  it("the business's own clients keep working (T-3)", () => {
    expect(ask(null, 'website.ai_site', 'public_business').outcome).toBe('allowed');
    expect(ask(null, 'booking.calendar_sync', 'public_self_service').outcome).toBe('allowed');
    expect(ask(null, 'payments.invoices', 'send:transactional:client').outcome).toBe('allowed');
  });

  it('marketing defers rather than sending on a guess', () => {
    expect(ask(null, 'marketing.lead_response', 'send:marketing')).toMatchObject({
      outcome: 'entitlement_unavailable',
      reason: 'unavailable_defer_marketing',
    });
  });

  it('an anomalous account takes the same path as an unreadable one', () => {
    const decision = ask(account(), 'chat.search', 'owner_write');
    expect(decision.outcome).toBe('entitlement_unavailable');
    expect(decision.reason).toContain('no_assignment');
  });

  it('every audience/surface pair has a policy, and they are not all the same', () => {
    const outcomes = new Set<string>();
    for (const definition of Object.values(CAPABILITIES)) {
      for (const surface of ['owner_read', 'owner_ai', 'public_business', 'send:marketing'] as SurfaceKind[]) {
        outcomes.add(failurePolicyFor(definition as CapabilityDef, surface).outcome);
      }
    }
    expect([...outcomes].sort()).toEqual(['allowed', 'entitlement_unavailable']);
  });
});

describe('step a — entitlement', () => {
  it('refuses what the plan does not include, and names the upgrade', () => {
    expect(ask(tierAccount('basic'), 'chat.search', 'owner_read')).toMatchObject({
      outcome: 'not_entitled',
      lowestTier: 'pro',
      reason: 'not_in_plan',
    });
  });

  it('allows what it does include', () => {
    expect(ask(tierAccount('growth'), 'chat.marketing', 'owner_write').outcome).toBe('allowed');
  });

  it('compares the requested quantity, not just presence', () => {
    expect(ask(tierAccount('basic'), 'ai.actions', 'owner_ai', { requested: { perMonth: 500 } })).toMatchObject({
      outcome: 'not_entitled',
      lowestTier: 'growth',
    });
    expect(ask(tierAccount('basic'), 'ai.actions', 'owner_ai', { requested: { perMonth: 50 } }).outcome).toBe('allowed');
  });

  it('refuses a not_built capability as not_built, not as "upgrade"', () => {
    const decision = ask(championAccount(), 'marketing.mass_email', 'owner_write');
    expect(decision).toMatchObject({ outcome: 'not_entitled', reason: 'not_built', lowestTier: null });
  });
});

describe('step b — state', () => {
  it('grace is read-only for the owner but open for their clients (B-9)', () => {
    expect(ask(inGrace, 'crm.core', 'owner_read').outcome).toBe('allowed');
    expect(ask(inGrace, 'crm.core', 'owner_write').outcome).toBe('read_only');
    expect(ask(inGrace, 'website.ai_site', 'public_business').outcome).toBe('allowed_with_warning');
    expect(ask(inGrace, 'marketing.lead_response', 'send:marketing').outcome).toBe('suppressed');
  });

  it('paused closes the shop front and leaves the till open (B-11)', () => {
    expect(ask(paused, 'website.ai_site', 'public_business').outcome).toBe('paused_public');
    expect(ask(paused, 'payments.invoices', 'public_self_service').outcome).toBe('allowed');
    expect(ask(paused, 'payments.invoices', 'send:transactional:client').outcome).toBe('allowed');
    expect(ask(paused, 'intake.reminders', 'send:transactional:system').outcome).toBe('suppressed');
  });

  it('a per-send exception beats the state table (Q-B4)', () => {
    const withException = {
      ...config,
      lifecycle: {
        ...config.lifecycle,
        sendPolicyOverrides: { 'intake.request': { paused: 'allow' as const } },
      },
    };

    expect(overlayFor(config, 'paused', 'send:transactional:system', 'intake.request')).toBe('suppress');
    expect(overlayFor(withException, 'paused', 'send:transactional:system', 'intake.request')).toBe('allow');
    // …and only for that send.
    expect(overlayFor(withException, 'paused', 'send:transactional:system', 'payments.reminder')).toBe('suppress');
  });
});

describe('the order is the contract', () => {
  it('a Basic account in grace is told the ENTITLEMENT answer first', () => {
    // Both would refuse. `not_entitled` is the actionable one: telling them the
    // account is read-only implies that paying would give them `chat.search`.
    const basicInGrace = tierAccount('basic', {
      tierExpiresAt: '2026-09-20T00:00:00.000Z',
      cohort: 'trial',
      onboardingStartedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(snapshotFor(basicInGrace).state).toBe('grace');
    expect(ask(basicInGrace, 'chat.search', 'owner_write').outcome).toBe('not_entitled');
    // …while something the plan DOES include gets the state answer.
    expect(ask(basicInGrace, 'crm.core', 'owner_write').outcome).toBe('read_only');
  });

  it('state is answered before the balance', () => {
    const decision = decide({
      config,
      resolution: snapshotFor(inGrace),
      capability: 'ai.actions',
      request: { surfaceKind: 'owner_ai' },
      balance: { sufficient: false },
    });

    expect(decision.outcome).toBe('read_only');
  });
});

describe('step c — the allowance', () => {
  it('an exhausted allowance is limit_reached, carrying what to do instead', () => {
    const decision = decide({
      config,
      resolution: snapshotFor(championAccount()),
      capability: 'ai.actions',
      request: { surfaceKind: 'owner_ai', cost: 1 },
      balance: { sufficient: false, remaining: 0 },
    });

    expect(decision).toMatchObject({
      outcome: 'limit_reached',
      reason: 'allowance_exhausted',
      // D-12: `ai.actions` is decided by the call site's audience, which is why
      // the behaviour travels with the decision instead of being looked up again.
      atLimit: CAPABILITIES['ai.actions'].atLimit,
      remaining: 0,
    });
  });

  it('a sufficient balance allows', () => {
    const decision = decide({
      config,
      resolution: snapshotFor(championAccount()),
      capability: 'ai.actions',
      request: { surfaceKind: 'owner_ai' },
      balance: { sufficient: true },
    });
    expect(decision.outcome).toBe('allowed');
  });

  it('a non-metered capability is never limit_reached', () => {
    const decision = decide({
      config,
      resolution: snapshotFor(championAccount()),
      capability: 'crm.core',
      request: { surfaceKind: 'owner_write' },
      balance: { sufficient: false },
    });
    expect(decision.outcome).toBe('allowed');
  });
});

describe('the decision object', () => {
  it('always carries enough to build a log line and an API error (FR-16)', () => {
    const decision = ask(tierAccount('basic'), 'chat.search', 'owner_write');
    expect(Object.keys(decision).sort()).toEqual(
      expect.arrayContaining(['capability', 'lowestTier', 'outcome', 'reason', 'state', 'surfaceKind'])
    );
  });

  it('isRefusal is true for everything except the two allow outcomes', () => {
    expect(isRefusal(ask(championAccount(), 'crm.core', 'owner_write'))).toBe(false);
    expect(isRefusal(ask(inGrace, 'website.ai_site', 'public_business'))).toBe(false);
    expect(isRefusal(ask(tierAccount('basic'), 'chat.search', 'owner_write'))).toBe(true);
    expect(isRefusal(ask(paused, 'website.ai_site', 'public_business'))).toBe(true);
  });

  it('an unknown capability is unavailable, not entitled and not an upgrade prompt', () => {
    expect(ask(championAccount(), 'chat.telepathy', 'owner_write')).toMatchObject({
      outcome: 'entitlement_unavailable',
      reason: 'unknown_capability',
    });
  });
});
