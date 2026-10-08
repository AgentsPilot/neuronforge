/**
 * What the model is told about a business, and what it is deliberately not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The model's job is to notice a SHAPE worth asking about, then write the query
 * that would settle it. For that it needs to know what this business has enough
 * of to group by, and roughly how its numbers have moved. It does not need to
 * know who anybody is.
 *
 * SO NO PEOPLE, AND NO OWNER TEXT.
 *
 * No client names, no emails, no message bodies, no chat questions. Partly
 * privacy -- `bos-llm-call-standards` Standard 5 forbids owner text in logs and
 * the same reasoning applies to a prompt -- and partly quality: given a name,
 * a model reaches for it, and "David never rebooks" is a claim about one person
 * that the verifier will throw away for lack of a denominator. Shapes produce
 * answerable questions; names produce anecdotes.
 *
 * WHY COUNTS AND NOT ROWS
 *
 * A row dump would be larger, slower, more expensive, and would invite the
 * model to do arithmetic -- which is the one thing this design never lets it
 * do. Counts tell it what can be grouped; the query it writes does the rest.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { renderCatalogForPrompt } from '../../bizql/planner/catalogPrompt';
import { AuditTrailRepository } from '@/lib/repositories/AuditTrailRepository';
import { MIN_ROWS_FLOOR } from './verify';

const logger = createLogger({ module: 'hypothesisProfile' });

/** How far back the behaviour and metric history is summarised. */
const BEHAVIOUR_DAYS = 30;
const METRIC_PERIODS = 12;

/**
 * Entities worth telling the model it has.
 *
 * Each maps to a catalog entity the model can write a query against, so there
 * is no point reporting a count for something it cannot then group.
 */
const COUNTED_TABLES = [
  'scheduling_bookings',
  'payment_invoices',
  'payment_transactions',
  'proposals',
  'crm_contacts',
  'scheduling_services',
] as const;

export interface BusinessProfile {
  /** Row counts, so the model knows what has enough behind it to group. */
  counts: Record<string, number>;
  /**
   * Recent metric history: key, period type, and the ordered values.
   *
   * The VALUES matter more than any average. The finding that prompted this
   * feature is visible only in the sequence: `[0,0,0,0,0,100,100]` is a
   * bimodal repeat rate, and a mean of 28.6 hides exactly the thing worth
   * saying about it.
   */
  metrics: Array<{ key: string; periodType: string; values: number[] }>;
  /** What the owner did by hand, by action, in the window. */
  behaviour: Array<{ action: string; count: number; days: number }>;
  /** The catalog, so a proposed query can name real entities and fields. */
  catalog: string;
  /** Stated so the prompt can say what window everything covers. */
  windowDays: number;
}

