/**
 * The detector contract, finally enforced rather than documented.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `minSamples` was declared by all 40 detectors and read by NONE — neither
 * `BaseDetector` nor `DetectorEngine` ever looked at it. `ops_utilization_low`
 * carried `minSamples: 28 // 4 weeks of data` and fired on a business six days
 * old with two bookings, because the only thing between it and the owner was a
 * vector threshold of 1.
 *
 * A field that looks like a guard and is not is worse than no field: everyone
 * who reads it believes it is enforced, so nobody adds the check.
 *
 * Two more rules are corrected centrally rather than trusted to each detector,
 * because both have been wrong repeatedly across the catalog:
 *
 *   a percentage change with no baseline   sixteen detectors, narrated as
 *                                          "a 100% increase in risk"
 *   an impossible money figure             NaN and Infinity both arrive from a
 *                                          division by an empty set and both
 *                                          render beside a currency symbol
 *
 * Corrected, not thrown: this runs in a cron loop over every business, and a
 * throw would cost one business its entire detection run over a cosmetic
 * figure. Logged at error so the detector gets fixed; degraded to silence so
 * the owner is never told something invented.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { BaseDetector } from '../BaseDetector';
import type { DetectorDefinition, DetectionResult } from '../../types';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

type Params = Parameters<TestDetector['build']>[0];

class TestDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'test_detector',
    name: 'Test',
    category: 'cash_flow',
    description: 'A detector for exercising the contract',
    watchedMetrics: ['cashflow.ar_total'],
    eventTypes: [],
    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    minSamples: 10,
    severityFn: () => 'medium',
    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 24,
  };

  constructor() {
    super({} as never);
  }

  async evaluate(): Promise<DetectionResult | null> {
    return null;
  }

  /** Exposes the protected factory so the contract can be exercised directly. */
  build(overrides: Partial<Record<string, unknown>> = {}): DetectionResult | null {
    return this.createDetectionResult({
      severity: 'medium',
      metricKey: 'cashflow.ar_total',
      currentValue: 10,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 0,
      direction: 'above',
      affectedCount: 1,
      impactDirection: 'loss',
      impactPeriod: 'weekly',
      processParameters: {},
      ...overrides,
    } as never);
  }
}

const detector = () => new TestDetector();

describe('minSamples is enforced', () => {
  it('withholds a detection computed from too little', () => {
    expect(detector().build({ sampleSize: 9 })).toBeNull();
  });

  it('allows one exactly at the floor', () => {
    expect(detector().build({ sampleSize: 10 })).not.toBeNull();
  });

  it('leaves a detector that declares no sample alone', () => {
    /*
     * A detector that COUNTS things has nothing to declare: one overdue invoice
     * is one overdue invoice at any sample size. Only rates and trends stop
     * being true on a small denominator.
     */
    expect(detector().build()).not.toBeNull();
  });
});

describe('a change needs a baseline', () => {
  it('drops a percentage reported against nothing', () => {
    const result = detector().build({ percentChange: 100, baselineValue: 0 });

    expect(result!.percentChange).toBe(0);
  });

  it('keeps a percentage that was actually measured', () => {
    const result = detector().build({ percentChange: -40, baselineValue: 250 });

    expect(result!.percentChange).toBe(-40);
  });
});

describe('money has to be a number somebody could check', () => {
  it('drops NaN', () => {
    // Arrives from dividing by an empty set, and renders as "$NaN".
    const result = detector().build({ estimatedImpactUsd: Number.NaN });

    expect(result!.estimatedImpactUsd).toBeUndefined();
  });

  it('drops Infinity', () => {
    const result = detector().build({ estimatedImpactUsd: Number.POSITIVE_INFINITY });

    expect(result!.estimatedImpactUsd).toBeUndefined();
  });

  it('drops zero, which reads as "nothing at stake" rather than "unknown"', () => {
    const result = detector().build({ estimatedImpactUsd: 0 });

    expect(result!.estimatedImpactUsd).toBeUndefined();
  });

  it('keeps a real amount', () => {
    const result = detector().build({ estimatedImpactUsd: 1250.5 });

    expect(result!.estimatedImpactUsd).toBe(1250.5);
  });

  it('leaves an absent amount absent', () => {
    expect(detector().build()!.estimatedImpactUsd).toBeUndefined();
  });
});
