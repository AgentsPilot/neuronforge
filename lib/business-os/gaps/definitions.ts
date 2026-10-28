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
import { CLIENT_CANCELLED_PREFIX } from '@/lib/services/bookingCancellationReason';
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

/**
 * How long a client gets to rebook on their own before the owner is asked to
 * chase them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The cancellation email carries a booking button — the path a client cancels
 * through does not suppress it — and it reaches them the moment they cancel.
 * The row used to appear at that same moment, so the first thing the owner was
 * told to do was send a link that was already in the client's inbox.
 *
 * A day later the row means something it could not mean before: they had the
 * link and did not use it. That is worth a personal approach, and it is a
 * different task from the one the automation just did.
 *
 * ONLY the empty-slot case waits. Money held and a plan still charging appear
 * at once — nothing else is going to collect or return those, and a day's
 * delay there is a day of the client's money sitting in the wrong place.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const REBOOK_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * How far back the unmarked-meeting scan reads.
 *
 * Its own constant rather than borrowing the one above: that name describes a
 * different question, and a shared number is how two scans come to be tuned
 * against each other. Unlike the cancelled scan this one discards nothing after
 * the query, so the limit is a ceiling on work rather than a risk of hiding a
 * row — the newest are the ones an owner can still remember.
 */
const UNMARKED_SCAN_LIMIT = 200;

/**
 * How far back an unmarked meeting is still an ERRAND.
 *
 * Beyond this it is a record, not a question: an owner cannot usefully say
 * whether a client turned up seven months ago, and a card carrying a permanent
 * count of legacy rows is one people stop reading — which costs more than the
 * rows are worth. Nothing is deleted or decided; it simply stops being asked.
 */
