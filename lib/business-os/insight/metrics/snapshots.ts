/**
 * Current-state metrics: what is true right now, written down so it becomes a series.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS
 *
 * `MetricsComputeService` aggregates `business_events`. Most detector metrics
 * are not events — they are STATES of the business read from module tables:
 * money still owed, links that do not open, clients who have gone quiet. A
 * state has nothing to count, so no event-derived definition can be written
 * for it, and the measurement sweep added in 20261006g therefore recorded
 * `unmeasurable` for 9 of the 11 metric keys live insights name (hazard H21).
 *
 * A state becomes measurable the moment somebody writes it down on a
 * schedule. That is all a snapshot is: today's value of a thing that has no
 * event, stored so that tomorrow's value can be compared with it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NULL IS A REAL ANSWER, AND THE MOST IMPORTANT ONE HERE.
 *
 * Every reader returns null rather than zero when it cannot answer. The caller
 * then writes NO ROW. A fabricated zero is indistinguishable from a
 * measurement: `BaselineCalculator` averages it into the mean, `percent_change`
 * is computed against it, and the measurement sweep reads two of them as "the
 * metric did not move". This module's whole value depends on that discipline —
 * a series of invented zeroes is worse than no series, because it looks like
 * data.
 *
 * Pure of the clock: each reader asks "what is true now". The period is the
 * caller's business, which is why these take no dates.
 *
 * @module lib/business-os/insight/metrics/snapshots
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import type { MetricKey, MetricUnit } from './types';
import { deadReason } from '../detectors/catalog/WebLinkDeadDestinationDetector';
import { buildClientStageFilter } from '@/lib/crm/StageTypeUtils';

const logger = createLogger({ module: 'InsightMetricSnapshots' });

export interface SnapshotReading {
  value: number;
  unit: MetricUnit;
  sampleSize: number;
  /**
   * Optional detail stored on the row.
   *
   * Numbers only, matching `ComputedMetricResult.breakdown` — widening that
   * shared type to carry a currency string would change what every existing
   * reader of the column can expect. The currency a figure is in therefore
   * stays out of here; it is in the invoices the figure came from, and the
   * refusal path logs it when it matters.
   */
  breakdown?: Record<string, number>;
}

/** Invoice statuses that mean the money is still owed. */
const OWED = ['sent', 'overdue', 'partial'];

/**
 * Money a business is still waiting for.
 *
 * ⚠️ REFUSES RATHER THAN SUMS ACROSS CURRENCIES.
 *
 * There is no FX rate anywhere in this platform, so adding ₪400 to $400 is
 * meaningless arithmetic that renders as an authoritative figure. CLAUDE.md
 * § Currency & Timezone makes this a standing rule, and the existing
 * `cashflow.ar_overdue_usd` snapshot quietly breaks it — its name says USD and
 * it sums whatever `amount` happens to hold.
 *
 * A single-currency business is the common case and gets a real series. A
 * business invoicing in two currencies gets null, which the sweep reports as
 * `unmeasurable`: honest, and visible in the breakdown of the log line. The
 * alternative — a per-currency series — needs a metric key per currency and is
 * a bigger change than this.
 */
async function arTotal(
  supabase: SupabaseClient,
  userId: string,
  unit: MetricUnit
): Promise<SnapshotReading | null> {
  const { data, error } = await supabase
    .from('payment_invoices')
    .select('amount, refunded_amount, currency')
    .eq('user_id', userId)
    .in('status', OWED);

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    amount: number | string | null;
    refunded_amount: number | string | null;
    currency: string | null;
  }>;

  if (rows.length === 0) {
    /*
     * Nothing owed is a REAL zero, not an absence: the business has been
     * invoicing and everything is settled. Unit stays whatever the definition
     * declares, and the currency question does not arise with no rows.
     */
    return { value: 0, unit, sampleSize: 0 };
  }

  const currencies = new Set(
    rows.map(r => (r.currency ?? '').trim().toUpperCase()).filter(Boolean)
  );

  if (currencies.size > 1) {
    logger.debug(
      { userId, currencies: [...currencies], invoices: rows.length },
      'AR spans more than one currency; refusing to sum'
    );
    return null;
  }

  /*
   * Net of refunds. An invoice part-refunded is owed for the remainder, and
   * `refunded_amount` is the column that records it — the same net the
   * payments module reports elsewhere.
   */
  const total = rows.reduce((sum, r) => {
    const amount = Number(r.amount) || 0;
    const refunded = Number(r.refunded_amount) || 0;
    return sum + Math.max(0, amount - refunded);
  }, 0);

  return {
    value: Math.round(total * 100) / 100,
    unit,
    sampleSize: rows.length,
    breakdown: { invoices: rows.length },
  };
}

/**
 * Active links that cannot open for anybody but the owner.
 *
 * Judged from the address with no network call, by the SAME `deadReason` the
 * detector uses — imported rather than re-implemented so the series and the
 * card can never disagree about what "broken" means. On the reporting account
 * this is how a smart link pointing at `http://localhost:3000` was found with
 * 27 clicks against it.
 *
 * A business with no active links at all returns null, not zero: "none of your
 * links are broken" is a different and misleading claim when there are no
 * links to break.
 */
