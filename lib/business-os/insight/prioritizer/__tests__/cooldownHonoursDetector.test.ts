/**
 * A detector's own cooldown is the one that applies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUND IN AUDIT, 2026-10-06. `applyCooldowns` read
 * `CATEGORY_COOLDOWNS[category]` and never looked at the detector's
 * `cooldownHours`, which every one of the 46 declares. Two sources of truth,
 * and the invisible one won.
 *
 * Most values agreed by coincidence, which is why it survived. The one that did
 * not is `toil_manual_booking_entry`: it asks for 336 hours deliberately --
 * changing how you take bookings is not a weekly nag -- and was re-surfaced
 * after its category's 168.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { InsightPrioritizer } from '../InsightPrioritizer';
import type { DetectionResult } from '../../detectors/types';

const USER = '08456106-aa50-4810-b12c-7ca84102da31';
const HOUR = 60 * 60 * 1000;

/** Surfaced 200 hours ago: past a 168 cooldown, inside a 336 one. */
const SURFACED_200H_AGO = new Date(Date.now() - 200 * HOUR).toISOString();

/**
 * A client whose `insights` read answers only when the cutoff is old enough to
 * include a row surfaced 200 hours ago -- which is what `gte` does in life.
 */
function clientSeeingLastSurfacedAt(lastSurfacedAt: string) {
  return {
    from: () => {
      let cutoff = '';
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        gte: (_col: string, value: string) => { cutoff = value; return builder; },
        limit: async () => ({
          data: lastSurfacedAt >= cutoff ? [{ last_surfaced_at: lastSurfacedAt }] : [],
          error: null,
        }),
        order: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return builder;
    },
  };
}

const detection = (cooldownHours: number | undefined): DetectionResult =>
  ({
    detectorId: 'toil_manual_booking_entry',
    category: 'operations',
    severity: 'low',
    cooldownHours,
  }) as unknown as DetectionResult;

/** `applyCooldowns` is private and is the whole subject of this file. */
const applyCooldowns = (
  prioritizer: InsightPrioritizer,
  insights: Array<{ detection: DetectionResult }>
) =>
  (prioritizer as unknown as {
    applyCooldowns: (u: string, i: unknown[]) => Promise<unknown[]>;
  }).applyCooldowns(USER, insights);

describe('applyCooldowns', () => {
  it('keeps a card suppressed inside the detector’s own longer cooldown', async () => {
    /*
     * THE BUG. Operations maps to 168 hours; this detector asks for 336. At
     * 200 hours since it was last shown the category map would let it through
     * and the detector would not.
     */
    const prioritizer = new InsightPrioritizer(clientSeeingLastSurfacedAt(SURFACED_200H_AGO) as never);

    const kept = await applyCooldowns(prioritizer, [{ detection: detection(336) }]);

    expect(kept).toHaveLength(0);
  });

  it('lets it through once its own cooldown has passed', async () => {
    const prioritizer = new InsightPrioritizer(clientSeeingLastSurfacedAt(SURFACED_200H_AGO) as never);

    const kept = await applyCooldowns(prioritizer, [{ detection: detection(168) }]);

    expect(kept).toHaveLength(1);
  });

  it('falls back to the category map when a detector declares nothing', async () => {
    /*
     * The field is optional on a DetectionResult, and an older row in flight
     * will not carry it. Falling back is what keeps this change from being a
     * behaviour cliff for anything already queued.
     */
    const prioritizer = new InsightPrioritizer(clientSeeingLastSurfacedAt(SURFACED_200H_AGO) as never);

    const kept = await applyCooldowns(prioritizer, [{ detection: detection(undefined) }]);

    // operations = 168, and 200 hours have passed.
    expect(kept).toHaveLength(1);
  });
});
