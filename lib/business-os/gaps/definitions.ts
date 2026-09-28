/**
 * The gaps themselves.
 *
 * Each one answers the same question about a different thing: what entered a
 * state and did not advance, and whose move is it now. See `./types` for why
 * that shape is declared once rather than rewritten per surface.
 *
 * Every query here is scoped to the owner and every one of them swallows its
 * own failure — a gap that cannot be read must cost the dashboard one row, not
 * the whole card.
 *
 * @module lib/business-os/gaps/definitions
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type { GapDefinition, GapItem } from './types';
import { CLIENT_CANCELLED_PREFIX } from '@/lib/services/BookingLifecycleService';
import { PLAN_STOPPED_STATUSES } from '@/lib/payments/planStatus';

const logger = createLogger({ service: 'BusinessGaps' });

/** How the enquiry routes stamp somebody who filled a form. */
const FORM_SOURCES = ['website_form', 'conversion_page'];
/** And somebody who asked what something costs. */
const QUOTE_SOURCE = 'quote_request';

/** Every way the owner can have answered an enquiry. */
const ANSWERED_ACTIVITIES = ['booking_link_sent', 'booking_link_chase'];

/**
 * How far back the cancelled-booking scan reads. See the note at its use: this
 * gap discards rows AFTER the query, so a narrow window can hide a real debt.
 */
const CANCELLED_SCAN_LIMIT = 200;

/** Invoices that have been issued and not settled. */
const ISSUED = ['sent', 'pending', 'overdue'];

function personName(row: { first_name?: string | null; last_name?: string | null; email?: string | null }) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || 'Someone';
}

/** Never let one gap take the others down. */
async function safely(id: string, run: () => Promise<GapItem[]>): Promise<GapItem[]> {
  try {
    return await run();
  } catch (err) {
    logger.warn({ err, gap: id }, 'Gap could not be read');
    return [];
  }
}

/**
 * Somebody filled in a form and nobody has replied.
 *
 * The dashboard's original card, now expressed as a gap so the briefing and the
 * insight read the same definition rather than three near-copies of it.
 */
const enquiryUnanswered: GapDefinition = {
  id: 'enquiry_unanswered',
  blocksOn: 'owner',
  staleAfterHours: 0,
  action: 'send_booking_link',
  find: (userId, now) =>
    safely('enquiry_unanswered', async () => {
      const { data: contacts } = await supabaseServer
        .from('crm_contacts')
        .select('id, first_name, last_name, email, custom_fields, created_at')
        .eq('user_id', userId)
        .in('source', FORM_SOURCES)
        .gte('created_at', daysAgo(now, 14))
        .order('created_at', { ascending: true })
        .limit(50);

      const rows = contacts || [];
      if (rows.length === 0) return [];

      const handled = await answeredOrBooked(userId, rows.map(r => r.id));

      return rows
        .filter(r => !handled.has(r.id))
        .map(r => {
          const custom = (r.custom_fields ?? {}) as Record<string, unknown>;
          const note =
            str(custom.service_interest) ||
            str(custom.first_website_message) ||
            str(custom.last_website_message);
          return { contactId: r.id, name: personName(r), note, since: r.created_at as string };
        });
    }),
};

/**
 * Somebody asked what it costs and nothing has been written.
 *
 * Stale immediately — the client is already waiting by the time the row exists,
 * and unlike an enquiry there is no link that answers it. Only the owner can.
 */
