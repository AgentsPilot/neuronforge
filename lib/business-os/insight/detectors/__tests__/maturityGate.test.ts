/**
 * How much evidence a detector needs before it may speak.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED BY THE OWNER, 2026-10-06, pointing at DAY 52 on the dashboard
 * timeline: the pricing node, drawn locked and promised for day 52, while a
 * pricing card was already on screen.
 *
 * `getVectorMaturity` computes three states, and `learn` means ONE ROW:
 *
 *   if (dataPoints >= threshold && alsoMet) state = 'lit';
 *   else if (dataPoints > 0)                state = 'learn';
 *   else                                    state = 'dark';
 *
 * The engine read `state === 'dark'` into a Set and discarded the rest, so
 * `learn` was treated exactly like `lit`. `journeyTimeline` reads the same data
 * properly, including the `also` volume clause, which is where day 52 comes
 * from: the timeline honoured the threshold and the engine honoured `> 0`.
 *
 * On the reporting account that meant `price` ran 17 days early (26 of 42 days)
 * and `leads` ran 6 contacts short. 18 of 44 detectors should have been quiet.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { DetectorEngine } from '../DetectorEngine';
import { effectiveClaimType, type ClaimType } from '../types';
import type { VectorKey, VectorState } from '../../repository/InsightRepository';

/** The engine only stores the client at construction time. */
const engine = new DetectorEngine({} as never);

/** `shouldRun` is private, and is the whole decision. */
const decide = (
  claim: ClaimType | undefined,
  category: string,
  states: Map<VectorKey, VectorState> | null
): boolean =>
  (engine as unknown as {
    shouldRun: (d: unknown, s: Map<VectorKey, VectorState> | null) => boolean;
  }).shouldRun({ definition: { id: 'test', category, claimType: claim } }, states);

/** `price` short of its threshold, `cash` over it: the reported account. */
const STATES = new Map<VectorKey, VectorState>([
  ['price', 'learn'],
  ['cash', 'lit'],
  ['ret', 'dark'],
]);

describe('the claim type decides the evidence needed', () => {
  it('holds an inference on a vector that is only learning', () => {
    // The day-52 case. 26 of 42 days is data, and it is not enough data.
    expect(decide('rate', 'pricing', STATES)).toBe(false);
    expect(decide('trend', 'pricing', STATES)).toBe(false);
    expect(decide('pattern', 'pricing', STATES)).toBe(false);
  });

  it('runs the same inference once the vector is lit', () => {
    expect(decide('rate', 'cash_flow', STATES)).toBe(true);
  });

  it('runs an instance claim while the vector is still learning', () => {
    /*
     * This is the half that must keep working. "Three people wrote to you and
     * got no reply" is true on day one, and a strict gate silences exactly the
     * small businesses that can least afford to lose an enquiry.
     */
    expect(decide('instance', 'pricing', STATES)).toBe(true);
  });

  it('holds even an instance claim on a dark vector', () => {
    // Nothing recorded means nothing to name.
    expect(decide('instance', 'retention', STATES)).toBe(false);
  });

  it('runs anything whose category maps to no vector at all', () => {
    expect(decide('rate', 'not_a_category', STATES)).toBe(true);
  });
});

describe('when maturity cannot be read', () => {
  /*
   * This returned an empty Set and ran all 44 detectors: the most confident the
   * engine could possibly be at the moment it knows least.
   */
  it('fails closed for inference', () => {
    expect(decide('rate', 'cash_flow', null)).toBe(false);
    expect(decide('pattern', 'cash_flow', null)).toBe(false);
  });

  it('still allows an instance claim, which needs no baseline', () => {
    expect(decide('instance', 'cash_flow', null)).toBe(true);
  });
});

describe('effectiveClaimType', () => {
  it('defaults to the strict side when nothing is declared', () => {
    /*
     * The direction of this default is the point. `minSamples` was declared by
     * all 44 detectors and read by none; `ignoresVectorMaturity` was read but
     * hand-set until 22 claimed the exemption. Defaulting to `rate` means a new
     * detector that forgets to declare gets QUIETER, never louder.
     */
    expect(effectiveClaimType({})).toBe('rate');
  });

  it('reads the old boolean as an instance claim', () => {
    expect(effectiveClaimType({ ignoresVectorMaturity: true })).toBe('instance');
  });

  it('lets an explicit declaration win over the old boolean', () => {
    // The four corrected detectors are exactly this case.
    expect(effectiveClaimType({ claimType: 'pattern', ignoresVectorMaturity: true }))
      .toBe('pattern');
  });
});

describe('the four detectors whose hand-set flag was wrong', () => {
  const engineDetectors = (engine as unknown as {
    detectors: { definition: { id: string; claimType?: ClaimType } }[];
  }).detectors;

  const claimOf = (id: string): ClaimType | undefined => {
    const found = engineDetectors.find(d => d.definition.id === id);
    if (!found) throw new Error(`${id} is not registered in DetectorEngine`);
    return effectiveClaimType(found.definition);
  };

  it.each([
    // Both of these use `dominantReason`, which is a share of a sample.
    ['ret_cancel_pattern', 'pattern'],
    ['conv_decline_reason', 'pattern'],
    // `stage_progression_rate` is a cohort rate; its own file header says it
    // needs history rather than a snapshot, then exempted itself from the gate.
    ['conv_stage_dropoff', 'rate'],
    // The day-52 detector: `pricing.intro_conversion` is a conversion rate.
    ['pricing_intro_offer_stuck', 'rate'],
  ])('%s is a %s claim, not an instance one', (id, expected) => {
    expect(claimOf(id)).toBe(expected);
  });
});
