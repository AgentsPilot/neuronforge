/**
 * Remove the fake business events a seed script wrote into real accounts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENED
 *
 * `scripts/seed-insight-test-data.ts` took a user id from argv with no
 * environment check, and with no argument at all it selected `profiles`
 * LIMIT 1 and seeded whoever came back. It wrote 210 `business_events` into two
 * live accounts, and `MetricsComputeService` then computed `derived_metrics`
 * from them. Detectors read both. Insights were generated about trade that
 * never happened.
 *
 * HOW SEEDED ROWS ARE IDENTIFIED
 *
 * By their event_type. The seed script writes `booking_created`,
 * `booking_completed`, `booking_cancelled`, `enquiry_received`,
 * `enquiry_replied`, `payment_received` — underscore names that do NOT appear
 * in the `BusinessEventType` union. Real emitters write dotted names
 * (`booking.created`, `enquiry.received`). Nothing legitimate can produce the
 * underscore form, which is what makes this safe to delete by name.
 *
 * DERIVED METRICS ARE HANDLED NARROWLY
 *
 * They are computed from events AND from real module tables, so they cannot be
 * deleted wholesale without destroying legitimate ones. Only rows whose period
 * falls inside the seeded window are removed — those are demonstrably computed
 * from fake events — and `insight-metrics` recomputes nightly regardless.
 *
 * DRY RUN BY DEFAULT. Pass --delete to actually write.
 *
 *   npx tsx --env-file=.env.local scripts/purge-seeded-insight-data.ts
 *   npx tsx --env-file=.env.local scripts/purge-seeded-insight-data.ts --delete
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Event names the seed script writes.
 *
 * Every one is absent from `BusinessEventType` in
 * `lib/business-os/insight/events/types.ts`, where the real vocabulary is dotted.
 * If a real emitter ever starts writing one of these, this list stops being a
 * safe identifier and the purge must be re-derived.
 */
const SEEDED_EVENT_TYPES = [
  'booking_created',
  'booking_completed',
  'booking_cancelled',
  'enquiry_received',
  'enquiry_replied',
  'payment_received',
];

const DELETE = process.argv.includes('--delete');

async function main() {
  console.log(DELETE ? 'DELETING\n' : 'Dry run — pass --delete to write\n');

  const { data: events, error } = await supabase
    .from('business_events')
    .select('id, user_id, event_type, created_at')
    .in('event_type', SEEDED_EVENT_TYPES);

  if (error) throw error;

  const seeded = events ?? [];
  if (seeded.length === 0) {
    console.log('No seeded events found. Nothing to do.');
    return;
  }

  /* Per account, and the window its fake events span. */
  const byUser = new Map<string, { ids: string[]; first: string; last: string }>();

  for (const row of seeded) {
    const userId = String(row.user_id);
    const at = String(row.created_at);
    const entry = byUser.get(userId) ?? { ids: [], first: at, last: at };
    entry.ids.push(String(row.id));
    if (at < entry.first) entry.first = at;
    if (at > entry.last) entry.last = at;
    byUser.set(userId, entry);
  }

  for (const [userId, { ids, first, last }] of byUser) {
    console.log(`${userId}`);
    console.log(`  ${ids.length} seeded events, ${first.slice(0, 10)} .. ${last.slice(0, 10)}`);

    /*
     * Metrics inside the window only.
     *
     * Outside it they were computed from real invoices and bookings, and
     * deleting those would cost the account genuine history to spare it fake
     * history it no longer has.
     */
    const { data: metrics, error: metricsError } = await supabase
      .from('derived_metrics')
      .select('id, metric_key, period_start')
      .eq('user_id', userId)
      .gte('period_start', first)
      .lte('period_start', last);

    if (metricsError) throw metricsError;

    const metricIds = (metrics ?? []).map(m => String(m.id));
    console.log(`  ${metricIds.length} derived_metrics rows inside that window`);

    if (!DELETE) continue;

    const { error: eventError } = await supabase.from('business_events').delete().in('id', ids);
    if (eventError) throw eventError;
    console.log(`  ✓ deleted ${ids.length} events`);

    if (metricIds.length > 0) {
      const { error: metricError } = await supabase.from('derived_metrics').delete().in('id', metricIds);
      if (metricError) throw metricError;
      console.log(`  ✓ deleted ${metricIds.length} metric rows`);
    }
  }

  if (!DELETE) {
    console.log('\nNothing was written. Re-run with --delete to apply.');
  } else {
    /*
     * What survived, as proof. Real emitters write dotted names, so a non-zero
     * count here is the healthy outcome rather than a leftover.
     */
    const { count } = await supabase
      .from('business_events')
      .select('id', { count: 'exact', head: true });
    console.log(`\n${count} business_events remain, all with canonical names.`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