const quoteUnwritten: GapDefinition = {
  id: 'quote_unwritten',
  blocksOn: 'owner',
  staleAfterHours: 0,
  action: 'write_quote',
  find: (userId, now) =>
    safely('quote_unwritten', async () => {
      /*
       * TWO WAYS A CLIENT ENDS UP WAITING ON A PRICE, AND THIS USED TO SEE ONE.
       *
       * ─────────────────────────────────────────────────────────────────────
       * (a) They filled in the quote form. `source = 'quote_request'`, no
       *     booking, no proposal. That is what this gap originally found, and
       *     it is still found below.
       *
       * (b) They BOOKED a consultation on a quote-priced service, the meeting
       *     happened, and no price followed. Their contact row is stamped
       *     `website_booking`, so the source filter excluded every one of them.
       *
       * (b) is the common route and it was invisible. The CRM derives its
       *     "Needs a quote" badge from the BOOKING (a `sale_mode: 'proposal'`
       *     service whose start time has passed with no live proposal), while
       *     this derived it from how the contact arrived — two definitions of
       *     one fact, and only the badge was looking at the right column.
       *
       * The cost was not cosmetic. `isQuietDay` says a waiting quote is never
       * a quiet day, and the briefing is skipped on a quiet day: an account
       * with a consultation held and unpriced had five consecutive briefings
       * suppressed as "nothing happened", with the badge amber on screen the
       * whole time.
       * ─────────────────────────────────────────────────────────────────────
       */
      const [formAsked, quotedBookings] = await Promise.all([
        supabaseServer
          .from('crm_contacts')
          .select('id, first_name, last_name, email, custom_fields, created_at')
          .eq('user_id', userId)
          .eq('source', QUOTE_SOURCE)
          .gte('created_at', daysAgo(now, 30))
          .order('created_at', { ascending: true })
          .limit(50),
        /*
         * Quote-priced services first, then their past bookings. Two reads
         * rather than an embed: PostgREST rejects a whole select for one
         * unknown column, and a join here would take the gap down on any
         * database where `sale_mode` has not landed.
         */
        (async () => {
          const { data: services } = await supabaseServer
            .from('scheduling_services')
            .select('id, service_name')
            .eq('user_id', userId)
            .eq('sale_mode', 'proposal');

          const byService = new Map(
            (services || []).map(s => [s.id as string, s.service_name as string | null])
          );
          if (byService.size === 0) return { rows: [], byService };

          const { data: bookings } = await supabaseServer
            .from('scheduling_bookings')
            .select('id, contact_id, service_id, start_time')
            .eq('user_id', userId)
            .in('service_id', [...byService.keys()])
            // The meeting is where the job gets scoped, so nothing is owed
            // until it has happened. Matches the badge's `meetingAhead`.
            .lt('start_time', now.toISOString())
            .gte('start_time', daysAgo(now, 90))
            // Cancelling is the one mark that ends a quoted job.
            .neq('status', 'cancelled')
            .order('start_time', { ascending: true })
            .limit(50);

          return { rows: bookings || [], byService };
        })(),
      ]);

      const formRows = formAsked.data || [];
      const bookingRows = quotedBookings.rows.filter(b => b.contact_id);

      const contactIds = [
        ...new Set([...formRows.map(r => r.id as string), ...bookingRows.map(b => b.contact_id as string)]),
      ];
      if (contactIds.length === 0) return [];

      /*
       * Which of these already have a price in front of them.
       *
       * `superseded` is deliberately NOT in this set. It means a revision
       * replaced this version — and `markSuperseded` only ever writes it
       * alongside creating that revision, so the successor is normally what
       * counts. When the chain ends on `superseded` with nothing after it, the
       * client is holding no valid quote at all, which is this gap exactly.
       *
       * `declined` and `expired` are also absent, and that IS how they were
       * handled before: a refused price is a different conversation from one
       * never given, and the drawer already routes it back to the owner.
       */
      const LIVE_PROPOSAL = ['draft', 'sent', 'viewed', 'accepted'];

      const { data: proposals } = await supabaseServer
        .from('proposals')
        .select('contact_id')
        .eq('user_id', userId)
        .in('contact_id', contactIds)
        .in('status', LIVE_PROPOSAL);

      const quoted = new Set((proposals || []).map(p => p.contact_id as string));

      /* Names for the booking-sourced half, which the form half already has. */
      const { data: bookingContacts } = bookingRows.length
        ? await supabaseServer
            .from('crm_contacts')
            .select('id, first_name, last_name, email')
            .eq('user_id', userId)
            .in('id', bookingRows.map(b => b.contact_id as string))
        : { data: [] };

      const nameById = new Map(
        (bookingContacts || []).map(c => [c.id as string, personName(c)])
      );

      const items: GapItem[] = [];
      /* One row per person, not per booking: the gap is "they are waiting on a
         price from you", and two consultations do not make two of those. */
      const seen = new Set<string>();

      for (const r of formRows) {
        if (quoted.has(r.id as string) || seen.has(r.id as string)) continue;
        seen.add(r.id as string);
        const custom = (r.custom_fields ?? {}) as Record<string, unknown>;
        items.push({
          contactId: r.id as string,
          name: personName(r),
          note: str(custom.service_interest) || str(custom.quote_service_name),
          since: r.created_at as string,
        });
      }

      for (const b of bookingRows) {
        const contactId = b.contact_id as string;
        if (quoted.has(contactId) || seen.has(contactId)) continue;
        seen.add(contactId);
        items.push({
          contactId,
          name: nameById.get(contactId) || 'Someone',
          note: quotedBookings.byService.get(b.service_id as string) ?? undefined,
          /* The meeting, not the contact's creation date: that is when the
             owner started owing them an answer. */
          since: b.start_time as string,
        });
      }

      return items;
    }),
};

