/**
 * Run every detector against every real account and print what it would say.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every insight bug found in this module was found by a person reading a card,
 * never by a test — because the unit tests mock Supabase and assert the
 * arithmetic, so they confirm a detector computes what it was written to
 * compute. The bug is always that what it was written to compute is not true
 * about a real business:
 *
 *   a calendar "100% empty" from a metric nothing feeds
 *   "$2,400 of potential revenue" from an invented £75 an hour
 *   "a 100% increase in risk" against a baseline of nothing
 *   an insight firing on a business six days old with two bookings
 *
 * All four are obvious in one screen of this output and invisible in a test
 * suite. Run it before shipping any detector change.
 *
 * READ-ONLY. It evaluates detectors and prints; it writes nothing, creates no
 * insights and sends nothing. Cooldowns are bypassed so every detector reports,
 * which is the point — you want to see what it WOULD say.
 *
 *   npx tsx --env-file=.env.local scripts/insight-dry-run.ts            # all accounts
 *   npx tsx --env-file=.env.local scripts/insight-dry-run.ts <userId>   # one
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { DetectorEngine } from '../lib/business-os/insight/detectors/DetectorEngine';
import type { DetectionResult } from '../lib/business-os/insight/detectors/types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Row {
  detectorId: string;
  severity: string;
  count: number;
  money: number | null;
  percentChange: number;
  entityType: string;
  entityIdCount: number;
  pairedProcessId: string | null;
  note: string;
}

/**
 * What each process can act on — mirrors `PROCESS_EFFECTS` in
 * `automation/InsightActionEnqueuer.ts`, the gate the runtime applies when the
 * owner presses "Handle it for me". A process missing here sends nothing.
 */
const PROCESS_ENTITY_TYPES: Record<string, string[]> = {
  chase_overdue_invoices: ['invoice'],
  send_followup_nudge: ['contact'],
  send_reminder_sequence: ['booking', 'session'],
};

/** Everything a card could state, so a wrong figure is visible here. */
function describe(result: DetectionResult): Row {
  return {
    detectorId: result.detectorId,
    severity: result.severity,
    count: result.affectedCount ?? 0,
    money: result.estimatedImpactUsd ?? null,
    percentChange: result.percentChange ?? 0,
    entityType: String(result.affectedEntityType ?? '—'),
    entityIdCount: (result.affectedEntityIds ?? []).length,
    pairedProcessId: result.pairedProcessId ?? null,
    note: JSON.stringify(result.processParameters ?? {}).slice(0, 90),
  };
}

async function accounts(): Promise<string[]> {
  const argv = process.argv[2];
  if (argv) return [argv];

  const { data } = await supabase.from('business_profiles').select('user_id');
  return (data ?? []).map(r => String(r.user_id));
}

async function main() {
  const userIds = await accounts();
  const engine = new DetectorEngine(supabase);
  // `detectors` is private; this script is the one legitimate reader of it.
  const detectors = (engine as unknown as { detectors: Array<{
    definition: { id: string };
    evaluate: (u: string) => Promise<DetectionResult | null>;
    isOnCooldown?: unknown;
  }> }).detectors;

  console.log(`${detectors.length} detectors × ${userIds.length} accounts\n`);

  let totalFired = 0;
  const threw: string[] = [];
  const suspicious: string[] = [];

  for (const userId of userIds) {
    const rows: Row[] = [];

    for (const detector of detectors) {
      // Cooldowns hide what a detector would say; this is a dry run.
      (detector as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown =
        async () => false;

      try {
        const result = await detector.evaluate(userId);
        if (result) rows.push(describe(result));
      } catch (error) {
        threw.push(`${userId.slice(0, 8)} ${detector.definition.id}: ${(error as Error).message.slice(0, 80)}`);
      }
    }

    totalFired += rows.length;
    console.log(`── ${userId.slice(0, 8)} ──  ${rows.length} would fire`);

    for (const row of rows) {
      const money = row.money === null ? '' : `  money=${Math.round(row.money)}`;
      const pct = row.percentChange === 0 ? '' : `  pct=${row.percentChange}`;
      console.log(`   ${row.severity.padEnd(8)} ${row.detectorId.padEnd(28)} n=${String(row.count).padEnd(4)}${money}${pct}`);
      console.log(`            ${row.note}`);

      /*
       * The shapes that have been wrong before. Not errors — a prompt to look.
       */
      if (row.percentChange !== 0 && row.count <= 1) {
        suspicious.push(`${row.detectorId}: reports a ${row.percentChange}% change from ${row.count} thing(s)`);
      }
      if (row.money !== null && row.count === 0) {
        suspicious.push(`${row.detectorId}: names money with nothing affected`);
      }
      /*
       * Would the button work?
       *
       * `affectedEntityType` is decided inside `evaluate`, so no static test can
       * see it — but it is what `enqueueInsightActions` checks, and a mismatch
       * is a 400 the owner reads as a broken button. Three detectors shipped
       * that way. This is the only place it can be caught before they do.
       */
      if (row.pairedProcessId) {
        const accepts = PROCESS_ENTITY_TYPES[row.pairedProcessId];
        if (!accepts) {
          suspicious.push(`${row.detectorId}: offers ${row.pairedProcessId}, which sends nothing`);
        } else if (!accepts.includes(row.entityType)) {
          suspicious.push(
            `${row.detectorId}: offers ${row.pairedProcessId} (needs ${accepts.join('/')}) but reports ${row.entityType}`
          );
        } else if (row.entityIdCount === 0) {
          suspicious.push(`${row.detectorId}: offers an action with no ${row.entityType} ids to act on`);
        }
      }
    }
    console.log();
  }

  console.log(`${totalFired} detections across ${userIds.length} accounts`);

  if (threw.length) {
    console.log(`\n⚠ ${threw.length} threw:`);
    for (const t of threw) console.log('  ', t);
  }

  if (suspicious.length) {
    console.log(`\n⚠ worth a look:`);
    for (const s of [...new Set(suspicious)]) console.log('  ', s);
  }

  if (!threw.length && !suspicious.length) console.log('\nNothing suspicious.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
