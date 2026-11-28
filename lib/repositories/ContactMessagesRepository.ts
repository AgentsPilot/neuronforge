// lib/repositories/ContactMessagesRepository.ts
// Data-access layer for the contact-form inbox: `contact_messages` and its
// replies in `message_replies`. Workplan:
// docs/workplans/contact-inbox-standard-workplan.md.
//
// WHY THERE IS NO `.eq('user_id', userId)` HERE (CLAUDE.md rule 4 exemption,
// stated rather than silently skipped):
//
//   Both tables are platform-level data: a message someone sent to AgentPilot
//   through the contact form. They have NO `user_id` (or any other owner)
//   column, so there is nothing to scope by and no tenant's rows can be reached
//   through this repository.
//
//   `supabaseServer` (service role) is therefore INTENTIONAL. Both tables are
//   server-only (RLS on, every grant revoked from anon and authenticated,
//   migration 20261056), so no browser or cookie client could read them anyway.
//
//   Because scoping cannot protect these tables, AUTHORISATION IS THE CALLER'S
//   JOB. The permitted callers are:
//     * `app/api/admin/messages/**`, behind `requireAdmin`
//       (`lib/admin/requireAdminRoute.ts`; never `profiles.role`), for the
//       `...ForAdmin` methods;
//     * `app/api/contact/route.ts` (public), for `createFromContactForm` and
//       `markEmailSent` only.
//   `lib/repositories/__tests__/contactMessagesRepository.callers.guard.test.ts`
//   pins this list. Do not add another caller without updating it.
//
//   No method accepts a caller-supplied table name, column list or filter
//   string. The search text is quoted and escaped here before it reaches
//   PostgREST, and the update copies its two allowed fields by name.
//
//   Server-side only — never import this from a `'use client'` component.
//
// Log lines carry ids, counts, the status filter and whether a search was
// given; never a name, an email address, message text, notes or the search
// text itself.
//
// No method throws: every failure comes back as `{ data: null, error }`.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AdminReadContext } from './AdminTokenUsageAnalyticsRepository';
import { quoteFilterValue } from './AdminJobsQueuesRepository';
import { ilikeContainsPattern, matchesLiterally } from './BusinessProfileRepository';
import type {
  AgentRepositoryResult as RepositoryResult,
  ContactMessageRow,
  ContactMessageStatus,
  ContactMessageWithReplies,
  CreateContactMessageInput,
  MessageReplyRow,
  UpdateContactMessageInput,
} from './types';

// `contact_messages` is named literally in each `.from(...)`, so the RLS slice 2 source guard can see it. Replies are read only through the embed.
const REPLIES_TABLE = 'message_replies';
/** The embed alias. PostgREST addresses an aliased embed by its alias (SA C-1). */
export const REPLIES_ALIAS = 'replies';

/** Every column of `contact_messages`, the shape the admin screen reads. Never `*`. */
export const CONTACT_MESSAGE_COLUMNS =
  'id, name, email, message, status, email_sent, created_at, subject, phone, company, priority, source, updated_at, admin_notes';

export const MESSAGE_REPLY_COLUMNS = 'id, message_id, sender, content, created_at, admin_id';

/** The columns the admin search looks in. */
export const CONTACT_MESSAGE_SEARCH_COLUMNS = ['name', 'email', 'message', 'subject', 'company'] as const;

/** Most messages the admin list returns, newest first (D-11). */
export const ADMIN_MESSAGES_LIST_LIMIT = 500;

export interface AdminMessagesListOptions {
  /** A status, or 'all' for every status. */
  status: ContactMessageStatus | 'all';
  /** Already trimmed and length-capped by the route's schema; '' means no search. */
  search: string;
}

/**
 * The `.or()` expression for a contains-search across the search columns.
 *
 * The text is made a literal ILIKE pattern first (`\`, `%`, `_` escaped, `*`
 * sent as `_`), then double-quoted for PostgREST (`\` and `"` escaped), so
 * commas, parentheses, dots and colons in it stay part of the value.
 */
export function buildContactMessageSearchFilter(search: string): string {
  const operand = quoteFilterValue(ilikeContainsPattern(search));
  return CONTACT_MESSAGE_SEARCH_COLUMNS.map((column) => `${column}.ilike.${operand}`).join(',');
}

type RawMessageWithReplies = ContactMessageRow & { replies?: MessageReplyRow[] | null };

