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
  status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  provider: 'sendgrid' | 'resend';
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