async function brokenLinkDestinations(
  supabase: SupabaseClient,
  userId: string,
  unit: MetricUnit
): Promise<SnapshotReading | null> {
  const { data, error } = await supabase
    .from('smart_links')
    .select('code, destination_url')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) throw error;

  const links = (data ?? []) as Array<{ code: string; destination_url: string | null }>;

  if (links.length === 0) return null;

  const broken = links.filter(l => deadReason(l.destination_url) !== null);

  return {
    value: broken.length,
    unit,
    sampleSize: links.length,
    breakdown: { active_links: links.length, broken: broken.length },
  };
}

/**
 * How long a client goes quiet before they count as at risk.
 *
 * Thirty days, taken from `CrmEngagementDecayDetector` rather than chosen
 * here. The whole point of this series is to answer "did the number of
 * at-risk clients fall after she acted", and it cannot if the series and the
 * card that prompted her use different windows.
 */
const QUIET_DAYS = 30;

/**
 * Clients who have gone quiet.
 *
 * ⚠️ THREE DETECTORS WRITE `retention.clients_at_risk`, MEANING THREE
 * DIFFERENT THINGS — engagement decay, reschedule churn, a package ending. A
 * series can only have one definition, so this one is deliberately the
 * narrowest and most literal: **a client with no activity and no booking for
 * 30 days, whose relationship is at least that old.** Decided 2026-10-07.
 *
 * That is `CrmEngagementDecayDetector`'s definition, and every rule below is
 * imported or copied from it rather than re-derived:
 *
 *   - a "client" is a contact at a stage `buildClientStageFilter` calls one.
 *     Stages are rows in `crm_pipeline_stages` with a `stage_type`, NOT the
 *     literal string 'client' — reading `lifecycle_stage` is what held the
 *     retention vector dark platform-wide for weeks (hazard H14);
 *   - quiet means no `crm_activities` AND no `scheduling_bookings`. Either one
 *     alone would count a client who only ever books as silent;
 *   - a relationship younger than the window is excluded. Someone who became
 *     a client last week has not gone quiet, and counting them would make
 *     every new client briefly "at risk".
 *
 * Returns null when the business has no client stages configured or no clients
 * at all: zero at-risk clients out of zero clients is not a measurement.
 */
async function clientsAtRisk(
  supabase: SupabaseClient,
  userId: string,
  unit: MetricUnit
): Promise<SnapshotReading | null> {
  const clientStageKeys = await buildClientStageFilter(supabase, userId);
  if (clientStageKeys.length === 0) return null;

  const { data: clientRows, error } = await supabase
    .from('crm_contacts')
    .select('id, created_at')
    .eq('user_id', userId)
    .in('stage', clientStageKeys);

  if (error) throw error;

  const clients = (clientRows ?? []) as Array<{ id: string; created_at: string | null }>;
  if (clients.length === 0) return null;

  const quietBefore = new Date(Date.now() - QUIET_DAYS * 86_400_000);
  const since = quietBefore.toISOString();
  const clientIds = clients.map(c => c.id);

  const [{ data: activities }, { data: bookings }] = await Promise.all([
    supabase
      .from('crm_activities')
      .select('contact_id')
      .eq('user_id', userId)
      .in('contact_id', clientIds)
      .gte('activity_date', since),
    supabase
      .from('scheduling_bookings')
      .select('contact_id')
      .eq('user_id', userId)
      .gte('start_time', since),
  ]);

  const recent = new Set<string>();
  for (const a of (activities ?? []) as Array<{ contact_id: string | null }>) {
    if (a.contact_id) recent.add(a.contact_id);
  }
  for (const b of (bookings ?? []) as Array<{ contact_id: string | null }>) {
    if (b.contact_id) recent.add(b.contact_id);
  }

  /*
   * Only clients old enough to have gone quiet are even eligible, so the
   * denominator is that set rather than every client. Reporting "3 of 40" when
   * 25 of the 40 could not possibly qualify overstates how settled the
   * business is.
   */
  const eligible = clients.filter(c => {
    if (!c.created_at) return false;
    return new Date(c.created_at) < quietBefore;
  });

  if (eligible.length === 0) return null;

  const atRisk = eligible.filter(c => !recent.has(c.id));

  return {
    value: atRisk.length,
    unit,
    sampleSize: eligible.length,
    breakdown: { clients: clients.length, eligible: eligible.length, at_risk: atRisk.length },
  };
}

/**
 * Every snapshot reader, by the key it answers for.
 *
 * A key absent from this map is the signal `computeSnapshotMetric` logs and
 * refuses on — it writes nothing rather than a zero.
 */
const READERS: Partial<
  Record<
    MetricKey,
    (supabase: SupabaseClient, userId: string, unit: MetricUnit) => Promise<SnapshotReading | null>
  >
> = {
  'cashflow.ar_total': arTotal,
  'acquisition.broken_link_destinations': brokenLinkDestinations,
  'retention.clients_at_risk': clientsAtRisk,
};

/**
 * Read one current-state metric, or null when it cannot be answered.
 *
 * Never throws for a missing reader; a query error still propagates, because a
 * broken query is a bug and silence would hide it — the failure mode this
 * module spent a cycle removing.
 */
export async function readSnapshot(
  supabase: SupabaseClient,
  userId: string,
  metricKey: MetricKey,
  unit: MetricUnit
): Promise<SnapshotReading | null> {
  const reader = READERS[metricKey];
  if (!reader) return null;

  return reader(supabase, userId, unit);
}

/** Which keys have a reader. Used by the guard test, and by the engine's log. */
export function snapshotKeys(): MetricKey[] {
  return Object.keys(READERS) as MetricKey[];
}
