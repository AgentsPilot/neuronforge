import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'EmailAutomationRepository' });

// Types
export interface EmailSequence {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  trigger_type: 'manual' | 'contact_created' | 'booking_confirmed' | 'payment_received' | 'tag_added';
  trigger_config: Record<string, any>;
  is_active: boolean;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  created_at: string;
  updated_at: string;
}

export interface EmailSequenceStep {
  id: string;
  sequence_id: string;
  user_id: string;
  step_number: number;
  delay_minutes: number;
  subject: string;
  body_html: string;
  body_text: string | null;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
  created_at: string;
}

export interface EmailCampaign {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  segment_filter: Record<string, any>;
  status: 'draft' | 'scheduled' | 'sending' | 'sent';
  scheduled_at: string | null;
  sent_at: string | null;
  recipients_count: number;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
}

export interface EmailSend {
  id: string;
  user_id: string;
  contact_id: string;
  sequence_id: string | null;
  sequence_step_id: string | null;
  campaign_id: string | null;
  subject: string;
  body_html: string;
  to_email: string;
  /**
   * `complained` is a recipient marking the mail as spam.
   *
   * Listed because the provider reports it and the column is TEXT with no
   * CHECK, so a value the type does not know gets stored anyway — and the type
   * is then wrong about its own data in a way nothing detects. Exactly what
   * happened to `scheduling_bookings.status`, where a fifth value was written
   * for months while eleven declarations said there were four.
   *
   * It is kept distinct from `bounced`: a bounce is an address that does not
   * work, a complaint is a person who does not want to hear from this business
   * again, and only the second is a reason to stop writing to them.
   */
  status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'failed';
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  /**
   * Which transport actually sent it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The full set `sendEmail` can report, not a guess. This said
   * `'sendgrid' | 'resend'` while the transport layer had already grown SMTP
   * and Gmail paths, and the one writer collapsed everything to `'resend'` —
   * so the column could not record the truth and nobody could answer "what is
   * sending our email?" from the data.
   *
   * `sendgrid` is retained only because it is the column's historic DEFAULT;
   * no code path produces it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  provider: 'resend' | 'smtp' | 'gmail' | 'none' | 'sendgrid';
  provider_message_id: string | null;
  error_message: string | null;
  open_count: number;
  click_count: number;
  created_at: string;
}

export interface EmailSequenceEnrollment {
  id: string;
  user_id: string;
  sequence_id: string;
  contact_id: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  current_step_number: number;
  next_send_at: string | null;
  enrolled_at: string;
  completed_at: string | null;
}

export type EmailAutomationRepositoryResult<T> = {
  data: T | null;
  error: Error | null;
};

/**
 * What actually happened to a delivery event.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `data: null, error: null` was three different outcomes wearing one face:
 * no row carried that message id, a row did but the event added nothing, and —
 * separately — a real write. The only caller checks `error`, so all three were
 * logged as "Email delivery event recorded" and answered `{success: true}`.
 *
 * A webhook that reports success for an id it matched nothing on is the
 * silent-failure shape this codebase keeps paying for: if provider ids ever
 * stop lining up, every request would still return 200 and log a write, while
 * `opened_at` stayed null on every row and nothing anywhere said so.
 *
 * All three still answer 200 — a retry cannot help any of them — but they no
 * longer claim the same thing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type DeliveryEventOutcome = 'recorded' | 'unmatched' | 'duplicate' | 'failed';

export type DeliveryEventResult = EmailAutomationRepositoryResult<EmailSend> & {
  outcome: DeliveryEventOutcome;
};

// Email Sequence Repository
export class EmailSequenceRepository {
  private supabase = supabaseServer;

  async create(sequence: Omit<EmailSequence, 'id' | 'created_at' | 'updated_at'>): Promise<EmailAutomationRepositoryResult<EmailSequence>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sequences')
        .insert(sequence)
        .select()
        .single();

      if (error) throw error;
      logger.info({ sequenceId: data.id }, 'Email sequence created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create email sequence');
      return { data: null, error: error as Error };
    }
  }

  async findById(id: string, userId: string): Promise<EmailAutomationRepositoryResult<EmailSequence>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sequences')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to find email sequence');
      return { data: null, error: error as Error };
    }
  }

  async list(
    userId: string,
    options: {
      trigger_type?: string;
      is_active?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<EmailAutomationRepositoryResult<EmailSequence[]>> {
    try {
      const { trigger_type, is_active, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('email_sequences')
        .select('*')
        .eq('user_id', userId);

      if (trigger_type) query = query.eq('trigger_type', trigger_type);
      if (is_active !== undefined) query = query.eq('is_active', is_active);

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to list email sequences');
      return { data: null, error: error as Error };
    }
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<EmailSequence>
  ): Promise<EmailAutomationRepositoryResult<EmailSequence>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sequences')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ sequenceId: id }, 'Email sequence updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to update email sequence');
      return { data: null, error: error as Error };
    }
  }

  async delete(id: string, userId: string): Promise<EmailAutomationRepositoryResult<void>> {
    try {
      const { error } = await this.supabase
        .from('email_sequences')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      logger.info({ sequenceId: id }, 'Email sequence deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to delete email sequence');
      return { data: null, error: error as Error };
    }
  }
}

// Email Sequence Step Repository
export class EmailSequenceStepRepository {
  private supabase = supabaseServer;

  async create(step: Omit<EmailSequenceStep, 'id' | 'created_at'>): Promise<EmailAutomationRepositoryResult<EmailSequenceStep>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sequence_steps')
        .insert(step)
        .select()
        .single();

      if (error) throw error;
      logger.info({ stepId: data.id, sequenceId: data.sequence_id }, 'Email sequence step created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create email sequence step');
      return { data: null, error: error as Error };
    }
  }

  async list(sequenceId: string, userId: string): Promise<EmailAutomationRepositoryResult<EmailSequenceStep[]>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sequence_steps')
        .select('*')
        .eq('sequence_id', sequenceId)
        .eq('user_id', userId)
        .order('step_number', { ascending: true });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, sequenceId }, 'Failed to list email sequence steps');
      return { data: null, error: error as Error };
    }
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<EmailSequenceStep>
  ): Promise<EmailAutomationRepositoryResult<EmailSequenceStep>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sequence_steps')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ stepId: id }, 'Email sequence step updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to update email sequence step');
      return { data: null, error: error as Error };
    }
  }

  async delete(id: string, userId: string): Promise<EmailAutomationRepositoryResult<void>> {
    try {
      const { error } = await this.supabase
        .from('email_sequence_steps')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      logger.info({ stepId: id }, 'Email sequence step deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to delete email sequence step');
      return { data: null, error: error as Error };
    }
  }
}

// Email Campaign Repository
export class EmailCampaignRepository {
  private supabase = supabaseServer;

  async create(campaign: Omit<EmailCampaign, 'id' | 'created_at' | 'updated_at'>): Promise<EmailAutomationRepositoryResult<EmailCampaign>> {
    try {
      const { data, error } = await this.supabase
        .from('email_campaigns')
        .insert(campaign)
        .select()
        .single();

      if (error) throw error;
      logger.info({ campaignId: data.id }, 'Email campaign created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create email campaign');
      return { data: null, error: error as Error };
    }
  }

  async findById(id: string, userId: string): Promise<EmailAutomationRepositoryResult<EmailCampaign>> {
    try {
      const { data, error } = await this.supabase
        .from('email_campaigns')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to find email campaign');
      return { data: null, error: error as Error };
    }
  }

  async list(
    userId: string,
    options: {
      status?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<EmailAutomationRepositoryResult<EmailCampaign[]>> {
    try {
      const { status, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('email_campaigns')
        .select('*')
        .eq('user_id', userId);

      if (status) query = query.eq('status', status);

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to list email campaigns');
      return { data: null, error: error as Error };
    }
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<EmailCampaign>
  ): Promise<EmailAutomationRepositoryResult<EmailCampaign>> {
    try {
      const { data, error } = await this.supabase
        .from('email_campaigns')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ campaignId: id }, 'Email campaign updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to update email campaign');
      return { data: null, error: error as Error };
    }
  }

  async delete(id: string, userId: string): Promise<EmailAutomationRepositoryResult<void>> {
    try {
      const { error } = await this.supabase
        .from('email_campaigns')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      logger.info({ campaignId: id }, 'Email campaign deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to delete email campaign');
      return { data: null, error: error as Error };
    }
  }
}

// Email Send Repository
export class EmailSendRepository {
  private supabase = supabaseServer;

  async create(send: Omit<EmailSend, 'id' | 'created_at'>): Promise<EmailAutomationRepositoryResult<EmailSend>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sends')
        .insert(send)
        .select()
        .single();

      if (error) throw error;
      logger.info({ sendId: data.id, contactId: data.contact_id }, 'Email send record created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create email send record');
      return { data: null, error: error as Error };
    }
  }

  async findById(id: string, userId: string): Promise<EmailAutomationRepositoryResult<EmailSend>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sends')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to find email send');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Record what the provider observed about a message it already accepted.
   *
   * ⟨unscoped-by-design⟩ — the only method here without `.eq('user_id', …)`.
   *
   * A delivery webhook knows the provider's message id and nothing else: there
   * is no session, no owner, and no way to learn whose send it was except by
   * looking it up. The id IS the scope — generated by Resend, unguessable and
   * unique across the platform — so matching on it cannot reach another
   * tenant's row by accident. Same reasoning as the cron claim methods on
   * `LeadResponseRepository`.
   *
   * Timestamps only move FORWARD and counts only increase. Providers retry
   * webhooks and deliver them out of order, so a redelivered "opened" event
   * from an hour ago must not overwrite the open that happened since, and a
   * replayed event must not inflate the count.
   */
  async recordDeliveryEvent(
    providerMessageId: string,
    event: {
      status?: EmailSend['status'];
      deliveredAt?: string;
      openedAt?: string;
      clickedAt?: string;
      errorMessage?: string;
    }
  ): Promise<DeliveryEventResult> {
    try {
      const { data: existing, error: readError } = await this.supabase
        .from('email_sends')
        .select('id, status, delivered_at, opened_at, clicked_at, open_count, click_count')
        .eq('provider_message_id', providerMessageId)
        .maybeSingle();

      if (readError) throw readError;

      /*
       * Not an error. Events arrive for mail this platform did not record — a
       * send from before ids were captured, or one from another system on the
       * same Resend account. The webhook must still answer 200 so the provider
       * stops retrying something that will never match.
       */
      if (!existing) return { data: null, error: null, outcome: 'unmatched' };

      const patch: Record<string, unknown> = {};

      // Never regress a timestamp: a redelivered event is older than reality.
      if (event.deliveredAt && !existing.delivered_at) patch.delivered_at = event.deliveredAt;

      if (event.openedAt && (!existing.opened_at || event.openedAt > existing.opened_at)) {
        patch.opened_at = event.openedAt;
        patch.open_count = (existing.open_count ?? 0) + 1;
      }

      if (event.clickedAt && (!existing.clicked_at || event.clickedAt > existing.clicked_at)) {
        patch.clicked_at = event.clickedAt;
        patch.click_count = (existing.click_count ?? 0) + 1;
      }

      /*
       * A bounce or a complaint is terminal and outranks `sent`. An open can
       * never move the status: the row already says the mail went.
       */
      if (event.status && event.status !== 'sent') patch.status = event.status;
      if (event.errorMessage) patch.error_message = event.errorMessage;

      // Matched, but this event tells us nothing new — a redelivery, or an
      // open older than one already recorded.
      if (Object.keys(patch).length === 0) return { data: null, error: null, outcome: 'duplicate' };

      const { data, error } = await this.supabase
        .from('email_sends')
        .update(patch)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null, outcome: 'recorded' };
    } catch (error) {
      logger.error({ err: error, providerMessageId }, 'Failed to record an email delivery event');
      return { data: null, error: error as Error, outcome: 'failed' };
    }
  }


  async list(
    userId: string,
    options: {
      contact_id?: string;
      sequence_id?: string;
      campaign_id?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<EmailAutomationRepositoryResult<EmailSend[]>> {
    try {
      const { contact_id, sequence_id, campaign_id, status, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('email_sends')
        .select('*')
        .eq('user_id', userId);

      if (contact_id) query = query.eq('contact_id', contact_id);
      if (sequence_id) query = query.eq('sequence_id', sequence_id);
      if (campaign_id) query = query.eq('campaign_id', campaign_id);
      if (status) query = query.eq('status', status);

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to list email sends');
      return { data: null, error: error as Error };
    }
  }

  async updateStatus(
    id: string,
    userId: string,
    status: EmailSend['status'],
    metadata?: {
      sent_at?: string;
      delivered_at?: string;
      opened_at?: string;
      clicked_at?: string;
      error_message?: string;
    }
  ): Promise<EmailAutomationRepositoryResult<EmailSend>> {
    try {
      const updates: Partial<EmailSend> = { status, ...metadata };

      const { data, error } = await this.supabase
        .from('email_sends')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ sendId: id, status }, 'Email send status updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to update email send status');
      return { data: null, error: error as Error };
    }
  }
}

