/**
 * The drift snapshot (T-11 / WC-19 / S-7).
 *
 * Two jobs:
 *
 *   1. Guard the SHIPPED config: if someone lowers a tier value without
 *      recording a removal and bumping the version, this goes red. Today the
 *      matrix is empty, so what it really guards is the cohort histories — which
 *      are exactly the values someone would be tempted to edit in place.
 *   2. Prove the comparison itself works, against the fixture matrix. A snapshot
 *      test that only ever compares an empty object with an empty object is a
 *      test that will still pass on the day it is needed and fail to do its job.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { CAPABILITIES } from '@/lib/business-os/entitlements/config/catalog';
import { COHORTS } from '@/lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';
import { TIER_MATRIX } from '@/lib/business-os/entitlements/config/tierMatrix';
import { FIXTURE_TIER_MATRIX } from '@/lib/business-os/entitlements/__fixtures__/exampleTierMatrix';
import { findDrift, rankValue } from '@/lib/business-os/entitlements/snapshot';
import type { EntitlementSnapshot } from '@/lib/business-os/entitlements/snapshot';
import type { CapabilityValue } from '@/lib/business-os/entitlements/types';

const snapshot = JSON.parse(
  readFileSync(join(process.cwd(), 'lib', 'business-os', 'entitlements', '__tests__', 'entitlements.snapshot.json'), 'utf8')
) as EntitlementSnapshot;

/** The shipped config in the shape the comparison takes. */
function currentConfig() {
  return {
    matrixVersion: TIER_MATRIX.version,
    tiers: TIER_MATRIX.tiers as Record<string, Record<string, CapabilityValue>>,
    removals: TIER_MATRIX.removals,
    histories: {
      trial: { duration: COHORTS.trial.durationHistory ?? [], grace: COHORTS.trial.graceHistory },
      champion: { grace: COHORTS.champion.graceHistory },
      subscription: { grace: LIFECYCLE_CONFIG.subscriptionGraceHistory },
    },
    catalog: CAPABILITIES,
  };
}

describe('the shipped configuration has not drifted', () => {
  it('matches the committed snapshot', () => {
    const findings = findDrift(snapshot, currentConfig());

    // If this fails, read the detail: it says whether the change takes something
    // away from existing subscribers (fix it) or is an addition (refresh the
    // snapshot with `npm run entitlements:snapshot`, and let the diff be the
    // record of the decision).
    expect(findings.map((finding) => `${finding.where}: ${finding.detail}`)).toEqual([]);
  });

  it('snapshots something worth snapshotting', () => {
    // With no tiers configured, the histories are the whole guard. If they were
    // empty too, the test above would be comparing nothing with nothing.
    expect(snapshot.histories.trial.duration.length).toBeGreaterThan(0);
    expect(snapshot.histories.champion.grace.length).toBeGreaterThan(0);
  });
});