const UNMARKED_MAX_AGE_DAYS = 90;

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
        /*
         * `source_metadata` carries WHICH CHANNEL brought this one.
         *
         * A mailbox lead and a website-form lead share a `source` on purpose —
         * it has to stay inside `FORM_SOURCES` or this very gap never sees the
         * contact, which is the identity `captureEnquiry` is built around. The
         * marker beside it is how the two can still be told apart, and until
         * now nothing read it: the card said "Website contact · just now" for
         * an email an agent had found and filed, with no sign it came from the
         * inbox at all.
         */
        .select('id, first_name, last_name, email, custom_fields, source_metadata, created_at')
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
          /*
           * Named as a KEY, not a sentence: the gaps run server-side and this
           * route resolves no language, so a phrase composed here would reach
           * a Hebrew owner in English. The surface says it in their words.
           */
          const attribution = (r.source_metadata ?? null) as
            { via?: string; provider?: string } | null;

          return {
            contactId: r.id,
            name: personName(r),
            note,
            since: r.created_at as string,
            ...(attribution?.via ? { via: attribution.via } : {}),
            /* WHICH mailbox the agent was reading. Stored beside `via` by
               `captureEnquiry` and, like it, a key rather than a sentence. */
            ...(attribution?.provider ? { viaProvider: attribution.provider } : {}),
          };
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
      /*
       * `stopped` AND `withdrawn` BELONG HERE, AND LEAVING THEM OUT WAS THE BUG.
       *
       * ─────────────────────────────────────────────────────────────────────
       * This set answers one question: has a price already been written for
       * this person? Not "is a price still live" — the row's own sentence is
       * "they asked for a price, and nothing has been written yet", and that is
       * false the moment any quote exists.
       *
       * `stopped` means ACCEPTED, started, and ended early. The migration that
       * added it says so outright: "Acceptance stays a historical fact… this
       * records how the job ENDED, never that it was not agreed." So a client
       * whose job was agreed and later stopped was being reported as somebody
       * waiting for a first price. On the reporting account `stopped` is the
       * MOST COMMON proposal status — 12 rows of 35 — so this was not an edge
       * case, it was the common one.
       *
       * `withdrawn` is the owner taking back a quote they wrote. Also written.
       *
       * The three still absent are deliberate and unchanged: `declined` and
       * `expired` are a refused or lapsed price, which is a different
       * conversation from one never given, and `superseded` means a revision
       * replaced this version — `markSuperseded` only ever writes it alongside
       * creating the successor, so the successor is what counts.
       * ─────────────────────────────────────────────────────────────────────
       */
      const LIVE_PROPOSAL = ['draft', 'sent', 'viewed', 'accepted', 'stopped', 'withdrawn'];

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
          /*
           * THE CONSULTATION THE QUOTE IS FOR.
           *
           * Omitted until now, though it was sitting in `b` the whole time. The
           * "write a quote" button navigates to the contact's bookings, and the
           * control it is sending the owner to — the proposal builder — is a
           * prop of the booking ROW, reachable only once that row is expanded.
           * With no booking named, the link opened an unexpanded list five rows
           * to a page and left the owner to find a consultation that, by the
           * time this gap is worth showing, is usually not on the first page.
           */
          entityId: b.id as string,
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
  /*
   * It had none, and it was the only client-blocked gap without one: an unpaid
   * invoice is chased, an outstanding form is chased, an upcoming meeting is
   * reminded about, and an unanswered quote reached nobody. The action is what
   * lets `chase_quotes` hang off it.
   */
  action: 'chase_quote',
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
        .select('id, contact_id, start_time, created_at, payment_status, meeting_status, service:scheduling_services(service_name), contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        /*
         * And the meeting has not already been settled.
         *
         * `status = 'confirmed'` no longer means "still on": `markNoShow()` and
         * `cancel()` write `meeting_status` and leave the status alone. Without
         * this the gap sends "see you tomorrow" for an appointment that has
         * been marked missed or called off — and there are live rows in exactly
         * that state, carrying a settled outcome on a FUTURE date.
         *
         * `.is(null)` and not a NOT IN: `NULL NOT IN (…)` is NULL in SQL, so a
         * NOT IN would drop every unmarked booking and the reminder would stop
         * sending entirely.
         */
        .is('meeting_status', null)
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
        .select('id, contact_id, start_time, updated_at, created_at, cancellation_reason, cancelled_by, service:scheduling_services(service_name), contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId)
        .eq('status', 'cancelled')
        /*
         * Cancelled BY THE CLIENT. An owner who cancelled a booking does not
         * need the dashboard telling them they cancelled it — they were there.
         *
         * NOT a query filter any more. `cancelled_by` (20260928c) is the
         * authority, and rows cancelled before that column existed carry only
         * the English prefix in the prose — so the test is "the column, or the
         * prefix where the column is null", which PostgREST cannot express as
         * one filter.
         *
         * Either alone silently drops half the rows: the column alone loses
         * every pre-migration cancellation, and the prefix alone will lose
         * every future one the moment that prose stops being written. Applied
         * in `byClient` below, over a set the status filter has already made
         * small.
         */
        .order('updated_at', { ascending: false })
        .limit(CANCELLED_SCAN_LIMIT);

      /**
       * Who called it off, from the column where there is one.
       *
       * The prefix is the fallback and only the fallback: it is what rows
       * cancelled before `cancelled_by` existed carry instead.
       */
      const byClient = (row: { cancelled_by?: string | null; cancellation_reason?: string | null }) =>
        row.cancelled_by
          ? row.cancelled_by === 'client'
          : (row.cancellation_reason ?? '').startsWith(CLIENT_CANCELLED_PREFIX);

      const rows = (data || []).filter(row => row.contact_id && byClient(row));
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

      /*
       * ───────────────────────────────────────────────────────────────────────
       * THE CLIENTS WHO ALREADY CAME BACK.
       *
       * The cancellation email the client receives carries a booking button —
       * `offerRebooking` is not suppressed on the path a client cancels
       * through, so `resolveBookingUrl` fills it in and the template draws
       * "choose another time". A good share of them use it.
       *
       * Nothing here noticed. The row filtered on `status = 'cancelled'` and
       * who cancelled it, and neither of those changes when the same client
       * books again — so a client who cancelled Tuesday, pressed the button,
       * and sits in the diary for Thursday still left the owner a row saying
       * "send booking link". The task had resolved itself and went on asking.
       *
       * Any FUTURE booking counts, not only one made after the cancellation.
       * A client with an hour still ahead of them does not need a link, and
       * which of their bookings came first is not the question the row asks.
       *
       * Only the empty-slot case is dropped. Money held and a plan still
       * charging are decided below and are untouched by this: being back in
       * the diary does not return a deposit or stop a debit.
       * ───────────────────────────────────────────────────────────────────────
       */
      const rebooked = new Set<string>();
      /* A row this gap is reporting on can never be its own answer. Held
         separately from the status test below because it is a different
         claim: that one excludes dead appointments, this one excludes the
         very bookings being asked about. */
      const cancelledIds = new Set(rows.map(row => row.id as string));
      const cancelledContactIds = [
        ...new Set(rows.map(row => row.contact_id as string).filter(Boolean)),
      ];
      for (const ids of chunked(cancelledContactIds)) {
        const { data: upcoming } = await supabaseServer
          .from('scheduling_bookings')
          .select('id, contact_id, status, start_time')
          .eq('user_id', userId)
          .in('contact_id', ids);
        for (const row of upcoming || []) {
          /*
           * The three conditions are applied HERE rather than as PostgREST
           * filters, and deliberately.
           *
           * A dead appointment is not a client coming back, so cancelled and
           * missed rows are excluded — and without that the cancelled rows
           * this gap is built from would answer their own question and
           * suppress every one of themselves. The hour must also be ahead:
           * one that has already passed refills nothing.
           *
           * In memory because the predicate is small, the row set is already
           * bounded by the contacts above, and a filter that silently fails
           * server-side here would not error — it would quietly mark every
           * client as back and empty the gap. This way the rule is visible
           * and testable.
           */
          const contactId = row.contact_id as string | null;
          if (!contactId) continue;
          if (cancelledIds.has(row.id as string)) continue;
          const status = row.status as string | null;
          if (status === 'cancelled' || status === 'no_show') continue;
          const starts = row.start_time ? new Date(row.start_time as string).getTime() : NaN;
          if (!Number.isFinite(starts) || starts <= nowMs) continue;
          rebooked.add(contactId);
        }
      }

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
          /* They have an hour ahead of them already — see `rebooked` above.
             Nothing to send, and the slot question answered itself. */
          if (rebooked.has(row.contact_id as string)) return false;
          /*
           * Still inside the client's own window to come back. See
           * `REBOOK_GRACE_MS`: asking now would duplicate the email that went
           * out when they cancelled.
           *
           * An unreadable timestamp shows the row rather than hiding it. A
           * task the owner sees a few hours early is a smaller failure than
           * one they never see, and this is the half of the gap where nobody
           * else is watching the client.
           */
          const cancelledAt = Date.parse(
            (row.updated_at as string) || (row.created_at as string) || ''
          );
          if (Number.isFinite(cancelledAt) && nowMs - cancelledAt < REBOOK_GRACE_MS) return false;
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
        .select('id, contact_id, amount, currency, label, created_at, proposal_id, booking_id, meeting_id')
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

      const allStages = (stages || []).filter(row => row.contact_id);
      if (allStages.length === 0) return [];

      /*
       * ───────────────────────────────────────────────────────────────────────
       * A STAGE THAT BILLS A SESSION WAITS FOR THAT SESSION.
       *
       * The header above says "there is nothing to wait for: no date will ever
       * arrive to make it billable", and `staleAfterHours: 0` follows from it.
       * That is true of a quote phase, which has no date of its own.
       *
       * It is FALSE for a package, where the stage has an obvious date: the
       * session it bills for. A real series created six manual stages, one per
       * session, for meetings running from 8 October to 17 December — and the
       * card asked the owner to mark December's session done and invoice for
       * it, in October. Every one of the six.
       *
       * ───────────────────────────────────────────────────────────────────────
       * WHY THE FIRST FIX FOR THAT STOPPED WORKING, which is the bug here.
       *
       * It held a stage against its `booking_id`. That worked while each
       * session had a booking of its own, and a package is now ONE container
       * booking with N `scheduling_meetings` — so every stage of a package
       * shares the container's id, and `ProposalAcceptanceService` says what
       * the container is: "a container carries no time and the bookings
       * constraint therefore skips it."
       *
       * So `start` was always null, the fail-open below fired, and all six
       * stages were released the moment the quote was accepted. The guard did
       * not weaken — it became unreachable, because the column it read can
       * never hold a value for the case it was written for.
       *
       * The session is named by `meeting_id`, which the acceptance service has
       * stamped all along. Precedence is `billSessionOnCompletion`'s, so the
       * card and the biller agree about which session a stage belongs to:
       * the meeting first, the booking only for stages written before that
       * column existed.
       *
       * A stage whose `meeting_id` cannot be read does NOT fall back to the
       * booking. That fallback is the bug: the container has no time, so it
       * releases everything. It falls through to the same fail-open instead.
       * ───────────────────────────────────────────────────────────────────────
       */
      const meetingIds = [...new Set(allStages.map(row => row.meeting_id).filter(Boolean))] as string[];

      const meetingById = new Map<
        string,
        {
          start: string | null;
          end: string | null;
          session: number | null;
          status: string | null;
          /**
           * WHO answered for this hour (`outcome_by`, 20261078).
           *
           * Carried because the row this gap raises asks the owner to BILL,
           * and the strength of that ask depends entirely on who said the
           * meeting happened. `auto_complete_meetings` marks an overdue
           * meeting held because held is the only answer a clock has — the
           * date passing is not evidence anyone attended. Billing on that
           * without a person agreeing is how a client is invoiced for an hour
           * nobody sat through.
           */
          by: string | null;
        }
      >();
      for (const ids of chunked(meetingIds)) {
        const { data: meetings } = await supabaseServer
          .from('scheduling_meetings')
          .select('id, start_time, end_time, session_number, meeting_status, outcome_by')
          .eq('user_id', userId)
          .in('id', ids);
        for (const meeting of meetings || []) {
          meetingById.set(meeting.id as string, {
            start: (meeting.start_time as string) ?? null,
            end: (meeting.end_time as string) ?? null,
            session: (meeting.session_number as number) ?? null,
            status: (meeting.meeting_status as string) ?? null,
            by: (meeting.outcome_by as string) ?? null,
          });
        }
      }

      const bookingIds = [...new Set(allStages.map(row => row.booking_id).filter(Boolean))] as string[];

      const startByBooking = new Map<string, string | null>();
      for (const ids of chunked(bookingIds)) {
        const { data: bookings } = await supabaseServer
          .from('scheduling_bookings')
          .select('id, start_time')
          .eq('user_id', userId)
          .in('id', ids);
        for (const booking of bookings || []) {
          startByBooking.set(booking.id as string, (booking.start_time as string) ?? null);
        }
      }

      const nowMs = Date.now();
      const rows = allStages.filter(row => {
        const meeting = row.meeting_id ? meetingById.get(row.meeting_id as string) : undefined;

        if (meeting) {
          /*
           * A session that did not happen is not billable, and asking the owner
           * to mark one done is the same wrong question in another form. The
           * stage is not deleted — it comes back if the session is reinstated.
           *
           * `no_show` is deliberately NOT here: the hour was held, the client
           * did not come, and whether that is charged for is the owner's call
           * to make on a row they can see.
           *
           * `moved` should be unreachable: `moveMeeting` repoints a pending
           * unbilled stage at the new attempt precisely so the money follows
           * the session. If one appears anyway the invariant has broken, and
           * releasing it on a superseded date is the bug this block exists to
           * fix — so it is held, and said out loud rather than dropped in
           * silence.
           */
          if (meeting.status === 'cancelled') return false;
          if (meeting.status === 'moved') {
            logger.warn(
              { stageId: row.id, meetingId: row.meeting_id },
              'Pending stage still names a moved meeting; holding it rather than billing a superseded date'
            );
            return false;
          }

          // Unreadable time: the same fail-open as below, for the same reason.
          if (!meeting.start) return true;
          return Date.parse(meeting.start) <= nowMs;
        }

        if (!row.booking_id) return true;
        const start = startByBooking.get(row.booking_id as string);
        /*
         * A booking we could not read, or one with no time at all, is NOT
         * withheld. The stage is real and unbilled either way, and hiding it
         * over a missing join would lose the owner money silently — the
         * opposite failure from the one above, and the worse of the two.
         */
        if (!start) return true;
        return Date.parse(start) <= nowMs;
      });

      if (rows.length === 0) return [];

      const { data: contacts } = await supabaseServer
        .from('crm_contacts')
        .select('id, first_name, last_name, email')
        .eq('user_id', userId)
        .in('id', rows.map(row => row.contact_id as string));

      const nameById = new Map((contacts || []).map(c => [c.id as string, personName(c)]));

      /*
       * THE JOB THE PHASE BELONGS TO.
       *
       * Without it the row said only "באמצע" — "midway" — which is a label on a
       * payment schedule and means nothing standing on its own. Midway through
       * WHAT. The owner is being asked to confirm that a piece of work happened
       * and to bill someone for it, and the row did not name the work.
       *
       * Taken from the quote the phase was agreed in, which is where the job got
       * its name.
       */
      const proposalIds = [...new Set(rows.map(row => row.proposal_id).filter(Boolean))] as string[];

      const { data: quotes } = proposalIds.length
        ? await supabaseServer
            .from('proposals')
            .select('id, title')
            .eq('user_id', userId)
            .in('id', proposalIds)
        : { data: [] };

      const jobById = new Map((quotes || []).map(q => [q.id as string, str(q.title)]));

      /*
       * One row per PHASE, not per person — unlike the quote gaps above.
       *
       * A job billed in three phases genuinely has two decisions waiting, they
       * fall due at different times, and each is its own invoice. Collapsing them
       * would tell the owner one thing was waiting and hide the rest.
       */
      return rows.map(row => {
        const meeting = row.meeting_id ? meetingById.get(row.meeting_id as string) : undefined;

        return {
        contactId: row.contact_id as string,
        name: nameById.get(row.contact_id as string) || 'Someone',
        /*
         * The job, then the phase of it. Either half alone is unreadable: the
         * job without the phase does not say which decision is waiting, and the
         * phase without the job does not say what it is a phase OF.
         */
        note: [jobById.get(row.proposal_id as string), str(row.label)]
          .filter(Boolean)
          .join(' · ') || undefined,
        /*
         * ─────────────────────────────────────────────────────────────────────
         * THE SESSION, WHERE THERE IS ONE.
         *
         * This was `created_at` for every stage, under the note that "a phase
         * has no date of its own, and that is the whole reason this gap
         * exists". True of a quote phase, and never true of a package: the
         * session IS the date.
         *
         * It read badly as well as wrongly. Five rows said "7 hours since they
         * approved the proposal" — all five identical, none of them about the
         * thing the owner was being asked to confirm. A session held last week
         * and still unbilled is older than one held this morning, and the card
         * could not tell them apart.
         *
         * `staleFrom` is the meeting's END, which is the distinction the field
         * was added for: `since` is what the row SAYS, and the question "did it
         * happen" cannot be answered until the session is over. Without it a
         * long session is asked about while it is still running.
         * ─────────────────────────────────────────────────────────────────────
         */
        since: meeting?.start ?? (row.created_at as string),
        staleFrom: meeting?.end ?? undefined,
        /*
         * WHICH session of the package, as a NUMBER.
         *
         * Composed into a sentence here it would ship English to a Hebrew
         * owner: this runs server-side, the gaps route resolves no language,
         * and `note` is rendered raw by the card. So the figure travels and the
         * card says "מפגש 3" in the reader's own words.
         *
         * Without it two sessions due to be billed produce two rows identical
         * to the character, and the owner cannot tell which one they just
         * billed.
         */
        sessionNumber: meeting?.session ?? undefined,
        /*
         * ─────────────────────────────────────────────────────────────────────
         * NOBODY HAS ACTUALLY SAID THIS HOUR HAPPENED.
         *
         * The row asks the owner to bill. How much that ask can be trusted
         * depends on who closed the meeting, and there are two very different
         * answers:
         *
         *   a person   the owner (or the client) was there and said so. The
         *              stage is simply waiting its turn to be invoiced.
         *   a clock    `auto_complete_meetings` marked it held because the
         *              date went by. Held is the only answer available to it —
         *              no-show and called-off are judgements about a room it
         *              was not in — and a date passing is not evidence anyone
         *              attended.
         *
         * The automation deliberately does not bill, precisely so this second
         * case reaches a person first. Flagged rather than hidden: the money is
         * genuinely waiting, and the owner is the only one who can say whether
         * it is owed. The card turns this into a sentence that explains itself
         * and a button that confirms before it charges.
         * ─────────────────────────────────────────────────────────────────────
         */
        autoHeld: meeting?.by === 'system' || undefined,
        entityId: row.id as string,
        /*
         * The JOB this phase belongs to, which is what the button opens.
         *
         * `entityId` above is the stage, because that is what
         * `payment-stages/[id]/complete` bills. It is not a booking, and the
         * card was passing it as one — so `&booking=` named a row that does not
         * exist in the bookings list and nothing expanded. Null where the stage
         * hangs off a proposal with no appointment behind it, in which case the
         * link degrades to the contact's list rather than naming a phantom.
         */
        /*
         * ─────────────────────────────────────────────────────────────────────
         * THE MEETING, WHERE THERE IS ONE — because that is what the drawer
         * calls a booking here.
         *
         * `booking_id` on a per-session stage is the CONTAINER: one booking
         * holding N meetings, which is the shape a package has had since
         * `ProposalAcceptanceService` stopped creating a child booking per
         * date. The drawer does not render that container. It splits a package
         * into one card per session, and gives each card
         * `booking.id = attempt.id` — the MEETING id — demoting the container
         * to `parent_booking_id`.
         *
         * So the link arrived naming a booking no card carried, `BookingsTab`
         * matched nothing, and the owner landed on a list of shut cards with
         * the row they were sent for indistinguishable from the rest.
         *
         * The meeting id is therefore not a different answer to the question,
         * it IS the booking to open for this row. The container stays the
         * fallback for every stage that has no meeting — a quote phase, and
         * any stage written before the column existed.
         * ─────────────────────────────────────────────────────────────────────
         */
        bookingId:
          (row.meeting_id as string | null) ?? (row.booking_id as string | null) ?? undefined,
        value: Number(row.amount) || undefined,
        currency: str(row.currency) || undefined,
        };
      });
    }),
};

