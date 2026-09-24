/**
 * Five different findings are not one finding.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The dedupe key was `category:affectedEntityType`, which describes a SHAPE
 * rather than a finding. These five all report `conversion:contact`:
 *
 *   crm_cold_leads          nobody has spoken to these people in weeks
 *   conv_pipeline_stuck     they are sitting in one stage
 *   conv_no_next_step       nothing at all is scheduled for them
 *   conv_stage_dropoff      everybody stalls at this particular step
 *   conv_service_rate_drop  this entry service stopped converting
 *
 * Four of the five were discarded on every run — never stored, never counted,
 * never resolved, no row and no trace. And because the cron feeds
 * `resolveStaleInsights` the list of detectors that FIRED, a dropped detection
 * counted as "ran", so its existing insight was neither refreshed nor closed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { InsightPrioritizer } from '../InsightPrioritizer';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

interface Candidate { detection: { detectorId: string; category: string; affectedEntityType: string }; score: number }

function candidate(detectorId: string, score: number, category = 'conversion', affectedEntityType = 'contact'): Candidate {
  return { detection: { detectorId, category, affectedEntityType }, score };
}

/** The method is private; what survives it is the behaviour. */
function dedupe(candidates: Candidate[]): string[] {
  const prioritizer = new InsightPrioritizer({} as never);
  const kept = (prioritizer as unknown as {
    deduplicate: (c: Candidate[]) => Candidate[];
  }).deduplicate(candidates);

  return kept.map(c => c.detection.detectorId);
}

describe('deduplicate', () => {
  it('keeps every distinct conversion finding', () => {
    // The reported case: five detectors, same category, same entity type.
    const kept = dedupe([
      candidate('crm_cold_leads', 90),
      candidate('conv_pipeline_stuck', 80),
      candidate('conv_no_next_step', 70),
      candidate('conv_stage_dropoff', 60),
      candidate('conv_service_rate_drop', 50),
    ]);

    expect(kept).toHaveLength(5);
  });

  it('still collapses the same detector firing twice', () => {
    // `createBatch` refuses a second open insight per detector, so this is the
    // duplication that genuinely needs removing.
    const kept = dedupe([
      candidate('crm_cold_leads', 40),
      candidate('crm_cold_leads', 90),
    ]);

    expect(kept).toEqual(['crm_cold_leads']);
  });

  it('keeps the higher-scoring of a repeated detector', () => {
    const prioritizer = new InsightPrioritizer({} as never);
    const kept = (prioritizer as unknown as {
      deduplicate: (c: Candidate[]) => Candidate[];
    }).deduplicate([candidate('crm_cold_leads', 40), candidate('crm_cold_leads', 90)]);

    expect(kept[0].score).toBe(90);
  });

  it('returns them worst-first by score', () => {
    const kept = dedupe([
      candidate('conv_no_next_step', 30),
      candidate('crm_cold_leads', 95),
      candidate('conv_pipeline_stuck', 60),
    ]);

    expect(kept).toEqual(['crm_cold_leads', 'conv_pipeline_stuck', 'conv_no_next_step']);
  });

  it('does not merge across categories that happen to share an entity type', () => {
    const kept = dedupe([
      candidate('crm_cold_leads', 90, 'conversion', 'contact'),
      candidate('crm_engagement_decay', 80, 'retention', 'contact'),
    ]);

    expect(kept).toHaveLength(2);
  });
});