export class ContactMessagesRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Intentionally bypasses RLS — server-only platform tables, see the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'ContactMessagesRepository' });
  }

  // ============ Admin operations (callers: app/api/admin/messages/**) ============

  /** The inbox, newest first, each message with its replies, in one query. */
  async listForAdmin(
    ctx: AdminReadContext,
    options: AdminMessagesListOptions
  ): Promise<RepositoryResult<ContactMessageWithReplies[]>> {
    const methodLogger = this.logger.child({ method: 'listForAdmin', ...ctx });
    const hasSearch = options.search !== '';
    try {
      let query = this.supabase
        .from('contact_messages')
        .select(`${CONTACT_MESSAGE_COLUMNS}, ${REPLIES_ALIAS}:${REPLIES_TABLE}(${MESSAGE_REPLY_COLUMNS})`);

      if (options.status !== 'all') {
        query = query.eq('status', options.status);
      }
      if (hasSearch) {
        query = query.or(buildContactMessageSearchFilter(options.search));
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .order('created_at', { referencedTable: REPLIES_ALIAS, ascending: true })
        .limit(ADMIN_MESSAGES_LIST_LIMIT);

      if (error) throw error;

      let rows: ContactMessageWithReplies[] = ((data ?? []) as RawMessageWithReplies[]).map((row) => ({
        ...row,
        replies: Array.isArray(row.replies) ? row.replies : [],
      }));

      // `*` reached the server as "any one character"; keep only literal matches.
      if (options.search.includes('*')) {
        rows = rows.filter((row) =>
          CONTACT_MESSAGE_SEARCH_COLUMNS.some((column) => matchesLiterally(row[column], options.search))
        );
      }

      methodLogger.info({ status: options.status, hasSearch, results: rows.length }, 'Contact messages listed');
      return { data: rows, error: null };
    } catch (error) {
      methodLogger.error({ err: error, status: options.status, hasSearch }, 'Failed to list contact messages');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Change a message's status and/or notes. Only those two fields are copied
   * from `patch`, by name; `updated_at` is set here. `data: null, error: null`
   * when no message has that id.
   */
  async updateForAdmin(
    ctx: AdminReadContext,
    id: string,
    patch: UpdateContactMessageInput
  ): Promise<RepositoryResult<ContactMessageRow>> {
    const methodLogger = this.logger.child({ method: 'updateForAdmin', ...ctx, messageId: id });
    const values: Record<string, unknown> = {};
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.admin_notes !== undefined) values.admin_notes = patch.admin_notes;
    const fields = Object.keys(values);
    values.updated_at = new Date().toISOString();

    try {
      const { data, error } = await this.supabase
        .from('contact_messages')
        .update(values)
        .eq('id', id)
        .select(CONTACT_MESSAGE_COLUMNS)
        .maybeSingle();

      if (error) throw error;

      methodLogger.info({ fields, found: data !== null }, 'Contact message update');
      return { data: (data as ContactMessageRow | null) ?? null, error: null };
    } catch (error) {
      methodLogger.error({ err: error, fields }, 'Failed to update contact message');
      return { data: null, error: error as Error };
    }
  }

  /** Delete a message; its replies go with it (FK cascade). `deleted: false` when no row had that id. */
  async deleteForAdmin(ctx: AdminReadContext, id: string): Promise<RepositoryResult<{ deleted: boolean }>> {
    const methodLogger = this.logger.child({ method: 'deleteForAdmin', ...ctx, messageId: id });
    try {
      const { data, error } = await this.supabase.from('contact_messages').delete().eq('id', id).select('id');

      if (error) throw error;

      const deleted = Array.isArray(data) && data.length > 0;
      methodLogger.info({ deleted }, 'Contact message delete');
      return { data: { deleted }, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to delete contact message');
      return { data: null, error: error as Error };
    }
  }

  // ============ Contact form (caller: app/api/contact/route.ts) ============

  /** Save one message from the public contact form. */
  async createFromContactForm(input: CreateContactMessageInput): Promise<RepositoryResult<{ id: string }>> {
    const methodLogger = this.logger.child({ method: 'createFromContactForm' });
    try {
      const { data, error } = await this.supabase
        .from('contact_messages')
        .insert({
          name: input.name,
          email: input.email,
          message: input.message,
          status: 'unread',
          email_sent: false,
          source: 'contact_form',
        })
        .select('id')
        .single();

      if (error) throw error;

      const id = (data as { id: string }).id;
      methodLogger.info({ messageId: id }, 'Contact message saved');
      return { data: { id }, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to save contact message');
      return { data: null, error: error as Error };
    }
  }

  /** Record that the team notification for this message was sent. */
  async markEmailSent(id: string): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'markEmailSent', messageId: id });
    try {
      const { error } = await this.supabase
        .from('contact_messages')
        .update({ email_sent: true, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to mark contact message as emailed');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton instance for convenience
export const contactMessagesRepository = new ContactMessagesRepository();