/**
 * A quote was written and never sent.
 *
 * Worse than unwritten, not better: the work is done and the client still has
 * nothing. A draft sitting in the builder is the easiest gap on this list to
 * close and the easiest to forget.
 */
const quoteUnsent: GapDefinition = {
  id: 'quote_unsent',
  blocksOn: 'owner',
  staleAfterHours: 0,
  action: 'send_quote',
  find: userId =>
    safely('quote_unsent', async () => {
      const { data } = await supabaseServer
        .from('proposals')
        .select('id, contact_id, title, total, currency, created_at, contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId)
        .eq('status', 'draft')
        .order('created_at', { ascending: true })
        .limit(50);

      return (data || []).map(row => {
        const contact = (Array.isArray(row.contact) ? row.contact[0] : row.contact) || {};
        return {
          contactId: row.contact_id as string,
          name: personName(contact),
          note: str(row.title),
          since: row.created_at as string,
          entityId: row.id as string,
          value: Number(row.total) || undefined,
          currency: str(row.currency) || undefined,
        };
      });
    }),
};

/**
 * A quote is out and the client has not answered.
 *
 * Reported, never actioned. The owner has done their part; a card telling them
 * to do it again would be wrong, and chasing is a judgement call about a
 * relationship rather than a button.
 */
const quoteAwaitingClient: GapDefinition = {
  id: 'quote_awaiting_client',
  blocksOn: 'client',
  staleAfterHours: 72,
  action: null,
  find: (userId, now) =>
    safely('quote_awaiting_client', async () => {
      const { data } = await supabaseServer
        .from('proposals')
        .select('id, contact_id, title, total, currency, sent_at, contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId)
        .in('status', ['sent', 'viewed'])
        .lt('sent_at', hoursAgo(now, 72))
        .order('sent_at', { ascending: true })
        .limit(50);

      return (data || []).map(row => {
        const contact = (Array.isArray(row.contact) ? row.contact[0] : row.contact) || {};
        return {
          contactId: row.contact_id as string,
          name: personName(contact),
          note: str(row.title),
          since: (row.sent_at as string) || new Date().toISOString(),
          entityId: row.id as string,
          value: Number(row.total) || undefined,
          currency: str(row.currency) || undefined,
        };
      });
    }),
};

/**
 * An appointment is coming and the intake form has not come back.
 *
 * The client is the blocker, but the owner is the one who walks into the room
 * unprepared — which is why it is reported rather than silently waited on.
 * `IntakeReminderService` already chases once, a day before; this is what is
 * left after that chase did not work.
 */
const intakeOutstanding: GapDefinition = {
  id: 'intake_outstanding',
  blocksOn: 'client',
  staleAfterHours: 0,
  action: 'chase_intake',
  find: (userId, now) =>
    safely('intake_outstanding', async () => {
      const { data } = await supabaseServer
        .from('scheduling_bookings')
        .select('id, contact_id, start_time, intake_sent_at, contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .not('intake_sent_at', 'is', null)
        .is('intake_completed_at', null)
        .gte('start_time', now.toISOString())
        .lte('start_time', daysFromNow(now, 7))
        .order('start_time', { ascending: true })
        .limit(50);

      return (data || []).map(row => {
        const contact = (Array.isArray(row.contact) ? row.contact[0] : row.contact) || {};
        return {
          contactId: row.contact_id as string,
          name: personName(contact),
          since: (row.intake_sent_at as string) || (row.start_time as string),
          entityId: row.id as string,
        };
      });
    }),
};

/**
 * An invoice was issued and nobody has paid it.
 *
 * The briefing already reports what is owed; this exists so the same fact is
 * available to the dashboard and the insight without a second query that
 * defines "owed" slightly differently.
 */
const invoiceUnpaid: GapDefinition = {
  id: 'invoice_unpaid',
  blocksOn: 'client',
  staleAfterHours: 0,
  action: 'chase_payment',
  find: userId =>
    safely('invoice_unpaid', async () => {
      const { data } = await supabaseServer
        .from('payment_invoices')
        .select('id, contact_id, amount, currency, due_date, created_at, client_name')
        .eq('user_id', userId)
        .in('status', ISSUED)
        .order('due_date', { ascending: true })
        .limit(50);

      return (data || [])
        .filter(row => row.contact_id)
        .map(row => ({
          contactId: row.contact_id as string,
          name: str(row.client_name) || 'Someone',
          since: (row.due_date as string) || (row.created_at as string),
          entityId: row.id as string,
          value: Number(row.amount) || undefined,
          currency: str(row.currency) || undefined,
        }));
    }),
};


/**
 * A confirmed appointment that has not happened yet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Not "stuck" like the other six. Nobody is waiting on anybody and nothing is
 * overdue — this exists so the card can say how many appointments the reminder
 * would cover, and so the enqueuer has something to schedule from.
 *
 * `eventAt` is the appointment's start, and it is the only date that can
 * schedule this: the reminder is due a chosen number of hours BEFORE the
 * meeting, where every other automation runs forward from when something got
 * stuck. `since` stays the booking's creation, so "how long" still means what
 * it means everywhere else.
 *
 * CONFIRMED ONLY. Reminding somebody about an appointment that was cancelled is
 * worse than not reminding them at all, and `pending` means the booking is not
 * settled — a payment outstanding, or a quote with no price yet — so a
 * confident "see you Tuesday" would be wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const meetingUpcoming: GapDefinition = {
  id: 'meeting_upcoming',
  // The client is who must act on it: they have to turn up. This also keeps it
  // out of the owner's "things you must do" list while still powering the card.
  blocksOn: 'client',
  staleAfterHours: 0,
  action: null,
  find: (userId, now) =>
    safely('meeting_upcoming', async () => {
      const { data } = await supabaseServer
        .from('scheduling_bookings')
        .select('id, contact_id, start_time, created_at, payment_status, service:scheduling_services(service_name), contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .gte('start_time', new Date(now).toISOString())
        .order('start_time', { ascending: true })
        .limit(50);

      const upcoming = (data || []).filter(row => row.contact_id && row.start_time);

      /*
       * HOLD the reminder for a booking that has been refunded in full.
       *
       * ───────────────────────────────────────────────────────────────────────
       * A refund taken in the Stripe dashboard leaves the appointment
       * `confirmed`, so this gap still picked it up and the client was sent
       * "see you tomorrow" for a session their money had been returned for.
       *
       * Held, not dropped: `booking_refunded` puts the same booking in front of
       * the owner, and the moment they answer "it is still going ahead" the
       * marker below lets the reminder resume. A refund the owner meant as
       * goodwill therefore costs one decision, not a silently missing reminder.
       *
       * Only FULL refunds reach `payment_status = 'refunded'`; a partial one
       * stays `paid` and is untouched by this.
       * ───────────────────────────────────────────────────────────────────────
       */
      const refunded = upcoming.filter(row => row.payment_status === 'refunded');
      const kept = refunded.length
        ? await keptAfterRefund(userId, refunded.map(row => row.id as string))
        : new Set<string>();

      return upcoming
        .filter(row => row.payment_status !== 'refunded' || kept.has(row.id as string))
        .map(row => {
          const contact = (row as { contact?: { first_name?: string; last_name?: string; email?: string } | null }).contact;
          const service = (row as { service?: { service_name?: string } | null }).service;
          return {
            contactId: row.contact_id as string,
            name: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim()
              || contact?.email
              || 'Someone',
            note: service?.service_name ?? undefined,
            since: (row.created_at as string) ?? (row.start_time as string),
            eventAt: row.start_time as string,
            entityId: row.id as string,
          };
        });
    }),
};

