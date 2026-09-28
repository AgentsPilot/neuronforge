/**
 * An insight's sentence has to keep up with its own numbers.
 *
 * Re-detection refreshed every figure on the row — `current_value`,
 * `affected_count`, `estimated_impact_usd` — and left `title`, `description`
 * and `recommendation` exactly as first written. Two consequences, both seen on
 * live accounts:
 *
 *   the prose went stale against the FACTS      a card raised at one unpaid
 *                                               invoice kept saying "$500"
 *                                               while the value underneath
 *                                               climbed
 *
 *   the prose went stale against the PROMPT     cards written on 17 September
 *                                               still said "a 100% increase in
 *                                               your expected cash flow" days
 *                                               after the fabricated figure
 *                                               behind that sentence was removed
 *
 * Rewriting costs an LLM call, so it happens when a quoted number moved and not
 * otherwise.
 */

import { InsightRepository } from '../InsightRepository';
import type { InsightRunIds } from '../InsightRepository';
import type { DetectionResult } from '../../detectors/types';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

/*
 * The ids a rewrite is attributed under.
 *
 * Typed with the REAL `InsightRunIds` rather than re-declared, because a
 * rewrite is a tracked LLM call: this is the same fourth parameter the F-13 fix
 * turned from a bare `runId: string` into `{ runId, groupId }`. A hand-written
 * `r: string` here keeps compiling while the production signature moves — the
 * hole that hid four sibling files, spelled `as unknown as` in this one instead
 * of `as never as`, which is why the first sweep walked past it.
 *
 * `groupId` is deliberately NOT `runId`: one business's group, never the run's.
 */
const RUN_IDS: InsightRunIds = {
  runId: '9c1d4f0e-1111-4111-8111-111111111111',
  groupId: 'b7a3e6d2-2222-4222-8222-222222222222',
};

const STORED = {
  id: 'i1',
  current_value: 500,
  affected_count: 1,
  estimated_impact_usd: 500,
  language: 'en',
};

function detection(overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    detectorId: 'cash_revenue_at_risk',
    currentValue: 500,
    affectedCount: 1,
    estimatedImpactUsd: 500,
  } as unknown as DetectionResult;
}

function withOverrides(overrides: Record<string, unknown>): DetectionResult {
  return { ...detection(), ...overrides } as unknown as DetectionResult;
}

/** Counts how often the narrator was asked for fresh words. */
function repo() {
  const repository = new InsightRepository({} as never);
  const narrate = jest.fn().mockResolvedValue({
    title: 'New title',
    description: 'New description',
    recommendation: 'New recommendation',
  });

  (repository as unknown as Record<string, unknown>).getUserBusinessContext =
    jest.fn().mockResolvedValue({ language: 'he', currency: 'ILS', vertical: 'trainer' });
  (repository as unknown as Record<string, unknown>).generateLocalizedContent = narrate;

  const restate = (stored: typeof STORED, fresh: DetectionResult) =>
    (repository as unknown as {
      restateIfChanged: (s: unknown, d: DetectionResult, u: string, r: InsightRunIds) => Promise<Record<string, unknown>>;
    }).restateIfChanged(stored, fresh, 'user-1', RUN_IDS);

  return { restate, narrate };
}

describe('restateIfChanged', () => {
  it('leaves the words alone when nothing the sentence quotes has moved', async () => {
    const { restate, narrate } = repo();

    expect(await restate(STORED, detection())).toEqual({});
    expect(narrate).not.toHaveBeenCalled();
  });

  it('rewrites when the amount changed', async () => {
    // The reported shape: raised at $500, now $2,105, still saying $500.
    const { restate, narrate } = repo();

    const result = await restate(STORED, withOverrides({ currentValue: 2105 }));

    expect(narrate).toHaveBeenCalledTimes(1);
    expect(result.description).toBe('New description');
  });

  it('rewrites when the count changed', async () => {
    const { restate, narrate } = repo();

    await restate(STORED, withOverrides({ affectedCount: 3 }));

    expect(narrate).toHaveBeenCalledTimes(1);
  });

  it('rewrites when only the money in the title changed', async () => {
    // "$1,000 Impact" can move while the count stays at one client.
    const { restate, narrate } = repo();

    await restate(STORED, withOverrides({ estimatedImpactUsd: 1000 }));

    expect(narrate).toHaveBeenCalledTimes(1);
  });

  it('is not fooled by a numeric arriving as a string', async () => {
    /*
     * PostgREST returns numerics as strings. Strict equality would call every
     * unchanged insight changed and buy identical words daily at full price.
     */
    const { restate, narrate } = repo();

    const stored = { ...STORED, current_value: '500.00', estimated_impact_usd: '500.00' } as never;
    expect(await restate(stored, detection())).toEqual({});
    expect(narrate).not.toHaveBeenCalled();
  });

  it('does not rewrite for a fraction of a penny', async () => {
    const { restate, narrate } = repo();

    await restate(STORED, withOverrides({ currentValue: 500.000001 }));

    expect(narrate).not.toHaveBeenCalled();
  });

  it('treats a figure appearing or disappearing as a change', async () => {
    const { restate, narrate } = repo();

    await restate(STORED, withOverrides({ estimatedImpactUsd: null }));

    expect(narrate).toHaveBeenCalledTimes(1);
  });

  it('carries the language with the new words', async () => {
    // A business that switched language must not get a stale label over
    // freshly translated prose.
    const { restate } = repo();

    const result = await restate(STORED, withOverrides({ currentValue: 900 }));

    expect(result.language).toBe('he');
  });

  it('keeps the previous wording when the rewrite fails', async () => {
    /*
     * Old words beat no words. A card whose text failed to regenerate still has
     * something true on it from last time; an empty one has nothing.
     */
    const repository = new InsightRepository({} as never);
    (repository as unknown as Record<string, unknown>).getUserBusinessContext =
      jest.fn().mockRejectedValue(new Error('offline'));

    const result = await (repository as unknown as {
      restateIfChanged: (s: unknown, d: DetectionResult, u: string, r: InsightRunIds) => Promise<Record<string, unknown>>;
    }).restateIfChanged(STORED, withOverrides({ currentValue: 2105 }), 'user-1', RUN_IDS);

    expect(result).toEqual({});
  });
});
