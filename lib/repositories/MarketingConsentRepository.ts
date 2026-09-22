/**
 * The record of who agreed to be marketed to, and on what wording.
 *
 * Two tables behind one class. `marketing_consent_events` is the evidence: an
 * append-only ledger where every grant carries the sentence the person actually
 * read. `marketing_consent_state` is the answer the send gate needs — one row
 * per address, maintained by a database trigger, never written from here.
 *
 * Reads go to state (one indexed lookup, cheap enough to run per recipient
 * inside a fan-out). Writes go to events, and the trigger does the rest.
 *
 * @module lib/repositories/MarketingConsentRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';

export type ConsentChannel = 'email' | 'sms' | 'whatsapp' | 'phone';
export type ConsentDecision = 'granted' | 'withdrawn';

/**
 * How the decision reached us. This is the "how" half of what GDPR Art. 7(1)
 * asks a controller to be able to demonstrate.
 */
export type ConsentMethod =
  | 'web_form'
  | 'double_optin_confirm'
  | 'unsubscribe_link'
  | 'list_unsubscribe'
  | 'owner_entered'
  | 'imported'
  | 'reply_stop'
  | 'legacy_unsubscribe_import';

export interface MarketingConsentEvent {
  id: string;
  user_id: string;
  contact_id: string | null;
  email: string;
  email_normalized: string;
  channel: ConsentChannel;
  purpose: 'marketing';
  decision: ConsentDecision;
  method: ConsentMethod;
  statement_text: string | null;
  statement_locale: string | null;
  statement_version: number | null;
  privacy_policy_url: string | null;
  source_surface: string | null;
  source_page_url: string | null;
  ip_hash: string | null;
  ip_hash_salt: string | null;
  user_agent: string | null;
  session_id: string | null;
  recorded_by: string | null;
  evidence: Record<string, unknown>;
  redacted_at: string | null;
  occurred_at: string;
  created_at: string;
}

export interface MarketingConsentState {
  user_id: string;
  email_normalized: string;
  channel: ConsentChannel;
  consented: boolean;
  contact_id: string | null;
  last_event_id: string;
  decided_at: string;
  updated_at: string;
}

export interface MarketingConsentSettings {
  user_id: string;
  capture_enabled: boolean;
  statement_en: string | null;
  statement_es: string | null;
  statement_he: string | null;
  statement_version: number;
  privacy_policy_mode: 'hosted' | 'url' | 'none';
  privacy_policy_url: string | null;
  privacy_policy_body: string | null;
  privacy_policy_updated_at: string | null;
  postal_address: string | null;
  label_as_advertisement: boolean;
}

export interface MarketingConsentResult<T> {
  data: T | null;
  error: Error | null;
}