/**
 * A meeting whose time has passed and which nobody has marked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A GAP AND NOT MERELY UNTIDY
 *
 * Marking a meeting has always been optional admin with no consequence, so most
 * are never marked. Three things depend on it, and each one fails silently:
 *
 *   · A QUOTED job cannot move. The drawer's quote step now asks "did the
 *     meeting happen?" rather than assuming it did the moment the clock passed
 *     — an honest question that nobody answers if they never open the contact.
 *   · The NO-SHOW rate is unknowable, so nothing can tell a business that one
 *     client in five does not turn up.
 *   · Under per-session billing (packages, scenario 2) the session is never
 *     invoiced. A forgotten tick becomes money that never arrives.
 *
 * `blocksOn: 'owner'` because nobody else can know what happened in a room they
 * were not in.
 *
 * `staleAfterHours: 2`, measured from the meeting's END via `staleFrom`.
 *
 * This was 12 hours from the START, which charged the wait to the wrong moment
 * twice over. A three-hour workshop was asked about while it was still running,
 * and a 15:30 appointment did not become a row until 03:30 the next morning —
 * so the evening glance at the card, which is when an owner actually closes off
 * the day, showed nothing about the day they had just worked.
 *
 * Measuring from the end makes the reasoning the comment always claimed come
 * true: the owner is never asked about a session they are still in, because the
 * end is in the future until it is not. Two hours is then only the grace for
 * one they have "only just left", rather than a number standing in for a
 * duration nobody looked up.
 *
 * ONLY WHAT CAN STILL BE MARKED. `confirmed` and `pending` are the two states a
 * marking decision applies to. Completed, no-show and cancelled ARE the answers.
 * And only bookings with a time: a product sale has no meeting to have happened.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const meetingUnmarked: GapDefinition = {
  id: 'meeting_unmarked',
  blocksOn: 'owner',
  staleAfterHours: 2,
  action: 'mark_meeting',
  find: userId =>
    safely('meeting_unmarked', async () => {
      const { data: bookings } = await supabaseServer
        .from('scheduling_bookings')
        .select('id, contact_id, start_time, end_time, status, meeting_status, service:scheduling_services(service_name)')
        .eq('user_id', userId)
        .in('status', ['confirmed', 'pending'])
        /*
         * Nobody has answered yet — which is the entire question this gap asks.
         *
         * The status pair was the answer while an outcome overwrote the status.
         * It is not any more: a meeting marked held keeps `status: 'confirmed'`,
         * so this gap went on asking "what happened at this meeting?" about
         * meetings the owner had already told it about, and no number of
         * answers would make it stop.
         */
        .is('meeting_status', null)
        .not('start_time', 'is', null)
        /*
         * Already past. The staleness window in `findGaps` then holds it back
         * for another twelve hours — this bound only keeps the query from
         * dragging back every future appointment the business has.
         */
        .lt('start_time', new Date().toISOString())
        /*
         * And not older than the window above. An account arriving with a year
         * of never-marked history would otherwise show a count that never moves
         * however many an owner answers.
         */
        .gte(
          'start_time',
          new Date(Date.now() - UNMARKED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
        )
        .order('start_time', { ascending: false })
        .limit(UNMARKED_SCAN_LIMIT);

      const rows = (bookings || []).filter(row => row.contact_id);
      if (rows.length === 0) return [];

      const { data: contacts } = await supabaseServer
        .from('crm_contacts')
        .select('id, first_name, last_name, email')
        .eq('user_id', userId)
        .in('id', rows.map(row => row.contact_id as string));

      const nameById = new Map((contacts || []).map(c => [c.id as string, personName(c)]));

      /*
       * One row per MEETING. Two unmarked sessions with the same client are two
       * answers the owner owes, and they may differ — one held, one missed.
       */
      return rows.map(row => {
        const service = Array.isArray(row.service) ? row.service[0] : row.service;
        return {
          contactId: row.contact_id as string,
          name: nameById.get(row.contact_id as string) || 'Someone',
          // The service, so the row says which meeting it is asking about.
          note: str((service as { service_name?: string } | null)?.service_name),
          /*
           * The START, not the end: it is what the owner recognises ("the 10am
           * on Tuesday"), and it is what the staleness window measures from.
           */
          since: row.start_time as string,
          /*
           * The wait runs from the END. Falls back to the start for a booking
           * with no end recorded, which is the old behaviour for that row
           * rather than a meeting that can never become stale.
           */
          staleFrom: (row.end_time as string | null) ?? (row.start_time as string),
          entityId: row.id as string,
        };
      });
    }),
};

