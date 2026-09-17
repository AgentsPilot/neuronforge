/**
 * Relabel bookings stamped with a zone that is not their business's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES NOT DO
 *
 * It never touches `start_time`. Those values are correct: an instant with an
 * offset, which is what makes overlap checks, reminders and every cron fire at
 * the right moment. Only the LABEL is wrong, and the label is what the client's
 * email formats against.
 *
 * Moving the instant would be the destructive version of this fix and would
 * turn a cosmetic mismatch into real appointments at the wrong hour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT SKIPS OWNERS STILL ON UTC
 *
 * `user_preferences.timezone` defaults to `UTC`, and for most accounts that is
 * not a decision, it is an unanswered question. Relabelling a booking to UTC
 * would be writing that non-answer into a second place. Set the real zone in
 * Settings first, then run this.
 *
 * Usage:
 *   npx tsx scripts/backfill-booking-timezones.ts          # dry run
 *   npx tsx scripts/backfill-booking-timezones.ts --apply  # write
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const { data: prefs } = await db.from('user_preferences').select('user_id, timezone');
  const zoneOf = new Map((prefs ?? []).map(p => [p.user_id, p.timezone as string]));

  const { data: bookings } = await db
    .from('scheduling_bookings')
    .select('id, user_id, start_time, timezone, status');

  let wrong = 0, noPref = 0;
  for (const b of bookings ?? []) {
    const want = zoneOf.get(b.user_id as string);
    if (!want || want === 'UTC') { noPref++; continue; }
    if (b.timezone !== want) {
      wrong++;
      const d = new Date(b.start_time as string);
      console.log(`${(b.id as string).slice(0,8)}  ${b.timezone ?? 'NULL'} -> ${want}   ` +
        `${d.toLocaleString('en-US',{timeZone:b.timezone||'UTC',hour:'numeric',minute:'2-digit'})} reads as ` +
        `${d.toLocaleString('en-US',{timeZone:want,hour:'numeric',minute:'2-digit'})}`);
    }
  }
  console.log(`\ntotal bookings: ${bookings?.length ?? 0}`);
  console.log(`would relabel:  ${wrong}`);
  console.log(`skipped (owner has no real zone set yet): ${noPref}`);

  if (!process.argv.includes('--apply')) {
    console.log('\nDry run. Re-run with --apply to write these labels.');
    return;
  }

  let written = 0;
  for (const b of bookings ?? []) {
    const want = zoneOf.get(b.user_id as string);
    if (!want || want === 'UTC' || b.timezone === want) continue;
    const { error } = await db
      .from('scheduling_bookings')
      .update({ timezone: want })
      .eq('id', b.id as string);
    if (error) console.log(`FAILED ${(b.id as string).slice(0,8)}: ${error.message}`);
    else written++;
  }
  console.log(`\nrelabelled ${written} bookings. No start_time was changed.`);
})();
