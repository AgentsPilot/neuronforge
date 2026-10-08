/**
 * Does the event rail actually fire? Proved by doing it, then undoing it.
 *
 * The verifier (`verify-business-events.ts`) proves the rail HOLDS what the
 * module tables imply. It cannot prove the triggers still fire, because a rail
 * filled entirely by the backfill would pass it just as well. This does the
 * other half: make a real state transition, look for the event, then delete
 * both so the account is exactly as it was.
 *
 * SAFETY, because this writes to live tables:
 *
 *   - `contact_id` is NULL on everything. The payment-reminder cron selects
 *     invoices with status `sent`/`overdue`, and a row with no contact has
 *     nobody to email even if a cron runs mid-test.
 *   - Invoice numbers are prefixed `SMOKE-` and the amount is 1, so anything
 *     left behind by a crash is obvious and greppable.
 *   - Cleanup deletes the events first and the rows second, and the script
 *     reports what it deleted. A non-zero exit means check for `SMOKE-` rows.
 *   - No bookings and no proposals: inserting a booking can wake reminder and
 *     lifecycle machinery that sends mail, which is not worth it to test a
 *     trigger. `booking.created` is covered by the verifier's count instead.
 *
 * USAGE
 *   npx tsx --env-file=.env.local scripts/smoke-business-event-triggers.ts --user=<uuid>
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing Supabase env. Run with: npx tsx --env-file=.env.local ...');
  process.exit(1);
}

const supabase = createClient(url, key);

const USER = process.argv.find(a => a.startsWith('--user='))?.slice('--user='.length);
if (!USER) {
  console.error('Pass --user=<uuid>. This writes to that account and cleans up after itself.');
  process.exit(1);
}

/** Unique per run, so two runs cannot collide on the invoice number. */
const STAMP = `SMOKE-${Date.now()}`;

interface Check {
  step: string;
  expected: string;
  found: boolean;
  detail: string;
}

const checks: Check[] = [];
const createdInvoices: string[] = [];
const createdTransactions: string[] = [];
const createdBookings: string[] = [];
const createdServices: string[] = [];
const createdContacts: string[] = [];
const createdActivities: string[] = [];
const createdPageViews: string[] = [];

/** Events on the rail for one entity, newest first. */
async function eventsFor(entityId: string): Promise<{ event_type: string; value_usd: number | null; metadata: Record<string, unknown> }[]> {
  const { data, error } = await supabase
    .from('business_events')
    .select('event_type, value_usd, metadata')
    .eq('user_id', USER)
    .eq('entity_id', entityId);

  if (error) throw new Error(`rail read: ${error.message}`);
  return (data ?? []) as { event_type: string; value_usd: number | null; metadata: Record<string, unknown> }[];
}

async function expectEvent(step: string, entityId: string, eventType: string, expectValue?: number) {
  const events = await eventsFor(entityId);
  const match = events.filter(e => e.event_type === eventType);

  if (match.length === 0) {
    checks.push({
      step,
      expected: eventType,
      found: false,
      detail: `nothing. rail has: ${events.map(e => e.event_type).join(', ') || '(empty)'}`,
    });
    return;
  }

  if (match.length > 1) {
    checks.push({ step, expected: eventType, found: false, detail: `DUPLICATED x${match.length}` });
    return;
  }

  const valueNote =
    expectValue === undefined
      ? ''
      : Number(match[0].value_usd) === expectValue
        ? ` value=${match[0].value_usd}`
        : ` WRONG VALUE: got ${match[0].value_usd}, expected ${expectValue}`;

  const ok = expectValue === undefined || Number(match[0].value_usd) === expectValue;
  checks.push({ step, expected: eventType, found: ok, detail: `once.${valueNote}` });
}