/**
 * A meeting the platform closed off, while it can still be corrected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SECOND CHANCE, AND WHY IT IS A GAP RATHER THAN A NOTICE.
 *
 * `auto_complete_meetings` marks every past meeting `completed`, because that
 * is the only one of the three answers it can give. For the meetings that were
 * actually no-shows it is wrong, and wrong in a way that pays: a no-show is the
 * basis for a fee, and it feeds `retention.no_show_rate` and its baseline.
 *
 * Completing the booking also takes it out of `meeting_unmarked` — that gap
 * matches `confirmed` and `pending` — so the owner's prompt disappears at the
 * same moment the assumption is recorded. This puts it back, for a week, with
 * the automation's answer shown rather than hidden.
 *
 * `blocksOn: 'owner'` because only the owner knows, and `staleAfterHours: 0`
 * because the question is live the moment the platform answers it for them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MEETING_TRIAGE_DAYS = 7;

const meetingAutoCompleted: GapDefinition = {
  id: 'meeting_auto_completed',
  blocksOn: 'owner',
  staleAfterHours: 0,
  /*
   * The SAME action the unmarked gap uses. It navigates to the booking, where
   * all three marks already are — which is exactly right here, because the
   * correction this row invites is "no-show", and no single button can offer a
   * choice of three.
   */
  action: 'mark_meeting',
  find: userId =>
    safely('meeting_auto_completed', async () => {
      const since = new Date(
        Date.now() - MEETING_TRIAGE_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: marks } = await supabaseServer
        .from('crm_activities')
        .select('source_entity_id, created_at')
        .eq('user_id', userId)
        .eq('activity_type', 'booking_auto_completed')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(UNMARKED_SCAN_LIMIT);

      const markedAt = new Map<string, string>();
      for (const row of marks || []) {
        const id = row.source_entity_id as string | null;
        /* First wins: the list is newest-first and a booking is only marked
           once, so a duplicate could only come from a replayed queue row. */
        if (id && !markedAt.has(id)) markedAt.set(id, row.created_at as string);
      }

      if (markedAt.size === 0) return [];

      /*
       * Only the ones STILL carrying the automation's answer.
       *
       * An owner who has already corrected one to `no_show` — or cancelled it,
       * or re-opened it — has answered, and the row must go. The marker stays
       * in the timeline as the record of what the platform did; this filter is
       * what stops it also being a standing question.
       */
      const { data: bookings } = await supabaseServer
        .from('scheduling_bookings')
        .select('id, contact_id, start_time, status, meeting_status, service:scheduling_services(service_name)')
        .eq('user_id', userId)
        /*
         * Still marked HELD, which is `meeting_status` — the column the
         * automation's answer now lives in. `complete()` stopped writing
         * `status: 'completed'`, so against the old filter this gap matched
         * nothing the automation had marked and quietly stopped asking.
         */
        .eq('meeting_status', 'held')
        .in('id', [...markedAt.keys()]);

      const rows = (bookings || []).filter(row => row.contact_id);
      if (rows.length === 0) return [];

      const { data: contacts } = await supabaseServer
        .from('crm_contacts')
        .select('id, first_name, last_name, email')
        .eq('user_id', userId)
        .in('id', rows.map(row => row.contact_id as string));

      const nameById = new Map((contacts || []).map(c => [c.id as string, personName(c)]));

      return rows.map(row => {
        const service = Array.isArray(row.service) ? row.service[0] : row.service;
        return {
          contactId: row.contact_id as string,
          name: nameById.get(row.contact_id as string) || 'Someone',
          note: str((service as { service_name?: string } | null)?.service_name),
          /* The MEETING's own time, not the moment it was marked: "the 10am on
             Tuesday" is what the owner recognises, here as everywhere else. */
          since: row.start_time as string,
          entityId: row.id as string,
        };
      });
    }),
};

