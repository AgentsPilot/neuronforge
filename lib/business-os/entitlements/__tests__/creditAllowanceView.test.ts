/**
 * creditAllowanceForDisplay — what the owner card counts down from (credit
 * deduction slice 6a, workplan §4.4, SA Q-4, W6-9).
 *
 * Resolved against the REAL config, so a change to an allowance in the tier
 * matrix or the cohorts shows up here as a changed figure, not as a stale
 * fixture. "No allowance" (null) must never become "0 of 0".
 */

import { creditAllowanceDecision, creditAllowanceForDisplay } from '../creditAllowanceView';
import { previewAccountFor } from '../planPresentation';
import { resolveEntitlements, type EntitlementResolution, type TraceEntry } from '../resolver';
import { readCodeConfig } from '../source';
import type { SnapshotResult } from '../EntitlementService';
import type { LifecycleState } from '../types';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const config = readCodeConfig();

function resolutionFor(planId: string): EntitlementResolution {
  return resolveEntitlements({
    config,
    account: previewAccountFor(config, planId, NOW),
    overrides: [],
    addons: [],
    now: NOW,
  });
}

const snapshot = (resolution: EntitlementResolution | null, extra: Partial<SnapshotResult> = {}): SnapshotResult => ({
  resolution,
  unavailable: false,
  stale: false,
  ...extra,
});

/** The value the real config gives a plan, read the same way the helper reads it. */
function configured(planId: string): unknown {
  return resolutionFor(planId).values['credits.allowance']?.value;
}

describe('creditAllowanceForDisplay', () => {
  it('a Founding Partner (champion) gets its monthly allowance', () => {
    const value = configured('champion') as { perMonth: number };
    expect(value.perMonth).toBeGreaterThan(0);
    expect(creditAllowanceForDisplay(snapshot(resolutionFor('champion')))).toEqual({
      amount: value.perMonth,
      per: 'month',
    });
  });

  it('every paid tier gets its monthly allowance', () => {
    for (const tier of config.tierOrder) {
      const value = configured(tier) as { perMonth: number };
      expect({ tier, allowance: creditAllowanceForDisplay(snapshot(resolutionFor(tier))) }).toEqual({
        tier,
        allowance: { amount: value.perMonth, per: 'month' },
      });
    }
  });

  it('a trial gets its one-off total, recognised by the value shape', () => {
    const value = configured('trial') as { total: number };
    expect(value.total).toBeGreaterThan(0);
    expect(creditAllowanceForDisplay(snapshot(resolutionFor('trial')))).toEqual({ amount: value.total, per: 'total' });
  });

  it('an unavailable snapshot is "no allowance", never zero', () => {
    expect(creditAllowanceForDisplay({ resolution: null, unavailable: true, stale: false })).toBeNull();
  });

  it('a stale snapshot is used: display only (T-3 bars stale data from owner-paid answers, not read-outs)', () => {
    expect(creditAllowanceForDisplay(snapshot(resolutionFor('champion'), { stale: true }))).not.toBeNull();
  });

  it('no plan row (an anomaly) is "no allowance" — never the withheld { perMonth: 0 } shown as 0 of 0', () => {
    const resolution = resolveEntitlements({ config, account: null, overrides: [], addons: [], now: NOW });
    expect(resolution.anomaly).toBeDefined();
    expect(creditAllowanceForDisplay(snapshot(resolution))).toBeNull();
  });

  it('a basis of none is "no allowance"', () => {
    const resolution = { ...resolutionFor('champion'), basis: { kind: 'none' as const } };
    expect(creditAllowanceForDisplay(snapshot(resolution))).toBeNull();
  });

  it('the withheld value is "no allowance"', () => {
    const base = resolutionFor('champion');
    const resolution: EntitlementResolution = {
      ...base,
      values: {
        ...base.values,
        'credits.allowance': { ...base.values['credits.allowance'], value: { perMonth: 0 } },
      },
    };
    expect(creditAllowanceForDisplay(snapshot(resolution))).toBeNull();
  });

  it('a zero trial total is "no allowance", never "0 of 0 in total"', () => {
    const base = resolutionFor('trial');
    const resolution: EntitlementResolution = {
      ...base,
      values: { ...base.values, 'credits.allowance': { ...base.values['credits.allowance'], value: { total: 0 } } },
    };
    expect(creditAllowanceForDisplay(snapshot(resolution))).toBeNull();
  });

  it.each<[LifecycleState, boolean]>([
    ['trial', true],
    ['champion', true],
    ['active', true],
    ['past_due', true],
    ['grace', true],
    ['paused', false],
    ['unknown', false],
  ])('state %s shows an allowance: %s (W6-9)', (state, shows) => {
    const resolution = { ...resolutionFor('champion'), state };
    expect(creditAllowanceForDisplay(snapshot(resolution)) !== null).toBe(shows);
  });
});

