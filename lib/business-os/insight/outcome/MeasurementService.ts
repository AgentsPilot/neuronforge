/**
 * The sweep that finally asks whether the advice helped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs over every business, finds the cards whose horizon has passed, reads
 * the metric again and stores what it finds. Nothing here is clever; the
 * judgement is in `judgeMovement.ts` and the two-readings-one-series rule is
 * in `MeasurementRepository.ts`. This file is the loop and the honesty about
 * what it could not do.
 *
 * TWO HORIZONS, ON PURPOSE.
 *
 * Thirty days is early enough to be useful and short enough that the owner
 * still remembers acting. Ninety is where a change either held or did not --
 * plenty of advice produces a fortnight of effort and no lasting difference,
 * and a loop that only ever looked at thirty days would learn to recommend it.
 * A second horizon is a new row, never an overwrite, so both readings survive.
 *
 * `unmeasurable` IS A RESULT AND IS STORED.
 *
 * A metric with no series in `derived_metrics` cannot be re-read, and most
 * detectors compute straight from module tables, so this will be the common
 * answer at first. Storing it is what stops the job retrying the same rows
 * forever, and what keeps "no data" from quietly reading as "no improvement"
 * when the ranking is eventually built on top.
 *
 * @module lib/business-os/insight/outcome/MeasurementService
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { judgeMovement } from './judgeMovement';
import { MeasurementRepository, type DueInsight } from './MeasurementRepository';

const logger = createLogger({ module: 'InsightMeasurementService' });

/**
 * When a card gets re-read.
 *
 * See the header. Both run every sweep; an insight past 90 days that was never
 * measured at 30 gets both rows, which is correct — the 30-day reading is
 * still a true statement about the window it covers.
 */
export const HORIZONS_DAYS = [30, 90];

export interface SweepSummary {
  horizons: Array<{
    horizonDays: number;
    due: number;
    written: number;
    already: number;
    unmeasurable: number;
    improved: number;
    worsened: number;
    unchanged: number;
  }>;
  failed: number;
}

/**
 * Measure everything that is due, at every horizon.
 *
 * Never throws for one bad insight: a single unreadable metric must not stop
 * the sweep for every other business. Failures are counted and logged.
 */
export async function measureDueInsights(
  supabase: SupabaseClient,
  options: { horizons?: number[]; limit?: number } = {}
): Promise<SweepSummary> {
  const repo = new MeasurementRepository(supabase);
  const horizons = options.horizons ?? HORIZONS_DAYS;

  const summary: SweepSummary = { horizons: [], failed: 0 };

  for (const horizonDays of horizons) {
    const due = await repo.findDue(horizonDays, options.limit);

    const tally = {
      horizonDays,
      due: due.length,
      written: 0,
      already: 0,
      unmeasurable: 0,
      improved: 0,
      worsened: 0,
      unchanged: 0,
    };

    for (const insight of due) {
      try {
        const outcome = await measureOne(repo, insight, horizonDays);

        if (outcome === 'already') {
          tally.already += 1;
        } else {
          tally.written += 1;
          tally[outcome] += 1;
        }
      } catch (err) {
        /*
         * One insight's metric being unreadable is not the sweep's problem.
         * No `userId` in the line beyond the id already present: this log is
         * operational, and nothing about the business belongs in it.
         */
        summary.failed += 1;
        logger.error(
          { err, insightId: insight.id, detectorId: insight.detectorId, horizonDays },
          'Could not measure insight'
        );
      }
    }

    summary.horizons.push(tally);
  }

  logger.info({ summary }, 'Insight measurement sweep complete');
  return summary;
}

/** One insight, one horizon. Returns the verdict, or that a row already existed. */
async function measureOne(
  repo: MeasurementRepository,
  insight: DueInsight,
  horizonDays: number
): Promise<'improved' | 'worsened' | 'unchanged' | 'unmeasurable' | 'already'> {
  /*
   * One series for both readings. Resolved once, here, rather than
   * independently at each end -- a metric whose period type changed between
   * the two would otherwise have a daily "before" compared with a monthly
   * "after", which is the population error this whole module avoids.
   */
  const periodType = await repo.resolvePeriodType(insight.userId, insight.metricKey);

  let before: number | null = null;
  let after: number | null = null;

  if (periodType) {
    before = await repo.readMetricAt(
      insight.userId,
      insight.metricKey,
      periodType,
      new Date(insight.actionAt)
    );
    after = await repo.readMetricAt(
      insight.userId,
      insight.metricKey,
      periodType,
      new Date()
    );
  }

  const movement = judgeMovement({ before, after, direction: insight.direction });

  const written = await repo.record({
    userId: insight.userId,
    insightId: insight.id,
    detectorId: insight.detectorId,
    metricKey: insight.metricKey,
    outcomeOf: insight.outcomeOf,
    actionAt: insight.actionAt,
    horizonDays,
    valueBefore: before,
    valueAfter: after,
    direction: insight.direction,
    verdict: movement.verdict,
    changePercent: movement.changePercent,
  });

  return written === 'already' ? 'already' : movement.verdict;
}