// Email Sequence Enrollment Repository
export class EmailSequenceEnrollmentRepository {
  private supabase = supabaseServer;

  async create(enrollment: Omit<EmailSequenceEnrollment, 'id' | 'enrolled_at' | 'completed_at'>): Promise<EmailAutomationRepositoryResult<EmailSequenceEnrollment>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sequence_enrollments')
        .insert(enrollment)
        .select()
        .single();

      if (error) throw error;
      logger.info({ enrollmentId: data.id, sequenceId: data.sequence_id, contactId: data.contact_id }, 'Contact enrolled in sequence');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to enroll contact in sequence');
      return { data: null, error: error as Error };
    }
  }

  async list(
    userId: string,
    options: {
      sequence_id?: string;
      contact_id?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<EmailAutomationRepositoryResult<EmailSequenceEnrollment[]>> {
    try {
      const { sequence_id, contact_id, status, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('email_sequence_enrollments')
        .select('*')
        .eq('user_id', userId);

      if (sequence_id) query = query.eq('sequence_id', sequence_id);
      if (contact_id) query = query.eq('contact_id', contact_id);
      if (status) query = query.eq('status', status);

      query = query
        .order('enrolled_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to list sequence enrollments');
      return { data: null, error: error as Error };
    }
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<EmailSequenceEnrollment>
  ): Promise<EmailAutomationRepositoryResult<EmailSequenceEnrollment>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sequence_enrollments')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ enrollmentId: id }, 'Sequence enrollment updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to update sequence enrollment');
      return { data: null, error: error as Error };
    }
  }

  async cancel(id: string, userId: string): Promise<EmailAutomationRepositoryResult<EmailSequenceEnrollment>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sequence_enrollments')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ enrollmentId: id }, 'Sequence enrollment cancelled');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to cancel sequence enrollment');
      return { data: null, error: error as Error };
    }
  }

  async getPendingSends(userId: string): Promise<EmailAutomationRepositoryResult<EmailSequenceEnrollment[]>> {
    try {
      const { data, error } = await this.supabase
        .from('email_sequence_enrollments')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .lte('next_send_at', new Date().toISOString());

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get pending sends');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton exports
export const emailSequenceRepository = new EmailSequenceRepository();
export const emailSequenceStepRepository = new EmailSequenceStepRepository();
export const emailCampaignRepository = new EmailCampaignRepository();
export const emailSendRepository = new EmailSendRepository();
export const emailSequenceEnrollmentRepository = new EmailSequenceEnrollmentRepository();
