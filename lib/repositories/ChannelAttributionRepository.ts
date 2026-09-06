/**
 * Reads lead attribution and the business outcomes each lead produced.
 *
 * The value of this data is that it answers "which channel brings me paying
 * clients" using AgentPilot's own bookings and revenue, rather than a social
 * platform's self-reported conversion count.
 *
 * Attribution model: first-touch cohort. A lead is counted in the window it was
 * acquired, together with every booking and payment it has produced since —
 * including revenue that landed after the window closed. A June ad can produce
 * August revenue, and crediting that to August's channel mix would be wrong.
 * `mergeAttributionMetadata` already preserves the original capture, so the
 * stored attribution is first-touch by construction.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'ChannelAttributionRepository' });

export interface AttributedContact {
  id: string;
  created_at: string;
  referrer_domain: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

export interface ContactOutcomes {
  /** contact_id -> number of non-cancelled bookings */
  bookingsByContact: Map<string, number>;
  /** contact_id -> revenue actually collected */
  revenueByContact: Map<string, number>;
  /**
   * contact_id -> everything asked for, paid or not.
   *
   * Always >= the collected figure. Kept separate so a channel that produced
   * work but no payment yet reads as "billed, not paid" instead of as nothing
   * at all — twelve sent invoices reported as ₪0 looked like a broken column.
   */
  billedByContact: Map<string, number>;
}

export interface ChannelAttributionResult<T> {
  data: T | null;
  error: Error | null;
}

export class ChannelAttributionRepository {
  constructor(private readonly supabase: SupabaseClient = supabaseServer) {}

  /**
   * Leads acquired in the window, with their raw attribution fields.
   * Channel resolution happens in `channelFromReferrer`, not here — the
   * repository stays a data-access layer with no business rules.
   */
  async findAttributedContacts(
    userId: string,
    since: string
  ): Promise<ChannelAttributionResult<AttributedContact[]>> {
    try {
      // No soft-delete filter: crm_contacts has no `status` or `deleted_at`
      // column — deletes are hard. Filtering on a non-existent column makes
      // PostgREST reject the whole query, which is what emptied this section.
      const { data, error } = await this.supabase
        .from('crm_contacts')
        .select('id, created_at, referrer_domain, utm_source, utm_medium, utm_campaign')
        .eq('user_id', userId)
        .gte('created_at', since);

      if (error) throw error;
      return { data: (data as AttributedContact[]) || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to load attributed contacts');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Bookings and revenue produced by the given contacts, at any time.
   *
   * Revenue deliberately avoids the double count that would follow from summing
   * transactions and paid invoices naively: an invoice paid through Stripe is
   * recorded in BOTH tables, linked by `payment_transactions.invoice_id`. We
   * take every succeeded transaction, then add only those paid invoices that no
   * transaction already accounts for.
   */
  async findOutcomesForContacts(
    userId: string,
    contactIds: string[]
  ): Promise<ChannelAttributionResult<ContactOutcomes>> {
    const empty: ContactOutcomes = {
      bookingsByContact: new Map(),
      revenueByContact: new Map(),
      billedByContact: new Map(),
    };

    if (contactIds.length === 0) {
      return { data: empty, error: null };
    }

    try {
      const [bookingsResult, transactionsResult, invoicesResult] = await Promise.all([
        this.supabase
          .from('scheduling_bookings')
          .select('contact_id')
          .eq('user_id', userId)
          .in('contact_id', contactIds)
          .neq('status', 'cancelled'),
        this.supabase
          .from('payment_transactions')
          .select('contact_id, amount, invoice_id')
          .eq('user_id', userId)
          .in('contact_id', contactIds)
          .eq('status', 'succeeded'),
        this.supabase
          // Every invoice, not just the paid ones. A channel that produced
          // twelve unpaid invoices has produced something, and reporting it as
          // zero income made the column look broken rather than unpaid.
          .from('payment_invoices')
          .select('id, contact_id, amount, status')
          .eq('user_id', userId)
          .in('contact_id', contactIds)
          .neq('status', 'cancelled'),
      ]);

      if (bookingsResult.error) throw bookingsResult.error;
      if (transactionsResult.error) throw transactionsResult.error;
      if (invoicesResult.error) throw invoicesResult.error;

      const bookingsByContact = new Map<string, number>();
      for (const booking of bookingsResult.data || []) {
        const id = (booking as { contact_id: string | null }).contact_id;
        if (!id) continue;
        bookingsByContact.set(id, (bookingsByContact.get(id) || 0) + 1);
      }

      const revenueByContact = new Map<string, number>();
      // Everything asked for, paid or not. Always >= revenueByContact.
      const billedByContact = new Map<string, number>();
      const invoicesAlreadyPaidByTransaction = new Set<string>();

      for (const tx of transactionsResult.data || []) {
        const { contact_id: id, amount, invoice_id } = tx as {
          contact_id: string | null;
          amount: number | string | null;
          invoice_id: string | null;
        };
        if (invoice_id) invoicesAlreadyPaidByTransaction.add(invoice_id);
        if (!id) continue;
        const value = Number(amount) || 0;
        revenueByContact.set(id, (revenueByContact.get(id) || 0) + value);
        billedByContact.set(id, (billedByContact.get(id) || 0) + value);
      }

      for (const invoice of invoicesResult.data || []) {
        const { id: invoiceId, contact_id, amount, status } = invoice as {
          id: string;
          contact_id: string | null;
          amount: number | string | null;
          status: string | null;
        };
        // Already counted as a transaction — adding it again would inflate both.
        if (invoicesAlreadyPaidByTransaction.has(invoiceId)) continue;
        if (!contact_id) continue;
        const value = Number(amount) || 0;

        billedByContact.set(contact_id, (billedByContact.get(contact_id) || 0) + value);
        // Only money that actually arrived counts as revenue.
        if (status === 'paid') {
          revenueByContact.set(contact_id, (revenueByContact.get(contact_id) || 0) + value);
        }
      }

      return { data: { bookingsByContact, revenueByContact, billedByContact }, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to load contact outcomes');
      return { data: null, error: error as Error };
    }
  }
}

export const channelAttributionRepository = new ChannelAttributionRepository();
