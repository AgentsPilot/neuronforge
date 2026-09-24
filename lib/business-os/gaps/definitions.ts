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

const logger = createLogger({ service: 'BusinessGaps' });

/** How the enquiry routes stamp somebody who filled a form. */
const FORM_SOURCES = ['website_form', 'conversion_page'];
/** And somebody who asked what something costs. */
const QUOTE_SOURCE = 'quote_request';

/** Every way the owner can have answered an enquiry. */
const ANSWERED_ACTIVITIES = ['booking_link_sent', 'booking_link_chase'];

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
      const { data: contacts } = await supabaseServer
        .from('crm_contacts')
        .select('id, first_name, last_name, email, custom_fields, created_at')
        .eq('user_id', userId)
        .eq('source', QUOTE_SOURCE)
        .gte('created_at', daysAgo(now, 30))
        .order('created_at', { ascending: true })
        .limit(50);

      const rows = contacts || [];
      if (rows.length === 0) return [];

      /*
       * Anyone who already has a proposal of ANY status is out.
       *
       * This is the check the first version of the briefing line was missing:
       * without it, a quote written, sent and accepted still reported as "still
       * waiting on a price from you" every morning for a fortnight.
       */
      const { data: proposals } = await supabaseServer
        .from('proposals')
        .select('contact_id')
        .eq('user_id', userId)
        .in('contact_id', rows.map(r => r.id));

      const quoted = new Set((proposals || []).map(p => p.contact_id as string));

      return rows
        .filter(r => !quoted.has(r.id))
        .map(r => {
          const custom = (r.custom_fields ?? {}) as Record<string, unknown>;
          return {
            contactId: r.id,
            name: personName(r),
            note: str(custom.service_interest) || str(custom.quote_service_name),
            since: r.created_at as string,
          };
        });
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
        .select('id, contact_id, start_time, created_at, service:scheduling_services(service_name), contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .gte('start_time', new Date(now).toISOString())
        .order('start_time', { ascending: true })
        .limit(50);

      return (data || [])
        .filter(row => row.contact_id && row.start_time)
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

/** Everything tracked, in the order a person would care about it. */
export const GAP_DEFINITIONS: GapDefinition[] = [
  enquiryUnanswered,
  quoteUnwritten,
  quoteUnsent,
  intakeOutstanding,
  quoteAwaitingClient,
  invoiceUnpaid,
  meetingUpcoming,
];

/* ------------------------------------------------------------------ helpers */

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
