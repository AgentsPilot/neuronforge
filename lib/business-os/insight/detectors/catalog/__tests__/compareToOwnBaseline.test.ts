/**
 * A detector compares a business to ITSELF, and says nothing when nothing moved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every detector in the catalogue measures against a constant somebody typed:
 * refunds above 5%, 25 visitors, 42 days. None of them asks what is normal for
 * this business, so a card can only repeat that you are over a line, week after
 * week. That is the complaint that started this work: "the insights keep saying
 * the same thing".
 *
 * `BaselineCalculator` could always answer the better question, and
 * `BaseDetector` handed an instance to all 44 detectors. Not one called it.
 *
 * Two answers matter, and they must not be confused:
 *
 *   `unusual: false`  the figure is where this business normally sits, so there
 *                     is nothing to report however it compares to a constant.
 *                     This is how a detector learns to stay quiet.
 *   `null`            there is NO baseline, so the caller should fall back to
 *                     whatever absolute rule it had.
 *
 * The first version of this returned null for both, and the detector that wired
 * into it had to query the baseline a second time to tell them apart.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { BaseDetector } from '../BaseDetector';
import type { DetectorDefinition, DetectionResult } from '../../types';

const USER = '08456106-aa50-4810-b12c-7ca84102da31';

/** What `BaselineCalculator.computeBaseline` will return for this test. */
let stubBaseline: {
  mean: number;
  stdDev: number;
  threshold: number;
  sampleSize: number;
  isSignificant: boolean;
} | Error;

jest.mock('../../../metrics/BaselineCalculator', () => ({
  BaselineCalculator: class {
    async computeBaseline() {
      if (stubBaseline instanceof Error) throw stubBaseline;
      return stubBaseline;
    }
  },
}));

/** The smallest possible detector: this suite only exercises the helper. */
class ProbeDetector extends BaseDetector {
  definition = {
    id: 'probe',
    name: 'Probe',
    category: 'cash_flow',
    description: 'test only',
    watchedMetrics: [],
    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    minSamples: 1,
    severityFn: () => 'low',
    consentTier: 'suggest',
    eligibleForAutomation: false,
    cooldownHours: 24,
  } as unknown as DetectorDefinition;

  async evaluate(): Promise<DetectionResult | null> {
    return null;
  }

  /** `compareToOwnBaseline` is protected; this suite is its only caller. */
  compare(value: number) {
    return this.compareToOwnBaseline(USER, 'cashflow.refund_rate' as never, value);
  }
}

const detector = new ProbeDetector({} as never);

/** A business whose refund rate normally sits at 6%, give or take 2 points. */
const NORMAL = { mean: 6, stdDev: 2, threshold: 4, sampleSize: 30, isSignificant: true };

describe('when the figure is unremarkable', () => {
  beforeEach(() => { stubBaseline = NORMAL; });

  it('calls a figure sitting on the mean unremarkable', async () => {
    // THE headline behaviour. Nothing moved, so there is nothing to report --
    // and the caller is TOLD that, rather than inferring it from a null.
    expect((await detector.compare(6))?.unusual).toBe(false);
  });

  it('calls one standard deviation out unremarkable', async () => {
    // 8% against a 6% ± 2 norm is an ordinary week, not news.
    expect((await detector.compare(8))?.unusual).toBe(false);
  });

  it('calls just inside the band unremarkable', async () => {
    expect((await detector.compare(9.9))?.unusual).toBe(false);
  });

  it('never returns null for an unremarkable figure', async () => {
    /*
     * The distinction this type exists for. Null must mean ONLY "no baseline",
     * so a caller can fall back to an absolute rule; conflating it with
     * "unremarkable" made the first version of this ask twice.
     */
    expect(await detector.compare(6)).not.toBeNull();
  });
});

describe('when the figure is genuinely unusual', () => {
  beforeEach(() => { stubBaseline = NORMAL; });

  it('reports a rise with its distance from the business own mean', async () => {
    const result = await detector.compare(14);

    expect(result).not.toBeNull();
    expect(result!.unusual).toBe(true);
    expect(result!.direction).toBe('above');
    expect(result!.sigma).toBe(4);
    expect(result!.mean).toBe(6);
  });

  it('reports a fall as well as a rise', async () => {
    /*
     * Direction matters and is not always bad: a reply time dropping four
     * standard deviations is the business getting faster, and a detector that
     * only looked for rises would never notice.
     */
    const result = await detector.compare(0);

    expect(result!.direction).toBe('below');
    expect(result!.sigma).toBe(-3);
  });

  it('carries the sample size, so copy can say what it compared against', async () => {
    const result = await detector.compare(14);

    expect(result!.sampleSize).toBe(30);
    expect(result!.periodType).toBe('daily');
  });
});

describe('when there is no baseline at all', () => {
  it('returns null when the baseline is not significant', async () => {
    /*
     * Four days of history cannot tell you what normal looks like. This is the
     * same discipline the maturity gate applies one level up, and the two must
     * agree rather than compete.
     */
    stubBaseline = { ...NORMAL, sampleSize: 4, isSignificant: false };

    expect(await detector.compare(99)).toBeNull();
  });

  it('returns null when the metric has never varied', async () => {
    /*
     * A standard deviation of zero makes every value "outside" the band, so a
     * 2σ test would fire on the first flicker. `cashflow.ar_overdue_usd` is
     * exactly this on a small account: the same balance every day. No spread
     * means no way to be unusual.
     */
    stubBaseline = { ...NORMAL, stdDev: 0 };

    expect(await detector.compare(5000)).toBeNull();
  });

  it('returns null, rather than throwing, when the baseline cannot be read', async () => {
    /*
     * A detector must survive its baseline being unavailable: it falls back to
     * whatever absolute rule it already had, which is how it behaved before
     * this helper existed.
     */
    stubBaseline = new Error('derived_metrics unreadable');

    await expect(detector.compare(14)).resolves.toBeNull();
  });
});