/**
 * A booking the client cancelled, and what the owner still has to do about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO KINDS OF ROW, ONE GAP.
 *
 * Money held — the client paid and is not getting the appointment, so it is
 * owed back. Nothing held — nobody paid, but an hour just came free and could
 * still be sold to somebody else.
 *
 * They expire differently, and that difference matters. A debt does not stop
 * mattering because a week passed, so a row with money on it stays until the
 * refund happens. An empty slot stops mattering the moment it has been and
 * gone, so a row without money drops off once the appointment time passes — a
 * card still asking about last Tuesday is noise, and noise is what teaches an
 * owner to stop reading the card.
 *
 * WHY IT IS HERE AT ALL. A client cancellation used to reach the owner through
 * one email that never mentioned money and can be switched off, or a daily
 * briefing that covers a single day and has never sent. A booking cancelled
 * three weeks ahead reached them through nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const bookingCancelled: GapDefinition = {
  id: 'booking_cancelled',
  // The owner's move: refund it, or refill the hour. The client has done theirs.
  blocksOn: 'owner',
  staleAfterHours: 0,
  /*
   * Refunding is the action when money is held. `find` cannot vary the action
   * per row — it belongs to the gap — so the card reads `value` to decide which
   * button a row gets, and this is the one that matters: money moving back is
   * the consequential half.
   */
  action: 'refund',
  find: (userId, now) =>
    safely('booking_cancelled', async () => {
      const { data } = await supabaseServer
        .from('scheduling_bookings')
        .select('id, contact_id, start_time, updated_at, created_at, cancellation_reason, service:scheduling_services(service_name), contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId)
        .eq('status', 'cancelled')
        /*
         * Cancelled BY THE CLIENT. An owner who cancelled a booking does not
         * need the dashboard telling them they cancelled it — they were there.
         *
         * Matched against the constant the cancel route writes, not a literal
         * copied to here: the two spellings drifted apart within a day of each
         * other, and a mismatch is silent — the card simply shows nothing.
         */
        .ilike('cancellation_reason', `${CLIENT_CANCELLED_PREFIX}%`)
        .order('updated_at', { ascending: false })
        .limit(CANCELLED_SCAN_LIMIT);

      const rows = (data || []).filter(row => row.contact_id);
      if (rows.length === 0) return [];

      /*
       * The cap is wider here than on the other gaps, and it is said out loud.
       *
       * Every other gap discards nothing after its query: what the database
       * returns is what the owner sees. This one filters afterwards — a row
       * with no money on it is dropped once its slot has passed — and the money
       * lives in a different table, so it cannot be part of the query above.
       *
       * Which means a narrow window is not merely "fewer rows": fifty recent
       * cancellations that nobody paid for would fill the window, all be
       * discarded, and hide an older one still holding somebody's money. A
       * silent nothing, on the one gap that is about a debt. Hence the wider
       * cap, and a warning rather than a quiet truncation if it is ever hit.
       */
      if (rows.length >= CANCELLED_SCAN_LIMIT) {
        logger.warn(
          { userId, limit: CANCELLED_SCAN_LIMIT },
          'Cancelled-booking scan hit its cap; an older unrefunded booking may not be listed'
        );
      }

      /*
       * What is still held on each, from the PAYMENTS.
       *
       * ───────────────────────────────────────────────────────────────────────
       * Two queries rather than one per booking, and read off
       * `payment_transactions` rather than the invoices.
       *
       * Invoices alone miss the commonest online sale: a client paying through
       * the booking widget or a landing page produces a transaction carrying
       * `booking_id` and NO invoice at all. An invoice-derived sum called those
       * bookings unpaid — so the row offered "send a booking link" over money
       * the business was still holding, and then aged off the card once the
       * slot had passed, taking the debt with it.
       *
       * `booking.payment_status` is no better: the delete guard in
       * `BookingLifecycleService` documents it as not updated by every refund
       * path. The payments are what every refund path does update.
       * ───────────────────────────────────────────────────────────────────────
       */
      const bookingIds = rows.map(r => r.id as string);

      const invoicePages = await Promise.all(
        chunked(bookingIds).map(async ids => {
          const { data } = await supabaseServer
            .from('payment_invoices')
            .select('id, booking_id')
            .eq('user_id', userId)
            .in('booking_id', ids);
          return data || [];
        })
      );

      // Which booking each invoice belongs to, so a payment tied to an invoice
      // can be credited to the right one.
      const bookingByInvoice = new Map<string, string>();
      for (const invoice of invoicePages.flat()) {
        bookingByInvoice.set(invoice.id as string, invoice.booking_id as string);
      }

      /*
       * Settled payments, reached either way. `booking_id` and `invoice_id` are
       * separate columns and PostgREST cannot express "or" across two in-lists,
       * so both are asked for and merged — the same shape
       * `findSettledForBooking` uses for one booking.
       */
      const invoiceIds = [...bookingByInvoice.keys()];
      const settled = await Promise.all([
        ...chunked(bookingIds).map(ids => settledPayments(userId, 'booking_id', ids)),
        ...chunked(invoiceIds).map(ids => settledPayments(userId, 'invoice_id', ids)),
      ]);

      // Merged by id: a payment carrying BOTH columns comes back from the
      // booking query AND the invoice one, and counted twice it would report
      // double the money on the button that hands it back.
      const payments = new Map<string, Record<string, unknown>>();
      for (const row of settled.flat()) {
        payments.set(row.id as string, row);
      }

      const heldByBooking = new Map<string, { amount: number; currency?: string }>();
      for (const payment of payments.values()) {
        const bookingId =
          (payment.booking_id as string) ||
          bookingByInvoice.get(payment.invoice_id as string) ||
          '';
        if (!bookingId) continue;

        const net = (Number(payment.amount) || 0) - (Number(payment.refunded_amount) || 0);
        if (net <= 0) continue;

        const current = heldByBooking.get(bookingId);
        heldByBooking.set(bookingId, {
          amount: (current?.amount ?? 0) + net,
          currency: current?.currency ?? (str(payment.currency) || undefined),
        });
      }

      /*
       * Which of these is a plan STILL CHARGING the client?
       *
       * ───────────────────────────────────────────────────────────────────────
       * The most serious row this gap can produce, and the one least visible
       * without it: the appointment is off, and the client's card is debited
       * again next period regardless. Cancelling deliberately does not stop a
       * payment plan — that is the owner's decision — which is precisely why
       * they have to be told it is still running.
       *
       * Live is the complement of `PLAN_STOPPED_STATUSES`, derived rather than
       * retyped so it cannot drift from what `cancelPlan` treats as finished.
       * ───────────────────────────────────────────────────────────────────────
       */
      const livePlanBookings = new Set<string>();
      const planPages = await Promise.all(
        chunked(bookingIds).map(async ids => {
          const { data } = await supabaseServer
            .from('payment_plan_subscriptions')
            .select('booking_id, status')
            .eq('user_id', userId)
            .in('booking_id', ids)
            .not('status', 'in', `(${PLAN_STOPPED_STATUSES.join(',')})`);
          return data || [];
        })
      );
      for (const plan of planPages.flat()) {
        if (plan.booking_id) livePlanBookings.add(plan.booking_id as string);
      }

      const nowMs = new Date(now).getTime();

      return rows
        .filter(row => {
          const held = heldByBooking.get(row.id as string);
          /*
           * A plan still charging NEVER ages off. The slot being gone does not
           * make the debits stop, and a row that expired would hide the one
           * situation here that is still costing the client money.
           */
          if (livePlanBookings.has(row.id as string)) return true;
          // Money owed stays until it is given back. An empty slot only matters
          // while there is still time to fill it.
          if (held) return true;
          return row.start_time ? new Date(row.start_time as string).getTime() > nowMs : false;
        })
        .map(row => {
          const held = heldByBooking.get(row.id as string);
          // PostgREST hands an embedded row back as an object here and as a
          // one-element array elsewhere; the other definitions in this file
          // already unwrap both, so this one does too.
          const service = (Array.isArray(row.service) ? row.service[0] : row.service) as { service_name?: string } | undefined;
          const contact = ((Array.isArray(row.contact) ? row.contact[0] : row.contact) || {}) as { first_name?: string; last_name?: string; email?: string };
          return {
            contactId: row.contact_id as string,
            name: personName(contact),
            note: str(service?.service_name),
            since: (row.updated_at as string) || (row.created_at as string),
            entityId: row.id as string,
            value: held?.amount,
            currency: held?.currency,
            planLive: livePlanBookings.has(row.id as string) || undefined,
          };
        });
    }),
};