export async function buildProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<BusinessProfile> {
  const since = new Date(Date.now() - BEHAVIOUR_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const counts: Record<string, number> = {};
  await Promise.all(
    COUNTED_TABLES.map(async table => {
      const { count, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      /*
       * A table that cannot be read is OMITTED, not reported as zero.
       *
       * Zero would tell the model "you have no invoices", and it would then
       * propose nothing about invoices -- a silent narrowing caused by an
       * error. Absent at least cannot be reasoned from.
       */
      if (error) {
        logger.warn({ err: error, userId, table }, 'Count unavailable; omitted from the profile');
        return;
      }
      counts[table] = count ?? 0;
    })
  );

  /*
   * The metric history, ordered oldest first.
   *
   * Only non-trivial series: a key whose every value is zero says nothing
   * except that its event never fired, and sending dozens of flat zeros
   * crowds out the series that have something in them. `derived_metrics` on a
   * young account is mostly zeros.
   */
  const metrics: BusinessProfile['metrics'] = [];
  const { data: metricRows, error: metricError } = await supabase
    .from('derived_metrics')
    .select('metric_key, period_type, period_start, value')
    .eq('user_id', userId)
    .order('period_start', { ascending: true });

  if (metricError) {
    logger.warn({ err: metricError, userId }, 'Metric history unavailable');
  } else {
    const series = new Map<string, number[]>();
    for (const row of metricRows ?? []) {
      const key = `${row.metric_key}|${row.period_type}`;
      const list = series.get(key) ?? [];
      list.push(Number(row.value) || 0);
      series.set(key, list);
    }

    for (const [key, values] of series) {
      const recent = values.slice(-METRIC_PERIODS);
      if (recent.every(v => v === 0)) continue;

      const [metricKey, periodType] = key.split('|');
      metrics.push({ key: metricKey, periodType, values: recent });
    }
  }

  /*
   * What the owner did themselves.
   *
   * Through `AuditTrailRepository.countOwnerActionsSince`, which applies the
   * BD-26 owner exclusions and filters out the agent platform's telemetry --
   * `audit_trail` is shared, and the agent side outnumbers Business OS in it.
   * Counts only: the repository returns no `details` or `changes`, so no owner
   * text can reach a prompt through this path even by mistake.
   */
  const behaviour: BusinessProfile['behaviour'] = [];
  const auditRepo = new AuditTrailRepository(supabase);
  const { data: tallies, error: behaviourError } = await auditRepo.countOwnerActionsSince(
    userId,
    since
  );

  if (behaviourError) {
    logger.warn({ err: behaviourError, userId }, 'Owner behaviour unavailable');
  } else {
    for (const tally of tallies ?? []) {
      behaviour.push({ action: tally.action, count: tally.count, days: tally.days.size });
    }
  }

  return {
    counts,
    metrics,
    behaviour,
    /*
     * The whole catalog, read-only.
     *
     * `includeActions` stays false: a hypothesis is a question, and a model
     * offered write verbs in the same breath may propose one. The verifier only
     * runs `op: 'compute'`, so a write could never execute -- but not offering
     * it is cheaper than relying on that.
     */
    catalog: renderCatalogForPrompt({ includeActions: false }),
    windowDays: BEHAVIOUR_DAYS,
  };
}

/**
 * The point at which asking a model is worth the call.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Raised from `MIN_ROWS_FLOOR * 4` (20) after watching it run. 20 rows is the
 * arithmetic minimum for the VERIFIER -- four groups of five -- and at that
 * volume every proposal the model returned was a tautology: "some services have
 * more bookings than others", which is what five small numbers always look like.
 *
 * The verifier's floor answers "can this comparison be computed". This answers
 * a different question: "is there enough here that a comparison could SURPRISE
 * anybody". On a business with four clients the owner already knows everything
 * there is to know, so the honest answer is no, however well-evidenced the
 * arithmetic.
 *
 * `MIN_ROWS_FLOOR * 30` is a judgement, not a derivation, and it is written as a
 * multiple of the floor so the two move together. It means roughly: six groups
 * that each clear the floor five times over. Lower it when a real account is
 * producing findings worth reading and this is what holds them back -- that is
 * evidence. Raising it on a hunch is not.
 *
 * This is also why the weekly cron stays SCHEDULED rather than switched off: the
 * gate decides, so an account that grows into it starts being asked without
 * anybody remembering to turn something on.
 * ───────────────────────────────────────────────────────────────────────────
 */
const MIN_ROWS_IN_ONE_ENTITY = MIN_ROWS_FLOOR * 30;

/**
 * Is there enough here to be worth asking a model about?
 *
 * Checked BEFORE the call, so a brand-new account costs nothing. The test is
 * per-entity, not total: a thousand rows spread across six tables with twenty
 * each is six entities nothing can be grouped within, while thirty bookings in
 * one is a real question waiting to be asked. A grouped query lives inside one
 * entity, so that is the unit.
 *
 * Two non-flat metric series as well, because a profile with no movement in it
 * gives the model nothing to notice.
 */
export function worthAsking(profile: BusinessProfile): boolean {
  const largest = Math.max(0, ...Object.values(profile.counts));
  return largest >= MIN_ROWS_IN_ONE_ENTITY && profile.metrics.length >= 2;
}