/** One place, so a lookup and a write can never disagree about the key. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class MarketingConsentRepository {
  private logger: Logger;

  constructor(private supabase: SupabaseClient = defaultSupabase) {
    this.logger = createLogger({ service: 'MarketingConsentRepository' });
  }

  /**
   * Append one decision.
   *
   * A grant without `statementText` is rejected by the database, not by this
   * method — `marketing_consent_grant_has_wording`. That is deliberate: the
   * constraint holds even for a caller that bypasses this class.
   */
  async record(params: {
    userId: string;
    email: string;
    decision: ConsentDecision;
    method: ConsentMethod;
    contactId?: string | null;
    channel?: ConsentChannel;
    statementText?: string | null;
    statementLocale?: string | null;
    statementVersion?: number | null;
    privacyPolicyUrl?: string | null;
    sourceSurface?: string | null;
    sourcePageUrl?: string | null;
    ipHash?: string | null;
    ipHashSalt?: string | null;
    userAgent?: string | null;
    sessionId?: string | null;
    recordedBy?: string | null;
    evidence?: Record<string, unknown>;
    occurredAt?: Date;
  }): Promise<MarketingConsentResult<MarketingConsentEvent>> {
    try {
      const { data, error } = await this.supabase
        .from('marketing_consent_events')
        .insert({
          contact_id: params.contactId ?? null,
          email: params.email,
          channel: params.channel ?? 'email',
          purpose: 'marketing',
          decision: params.decision,
          method: params.method,
          statement_text: params.statementText ?? null,
          statement_locale: params.statementLocale ?? null,
          statement_version: params.statementVersion ?? null,
          privacy_policy_url: params.privacyPolicyUrl ?? null,
          source_surface: params.sourceSurface ?? null,
          source_page_url: params.sourcePageUrl ?? null,
          ip_hash: params.ipHash ?? null,
          ip_hash_salt: params.ipHashSalt ?? null,
          user_agent: params.userAgent ?? null,
          session_id: params.sessionId ?? null,
          recorded_by: params.recordedBy ?? null,
          evidence: params.evidence ?? {},
          occurred_at: (params.occurredAt ?? new Date()).toISOString(),
          // Last, and never spread from a caller object: the tenant is not
          // something a caller gets to overwrite by passing an extra key.
          user_id: params.userId,
        })
        .select('*')
        .single();

      if (error) throw error;
      return { data: data as MarketingConsentEvent, error: null };
    } catch (error) {
      this.logger.error(
        { err: error, userId: params.userId, decision: params.decision },
        'Failed to record consent decision'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * The gate's question: may this business market to this address?
   *
   * `data: null` with no error means no decision was ever recorded, which reads
   * as "no". Callers must not treat absence as permission.
   */
  async getState(
    userId: string,
    email: string,
    channel: ConsentChannel = 'email'
  ): Promise<MarketingConsentResult<MarketingConsentState>> {
    try {
      const { data, error } = await this.supabase
        .from('marketing_consent_state')
        .select('*')
        .eq('user_id', userId)
        .eq('email_normalized', normalizeEmail(email))
        .eq('channel', channel)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as MarketingConsentState) ?? null, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to read consent state');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The same question for a list, in one round trip.
   *
   * This is what the bulk-send preview calls, so that the number the owner
   * confirms is the number that actually goes out. Addresses absent from the
   * map have no recorded decision, which is a "no".
   */
  async getStateBulk(
    userId: string,
    emails: string[],
    channel: ConsentChannel = 'email'
  ): Promise<MarketingConsentResult<Map<string, boolean>>> {
    const keys = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));
    if (keys.length === 0) return { data: new Map(), error: null };

    try {
      const { data, error } = await this.supabase
        .from('marketing_consent_state')
        .select('email_normalized, consented')
        .eq('user_id', userId)
        .eq('channel', channel)
        .in('email_normalized', keys);

      if (error) throw error;

      const map = new Map<string, boolean>();
      for (const row of (data ?? []) as Pick<
        MarketingConsentState,
        'email_normalized' | 'consented'
      >[]) {
        map.set(row.email_normalized, row.consented);
      }
      return { data: map, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to read consent state in bulk');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Every decision ever recorded for one person, newest first.
   *
   * This is the answer to a subject access request, so it returns the events
   * themselves — wording included — rather than a summary of them.
   */
  async history(
    userId: string,
    target: { contactId?: string; email?: string }
  ): Promise<MarketingConsentResult<MarketingConsentEvent[]>> {
    try {
      let query = this.supabase
        .from('marketing_consent_events')
        .select('*')
        .eq('user_id', userId)
        .order('occurred_at', { ascending: false });

      if (target.email) {
        query = query.eq('email_normalized', normalizeEmail(target.email));
      } else if (target.contactId) {
        query = query.eq('contact_id', target.contactId);
      } else {
        throw new Error('history requires a contactId or an email');
      }

      const { data, error } = await query;
      if (error) throw error;
      return { data: (data ?? []) as MarketingConsentEvent[], error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to read consent history');
      return { data: null, error: error as Error };
    }
  }

  async settings(userId: string): Promise<MarketingConsentResult<MarketingConsentSettings>> {
    try {
      const { data, error } = await this.supabase
        .from('marketing_consent_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as MarketingConsentSettings) ?? null, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to read consent settings');
      return { data: null, error: error as Error };
    }
  }

  async upsertSettings(
    userId: string,
    patch: Partial<Omit<MarketingConsentSettings, 'user_id'>>
  ): Promise<MarketingConsentResult<MarketingConsentSettings>> {
    try {
      const { data, error } = await this.supabase
        .from('marketing_consent_settings')
        .upsert(
          {
            ...patch,
            updated_at: new Date().toISOString(),
            user_id: userId,
          },
          { onConflict: 'user_id' }
        )
        .select('*')
        .single();

      if (error) throw error;
      return { data: data as MarketingConsentSettings, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to save consent settings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * "N of your M contacts can receive marketing."
   *
   * Without this the owner experiences the send gate as the platform silently
   * refusing to work, and files it as a bug.
   */
  async countMailable(userId: string): Promise<MarketingConsentResult<number>> {
    try {
      const { count, error } = await this.supabase
        .from('marketing_consent_state')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('channel', 'email')
        .eq('consented', true);

      if (error) throw error;
      return { data: count ?? 0, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to count mailable contacts');
      return { data: null, error: error as Error };
    }
  }

  async countContacts(userId: string): Promise<MarketingConsentResult<number>> {
    try {
      const { count, error } = await this.supabase
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .not('email', 'is', null);

      if (error) throw error;
      return { data: count ?? 0, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to count contacts');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Erasure. Strips the personal data out of every event for one address and
   * leaves the decisions standing.
   *
   * The rows cannot be deleted — a trigger refuses — and that is the point: a
   * right-to-erasure request must not quietly resurrect someone's consent, nor
   * lose the record that they withdrew it.
   *
   * The state row is deliberately left standing, address and all. It is the
   * suppression: erasing it would make a withdrawn person mailable again, which
   * is the one outcome erasure must never produce. `email_unsubscribes` makes
   * the same trade for the same reason (see purge/descriptors.ts).
   */
  async redact(userId: string, email: string): Promise<MarketingConsentResult<number>> {
    try {
      const { data, error } = await this.supabase
        .from('marketing_consent_events')
        .update({
          email: 'redacted@invalid',
          ip_hash: null,
          ip_hash_salt: null,
          user_agent: null,
          session_id: null,
          source_page_url: null,
          redacted_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('email_normalized', normalizeEmail(email))
        .is('redacted_at', null)
        .select('id');

      if (error) throw error;
      return { data: (data ?? []).length, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to redact consent events');
      return { data: null, error: error as Error };
    }
  }
}

export const marketingConsentRepository = new MarketingConsentRepository();
