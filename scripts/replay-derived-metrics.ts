/**
 * Recompute `derived_metrics` over past periods, so baselines have something
 * real to average.
 *
 * WHY
 *
 * `BaselineCalculator` needs 7 daily, 4 weekly or 3 monthly samples before it
 * will call a baseline significant. Those periods already exist for this
 * account -- 32 daily rows -- and almost every value is ZERO, because the
 * metrics layer has been computing faithfully from an event rail that was not
 * emitting. Filling the rail (see `backfill-business-events.ts`) does not fix
 * them on its own: `insight-metrics` computes the CURRENT period, so yesterday's
 * row keeps yesterday's zero forever.
 *
 * `MetricsComputeService.computeAllMetrics` takes an arbitrary `periodStart`,
 * and `computeAndStoreMetric` upserts on
 * `(user_id, metric_key, period_type, period_start)`. So the past can simply be
 * recomputed, and re-running is harmless. That is the whole script.
 *
 * It means baselines are available NOW rather than after a week of waiting.
 *
 * USAGE
 *   npx tsx --env-file=.env.local scripts/replay-derived-metrics.ts --user=<uuid> --check
 *   npx tsx --env-file=.env.local scripts/replay-derived-metrics.ts --user=<uuid>
 *   npx tsx --env-file=.env.local scripts/replay-derived-metrics.ts --all
 */

import { createClient } from '@supabase/supabase-js';
import { MetricsComputeService } from '@/lib/business-os/insight/metrics/MetricsComputeService';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing Supabase env. Run with: npx tsx --env-file=.env.local ...');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const ALL = args.includes('--all');
const ONE_USER = args.find(a => a.startsWith('--user='))?.slice('--user='.length);

/**
 * How far back each period type is replayed.
 *
 * Comfortably past `BaselineCalculator`'s minimums (7 / 4 / 3) so a baseline is
 * significant the moment this finishes, with room for the lookback window to
 * slide without immediately falling under them again.
 */
const PERIODS: { type: 'daily' | 'weekly' | 'monthly'; count: number; days: number }[] = [
  { type: 'daily', count: 60, days: 1 },
  { type: 'weekly', count: 12, days: 7 },
  { type: 'monthly', count: 6, days: 30 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC, so a period boundary is stable across runs and machines. */
function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function replayForUser(userId: string): Promise<{ computed: number; nonZero: number }> {
  const service = new MetricsComputeService(supabase);
  const today = startOfDayUtc(new Date());

  let computed = 0;
  let nonZero = 0;

  for (const period of PERIODS) {
    for (let i = period.count; i >= 1; i--) {
      const periodStart = new Date(today.getTime() - i * period.days * DAY_MS);
      const periodEnd = new Date(periodStart.getTime() + period.days * DAY_MS);

      if (CHECK) {
        computed += 1;
        continue;
      }

      const { data, error } = await service.computeAllMetrics(
        userId,
        period.type,
        periodStart,
        periodEnd
      );

      if (error) {
        console.error(`    ${period.type} ${periodStart.toISOString().slice(0, 10)}: ${error.message}`);
        continue;
      }

      computed += data?.length ?? 0;
      nonZero += (data ?? []).filter(m => Number(m.value) !== 0).length;
    }
  }

  return { computed, nonZero };
}

async function main() {
  if (!ONE_USER && !ALL) {
    console.error('Pass --user=<uuid> or --all. Add --check to compute nothing.');
    process.exit(1);
  }

  let users: string[];
  if (ONE_USER) {
    users = [ONE_USER];
  } else {
    const [{ data: b }, { data: i }] = await Promise.all([
      supabase.from('scheduling_bookings').select('user_id'),
      supabase.from('payment_invoices').select('user_id'),
    ]);
    users = [...new Set([...(b ?? []), ...(i ?? [])].map(r => r.user_id).filter(Boolean))];
  }

  const totalPeriods = PERIODS.reduce((n, p) => n + p.count, 0);
  console.log(CHECK ? 'DRY RUN - nothing will be written' : 'Replaying derived metrics');
  console.log(`users: ${users.length}, periods per user: ${totalPeriods}\n`);

  for (const userId of users) {
    const { computed, nonZero } = await replayForUser(userId);
    console.log(
      CHECK
        ? `  ${userId}  would compute ${computed} periods`
        : `  ${userId}  ${computed} metric rows written, ${nonZero} non-zero`
    );
  }

  if (CHECK) console.log('\nRe-run without --check to apply.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