/**
 * creditAllowanceDecision — the same allowance plus the layer that decided it,
 * for the admin per-account credit view (credit deduction slice 11c, SA OP-24).
 */
describe('creditAllowanceDecision', () => {
  const LAYERS: TraceEntry['layer'][] = ['basis', 'lifecycle_gate', 'grandfather', 'addon', 'cohort_values', 'override'];

  function withLayer(planId: string, layer: TraceEntry['layer']): EntitlementResolution {
    const base = resolutionFor(planId);
    return {
      ...base,
      values: { ...base.values, 'credits.allowance': { ...base.values['credits.allowance'], decidedBy: layer } },
    };
  }

  it.each(LAYERS)('reports the layer %s when an allowance is shown', (layer) => {
    const decision = creditAllowanceDecision(snapshot(withLayer('champion', layer)));
    expect(decision.layer).toBe(layer);
    expect(decision.allowance).not.toBeNull();
  });

  it('reports the real config layer for a plain tier (non-vacuity: not a fixture value)', () => {
    const resolution = resolutionFor(config.tierOrder[0]);
    expect(creditAllowanceDecision(snapshot(resolution)).layer).toBe(resolution.values['credits.allowance'].decidedBy);
  });

  it('the layer is null whenever the allowance is null', () => {
    const anomaly = resolveEntitlements({ config, account: null, overrides: [], addons: [], now: NOW });
    const withheldBase = resolutionFor('champion');
    const withheld: EntitlementResolution = {
      ...withheldBase,
      values: {
        ...withheldBase.values,
        'credits.allowance': { ...withheldBase.values['credits.allowance'], value: { perMonth: 0 }, decidedBy: 'override' },
      },
    };
    const cases: SnapshotResult[] = [
      { resolution: null, unavailable: true, stale: false },
      snapshot(anomaly),
      snapshot({ ...withLayer('champion', 'override'), basis: { kind: 'none' as const } }),
      snapshot(withheld),
      snapshot({ ...withLayer('champion', 'override'), state: 'paused' }),
      snapshot({ ...withLayer('champion', 'override'), state: 'unknown' }),
    ];
    for (const entry of cases) {
      expect(creditAllowanceDecision(entry)).toEqual({ allowance: null, layer: null });
    }
  });

  it('its allowance deep-equals creditAllowanceForDisplay on every fixture (one rule, not two)', () => {
    const fixtures: SnapshotResult[] = [
      ...config.tierOrder.map((tier) => snapshot(resolutionFor(tier))),
      snapshot(resolutionFor('champion')),
      snapshot(resolutionFor('trial')),
      snapshot(resolutionFor('champion'), { stale: true }),
      { resolution: null, unavailable: true, stale: false },
      snapshot(resolveEntitlements({ config, account: null, overrides: [], addons: [], now: NOW })),
      snapshot({ ...resolutionFor('champion'), basis: { kind: 'none' as const } }),
      ...(['trial', 'champion', 'active', 'past_due', 'grace', 'paused', 'unknown'] as LifecycleState[]).map((state) =>
        snapshot({ ...resolutionFor('champion'), state })
      ),
    ];
    expect(fixtures.length).toBeGreaterThan(10);
    for (const fixture of fixtures) {
      expect(creditAllowanceDecision(fixture).allowance).toEqual(creditAllowanceForDisplay(fixture));
    }
  });
});
