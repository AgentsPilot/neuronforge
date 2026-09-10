/**
 * Proposals — the quote a client accepts before any money exists.
 *
 * Two things here are not ordinary CRUD and are the reason this file is worth
 * reading before changing it:
 *
 *  1. `send()` and `claimForAcceptance()` are CONDITIONAL updates. They move a
 *     proposal between states only from the state it is allowed to leave, and
 *     report whether they won. That is what makes acceptance safe against a
 *     double-clicked button, an email link opened twice, and a retried request.
 *
 *  2. `accepted_snapshot` is written once, at acceptance, and never touched
 *     again. It is the record of what was agreed; the live columns are only
 *     what the document currently says.
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'ProposalRepository' });

export type ProposalStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'withdrawn'
  | 'superseded';

/** How acceptance turns into money. */
export type PaymentShape =
  | { kind: 'single' }
  | { kind: 'installments'; count: number; frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' }
  | { kind: 'milestones'; stages: Array<{ label: string; percent: number }> };

export interface Proposal {
  id: string;
  user_id: string;
  contact_id: string;
  service_id: string | null;
  /**
   * The request this quote answers.
   *
   * Null for quotes raised outside a booking. Matching on `service_id` alone
   * attached every quote for a service to every booking of it, so a second
   * request from the same client opened showing the first job already accepted.
   */
  booking_id: string | null;
  /**
   * The proposal document, when one was attached.
   *
   * Per VERSION, not per proposal chain: a revision that changes the scope
   * carries its own file, and the superseded version keeps the one it was
   * actually sent with.
   */
  document_id: string | null;
  title: string;
  description: string | null;
  currency: string;
  total: number;
  prices_include_tax: boolean;
  tax_rate: number | null;
  tax_label: string | null;
  status: ProposalStatus;
  valid_until: string | null;
  payment_shape: PaymentShape;
  decline_reason: string | null;
  decline_note: string | null;
  supersedes_id: string | null;
  accepted_snapshot: Record<string, unknown> | null;
  created_invoice_id: string | null;
  created_plan_id: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalInsert {
  user_id: string;
  contact_id: string;
  booking_id?: string | null;
  document_id?: string | null;
  service_id?: string | null;
  title: string;
  description?: string | null;
  currency?: string;
  total: number;
  prices_include_tax?: boolean;
  tax_rate?: number | null;
  tax_label?: string | null;
  valid_until?: string | null;
  payment_shape?: PaymentShape;
  supersedes_id?: string | null;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

/** States a proposal can still be acted on from. */
export const OPEN_PROPOSAL_STATUSES: ProposalStatus[] = ['draft', 'sent', 'viewed'];

export class ProposalRepository {
  constructor(private supabase = supabaseServer) {}

  async create(input: ProposalInsert): Promise<RepositoryResult<Proposal>> {
    try {
      const { data, error } = await this.supabase
        .from('proposals')
        .insert({ ...input, status: 'draft' })
        .select('*')
        .single();

      if (error) throw error;
      return { data: data as Proposal, error: null };
    } catch (error) {
      logger.error({ err: error, userId: input.user_id }, 'Failed to create proposal');
      return { data: null, error: error as Error };
    }
  }

  async findById(id: string, userId: string): Promise<RepositoryResult<Proposal>> {
    try {
      const { data, error } = await this.supabase
        .from('proposals')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as Proposal) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to read proposal');
      return { data: null, error: error as Error };
    }
  }

  /**
   * By id alone, for the public accept page.
   *
   * ⟨unscoped-by-design⟩ — the caller holds a signed token naming this exact
   * proposal, which is the authorisation. Every other read is user-scoped.
   */
  async findByIdForToken(id: string): Promise<RepositoryResult<Proposal>> {
    try {
      const { data, error } = await this.supabase
        .from('proposals')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as Proposal) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to read proposal by token');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The version of this quote that is live now.
   *
   * A revision does not reuse the old row — it is a NEW proposal carrying
   * `supersedes_id`, with its own token in its own email. So a client who goes
   * back to the first message holds a link to a retired quote, and following it
   * used to end at "this offer has been replaced" with nowhere to go. That is
   * the message a business sends to someone who is still interested enough to
   * come back and look.
   *
   * Walking FORWARD along `supersedes_id` lands them on the offer that stands.
   * Safe to do unscoped for the same reason `findByIdForToken` is: a successor
   * is by construction the same business's replacement quote to the same
   * client, addressed to the person already holding the signed link.
   *
   * ⟨unscoped-by-design⟩ — see `findByIdForToken`.
   */
  async currentInChain(id: string): Promise<RepositoryResult<Proposal>> {
    try {
      let currentId = id;
      let current: Proposal | null = null;

      /*
       * Bounded, not `while (true)`.
       *
       * The chain is a linked list built by an API that only ever appends, so a
       * cycle should be impossible — but this runs unauthenticated on a public
       * page, and "should be impossible" is not a reason to let a stranger's
       * request spin the database forever. Ten revisions of one quote is
       * already an unusual negotiation.
       */
      for (let hop = 0; hop < 10; hop++) {
        const { data, error } = await this.supabase
          .from('proposals')
          .select('*')
          .eq('id', currentId)
          .maybeSingle();

        if (error) throw error;
        if (!data) break;
        current = data as Proposal;

        // Its replacement, if one was ever sent. Drafts are skipped: a revision
        // the owner is still writing is not something to show the client.
        const { data: next, error: nextError } = await this.supabase
          .from('proposals')
          .select('*')
          .eq('supersedes_id', currentId)
          .neq('status', 'draft')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (nextError) throw nextError;
        if (!next) break;

        currentId = (next as Proposal).id;
      }

      return { data: current, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to resolve the current proposal');
      return { data: null, error: error as Error };
    }
  }

  async listByContact(contactId: string, userId: string): Promise<RepositoryResult<Proposal[]>> {
    try {
      const { data, error } = await this.supabase
        .from('proposals')
        .select('*')
        .eq('user_id', userId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: (data as Proposal[]) || [], error: null };
    } catch (error) {
      logger.error({ err: error, contactId, userId }, 'Failed to list proposals');
      return { data: null, error: error as Error };
    }
  }

  /** Everything still awaiting a decision, for the dashboard and the briefing. */
  async listOpen(userId: string): Promise<RepositoryResult<Proposal[]>> {
    try {
      const { data, error } = await this.supabase
        .from('proposals')
        .select('*')
        .eq('user_id', userId)
        .in('status', OPEN_PROPOSAL_STATUSES)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: (data as Proposal[]) || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list open proposals');
      return { data: null, error: error as Error };
    }
  }

  /** Editable only while it is a draft — sending freezes the terms. */
  async updateDraft(
    id: string,
    userId: string,
    patch: Partial<ProposalInsert>
  ): Promise<RepositoryResult<Proposal>> {
    try {
      const { data, error } = await this.supabase
        .from('proposals')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('status', 'draft')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      return { data: (data as Proposal) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to update draft');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Send it, and freeze the terms.
   *
   * Conditional on `draft`, so pressing send twice sends once. Returns null
   * when the row was already sent rather than treating that as an error — the
   * caller's job is to not send a second email, not to explain a race.
   */
  async send(id: string, userId: string): Promise<RepositoryResult<Proposal>> {
    try {
      const { data, error } = await this.supabase
        .from('proposals')
        .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('status', 'draft')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      return { data: (data as Proposal) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to send proposal');
      return { data: null, error: error as Error };
    }
  }

  /** First open of the link. Never moves it backwards from a decision. */
  async markViewed(id: string): Promise<void> {
    try {
      await this.supabase
        .from('proposals')
        .update({ status: 'viewed', viewed_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'sent');
    } catch (error) {
      // A missed view flag is not worth failing the page the client is reading.
      logger.warn({ err: error, id }, 'Could not mark proposal viewed');
    }
  }

  /**
   * Take exclusive ownership of accepting this proposal.
   *
   * THE most important method here. Acceptance goes on to create a plan,
   * instalments, an invoice and possibly a Stripe object — and doing that twice
   * charges a client twice for one agreement.
   *
   * The database allows `sent`/`viewed` → `accepted` exactly once. The winner
   * gets the row back and does the work; everyone else gets null and shows the
   * same finished result. That is the whole guarantee, and it lives here rather
   * than in the route so no future caller can re-implement it more loosely.
   */
  async claimForAcceptance(id: string): Promise<RepositoryResult<Proposal>> {
    try {
      const { data, error } = await this.supabase
        .from('proposals')
        .update({ status: 'accepted', decided_at: new Date().toISOString() })
        .eq('id', id)
        .in('status', ['sent', 'viewed'])
        .select('*')
        .maybeSingle();

      if (error) throw error;
      return { data: (data as Proposal) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to claim proposal for acceptance');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Record what was agreed, and what it produced.
   *
   * Separate from the claim so that a failure while creating the money leaves a
   * proposal marked accepted with no snapshot — visibly half-done and
   * recoverable — rather than an un-accepted proposal with invoices against it.
   */
  async recordAcceptance(
    id: string,
    snapshot: Record<string, unknown>,
    created: { invoiceId?: string | null; planId?: string | null }
  ): Promise<void> {
    try {
      await this.supabase
        .from('proposals')
        .update({
          accepted_snapshot: snapshot,
          created_invoice_id: created.invoiceId ?? null,
          created_plan_id: created.planId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
    } catch (error) {
      logger.error({ err: error, id }, 'Could not record what acceptance produced');
    }
  }

  /**
   * Declined — which returns the work to the owner rather than ending it.
   *
   * Conditional for the same reason as acceptance: a client who taps twice has
   * declined once, and the owner should see one decline with one reason.
   */
  async decline(
    id: string,
    reason: string,
    note?: string
  ): Promise<RepositoryResult<Proposal>> {
    try {
      const { data, error } = await this.supabase
        .from('proposals')
        .update({
          status: 'declined',
          decline_reason: reason,
          decline_note: note || null,
          decided_at: new Date().toISOString(),
        })
        .eq('id', id)
        .in('status', ['sent', 'viewed'])
        .select('*')
        .maybeSingle();

      if (error) throw error;
      return { data: (data as Proposal) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to decline proposal');
      return { data: null, error: error as Error };
    }
  }

  /** The old version steps aside for a revision; its link stops accepting. */
  async markSuperseded(id: string, userId: string): Promise<void> {
    try {
      await this.supabase
        .from('proposals')
        .update({ status: 'superseded', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .in('status', ['sent', 'viewed', 'declined']);
    } catch (error) {
      logger.error({ err: error, id }, 'Could not supersede the previous version');
    }
  }
}

export const proposalRepository = new ProposalRepository();