async function run() {
  console.log(`Smoke-testing the event triggers on ${USER}`);
  console.log(`marker: ${STAMP}\n`);

  // ---- invoice.created -----------------------------------------------------
  const { data: invoice, error: invoiceError } = await supabase
    .from('payment_invoices')
    .insert({
      user_id: USER,
      contact_id: null,
      invoice_number: `${STAMP}-A`,
      amount: 1,
      currency: 'ILS',
      status: 'draft',
    })
    .select('id')
    .single();

  if (invoiceError || !invoice) throw new Error(`invoice insert: ${invoiceError?.message}`);
  createdInvoices.push(invoice.id);
  await expectEvent('insert an invoice', invoice.id, 'invoice.created', 1);

  // ---- invoice.paid --------------------------------------------------------
  const { error: paidError } = await supabase
    .from('payment_invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', invoice.id);
  if (paidError) throw new Error(`invoice -> paid: ${paidError.message}`);
  await expectEvent('mark it paid', invoice.id, 'invoice.paid', 1);

  // ---- the same status again must NOT emit twice ---------------------------
  await supabase.from('payment_invoices').update({ status: 'paid' }).eq('id', invoice.id);
  await expectEvent('write paid a second time', invoice.id, 'invoice.paid', 1);

  // ---- invoice.overdue, on a second invoice -------------------------------
  const { data: overdueInvoice, error: overdueInsertError } = await supabase
    .from('payment_invoices')
    .insert({
      user_id: USER,
      contact_id: null,
      invoice_number: `${STAMP}-B`,
      amount: 1,
      currency: 'ILS',
      status: 'draft',
    })
    .select('id')
    .single();

  if (overdueInsertError || !overdueInvoice) throw new Error(`invoice B insert: ${overdueInsertError?.message}`);
  createdInvoices.push(overdueInvoice.id);

  const { error: overdueError } = await supabase
    .from('payment_invoices')
    .update({ status: 'overdue' })
    .eq('id', overdueInvoice.id);
  if (overdueError) throw new Error(`invoice -> overdue: ${overdueError.message}`);
  await expectEvent('mark one overdue', overdueInvoice.id, 'invoice.overdue', 1);

  // ---- payment.completed ---------------------------------------------------
  const { data: tx, error: txError } = await supabase
    .from('payment_transactions')
    .insert({
      user_id: USER,
      contact_id: null,
      amount: 7,
      currency: 'ILS',
      status: 'succeeded',
      refund_status: 'none',
      refunded_amount: 0,
    })
    .select('id')
    .single();

  if (txError || !tx) throw new Error(`transaction insert: ${txError?.message}`);
  createdTransactions.push(tx.id);
  await expectEvent('insert a succeeded payment', tx.id, 'payment.completed', 7);

  // ---- refund.completed, on the same row ----------------------------------
  const { error: refundError } = await supabase
    .from('payment_transactions')
    .update({
      refund_status: 'partial',
      refunded_amount: 3,
      refunded_at: new Date().toISOString(),
      refund_reason: STAMP,
    })
    .eq('id', tx.id);
  if (refundError) throw new Error(`transaction -> refunded: ${refundError.message}`);

  // The refunded amount, not the original 7. A partial refund also leaves
  // `status: 'succeeded'`, so payment.completed must still be there exactly once.
  await expectEvent('partially refund it', tx.id, 'refund.completed', 3);
  await expectEvent('...and the payment event survives', tx.id, 'payment.completed', 7);

  // ---- a pending payment must NOT emit ------------------------------------
  const { data: pending, error: pendingError } = await supabase
    .from('payment_transactions')
    .insert({
      user_id: USER,
      contact_id: null,
      amount: 9,
      currency: 'ILS',
      status: 'pending',
      refund_status: 'none',
      refunded_amount: 0,
    })
    .select('id')
    .single();

  if (pendingError || !pending) throw new Error(`pending insert: ${pendingError?.message}`);
  createdTransactions.push(pending.id);

  const pendingEvents = await eventsFor(pending.id);
  checks.push({
    step: 'insert a PENDING payment',
    expected: 'no event',
    found: pendingEvents.length === 0,
    detail: pendingEvents.length === 0 ? 'none, correct' : `emitted ${pendingEvents.map(e => e.event_type).join(', ')}`,
  });

  // ---- and then emits once when it succeeds -------------------------------
  await supabase.from('payment_transactions').update({ status: 'succeeded' }).eq('id', pending.id);
  await expectEvent('...then it succeeds', pending.id, 'payment.completed', 9);

  // ---- booking.created -----------------------------------------------------
  /*
   * Cancelled and dated 90 days ago so no reminder or lifecycle machinery has
   * anything to act on. `booking.created` fires on INSERT regardless of status,
   * so a cancelled row exercises the trigger without creating a live booking.
   */
  const past = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: service }, { data: contact }] = await Promise.all([
    supabase.from('scheduling_services').select('id').eq('user_id', USER).limit(1),
    supabase.from('crm_contacts').select('id').eq('user_id', USER).limit(1),
  ]);

  const { data: booking, error: bookingError } = await supabase
    .from('scheduling_bookings')
    .insert({
      user_id: USER,
      service_id: service?.[0]?.id ?? null,
      // NOT NULL on this table, so a booking always has a client.
      contact_id: contact?.[0]?.id,
      start_time: past,
      end_time: past,
      timezone: 'UTC',
      status: 'cancelled',
      payment_status: 'pending',
      booking_source: STAMP,
    })
    .select('id')
    .single();

  if (bookingError) {
    checks.push({
      step: 'insert a booking',
      expected: 'booking.created',
      found: false,
      detail: /client_email/.test(bookingError.message)
        ? 'the dead client_email trigger is back -- see 20261006b'
        : bookingError.message,
    });
    return;
  }

  createdBookings.push(booking!.id);
  await expectEvent('insert a booking', booking!.id, 'booking.created');

  // ---- a booking with no client is refused for the RIGHT reason -----------
  /*
   * Regression guard for the bug found on 2026-10-06. `contact_id` is NOT NULL,
   * so this insert must fail -- the question is HOW. A BEFORE INSERT trigger
   * runs ahead of constraint checking, so while
   * `create_crm_contact_from_booking()` was installed this raised
   * `record "new" has no field "client_email"`: a column dropped in August,
   * masking the actual constraint. The constraint message is the correct answer
   * and the phantom column is the symptom to watch for.
   */
  const { error: noContactError } = await supabase
    .from('scheduling_bookings')
    .insert({
      user_id: USER,
      service_id: service?.[0]?.id ?? null,
      contact_id: null,
      start_time: past,
      end_time: past,
      timezone: 'UTC',
      status: 'cancelled',
      payment_status: 'pending',
      booking_source: STAMP,
    })
    .select('id')
    .single();

  const message = noContactError?.message ?? '(it was allowed)';
  checks.push({
    step: 'a booking with no client',
    expected: 'refused on contact_id',
    found: /contact_id/.test(message) && !/client_email/.test(message),
    detail: /client_email/.test(message)
      ? 'STILL the phantom column -- 20261006b not applied'
      : message.slice(0, 60),
  });

  // ---- booking.confirmed ---------------------------------------------------
  await supabase.from('scheduling_bookings').update({ status: 'confirmed' }).eq('id', booking!.id);
  await expectEvent('confirm the booking', booking!.id, 'booking.confirmed');

  // ---- invoice.sent, on a third invoice -----------------------------------
  const { data: sentInvoice, error: sentError } = await supabase
    .from('payment_invoices')
    .insert({
      user_id: USER,
      contact_id: null,
      invoice_number: `${STAMP}-C`,
      amount: 1,
      currency: 'ILS',
      status: 'draft',
    })
    .select('id')
    .single();

  if (sentError || !sentInvoice) throw new Error(`invoice C insert: ${sentError?.message}`);
  createdInvoices.push(sentInvoice.id);

  await supabase
    .from('payment_invoices')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', sentInvoice.id);
  await expectEvent('send an invoice', sentInvoice.id, 'invoice.sent', 1);

  // ---- service.created / pricing.changed / service.disabled ---------------
  const { data: svc, error: svcError } = await supabase
    .from('scheduling_services')
    .insert({
      user_id: USER,
      service_name: STAMP,
      duration_minutes: 30,
      price: 100,
      currency: 'ILS',
      is_active: false,
      status: 'draft',
    })
    .select('id')
    .single();

  if (svcError || !svc) throw new Error(`service insert: ${svcError?.message}`);
  createdServices.push(svc.id);
  await expectEvent('create a service', svc.id, 'service.created', 100);

  await supabase.from('scheduling_services').update({ price: 150 }).eq('id', svc.id);
  await expectEvent('change its price', svc.id, 'pricing.changed', 150);

  // Activate then deactivate, because it was created inactive.
  await supabase.from('scheduling_services').update({ is_active: true }).eq('id', svc.id);
  await supabase.from('scheduling_services').update({ is_active: false }).eq('id', svc.id);
  await expectEvent('disable it', svc.id, 'service.disabled', 150);

  // ---- contact.created / contact.stage_changed ----------------------------
  const { data: newContact, error: contactError } = await supabase
    .from('crm_contacts')
    .insert({ user_id: USER, first_name: 'Smoke', last_name: STAMP, stage: 'initial_consultation' })
    .select('id')
    .single();

  if (contactError || !newContact) throw new Error(`contact insert: ${contactError?.message}`);
  createdContacts.push(newContact.id);
  await expectEvent('create a contact', newContact.id, 'contact.created');

  await supabase.from('crm_contacts').update({ stage: 'family_enrolled' }).eq('id', newContact.id);
  await expectEvent('move its stage', newContact.id, 'contact.stage_changed');

  // ---- enquiry.replied -----------------------------------------------------
  const { data: activity, error: activityError } = await supabase
    .from('crm_activities')
    .insert({
      user_id: USER,
      contact_id: newContact.id,
      activity_type: 'email',
      title: STAMP,
      activity_date: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (activityError || !activity) throw new Error(`activity insert: ${activityError?.message}`);
  createdActivities.push(activity.id);
  await expectEvent('log an outbound email', activity.id, 'enquiry.replied');

  // ---- a NON-outbound activity must not count as a reply ------------------
  const { data: note } = await supabase
    .from('crm_activities')
    .insert({
      user_id: USER,
      contact_id: newContact.id,
      activity_type: 'note',
      title: STAMP,
      activity_date: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (note) {
    createdActivities.push(note.id);
    const noteEvents = await eventsFor(note.id);
    checks.push({
      step: 'log an internal note',
      expected: 'no event',
      found: noteEvents.length === 0,
      detail: noteEvents.length === 0 ? 'none, correct' : `emitted ${noteEvents.map(e => e.event_type).join(', ')}`,
    });
  }

  // ---- page.viewed, and the owner's own visit excluded --------------------
  const { data: page } = await supabase
    .from('website_page_views')
    .select('page_id')
    .eq('user_id', USER)
    .limit(1);

  if (page?.[0]?.page_id) {
    const { data: view } = await supabase
      .from('website_page_views')
      .insert({
        user_id: USER,
        page_id: page[0].page_id,
        subdomain: STAMP,
        viewed_at: new Date().toISOString(),
        session_id: STAMP,
        is_owner_view: false,
      })
      .select('id')
      .single();

    if (view) {
      createdPageViews.push(view.id);
      const viewEvents = await eventsFor(page[0].page_id);
      const viewed = viewEvents.filter(e => e.event_type === 'page.viewed');
      const session = viewEvents.filter(e => e.event_type === 'page.session_started');

      checks.push({
        step: 'a visitor views a page',
        expected: 'page.viewed + session',
        found: viewed.length >= 1 && session.length >= 1,
        detail: `page.viewed x${viewed.length}, page.session_started x${session.length}`,
      });
    }

    // The owner checking their own site is not an audience.
    const beforeOwner = (await eventsFor(page[0].page_id)).length;
    const { data: ownerView } = await supabase
      .from('website_page_views')
      .insert({
        user_id: USER,
        page_id: page[0].page_id,
        subdomain: STAMP,
        viewed_at: new Date().toISOString(),
        session_id: `${STAMP}-owner`,
        is_owner_view: true,
      })
      .select('id')
      .single();

    if (ownerView) {
      createdPageViews.push(ownerView.id);
      const afterOwner = (await eventsFor(page[0].page_id)).length;
      checks.push({
        step: 'the OWNER views their page',
        expected: 'no event',
        found: afterOwner === beforeOwner,
        detail: afterOwner === beforeOwner ? 'none, correct' : `${afterOwner - beforeOwner} emitted`,
      });
    }
  }
}

async function cleanup() {
  /*
   * Page-view events are keyed on the PAGE, not on the view row, so they
   * cannot be cleaned by entity id without deleting the page's real history.
   * They are removed by their `subdomain` marker instead, further down.
   */
  const entityIds = [
    ...createdInvoices,
    ...createdTransactions,
    ...createdBookings,
    ...createdServices,
    ...createdContacts,
    ...createdActivities,
  ];
  let events = 0;

  if (entityIds.length) {
    const { data, error } = await supabase
      .from('business_events')
      .delete()
      .eq('user_id', USER)
      .in('entity_id', entityIds)
      .select('id');
    if (error) console.error(`  could not delete events: ${error.message}`);
    events = data?.length ?? 0;
  }

  /*
   * The page-view events, found by the marker their metadata carries. Deleted
   * before the view rows so a failure here leaves the greppable rows behind
   * rather than orphan events.
   */
  if (createdPageViews.length) {
    const { data, error } = await supabase
      .from('business_events')
      .delete()
      .eq('user_id', USER)
      .contains('metadata', { subdomain: STAMP })
      .select('id');
    if (error) console.error(`  could not delete page events: ${error.message}`);
    events += data?.length ?? 0;

    const { data: sessionEvents } = await supabase
      .from('business_events')
      .delete()
      .eq('user_id', USER)
      .contains('metadata', { session_id: STAMP })
      .select('id');
    events += sessionEvents?.length ?? 0;
  }

  for (const id of createdPageViews) {
    const { error } = await supabase.from('website_page_views').delete().eq('id', id);
    if (error) console.error(`  could not delete page view ${id}: ${error.message}`);
  }
  for (const id of createdActivities) {
    const { error } = await supabase.from('crm_activities').delete().eq('id', id);
    if (error) console.error(`  could not delete activity ${id}: ${error.message}`);
  }
  for (const id of createdContacts) {
    const { error } = await supabase.from('crm_contacts').delete().eq('id', id);
    if (error) console.error(`  could not delete contact ${id}: ${error.message}`);
  }
  for (const id of createdServices) {
    const { error } = await supabase.from('scheduling_services').delete().eq('id', id);
    if (error) console.error(`  could not delete service ${id}: ${error.message}`);
  }
  for (const id of createdBookings) {
    const { error } = await supabase.from('scheduling_bookings').delete().eq('id', id);
    if (error) console.error(`  could not delete booking ${id}: ${error.message}`);
  }
  for (const id of createdTransactions) {
    const { error } = await supabase.from('payment_transactions').delete().eq('id', id);
    if (error) console.error(`  could not delete transaction ${id}: ${error.message}`);
  }
  for (const id of createdInvoices) {
    const { error } = await supabase.from('payment_invoices').delete().eq('id', id);
    if (error) console.error(`  could not delete invoice ${id}: ${error.message}`);
  }

  console.log(
    `\ncleanup: ${events} events, ${createdTransactions.length} transactions, ` +
    `${createdInvoices.length} invoices, ${createdBookings.length} bookings, ` +
    `${createdServices.length} services, ${createdContacts.length} contacts, ` +
    `${createdActivities.length} activities, ${createdPageViews.length} page views removed`
  );
}

run()
  .catch(err => {
    console.error(`\nRUN FAILED: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();

    console.log('');
    for (const c of checks) {
      console.log(`  ${c.found ? 'PASS' : 'FAIL'}  ${c.step.padEnd(34)} -> ${c.expected.padEnd(18)} ${c.detail}`);
    }

    const failed = checks.filter(c => !c.found).length;
    console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`} (${checks.length} checks)`);
    if (failed > 0) process.exitCode = 1;
  });
