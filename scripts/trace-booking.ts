/**
 * Everything the platform recorded about one client, in the order it happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * For a report of the shape "she booked, she paid, we refunded, and it got
 * lost". That sentence spans five tables written by four different surfaces —
 * the smart-link booking page, the payment webhook, the refund action and the
 * diary — and "lost" could mean any seam between them:
 *
 *   no contact        the booking never resolved to a person
 *   no booking        payment taken against nothing
 *   no transaction    paid at Stripe, not recorded here
 *   no refund row     refunded at Stripe, not recorded here
 *   refund orphaned   recorded, pointing at no invoice or transaction
 *   booking live      money returned, the hour still held
 *
 * So this prints every row keyed to that person and leaves the reading to a
 * human, rather than deciding in advance which seam broke.
 *
 * READ ONLY. It writes nothing.
 *
 *   npx tsx scripts/trace-booking.ts --email="someone@example.com"
 *   npx tsx scripts/trace-booking.ts --email="..." --days=2
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from 'path';

import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const loadSupabase = async () => (await import('../lib/supabaseServer')).supabaseServer;

const arg = (name: string) => {
  const hit = process.argv.find(value => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

/**
 * Print a result, and NEVER let a failed query read as an empty one.
 *
 * This took `rows` alone and printed `rows?.length ?? 0`, so a rejected query
 * — PostgREST refuses the whole statement over one unknown column, and this
 * file asked for `stage_key` on a table whose column is `stage` — came out as
 * "contacts: 0". Which is exactly the shape of the bug being investigated, and
 * cost a round of wrong conclusions about a client who was in the database the
 * whole time.
 */
const show = (
  label: string,
  rows: unknown[] | null | undefined,
  error?: { message?: string } | null
) => {
  if (error) {
    console.log(`\n--- ${label}: QUERY FAILED ---`);
    console.log(`    ${error.message ?? String(error)}`);
    return;
  }
  console.log(`\n--- ${label}: ${rows?.length ?? 0} ---`);
  for (const row of rows ?? []) console.log(JSON.stringify(row, null, 2));
};

/**
 * Trace BACKWARDS from a transaction, when the email finds nothing.
 *
 * A refund names a transaction. The transaction names an invoice or a booking,
 * and those name a contact. Following that chain is the only way to learn who
 * a payment actually belonged to when the address it was supposedly made under
 * matches no row at all.
 */
