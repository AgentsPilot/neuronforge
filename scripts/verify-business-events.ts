/**
 * Evidence that every business event is captured, with nothing counted twice.
 *
 * Two independent questions, answered separately because they have different
 * failure modes and different fixes:
 *
 *   COMPLETENESS   For every event type, is the number of events on the rail
 *                  equal to the number derivable from the module tables? A
 *                  shortfall is a write path that never emitted.
 *
 *   UNIQUENESS     Does the same (user, event_type, entity_id) appear twice
 *                  WITHIN SECONDS? That is a race or two writers for one type,
 *                  and both have happened here.
 *
 *                  Not merely "appears twice": some transitions legitimately
 *                  recur. A booking can be cancelled, reinstated and cancelled
 *                  again, and a refund can go partial and then full -- two real
 *                  events on one entity. Treating those as duplicates would
 *                  demand deleting true history to make a check go green. What
 *                  cannot be legitimate is the same transition twice inside the
 *                  same moment, which is the signature of the non-atomic
 *                  read-then-write that produced `booking.completed` three
 *                  times in 0.7 seconds.
 *
 * Derivation is shared with `backfill-business-events.ts` on purpose: the same
 * function decides what SHOULD exist and what to write, so the verifier cannot
 * drift from the thing it is verifying.
 *
 * USAGE
 *   npx tsx --env-file=.env.local scripts/verify-business-events.ts
 *   npx tsx --env-file=.env.local scripts/verify-business-events.ts --user=<uuid>
 *
 * Exits non-zero when either question fails, so it can gate a deploy.
 */

import { createClient } from '@supabase/supabase-js';
import { derivableEvents, eventKey } from './backfill-business-events';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing Supabase env. Run with: npx tsx --env-file=.env.local ...');
  process.exit(1);
}

const supabase = createClient(url, key);
const ONE_USER = process.argv.find(a => a.startsWith('--user='))?.slice('--user='.length);

/**
 * Events the application owns rather than the triggers.
 *
 * `enquiry.received` and `form.submitted` are judgements about app state that
 * no table transition can observe, so nothing derives them and their absence
 * from a completeness check is correct rather than a gap.
 */
const NOT_DERIVABLE = new Set(['enquiry.received', 'form.submitted']);

/**
 * Types with no trigger and no application writer, and why.
 *
 * Printed rather than silently omitted: a gap nobody can see reads as a gap
 * nobody has, and this is the list that stops the next person re-deriving it.
 */
const CANNOT_BE_CAPTURED: Record<string, string> = {
  'enquiry.stalled': 'a condition that becomes true while nothing is written; needs a cron',
  'ar.aged': 'same: time passing is not a row change',
  'calendar.slot_filled': 'no slot entity; utilisation is measured from the calendar directly',
  'calendar.utilization_high': 'same',
  'calendar.utilization_low': 'same',
  'discount.applied': 'no discount column exists anywhere',
  'intro_offer.used': 'no intro/trial column exists',
  'intro_offer.converted': 'no intro/trial column exists',
  'invoice.viewed': 'payment_invoices has sent_at but no viewed_at',
  'form.abandoned': 'client-side only',
  'lead.qualified': 'a judgement no column records',
  'client.at_risk': 'a conclusion, i.e. detector output',
  'client.churned': 'a conclusion, i.e. detector output',
  'client.rebooking_due': 'a conclusion, i.e. detector output',
  'revenue.recognized': 'an aggregate over invoice.paid, not a thing that happens',
};

/**
 * Two of the same event closer together than this did not both really happen.
 *
 * A human reinstating a booking and cancelling it again takes longer than a
 * minute; two concurrent requests racing the same write take milliseconds. The
 * live incident spanned 0.7 seconds.
 */
const RACE_WINDOW_MS = 60_000;

