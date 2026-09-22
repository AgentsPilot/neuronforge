/**
 * AC-4 — moving a capability between plans is a ONE-LINE change.
 *
 * This is the claim the whole design exists to support (requirement §6.3): when
 * pricing changes, someone edits one value and ships. Not a route, not an
 * executor, not a cron, not a test.
 *
 * So the test does exactly that — takes the worked example from the requirement,
 * changes `chat.search` for Growth, and then measures TWO things:
 *
 *   1. the diff really is one leaf, and
 *   2. the config still validates, with the capability now assigned as changed.
 *
 * Measuring only the second would pass for a change that also touched five other
 * values; measuring only the first would pass for a change that broke the
 * config. Together they are the claim.
 */

import { FIXTURE_TIER_MATRIX } from '@/lib/business-os/entitlements/__fixtures__/exampleTierMatrix';
import { fixtureConfig } from '@/lib/business-os/entitlements/__fixtures__/fixtureSource';
import { validateEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { decide } from '@/lib/business-os/entitlements/decide';
import { lowestTierFor, resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { tierAccount } from '@/lib/business-os/entitlements/__fixtures__/accounts';

/** Every leaf of an object, as `path = json` strings. */
function leaves(value: unknown, path: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return [`${path.join('.')} = ${JSON.stringify(value)}`];
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, [...path, String(index)]));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leaves(child, [...path, key]));
}

describe('AC-4 — "search via chat" moves from Pro to Growth', () => {
  const before = FIXTURE_TIER_MATRIX;

  const after = JSON.parse(JSON.stringify(FIXTURE_TIER_MATRIX)) as typeof FIXTURE_TIER_MATRIX;
  // THE ONE LINE.
  (after.tiers.growth as Record<string, unknown>)['chat.search'] = true;

  it('is a single leaf difference', () => {
    const changed = leaves(after).filter((leaf) => !leaves(before).includes(leaf));

    expect(changed).toEqual(['tiers.growth.chat.search = true']);
  });

  it('still validates, with the new value in place', () => {
    const config = fixtureConfig({ matrix: after as unknown as EntitlementConfig['matrix'] });

    expect(() => validateEntitlementConfig(config)).not.toThrow();
    expect((config.matrix.tiers as Record<string, Record<string, unknown>>).growth['chat.search']).toBe(true);
    // Basic is untouched: the change is to one tier, not to "everything below
    // Pro".
    expect((config.matrix.tiers as Record<string, Record<string, unknown>>).basic['chat.search']).toBe(false);
  });

  it('needs no matching removal, because nobody loses anything (B-10)', () => {
    // Adding a capability to a tier applies to every account on that tier from
    // the release that ships it. Only a REMOVAL needs a ledger entry and a
    // version bump — the asymmetry is the point.
    expect(after.removals).toEqual([]);
    expect(after.version).toBe(before.version);
  });
});

describe('S1-T6a (SA C-1) — and the account actually gets it', () => {
  // The three assertions above measure the CONFIG. They would all pass if the
  // resolver ignored the matrix entirely, which is exactly the hole SA asked to
  // close: the claim is not "one line changes a file", it is "one line changes
  // what a customer can do".
  const after = JSON.parse(JSON.stringify(FIXTURE_TIER_MATRIX)) as typeof FIXTURE_TIER_MATRIX;
  (after.tiers.growth as Record<string, unknown>)['chat.search'] = true;

  const NOW = new Date('2026-09-22T00:00:00.000Z');
  const growthAccount = tierAccount('growth');

  it('a Growth account cannot search before the change', () => {
    const decision = decide({
      config: fixtureConfig(),
      resolution: resolveEntitlements({ config: fixtureConfig(), account: growthAccount, overrides: [], now: NOW }),
      capability: 'chat.search',
      request: { surfaceKind: 'owner_read' },
    });

    expect(decision).toMatchObject({ outcome: 'not_entitled', lowestTier: 'pro' });
  });

  it('the same account can search after it — with nothing else changed', () => {
    const config = fixtureConfig({ matrix: after as unknown as EntitlementConfig['matrix'] });
    const decision = decide({
      config,
      resolution: resolveEntitlements({ config, account: growthAccount, overrides: [], now: NOW }),
      capability: 'chat.search',
      request: { surfaceKind: 'owner_read' },
    });

    expect(decision.outcome).toBe('allowed');
    // And the cheapest tier that satisfies it has moved down, so an upgrade
    // prompt shown to a Basic account now names Growth rather than Pro.
    expect(lowestTierFor(config, 'chat.search')).toBe('growth');
  });

  it('a Basic account is unaffected in both directions', () => {
    const config = fixtureConfig({ matrix: after as unknown as EntitlementConfig['matrix'] });
    const decision = decide({
      config,
      resolution: resolveEntitlements({ config, account: tierAccount('basic'), overrides: [], now: NOW }),
      capability: 'chat.search',
      request: { surfaceKind: 'owner_read' },
    });

    expect(decision).toMatchObject({ outcome: 'not_entitled', lowestTier: 'growth' });
  });
});

describe('the same change in the other direction is NOT one line', () => {
  it('lowering a value without a removal entry leaves the matrix inconsistent with B-10', () => {
    // Expressed here as a plain observation — the snapshot test is what enforces
    // it — so that anyone reading the one-line claim sees its limit at the same
    // time: adding is one line, taking away is a decision.
    const after = JSON.parse(JSON.stringify(FIXTURE_TIER_MATRIX)) as typeof FIXTURE_TIER_MATRIX;
    (after.tiers.pro as Record<string, unknown>)['chat.bulk'] = false;

    const changed = leaves(after).filter((leaf) => !leaves(FIXTURE_TIER_MATRIX).includes(leaf));

    expect(changed).toEqual(['tiers.pro.chat.bulk = false']);
    // …and this is what the snapshot test refuses: a lowered value with no
    // removal recorded and no version bump.
    expect(after.removals).toEqual([]);
    expect(after.version).toBe(FIXTURE_TIER_MATRIX.version);
  });
});
