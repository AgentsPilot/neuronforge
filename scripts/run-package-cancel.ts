/**
 * Cancel the ADHD package through the REAL service, from the command line.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * The cascade cannot be proved by reading it. Every statement in it has been
 * smoke-tested against the live database, but the thing that broke last time
 * was not a statement — it was a throw, swallowed by a catch that only logs, so
 * the code looked right and did nothing.
 *
 * This calls `cancelBooking` exactly as the API route does, with the same
 * arguments the drawer sends. Same module, same order, same side effects. If it
 * throws anywhere, the throw surfaces here instead of being written to a log
 * nobody is reading.
 *
 * IT SENDS A REAL EMAIL, because the route does and the point is to exercise
 * the whole thing. Pass --quiet to suppress it.
 *
 *   npx tsx scripts/run-package-cancel.ts
 *   npx tsx scripts/run-package-cancel.ts --quiet
 *
 * `scripts/reset-package-cancel-test.mjs --apply` puts it all back.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const QUIET = process.argv.includes('--quiet');

/** The booking the drawer's cancel button sends: the quote's own row. */
const BOOKING = 'ae0543f1-d504-4aca-9ecf-967d29fe7275';
const PACKAGE = 'f00da6a7-37fc-4fc1-89bb-8c59c46d5411';
const USER = '08456106-aa50-4810-b12c-7ca84102da31';

async function snapshot(label: string) {
  const { supabaseServer } = await import('@/lib/supabaseServer');

  const { data: bookings } = await supabaseServer
    .from('scheduling_bookings')
    .select('id, status, meeting_status')
    .in('id', [BOOKING, PACKAGE]);

  const { data: sessions } = await supabaseServer
    .from('scheduling_meetings')
    .select('meeting_status')
    .eq('booking_id', PACKAGE);

  const { data: stages } = await supabaseServer
    .from('payment_plan_installments')
    .select('status')
    .eq('booking_id', PACKAGE);

  const { data: quote } = await supabaseServer
    .from('proposals')
    .select('status')
    .eq('booking_id', BOOKING)
    .not('package_booking_id', 'is', null)
    .maybeSingle();

  const { data: plan } = await supabaseServer
    .from('payment_plans')
    .select('total_amount, installment_count')
    .eq('id', 'b4b65734-6577-481c-b114-6d134e513940')
    .maybeSingle();

  const byId = Object.fromEntries((bookings ?? []).map(b => [b.id.slice(0, 8), b.status]));
  const holding = (sessions ?? []).filter(s => s.meeting_status === null).length;
  const open = (stages ?? []).filter(s => s.status === 'pending').length;

  console.log(`\n${label}`);
  console.log(`  booking ae0543f1   ${byId['ae0543f1']}`);
  console.log(`  booking f00da6a7   ${byId['f00da6a7']}`);
  console.log(`  quote              ${quote?.status}`);
  console.log(`  sessions holding   ${holding} of ${sessions?.length ?? 0}`);
  console.log(`  stages pending     ${open} of ${stages?.length ?? 0}`);
  console.log(`  plan               ${plan?.total_amount} over ${plan?.installment_count}`);
}

async function main() {
  await snapshot('BEFORE');

  const { cancelBooking } = await import('@/lib/services/BookingLifecycleService');

  console.log('\nrunning cancelBooking(ae0543f1) ...');

  const result = await cancelBooking({
    bookingId: BOOKING,
    userId: USER,
    reason: 'Testing the package cascade',
    cancelReason: 'client_cost',
    cancelledBy: 'owner',
    notifyClient: !QUIET,
  });

  console.log('  returned:', JSON.stringify({
    error: result.error?.message ?? null,
    stagesClosed: result.data?.stagesClosed ?? null,
    clientNotified: result.data?.clientNotified ?? null,
  }));

  await snapshot('AFTER');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\nTHREW:', err);
    process.exit(1);
  });