async function main() {
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

  const missingByType = new Map<string, number>();
  const presentByType = new Map<string, number>();
  let races: { key: string; count: number; withinMs: number }[] = [];
  let repeats: { key: string; count: number }[] = [];
  let railTotal = 0;

  for (const userId of users) {
    const [derivable, recorded] = await Promise.all([
      derivableEvents(supabase, userId),
      supabase
        .from('business_events')
        .select('event_type, entity_id, created_at')
        .eq('user_id', userId)
        .then(({ data, error }) => {
          if (error) throw new Error(`rail read: ${error.message}`);
          return data ?? [];
        }),
    ]);

    railTotal += recorded.length;

    // UNIQUENESS
    const stamps = new Map<string, number[]>();
    for (const r of recorded) {
      const k = eventKey(r as { event_type: string; entity_id: string });
      const t = new Date(String((r as { created_at: string }).created_at)).getTime();
      if (!stamps.has(k)) stamps.set(k, []);
      stamps.get(k)!.push(t);
    }

    for (const [k, times] of stamps) {
      if (times.length < 2) continue;
      times.sort((a, b) => a - b);

      /*
       * Tightest gap between any two of them. One pair inside the window makes
       * the whole group a race; otherwise it is a sequence of real transitions.
       */
      let tightest = Infinity;
      for (let i = 1; i < times.length; i++) {
        tightest = Math.min(tightest, times[i] - times[i - 1]);
      }

      const label = `${userId.slice(0, 8)} ${k}`;
      if (tightest <= RACE_WINDOW_MS) {
        races.push({ key: label, count: times.length, withinMs: tightest });
      } else {
        repeats.push({ key: label, count: times.length });
      }
    }

    const counts = stamps;

    // COMPLETENESS
    const onRail = new Set(counts.keys());
    for (const d of derivable) {
      const type = d.event_type;
      if (onRail.has(eventKey(d))) {
        presentByType.set(type, (presentByType.get(type) ?? 0) + 1);
      } else {
        missingByType.set(type, (missingByType.get(type) ?? 0) + 1);
      }
    }
  }

  const types = [...new Set([...presentByType.keys(), ...missingByType.keys()])].sort();
  const totalMissing = [...missingByType.values()].reduce((a, b) => a + b, 0);

  console.log(`\nAccounts checked: ${users.length}   Events on the rail: ${railTotal}\n`);
  console.log('COMPLETENESS — derivable events present on the rail');
  console.log('  event type            on rail   missing');
  for (const t of types) {
    const present = presentByType.get(t) ?? 0;
    const missing = missingByType.get(t) ?? 0;
    const flag = missing > 0 ? '  <-- GAP' : '';
    console.log(`  ${t.padEnd(22)}${String(present).padStart(7)}${String(missing).padStart(10)}${flag}`);
  }

  console.log('\nUNIQUENESS — the same transition twice inside 60s (a race)');
  if (races.length === 0) {
    console.log('  none');
  } else {
    races = races.sort((a, b) => a.withinMs - b.withinMs);
    for (const d of races.slice(0, 15)) {
      console.log(`  x${d.count}  ${d.key}   closest pair ${d.withinMs}ms apart`);
    }
    if (races.length > 15) console.log(`  ... and ${races.length - 15} more`);
  }

  console.log('\nRepeat transitions, spread out — real history, not a defect');
  if (repeats.length === 0) {
    console.log('  none');
  } else {
    for (const d of repeats.sort((a, b) => b.count - a.count).slice(0, 10)) {
      console.log(`  x${d.count}  ${d.key}`);
    }
  }

  const appOwned = [...NOT_DERIVABLE].join(', ');
  console.log(`\nNot derivable by design (application-owned): ${appOwned}`);

  console.log(`\nNOT CAPTURABLE — ${Object.keys(CANNOT_BE_CAPTURED).length} types, with the reason`);
  for (const [type, why] of Object.entries(CANNOT_BE_CAPTURED)) {
    console.log(`  ${type.padEnd(24)} ${why}`);
  }

  const ok = totalMissing === 0 && races.length === 0;
  console.log(
    `\n${ok ? 'PASS' : 'FAIL'} — ${totalMissing} missing, ${races.length} raced` +
    `, ${repeats.length} legitimate repeat${repeats.length === 1 ? '' : 's'}`
  );
  if (!ok) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
