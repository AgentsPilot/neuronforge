/**
 * The business's newsletter audience.
 *
 * Separate from `crm_contacts` on purpose: a subscriber is an audience, not a
 * deal. While they are only a subscriber no chaser can reach them, because every
 * one of them queries contacts and there is no contact row. They become one when
 * they book — a trigger links the two — or when the owner presses Move to
 * pipeline.
 *
 * Separate from `marketing_consent_state` too, which records DECISIONS and
 * treats absence as "no". A signup that has not yet clicked its confirmation
 * link has no consent row anywhere, so without this table it would be stored
 * nowhere between submitting the form and confirming.
 *
 * @module lib/repositories/BusinessSubscriberRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';

export type SubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed' | 'promoted';

export interface BusinessSubscriber {
  id: string;
  user_id: string;
  email: string;
  email_normalized: string;
  name: string | null;
  status: SubscriberStatus;
  source: string;
  attribution: Record<string, unknown>;
  subscribed_at: string;
  confirmed_at: string | null;
  promoted_contact_id: string | null;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriberResult<T> {
  data: T | null;
  error: Error | null;
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export class BusinessSubscriberRepository {
  private logger: Logger;

  constructor(private supabase: SupabaseClient = defaultSupabase) {
    this.logger = createLogger({ service: 'BusinessSubscriberRepository' });
  }

  /**
   * Record a signup, or return the row that already exists.
   *
   * Idempotent on `(user_id, email_normalized)`: submitting the form twice is
   * normal — people double-click, or sign up again because the first
   * confirmation went to spam — and it must not produce two rows or reset
   * somebody who has already confirmed.
   */
  async subscribe(params: {
    userId: string;
    email: string;
    name?: string | null;
    source?: string;
    attribution?: Record<string, unknown>;
  }): Promise<SubscriberResult<BusinessSubscriber>> {
    try {
      const { data: existing } = await this.supabase
        .from('business_subscribers')
        .select('*')
        .eq('user_id', params.userId)
        .eq('email_normalized', normalize(params.email))
        .maybeSingle();

      if (existing) {
        /*
         * Someone who had unsubscribed and is signing up again starts over at
         * `pending` — they have to confirm afresh, because the previous
         * withdrawal is a decision we must not quietly overturn.
         */
        if ((existing as BusinessSubscriber).status === 'unsubscribed') {
          const { data, error } = await this.supabase
            .from('business_subscribers')
            .update({ status: 'pending', subscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', (existing as BusinessSubscriber).id)
            .select('*')
            .single();

          if (error) throw error;
          return { data: data as BusinessSubscriber, error: null };
        }

        return { data: existing as BusinessSubscriber, error: null };
      }

      const { data, error } = await this.supabase
        .from('business_subscribers')
        .insert({
          email: params.email,
          name: params.name ?? null,
          status: 'pending',
          source: params.source ?? 'newsletter',
          attribution: params.attribution ?? {},
          // Last, and never spread from a caller object.
          user_id: params.userId,
        })
        .select('*')
        .single();

      if (error) throw error;
      return { data: data as BusinessSubscriber, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId: params.userId }, 'Failed to record a subscriber');
      return { data: null, error: error as Error };
    }
  }

  /** Called when the double opt-in link is clicked. */
  async markConfirmed(userId: string, email: string): Promise<SubscriberResult<boolean>> {
    return this.setStatus(userId, email, 'confirmed', {
      confirmed_at: new Date().toISOString(),
    });
  }

  /** Called when consent is withdrawn, from wherever it is withdrawn. */
  async markUnsubscribed(userId: string, email: string): Promise<SubscriberResult<boolean>> {
    return this.setStatus(userId, email, 'unsubscribed');
  }

  private async setStatus(
    userId: string,
    email: string,
    status: SubscriberStatus,
    extra: Record<string, unknown> = {}
  ): Promise<SubscriberResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('business_subscribers')
        .update({ status, updated_at: new Date().toISOString(), ...extra })
        .eq('user_id', userId)
        .eq('email_normalized', normalize(email))
        /*
         * A promoted row keeps its status. They are a contact now; the roster
         * entry has become a provenance record, and flipping it back to
         * `confirmed` would put them in the Subscribers tab alongside people
         * who are not yet clients.
         */
        .neq('status', 'promoted');

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId, status }, 'Failed to set subscriber status');
      return { data: null, error: error as Error };
    }
  }

  async findByEmail(userId: string, email: string): Promise<SubscriberResult<BusinessSubscriber>> {
    try {
      const { data, error } = await this.supabase
        .from('business_subscribers')
        .select('*')
        .eq('user_id', userId)
        .eq('email_normalized', normalize(email))
        .maybeSingle();

      if (error) throw error;
      return { data: (data as BusinessSubscriber) ?? null, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to find a subscriber');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The Subscribers tab.
   *
   * `includePromoted` is off by default: the tab answers "who is on my list and
   * not yet a client", and a promoted row answers a different question. Nothing
   * is ever deleted, so the flag is the only thing between the owner and the
   * full history.
   */
  async list(
    userId: string,
    options: { includePromoted?: boolean } = {}
  ): Promise<SubscriberResult<BusinessSubscriber[]>> {
    try {
      let query = this.supabase
        .from('business_subscribers')
        .select('*')
        .eq('user_id', userId)
        .order('subscribed_at', { ascending: false });

      if (!options.includePromoted) {
        query = query.neq('status', 'promoted');
      }

      const { data, error } = await query;
      if (error) throw error;
      return { data: (data ?? []) as BusinessSubscriber[], error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to list subscribers');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Record that this subscriber became a contact.
   *
   * The trigger on `crm_contacts` does this for a contact created by any other
   * route. This is the explicit path, for Move to pipeline, where the caller
   * already knows both ids.
   */
  async markPromoted(
    userId: string,
    email: string,
    contactId: string
  ): Promise<SubscriberResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('business_subscribers')
        .update({
          status: 'promoted',
          promoted_contact_id: contactId,
          promoted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('email_normalized', normalize(email));

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to mark a subscriber promoted');
      return { data: null, error: error as Error };
    }
  }
}

export const businessSubscriberRepository = new BusinessSubscriberRepository();
