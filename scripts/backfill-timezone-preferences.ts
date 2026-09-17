/**
 * Bring `user_preferences.timezone` into line with `profiles.timezone`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * The timezone was written to two columns by two different surfaces and read by
 * a third set of callers. `/api/user/profile` wrote `profiles.timezone`; the
 * settings page wrote `user_preferences.timezone`; the availability API, the
 * booking routes, every client-facing email and the language provider all read
 * the latter. Nothing kept them in step.
 *
 * The route now mirrors a change into `user_preferences`, which stops NEW drift.
 * This closes the drift already in the data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH SIDE WINS, AND WHY
 *
 * `profiles`, but only where `user_preferences` still holds the UTC default.
 *
 * UTC is what an untouched row says. A row saying `Asia/Jerusalem` is one
 * somebody deliberately set. Preferring the deliberate value over the default
 * is the only inference here, and it is a narrow one: where BOTH sides hold a
 * real zone and they differ, this changes nothing and reports the row, because
 * guessing which of two intentional settings is current is not something a
 * migration should decide.
 *
 * Nothing about a booking is touched. `start_time` is an absolute instant and
 * stays exactly as it is; this only changes which wall clock it is read
 * against. Displayed times WILL move for the affected accounts — that is the
 * point, since they were being shown on the wrong clock.
 *
 * Usage:
 *   npx tsx scripts/backfill-timezone-preferences.ts          # dry run
 *   npx tsx scripts/backfill-timezone-preferences.ts --apply
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** A zone Intl can actually resolve. A hand-edited row can be anything. */
function usable(zone: string | null | undefined): zone is string {
  if (!zone?.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { data: profiles, error: profileError } = await db
    .from('profiles')
    .select('id, timezone')
    .not('timezone', 'is', null);

  if (profileError) throw profileError;

  const { data: prefs, error: prefsError } = await db
    .from('user_preferences')
    .select('user_id, timezone');

  if (prefsError) throw prefsError;

  const current = new Map((prefs ?? []).map(row => [row.user_id, row.timezone as string | null]));

  const toUpdate: Array<{ userId: string; from: string | null; to: string }> = [];
  const conflicts: Array<{ userId: string; profiles: string; prefs: string }> = [];
  let alreadyAligned = 0;
  let unusable = 0;

  for (const profile of profiles ?? []) {
    const wanted = profile.timezone as string;
    if (!usable(wanted)) {
      unusable++;
      console.warn(`  ! ${profile.id.slice(0, 8)} profiles.timezone is not a resolvable zone: ${wanted}`);
      continue;
    }

    const existing = current.get(profile.id);

    if (existing === wanted) {
      alreadyAligned++;
      continue;
    }

    // Only the default gives way. Two deliberate values in conflict are reported.
    if (existing && existing !== 'UTC' && usable(existing)) {
      conflicts.push({ userId: profile.id, profiles: wanted, prefs: existing });
      continue;
    }

    toUpdate.push({ userId: profile.id, from: existing ?? null, to: wanted });
  }

  console.log('');
  console.log(`  aligned already   ${alreadyAligned}`);
  console.log(`  to relabel        ${toUpdate.length}`);
  console.log(`  conflicts (kept)  ${conflicts.length}`);
  console.log(`  unusable zone     ${unusable}`);
  console.log('');

  for (const row of toUpdate) {
    console.log(`  ${row.userId.slice(0, 8)}  user_preferences ${row.from ?? '(no row)'} -> ${row.to}`);
  }
  for (const row of conflicts) {
    console.log(`  ${row.userId.slice(0, 8)}  CONFLICT profiles=${row.profiles} prefs=${row.prefs} (left alone)`);
  }

  if (!APPLY) {
    console.log('');
    console.log('  Dry run. Re-run with --apply to write.');
    return;
  }

  let written = 0;
  for (const row of toUpdate) {
    const { error } = await db
      .from('user_preferences')
      .upsert(
        { user_id: row.userId, timezone: row.to, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error(`  x ${row.userId.slice(0, 8)} failed: ${error.message}`);
      continue;
    }
    written++;
  }

  console.log('');
  console.log(`  wrote ${written} of ${toUpdate.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
