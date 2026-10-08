/**
 * Reading the same metric twice, months apart.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS MODULE IS BUILT AROUND.
 *
 * `insights.current_value` is sitting right there, it is the figure that made
 * the card fire, and it is the WRONG "before". Detectors compute their own
 * numbers from module tables -- a manual-booking share, a cancellation rate
 * over a 60-day window -- while `derived_metrics` holds a separately computed
 * series under the same `metric_key`. The two are not the same measurement,
 * and dividing one by the other compares two populations. That is the error
 * `RetCancelPatternDetector` had to avoid this week by windowing both halves
 * of its rate on `start_time`, and it can exceed 100%.
 *
 * So BOTH readings come from `derived_metrics`, with the same `metric_key` and
 * the same `period_type`: one window ending when the owner acted, one ending
 * now. A metric with no series there is `unmeasurable` -- honestly, and
 * recorded as such -- rather than silently compared against a figure that
 * means something else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT RE-RUN THE DETECTOR INSTEAD
 *
 * It was the obvious idea and it does not work. A detector returning null is
 * ambiguous three ways -- the problem is fixed, the detector is on cooldown,
 * or the account went quiet -- and `isOnCooldown` is checked INSIDE each
 * `evaluate`, so a measuring job would read "cooled down" as "resolved" and
 * report success for advice nobody took.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CROSS-USER BY DESIGN
 *
 * `findDue` has no `.eq('user_id', …)` because it serves a cron that sweeps
 * every business, the same shape as the queue-drain claim methods -- see
 * CLAUDE.md rule 4 and the `PluginConnectionRepository` precedent. Every other
 * method here is scoped. ⟨unscoped-by-design⟩ marks the one that is not.
 *
 * @module lib/business-os/insight/outcome/MeasurementRepository
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import type { MovementVerdict } from './judgeMovement';

const logger = createLogger({ module: 'InsightMeasurementRepository' });

/**
 * How much history each reading averages over.
 *
 * A single day's `derived_metrics` row is noisy -- the series recomputes daily
 * over windows that shift under it -- so a point reading at each end would
 * mostly measure which day of the week the cron happened to run. Two weeks
 * smooths that without reaching so far back that the "after" window overlaps
 * the action it is measuring.
 */
export const READING_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;

/** One insight waiting to be re-measured. */
export interface DueInsight {
  id: string;
  userId: string;
  detectorId: string;
  metricKey: string;
  direction: 'above' | 'below';
  outcomeOf: 'acted' | 'dismissed';
  actionAt: string;
}

export interface MeasurementRow {
  userId: string;
  insightId: string;
  detectorId: string;
  metricKey: string;
  outcomeOf: 'acted' | 'dismissed';
  actionAt: string;
  horizonDays: number;
  valueBefore: number | null;
  valueAfter: number | null;
  direction: 'above' | 'below';
  verdict: MovementVerdict;
  changePercent: number | null;
}