/**
 * Refunded in full, and still in the diary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The state a Stripe-dashboard refund leaves behind. The money side lands
 * correctly — the ledger, the invoice and `payment_status` all end up right, by
 * webhook and by trigger — and the appointment carries on as though nothing
 * happened: still `confirmed`, still in the calendar, still due a "see you
 * tomorrow" to a client whose money went back.
 *
 * NEVER RESOLVED AUTOMATICALLY. A refund is not a cancellation: money goes back
 * as goodwill while the session still happens, or a deposit is returned while
 * the job continues on new terms. Cancelling on the owner's behalf would delete
 * a real appointment from a real diary, so the row asks instead — cancel it, or
 * keep it — and the client's reminder is held until they answer.
 *
 * `payment_status = 'refunded'` is written only on a FULL refund (a partial one
 * stays `paid`, deliberately), so this needs no money query of its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const bookingRefunded: GapDefinition = {
  id: 'booking_refunded',
  blocksOn: 'owner',
  staleAfterHours: 0,
  // The likelier of the two answers; "keep it" is the row's second control.
  action: 'cancel_booking',
  find: (userId, now) =>
    safely('booking_refunded', async () => {
      const { data } = await supabaseServer
        .from('scheduling_bookings')
        .select('id, contact_id, start_time, updated_at, created_at, service:scheduling_services(service_name), contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .eq('payment_status', 'refunded')
        /*
         * Only what has not happened yet. After the appointment there is
         * nothing left to cancel, and a card asking about last Tuesday is the
         * noise that teaches an owner to stop reading it.
         */
        .gte('start_time', new Date(now).toISOString())
        .order('start_time', { ascending: true })
        .limit(50);

      const rows = (data || []).filter(row => row.contact_id);
      if (rows.length === 0) return [];

      // Already answered "keep it" — asked once, not every morning.
      const kept = await keptAfterRefund(userId, rows.map(r => r.id as string));

      return rows
        .filter(row => !kept.has(row.id as string))
        .map(row => {
          const service = (Array.isArray(row.service) ? row.service[0] : row.service) as { service_name?: string } | undefined;
          const contact = ((Array.isArray(row.contact) ? row.contact[0] : row.contact) || {}) as { first_name?: string; last_name?: string; email?: string };
          return {
            contactId: row.contact_id as string,
            name: personName(contact),
            note: str(service?.service_name),
            since: (row.updated_at as string) || (row.created_at as string),
            entityId: row.id as string,
            eventAt: row.start_time as string,
          };
        });
    }),
};

