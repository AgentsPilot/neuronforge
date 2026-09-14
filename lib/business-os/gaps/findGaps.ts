/**
 * Run the gap registry.
 *
 * One entry point for three surfaces that were each about to grow their own
 * queries: the dashboard shows the owner's errands, the briefing narrates all
 * of them, and the stalled-enquiries insight counts the aged ones. They now
 * disagree about nothing, because there is nothing left to disagree about.
 *
 * @module lib/business-os/gaps/findGaps
 */

import { GAP_DEFINITIONS } from './definitions';
import type { GapId, GapResult } from './types';

/** How many of each are named. The count is always the truth about how many. */
const NAMED = 3;

export interface FindGapsOptions {
  /** Only these. Omitted means all of them. */
  only?: GapId[];
  /** Only errands, or only news. Omitted means both. */
  blocksOn?: 'owner' | 'client';
  /** Injected so a caller can ask "what was stuck an hour ago" and for tests. */
  now?: Date;
  /** How many items to name per gap. */
  named?: number;
}

/**
 * What is currently stuck for this business.
 *
 * Empty gaps are dropped rather than returned with a zero, so a caller can
 * render the result directly without filtering — and so "nothing is stuck"
 * reads as an empty array rather than six zeroes.
 *
 * Every definition swallows its own failure, so one unreadable gap costs its
 * own row and nothing else.
 */
export async function findGaps(
  userId: string,
  options: FindGapsOptions = {}
): Promise<GapResult[]> {
  const now = options.now ?? new Date();
  const named = options.named ?? NAMED;

  const wanted = GAP_DEFINITIONS.filter(definition => {
    if (options.only && !options.only.includes(definition.id)) return false;
    if (options.blocksOn && definition.blocksOn !== options.blocksOn) return false;
    return true;
  });

  const results = await Promise.all(
    wanted.map(async definition => {
      const found = await definition.find(userId, now);

      /*
       * The staleness window is applied HERE rather than inside each query.
       *
       * Two reasons: a definition then only has to answer "what is in this
       * state", which is the part that differs; and a caller can ask for a
       * different window — the insight wants 48 hours where the dashboard wants
       * everything — without a second query per gap.
       */
      const cutoff = now.getTime() - definition.staleAfterHours * 60 * 60 * 1000;
      const stale = found.filter(item => {
        const since = Date.parse(item.since);
        return Number.isNaN(since) ? true : since <= cutoff;
      });

      return {
        id: definition.id,
        blocksOn: definition.blocksOn,
        action: definition.action,
        count: stale.length,
        items: stale.slice(0, named),
      } satisfies GapResult;
    })
  );

  return results.filter(result => result.count > 0);
}

/** Just the errands — what the dashboard shows. */
export function ownerGaps(results: GapResult[]): GapResult[] {
  return results.filter(result => result.blocksOn === 'owner');
}