/**
 * A quote with a deadline on it that nobody has answered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME PROPOSALS AS `quote_awaiting_client`, NARROWED TO THE DATED ONES —
 * and a different answer to "whose move is it".
 *
 * An undated quote sitting unanswered is the client's move: they have it, they
 * will reply or they will not, and telling the owner every morning is the
 * nagging this registry's header warns about. A quote with a date is not that.
 * It is an offer the business made that expires, and the thing that expires is
 * the owner's — once the date passes, the sale is gone and no amount of
 * chasing brings that price back.
 *
 * So the two differ in exactly the way `blocksOn` exists to express, which is
 * why this is a second definition rather than a flag on the first. The
 * chaser still hangs off `quote_awaiting_client` and follows up on BOTH; this
 * is only about which ones the owner is shown.
 *
 * Ordered by the deadline, nearest first: the list is about time running out,
 * so the one running out soonest belongs at the top.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const quoteDeadlineUnanswered: GapDefinition = {
  id: 'quote_deadline_unanswered',
  blocksOn: 'owner',
  /* The same three days the client gets before anybody is told to act. */
  staleAfterHours: 72,
  action: 'chase_quote',
  find: (userId, now) =>
    safely('quote_deadline_unanswered', async () => {
      const { data } = await supabaseServer
        .from('proposals')
        .select('id, contact_id, title, total, currency, sent_at, valid_until, contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId)
        .in('status', ['sent', 'viewed'])
        .lt('sent_at', hoursAgo(now, 72))
        /* The whole point of this gap. An undated quote stays with
           `quote_awaiting_client`, where it is the client's move. */
        .not('valid_until', 'is', null)
        /*
         * And still open. A lapsed quote is a different conversation — the
         * price is withdrawn by its own terms — and "follow up" is the wrong
         * thing to offer for it.
         */
        .gte('valid_until', now.toISOString().slice(0, 10))
        .order('valid_until', { ascending: true })
        .limit(50);

      return (data || []).map(row => {
        const contact = (Array.isArray(row.contact) ? row.contact[0] : row.contact) || {};
        return {
          contactId: row.contact_id as string,
          name: personName(contact),
          note: str(row.title),
          /* Still the day it was SENT: "how long have they had it" is the
             question the row answers, and the deadline is shown separately. */
          since: (row.sent_at as string) || new Date().toISOString(),
          /*
           * The day the price is withdrawn by its own terms.
           *
           * Selected and sorted on since this gap existed, and never carried to
           * the card — so the row could say "9 days since you sent it" and not
           * "open until the 14th", which is the half that decides what to do
           * first. `mostUrgent` reads it to promote a quote about to lapse.
           *
           * `eventAt` rather than a field of its own: it already means "when
           * this one's moment is", which is exactly what a deadline is. The
           * meeting reminder uses it the same way.
           */
          eventAt: str(row.valid_until) || undefined,
          entityId: row.id as string,
          value: Number(row.total) || undefined,
          currency: str(row.currency) || undefined,
        };
      });
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
  meetingUnmarked,
  meetingAutoCompleted,
  quoteDeadlineUnanswered,
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