/** Everything tracked, in the order a person would care about it. */
/**
 * A phase of a quoted job, waiting on the owner to say the work happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS HAS NO DATE, AND WHY THAT IS NOT THE BUG.
 *
 * A quote billed in phases carries `trigger: 'manual'` on every stage after the
 * first, and no due date at all. That is correct: nothing but the owner knows
 * when a renovation reached "באמצע", so no clock can bill it. The stage waits,
 * and `payment-stages/[id]/complete` bills it when the owner says so.
 *
 * The bug was that NOTHING TOLD THEM. There was no gap, the briefing never read
 * the table, and `CashWorkUnbilledDetector` — the detector named for exactly this
 * — excludes a booking covered by a plan instalment, and excludes a quoted
 * service again for being priced zero. The only control was inside a collapsed
 * section of the contact drawer, reachable if you already knew it was there.
 *
 * Meanwhile the money was reported as OWED: the orders page and the outstanding
 * total count a pending stage as a debt, so the owner was simultaneously not
 * told to act and told the client was late.
 *
 * `blocksOn: 'owner'` because that is exactly true, and it is what puts the row
 * on the Needs-you card. `staleAfterHours: 0` because the client is already
 * waiting the moment the phase is reachable — there is nothing to wait for.
 *
 * The action NAVIGATES rather than sends. Every other gap here has an answer a
 * button can give; this one asks the owner to decide the work is done, and no
 * button should decide that for them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const stageAwaitingCompletion: GapDefinition = {
  id: 'stage_awaiting_completion',
  blocksOn: 'owner',
  staleAfterHours: 0,
  action: 'bill_stage',
  find: userId =>
    safely('stage_awaiting_completion', async () => {
      const { data: stages } = await supabaseServer
        .from('payment_plan_installments')
        .select('id, contact_id, amount, currency, label, created_at, proposal_id')
        .eq('user_id', userId)
        .eq('trigger', 'manual')
        .eq('status', 'pending')
        .is('due_date', null)
        /*
         * Unbilled only. A stage that already has an invoice is the client's move
         * and belongs to `invoice_unpaid`; reporting it here as well would ask the
         * owner to bill something twice.
         */
        .is('invoice_id', null)
        .order('created_at', { ascending: true })
        .limit(50);

      const rows = (stages || []).filter(row => row.contact_id);
      if (rows.length === 0) return [];

      const { data: contacts } = await supabaseServer
        .from('crm_contacts')
        .select('id, first_name, last_name, email')
        .eq('user_id', userId)
        .in('id', rows.map(row => row.contact_id as string));

      const nameById = new Map((contacts || []).map(c => [c.id as string, personName(c)]));

      /*
       * One row per PHASE, not per person — unlike the quote gaps above.
       *
       * A job billed in three phases genuinely has two decisions waiting, they
       * fall due at different times, and each is its own invoice. Collapsing them
       * would tell the owner one thing was waiting and hide the rest.
       */
      return rows.map(row => ({
        contactId: row.contact_id as string,
        name: nameById.get(row.contact_id as string) || 'Someone',
        note: str(row.label),
        /*
         * When the stage was created, which is when the client accepted the quote.
         * There is no better answer: a phase has no date of its own, and that is
         * the whole reason this gap exists.
         */
        since: row.created_at as string,
        entityId: row.id as string,
        value: Number(row.amount) || undefined,
        currency: str(row.currency) || undefined,
      }));
    }),
};

