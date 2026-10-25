/**
 * Remove one contact's BOOKING data, leaving the contact and the business alone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT THE PURGE SYSTEM
 *
 * `lib/business-os/purge/` is scoped to `user_id` — it resets a whole business.
 * That is the right tool for wiping an account and the wrong one for clearing
 * a single test client, which is what a developer actually needs between runs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT REPORTS FIRST AND DELETES ONLY WHEN TOLD
 *
 * Run with no flags and it prints what it WOULD remove, grouped by table, and
 * changes nothing. Pass `--apply` to carry it out. There is no way to delete
 * by accident, and no way to delete without having seen the list.
 *
 * Order is child-before-parent throughout, so a foreign key never refuses
 * halfway and leaves the contact half-cleared.
 *
 *   npx tsx scripts/clean-test-contact.ts someone@example.com
 *   npx tsx scripts/clean-test-contact.ts someone@example.com --apply
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY LEAVES
 *
 * The contact, and everything that belongs to the PERSON rather than to a
 * booking: their tasks, documents, notes, lead responses, and any activity not
 * raised by a booking. The next test books as the same client, which is the
 * point — a cleared diary, not a stranger.
 *
 * Mail is removed only where it names one of these bookings. A message to this
 * client about something else is theirs, not the diary's.
 */

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const email = process.argv[2];
const apply = process.argv.includes('--apply');

if (!email || email.startsWith('--')) {
  console.error('Usage: npx tsx scripts/clean-test-contact.ts <email> [--apply]');
  process.exit(1);
}

type Step = {
  table: string;
  /** Rows to remove, resolved before anything is deleted. */
  ids: string[];
  note?: string;
};

async function idsWhere(table: string, column: string, values: string[]): Promise<string[]> {
  if (values.length === 0) return [];
  const { data, error } = await sb.from(table).select('id').in(column, values);
  if (error) {
    /* A table this deployment does not have is not a failure: the inventory
       spans more than any one environment. Reported, not thrown. */
    console.log(`   (skipped ${table}: ${error.message.slice(0, 60)})`);
    return [];
  }
  return (data ?? []).map(r => r.id as string);
}

(async () => {
  const { data: contacts, error: contactError } = await sb
    .from('crm_contacts')
    .select('id, user_id, first_name, last_name, email')
    .eq('email', email);

  if (contactError) throw contactError;
  if (!contacts?.length) {
    console.log(`No contact with that address: ${email}`);
    return;
  }
  if (contacts.length > 1) {
    console.log(`${contacts.length} contacts share that address — all of them are included.`);
  }

  const contactIds = contacts.map(c => c.id as string);
  for (const c of contacts) {
    console.log(`Contact ${String(c.id).slice(0, 8)}  ${c.first_name ?? ''} ${c.last_name ?? ''}  (owner ${String(c.user_id).slice(0, 8)})`);
  }

  /* The bookings first: everything below hangs off them. */
  const bookingIds = await idsWhere('scheduling_bookings', 'contact_id', contactIds);

  if (bookingIds.length === 0) {
    console.log('\nThis contact has no bookings. Nothing to clear.');
    return;
  }

  /* Money raised FOR a booking. An invoice with no booking belongs to the
     client's wider account and is left alone. */
  const invoiceIds = await idsWhere('payment_invoices', 'booking_id', bookingIds);

  const steps: Step[] = [
    /* ── children of a booking ─────────────────────────────────────────── */
    { table: 'scheduling_meetings', ids: await idsWhere('scheduling_meetings', 'booking_id', bookingIds),
      note: 'the appointments, their outcomes and who moved them' },

    /* ── money, child before parent ────────────────────────────────────── */
    { table: 'payment_refunds', ids: await idsWhere('payment_refunds', 'invoice_id', invoiceIds) },
    { table: 'payment_reminders', ids: await idsWhere('payment_reminders', 'invoice_id', invoiceIds) },
    { table: 'payment_transactions', ids: await idsWhere('payment_transactions', 'booking_id', bookingIds) },
    { table: 'payment_plan_installments', ids: await idsWhere('payment_plan_installments', 'booking_id', bookingIds) },
    { table: 'payment_plan_subscriptions', ids: await idsWhere('payment_plan_subscriptions', 'booking_id', bookingIds) },
    { table: 'payment_invoices', ids: invoiceIds },
    /*
     * `payment_plans` is NOT here, deliberately.
     *
     * It is a template on the SERVICE — instalment count, frequency, the
     * processors allowed — not a record of one client's agreement. Deleting it
     * would quietly reconfigure the business while clearing a test contact.
     * The per-booking halves are the subscription and the instalments above.
     *
     * `external_calendar_events` is absent for the same reason: it has no
     * booking column at all; a booking points AT an event, and the owner's
     * calendar is not this script's to edit.
     */

    /* ── the quote that belongs to one of these bookings ───────────────── */
    { table: 'proposals', ids: await idsWhere('proposals', 'booking_id', bookingIds) },

    /* ── the trail the journey draws ───────────────────────────────────── */
    { table: 'email_sends', ids: await idsWhere('email_sends', 'booking_id', bookingIds),
      note: 'only mail that names one of these bookings' },
    { table: 'crm_activities', ids: await idsWhere('crm_activities', 'source_entity_id', bookingIds),
      note: 'the booking events; the contact\'s own notes stay' },

    /* ── the unfinished attempts, matched by address ───────────────────── */
    { table: 'abandoned_bookings', ids: await idsWhere('abandoned_bookings', 'email', [email]),
      note: 'matched on the address, since an attempt has no contact' },

    /* ── and the bookings themselves ───────────────────────────────────── */
    { table: 'scheduling_bookings', ids: bookingIds },
  ];

  const total = steps.reduce((n, s) => n + s.ids.length, 0);

  console.log(`\n${apply ? 'REMOVING' : 'WOULD REMOVE'} ${total} row(s):\n`);
  for (const step of steps) {
    if (step.ids.length === 0) continue;
    console.log(`  ${String(step.ids.length).padStart(4)}  ${step.table}${step.note ? `   — ${step.note}` : ''}`);
  }
  if (total === 0) {
    console.log('  nothing to remove; this contact is already clean');
    return;
  }

  if (!apply) {
    console.log('\nNothing was changed. Re-run with --apply to carry it out.');
    return;
  }

  for (const step of steps) {
    if (step.ids.length === 0) continue;
    /* In batches: a very long `in` list is refused by PostgREST. */
    for (let i = 0; i < step.ids.length; i += 100) {
      const batch = step.ids.slice(i, i + 100);
      const { error } = await sb.from(step.table).delete().in('id', batch);
      if (error) {
        console.error(`FAILED on ${step.table}: ${error.message}`);
        console.error('Stopped here. Everything before this point is already removed.');
        process.exit(1);
      }
    }
    console.log(`  removed ${step.ids.length} from ${step.table}`);
  }

  console.log('\nDone.');
})();