describe('the comparison itself can fail — proven on the fixture', () => {
  const fixtureSnapshot: EntitlementSnapshot = {
    generated: '2026-09-22',
    matrixVersion: FIXTURE_TIER_MATRIX.version,
    tiers: FIXTURE_TIER_MATRIX.tiers as unknown as EntitlementSnapshot['tiers'],
    removals: [],
    histories: {},
  };

  function fixtureCurrent(mutate: (matrix: typeof FIXTURE_TIER_MATRIX) => void) {
    const matrix = JSON.parse(JSON.stringify(FIXTURE_TIER_MATRIX)) as typeof FIXTURE_TIER_MATRIX;
    mutate(matrix);
    return {
      matrixVersion: matrix.version,
      tiers: matrix.tiers as unknown as Record<string, Record<string, CapabilityValue>>,
      removals: matrix.removals,
      histories: {},
      catalog: CAPABILITIES,
    };
  }

  it('is quiet when nothing changed', () => {
    expect(findDrift(fixtureSnapshot, fixtureCurrent(() => {}))).toEqual([]);
  });

  it('catches a capability switched off with no removal recorded', () => {
    const findings = findDrift(
      fixtureSnapshot,
      fixtureCurrent((matrix) => {
        (matrix.tiers.growth as Record<string, unknown>)['insights.checks'] = false;
      })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'lowered', where: 'growth.insights.checks' });
  });

  it('catches a variant moved DOWN the list', () => {
    // growth: unbranded → branded. Putting our name back on a paying customer's
    // website is exactly the kind of change that must not happen quietly.
    const findings = findDrift(
      fixtureSnapshot,
      fixtureCurrent((matrix) => {
        (matrix.tiers.growth as Record<string, unknown>)['website.branding'] = 'branded';
      })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('lowered');
  });

  it('catches an allowance cut', () => {
    const findings = findDrift(
      fixtureSnapshot,
      fixtureCurrent((matrix) => {
        (matrix.tiers.pro as Record<string, unknown>)['ai.actions'] = { perMonth: 500 };
      })
    );

    expect(findings[0]).toMatchObject({ kind: 'lowered', where: 'pro.ai.actions' });
  });

  it('ACCEPTS the same cut once it is recorded and the version is bumped (B-10)', () => {
    const findings = findDrift(
      fixtureSnapshot,
      fixtureCurrent((matrix) => {
        (matrix.tiers.growth as Record<string, unknown>)['insights.checks'] = false;
        matrix.version = 2;
        (matrix.removals as unknown[]).push({
          version: 2,
          tier: 'growth',
          capability: 'insights.checks',
          previousValue: true,
          grandfatherUntil: '2027-03-01T00:00:00.000Z',
        });
      })
    );

    // The two-line rule, working: value + ledger entry + version bump, and the
    // guard steps aside.
    expect(findings).toEqual([]);
  });

  it('does not treat an addition as a problem', () => {
    const findings = findDrift(
      fixtureSnapshot,
      fixtureCurrent((matrix) => {
        (matrix.tiers.growth as Record<string, unknown>)['chat.search'] = true;
      })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('changed');
  });

  it('catches a capability dropped from a tier entirely', () => {
    const findings = findDrift(
      fixtureSnapshot,
      fixtureCurrent((matrix) => {
        delete (matrix.tiers.pro as Record<string, unknown>)['chat.bulk'];
      })
    );

    expect(findings[0]).toMatchObject({ kind: 'removed_capability', where: 'pro.chat.bulk' });
  });

  it('catches a tier disappearing', () => {
    const findings = findDrift(
      fixtureSnapshot,
      fixtureCurrent((matrix) => {
        delete (matrix.tiers as Record<string, unknown>).pro;
      })
    );

    expect(findings[0]).toMatchObject({ kind: 'removed_tier', where: 'pro' });
  });
});

describe('S-7 — a history entry is a promise already made', () => {
  it('catches a trial length edited in place', () => {
    const edited = {
      ...currentConfig(),
      histories: {
        ...currentConfig().histories,
        trial: {
          duration: [{ effectiveFrom: '2026-09-22T00:00:00.000Z', days: 7 }],
          grace: COHORTS.trial.graceHistory,
        },
        champion: { grace: COHORTS.champion.graceHistory },
        subscription: { grace: LIFECYCLE_CONFIG.subscriptionGraceHistory },
      },
    };

    const findings = findDrift(snapshot, edited);

    expect(findings[0]).toMatchObject({ kind: 'history_edited', where: 'trial.duration[0]' });
  });

  it('is quiet when a new entry is APPENDED instead', () => {
    // The supported way to change a duration: people mid-trial keep the deal
    // they were given, new signups get the new one (AC-14).
    const appended = {
      ...currentConfig(),
      histories: {
        ...currentConfig().histories,
        trial: {
          duration: [
            ...(COHORTS.trial.durationHistory ?? []),
            { effectiveFrom: '2027-01-01T00:00:00.000Z', days: 7 },
          ],
          grace: COHORTS.trial.graceHistory,
        },
      },
    };

    expect(findDrift(snapshot, appended)).toEqual([]);
  });
});

describe('ranking, which is what makes "lowered" meaningful', () => {
  it('orders variants by the catalog, not alphabetically', () => {
    const branding = CAPABILITIES['website.branding'];

    expect(rankValue('branded', branding)).toBe(0);
    expect(rankValue('unbranded', branding)).toBe(1);
  });

  it('orders add-on states by how much the customer gets', () => {
    const addon = CAPABILITIES['website.custom_domain'];

    expect(rankValue('unavailable', addon)).toBe(0);
    expect(rankValue('purchasable', addon)).toBe(1);
    expect(rankValue('included', addon)).toBe(2);
  });

  it('reads a metered value whether it is a rate or a total', () => {
    const allowance = CAPABILITIES['ai.actions'];

    expect(rankValue({ perMonth: 500 }, allowance)).toBe(500);
    expect(rankValue({ total: 150 }, allowance)).toBe(150);
  });
});