export const GAP_DEFINITIONS: GapDefinition[] = [
  enquiryUnanswered,
  quoteUnwritten,
  quoteUnsent,
  intakeOutstanding,
  quoteAwaitingClient,
  invoiceUnpaid,
  stageAwaitingCompletion,
  meetingUpcoming,
  bookingCancelled,
  bookingRefunded,
];

/* ------------------------------------------------------------------ helpers */

/**
 * Split an id list into request-sized pieces.
 *
 * An `in.()` filter travels in the URL, so a couple of hundred UUIDs is several
 * kilobytes of query string and eventually a request the server rejects
 * outright. A rejected query here is not a smaller card — `safely` turns it
 * into an EMPTY one, so the busiest accounts would be the ones told nothing is
 * outstanding. Chunking costs a round trip and removes the ceiling.
 */
function chunked(ids: string[], size = 50): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Payments that actually went through, by whichever column links them. */
async function settledPayments(
  userId: string,
  column: 'booking_id' | 'invoice_id',
  ids: string[]
): Promise<Record<string, unknown>[]> {
  const { data } = await supabaseServer
    .from('payment_transactions')
    .select('id, booking_id, invoice_id, amount, refunded_amount, currency')
    .eq('user_id', userId)
    .eq('status', 'succeeded')
    .in(column, ids);

  return (data || []) as Record<string, unknown>[];
}