export class MeasurementRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Insights whose horizon has passed and that have not been measured at it.
   *
   * ⟨unscoped-by-design⟩ Cron-facing: sweeps every business.
   *
   * Two separate reads rather than one anti-join, because PostgREST cannot
   * express `NOT EXISTS` against another table. The candidate set is small --
   * insights acted on or dismissed, which on this platform is currently one --
   * so filtering in memory costs nothing and keeps the query readable.
   */
  async findDue(horizonDays: number, limit = 200): Promise<DueInsight[]> {
    const cutoff = new Date(Date.now() - horizonDays * DAY_MS).toISOString();

    const { data, error } = await this.supabase
      .from('insights')
      .select('id, user_id, detector_id, metric_key, direction, acted_at, dismissed_at')
      .or(`acted_at.lte.${cutoff},dismissed_at.lte.${cutoff}`)
      .not('metric_key', 'is', null)
      .limit(limit);

    if (error) throw error;

    const candidates = (data ?? []) as Array<{
      id: string;
      user_id: string;
      detector_id: string;
      metric_key: string;
      direction: string | null;
      acted_at: string | null;
      dismissed_at: string | null;
    }>;

    if (candidates.length === 0) return [];

    const { data: done, error: doneError } = await this.supabase
      .from('insight_measurements')
      .select('insight_id')
      .eq('horizon_days', horizonDays)
      .in(
        'insight_id',
        candidates.map(c => c.id)
      );

    if (doneError) throw doneError;

    const measured = new Set(
      ((done ?? []) as Array<{ insight_id: string }>).map(r => r.insight_id)
    );

    return candidates
      .filter(c => !measured.has(c.id))
      .map(c => {
        /*
         * Acting wins over dismissing when both are stamped. A card that was
         * dismissed and later acted on is an ACTED card -- the dismissal was
         * reconsidered, and counting it in the control group would put the
         * same insight on both sides of the comparison.
         */
        const acted = c.acted_at;
        const outcomeOf: 'acted' | 'dismissed' = acted ? 'acted' : 'dismissed';
        const actionAt = acted ?? c.dismissed_at;

        if (!actionAt) return null;

        /*
         * `direction` decides what "better" means, so a row without one cannot
         * be judged at all. Skipped rather than defaulted: guessing `above`
         * would report every utilisation recovery as a decline.
         */
        if (c.direction !== 'above' && c.direction !== 'below') {
          logger.debug(
            { insightId: c.id, detectorId: c.detector_id },
            'Insight has no breach direction; cannot judge improvement'
          );
          return null;
        }

        return {
          id: c.id,
          userId: c.user_id,
          detectorId: c.detector_id,
          metricKey: c.metric_key,
          direction: c.direction,
          outcomeOf,
          actionAt,
        };
      })
      .filter((d): d is DueInsight => d !== null);
  }

  /**
   * The mean of a metric over the window ending at `endingAt`.
   *
   * `periodType` is passed in rather than chosen here, so both readings of a
   * pair are guaranteed to come from the same series — mixing a daily reading
   * with a monthly one is the population error this file exists to avoid.
   *
   * Null when the window holds no rows: "we do not know", which the caller
   * stores as `unmeasurable` rather than treating as zero.
   */
  async readMetricAt(
    userId: string,
    metricKey: string,
    periodType: string,
    endingAt: Date
  ): Promise<number | null> {
    const from = new Date(endingAt.getTime() - READING_WINDOW_DAYS * DAY_MS).toISOString();

    const { data, error } = await this.supabase
      .from('derived_metrics')
      .select('value')
      .eq('user_id', userId)
      .eq('metric_key', metricKey)
      .eq('period_type', periodType)
      .gte('period_start', from)
      .lte('period_start', endingAt.toISOString());

    if (error) throw error;

    const values = ((data ?? []) as Array<{ value: number | string | null }>)
      .map(r => Number(r.value))
      .filter(v => Number.isFinite(v));

    if (values.length === 0) return null;

    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Which series this metric actually has, so both readings use one.
   *
   * The newest row's `period_type` wins. Null when the metric has no series at
   * all, which is the common case for detectors that compute straight from
   * module tables — and the reason `unmeasurable` is a stored verdict.
   */
  async resolvePeriodType(userId: string, metricKey: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('derived_metrics')
      .select('period_type')
      .eq('user_id', userId)
      .eq('metric_key', metricKey)
      .order('period_start', { ascending: false })
      .limit(1);

    if (error) throw error;

    const row = ((data ?? []) as Array<{ period_type: string | null }>)[0];
    return row?.period_type ?? null;
  }

  /**
   * Store one reading.
   *
   * The unique index on `(insight_id, horizon_days)` is the idempotency
   * guarantee: a re-run can only attempt rows that already exist, and the
   * conflict is swallowed here rather than failing the sweep. Nothing external
   * happens — no send, no charge — so this needs no claim/lease.
   */
  async record(row: MeasurementRow): Promise<'written' | 'already'> {
    const { error } = await this.supabase.from('insight_measurements').insert({
      user_id: row.userId,
      insight_id: row.insightId,
      detector_id: row.detectorId,
      metric_key: row.metricKey,
      outcome_of: row.outcomeOf,
      action_at: row.actionAt,
      horizon_days: row.horizonDays,
      value_before: row.valueBefore,
      value_after: row.valueAfter,
      direction: row.direction,
      verdict: row.verdict,
      change_percent: row.changePercent,
    });

    // 23505 = unique_violation: another run got there first.
    if (error?.code === '23505') return 'already';
    if (error) throw error;

    return 'written';
  }
}
