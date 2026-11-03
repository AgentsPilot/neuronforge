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
import { agentCoverage, NO_COVERAGE } from './coverage';

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

  /**
   * HIDE WHAT A LIVING AGENT IS ALREADY DOING. Owner-facing surfaces only.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * OFF BY DEFAULT, AND THAT DEFAULT IS LOAD-BEARING.
   *
   * `LeadResponseDispatchService` builds the automation queue FROM this
   * function — it asks for an automation's own `gapId` and schedules a send for
   * each item it gets back. Suppressing those items would starve the chaser of
   * the very work the suppression claims it is doing: the card would go quiet,
   * the robot would stop being given anything, and nobody would chase anyone.
   *
   * So the sweep, the detectors and anything else that reads gaps as WORK keep
   * seeing everything, unchanged. Only a surface that reads gaps as ERRANDS
   * FOR A PERSON asks for this, because only there is "a robot has it" a reason
   * to stay quiet.
   * ───────────────────────────────────────────────────────────────────────────
   */
  hideWhatAgentsHandle?: boolean;
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

  /*
   * WHAT THE OWNER'S AGENTS ARE ALREADY HANDLING, read once for the whole pass.
   *
   * Only when the caller asked — see `hideWhatAgentsHandle`, which the
   * automation sweep deliberately never sets. Read here rather than inside
   * each `find` so one dashboard costs two queries instead of two per gap, and
   * so every gap in a pass agrees about what is covered exactly as they already
   * agree about `now`.
   *
   * Fails open twice over: not asked for, nothing is covered; asked for and
   * unreadable, `agentCoverage` returns an empty map, which also covers
   * nothing. Both ways the cards appear.
   */
  const coverage = options.hideWhatAgentsHandle ? await agentCoverage(userId) : NO_COVERAGE;

  const results = await Promise.all(
    wanted.map(async definition => {
      const found = await definition.find(userId, now, coverage);

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
        /*
         * Measured from when the question became ANSWERABLE, which is not
         * always when it arose. `staleFrom` is omitted by every gap where the
         * two are the same instant; a meeting sets it to its end, so the wait
         * is charged from the moment the owner could first answer rather than
         * from a start time they may still be sitting in.
         */
        const basis = Date.parse(item.staleFrom ?? item.since);
        return Number.isNaN(basis) ? true : basis <= cutoff;
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