/**
 * Bookings whose owner has said a refunded appointment is still going ahead.
 *
 * One marker, two readers: this gap stops asking, and `meeting_upcoming` lets
 * the client's reminder resume. Written by
 * `POST /api/scheduling/bookings/[id]/keep-after-refund`, which records the
 * decision as an activity rather than changing a booking column — there is no
 * column for "the owner thought about this", and inventing one to hold an
 * answer would be a migration for a sentence.
 */
async function keptAfterRefund(userId: string, bookingIds: string[]): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set();

  const { data } = await supabaseServer
    .from('crm_activities')
    .select('source_entity_id')
    .eq('user_id', userId)
    .eq('activity_type', 'booking_refund_kept')
    .in('source_entity_id', bookingIds);

  return new Set((data || []).map(row => row.source_entity_id as string).filter(Boolean));
}

/** Who has already been replied to or has booked. Both mean "not waiting". */
async function answeredOrBooked(userId: string, contactIds: string[]): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set();

  const [replied, booked] = await Promise.all([
    supabaseServer
      .from('crm_activities')
      .select('contact_id')
      .eq('user_id', userId)
      .in('contact_id', contactIds)
      .in('activity_type', ANSWERED_ACTIVITIES),
    supabaseServer
      .from('scheduling_bookings')
      .select('contact_id')
      .eq('user_id', userId)
      .in('contact_id', contactIds),
  ]);

  return new Set<string>([
    ...(replied.data || []).map(r => r.contact_id as string),
    ...(booked.data || []).map(r => r.contact_id as string),
  ]);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function daysFromNow(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