async function fromTransaction(supabase: Awaited<ReturnType<typeof loadSupabase>>, id: string) {
  console.log(`\ntransaction: ${id}`);

  const { data: tx } = await supabase
    .from('payment_transactions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  show('transaction', tx ? [tx] : []);
  if (!tx) {
    console.log('\nThe refund points at a transaction that does not exist.');
    return;
  }

  if (tx.invoice_id) {
    const { data: invoice } = await supabase
      .from('payment_invoices')
      .select('*')
      .eq('id', tx.invoice_id)
      .maybeSingle();
    show('its invoice', invoice ? [invoice] : []);

    if (invoice?.contact_id) {
      const { data: contact } = await supabase
        .from('crm_contacts')
        .select('id, email, first_name, last_name, stage, created_at')
        .eq('id', invoice.contact_id)
        .maybeSingle();
      show('the invoice client', contact ? [contact] : []);
    }
  } else {
    console.log('\n--- its invoice: none. The transaction carries no invoice_id. ---');
  }

  if (tx.booking_id) {
    const { data: booking } = await supabase
      .from('scheduling_bookings')
      .select('*')
      .eq('id', tx.booking_id)
      .maybeSingle();
    show('its booking', booking ? [booking] : []);

    if (booking?.contact_id) {
      const { data: contact } = await supabase
        .from('crm_contacts')
        .select('id, email, first_name, last_name, stage, created_at')
        .eq('id', booking.contact_id)
        .maybeSingle();
      show('the booking client', contact ? [contact] : []);
    }
  } else {
    console.log('\n--- its booking: none. The transaction carries no booking_id. ---');
  }
}

/**
 * What became of a contact a booking still points at.
 *
 * A booking carrying a `contact_id` that resolves to nothing is the signature
 * of a person who was deleted or merged after the fact, and it is why a search
 * by email finds neither her nor her money.
 */
async function fromContact(supabase: Awaited<ReturnType<typeof loadSupabase>>, id: string) {
  console.log(`\ncontact: ${id}`);

  const { data: row } = await supabase.from('crm_contacts').select('*').eq('id', id).maybeSingle();
  show('the contact itself', row ? [row] : []);
  if (!row) console.log('\n  Gone. Nothing in `crm_contacts` has that id.');

  const { data: bookings } = await supabase
    .from('scheduling_bookings')
    .select('id, status, payment_status, start_time, client_email, created_at')
    .eq('contact_id', id);
  show('bookings still pointing at it', bookings);

  const { data: txs } = await supabase
    .from('payment_transactions')
    .select('id, amount, currency, status, refund_status, refunded_at, description')
    .eq('contact_id', id);
  show('transactions still pointing at it', txs);

  /* Who else this business knows, today, in case she was merged into one of
     them rather than simply removed. */
  const owner = (bookings ?? [])[0] ? null : null;
  const { data: siblings } = await supabase
    .from('crm_contacts')
    .select('id, email, first_name, last_name, created_at')
    .gte('created_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);
  show('contacts created in the last two days', siblings);
  void owner;
}

async function main() {
  const supabase = await loadSupabase();
  const contact = arg('contact');
  if (contact) {
    await fromContact(supabase, contact);
    return;
  }
  const transaction = arg('transaction');
  if (transaction) {
    await fromTransaction(supabase, transaction);
    /* The webhook trail, which is where the ORDER of events lives: a refund
       that ran before the payment was linked to its booking looks identical
       afterwards to one that ran after. */
    const { data: events, error: eventsError } = await supabase
      .from('payment_events')
      .select('id, event_type, entity_type, entity_id, created_at, metadata')
      .order('created_at', { ascending: true })
      .limit(60);
    const mine = (events ?? []).filter(e => JSON.stringify(e).includes(transaction));
    show('payment events mentioning this payment', mine, eventsError);
    return;
  }
  const email = arg('email');
  const days = Number(arg('days') ?? 1);

  if (!email) {
    console.error('Pass --email="someone@example.com".');
    process.exit(1);
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  console.log(`\nclient: ${email}`);
  console.log(`window: anything created since ${since}\n`);

  /* The person. Email is stored as typed, so match case-insensitively. */
  const { data: contacts, error: contactsError } = await supabase
    .from('crm_contacts')
    .select('id, user_id, email, first_name, last_name, stage, created_at')
    .ilike('email', email);

  show('contacts', contacts, contactsError);

  if (!contacts?.length) {
    console.log('\nNo contact with that email. If a booking exists it did not resolve to a person.');
  }

  const contactIds = (contacts ?? []).map(c => c.id);

  /* Bookings, by contact and also by the email on the booking itself: a
     booking that failed to resolve a contact is exactly what we are hunting. */
  const { data: byContact } = contactIds.length
    ? await supabase
        .from('scheduling_bookings')
        .select('*')
        .in('contact_id', contactIds)
        .gte('created_at', since)
    : { data: [] };

  const { data: byEmail } = await supabase
    .from('scheduling_bookings')
    .select('*')
    .ilike('client_email', email)
    .gte('created_at', since);

  const bookings = [...(byContact ?? []), ...(byEmail ?? [])].filter(
    (row, index, all) => all.findIndex(other => other.id === row.id) === index
  );
  show('bookings', bookings);

  const bookingIds = bookings.map(b => b.id);

  /* The money. Invoices first, then what was actually moved, then what came
     back. Each is fetched independently so a missing link shows as an empty
     section rather than disappearing inside a join. */
  const { data: invoices } = contactIds.length
    ? await supabase
        .from('payment_invoices')
        .select('*')
        .in('contact_id', contactIds)
        .gte('created_at', since)
    : { data: [] };
  show('invoices', invoices);

  const invoiceIds = (invoices ?? []).map(i => i.id);

  const { data: transactions } = await supabase
    .from('payment_transactions')
    .select('*')
    .gte('created_at', since)
    .or(
      [
        invoiceIds.length ? `invoice_id.in.(${invoiceIds.join(',')})` : null,
        bookingIds.length ? `booking_id.in.(${bookingIds.join(',')})` : null,
      ]
        .filter(Boolean)
        .join(',') || 'id.is.null'
    );
  show('transactions', transactions);

  const { data: refunds } = await supabase
    .from('payment_refunds')
    .select('*')
    .gte('created_at', since);

  /* Refunds are not keyed to a contact, so they are filtered here against
     everything above. A refund matching nothing is itself the finding. */
  const transactionIds = (transactions ?? []).map(t => t.id);
  const mine = (refunds ?? []).filter(
    r =>
      (r.invoice_id && invoiceIds.includes(r.invoice_id))
      || (r.transaction_id && transactionIds.includes(r.transaction_id))
  );
  show('refunds linked to this client', mine);

  const orphans = (refunds ?? []).filter(r => !mine.includes(r));
  if (orphans.length) {
    console.log(
      `\n--- other refunds in the same window: ${orphans.length} ---\n` +
        '    (listed because a refund pointing at no invoice or transaction of\n' +
        "     this client's is one of the ways money 'gets lost')"
    );
    for (const row of orphans) console.log(JSON.stringify(row, null, 2));
  }

  /* The diary entry the hour lives in, which is what "lost" may mean. */
  if (bookingIds.length) {
    const { data: meetings } = await supabase
      .from('scheduling_meetings')
      .select('*')
      .in('booking_id', bookingIds);
    show('meetings', meetings);
  }

  console.log('\n--- the chain, in one line each ---');
  console.log(`  contacts      ${contacts?.length ?? 0}`);
  console.log(`  bookings      ${bookings.length}`);
  console.log(`  invoices      ${invoices?.length ?? 0}`);
  console.log(`  transactions  ${transactions?.length ?? 0}`);
  console.log(`  refunds       ${mine.length}`);
}

main().catch(error => {
  console.error('\nFAILED:', error?.message || error);
  process.exit(1);
});
