/**
 * CRM Contact Repository
 * Handles all database operations for CRM contacts
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { activitySentence } from '@/lib/business-os/activityText';

const logger = createLogger({ service: 'CRMContactRepository' });

// Type definitions
export interface CRMContact {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  stage: string; // 'lead', 'client', 'past_client'
  tags: string[];
  custom_fields: Record<string, any>;
  source: string | null; // 'website_form', 'manual', 'import', 'booking', 'campaign'
  /**
   * How the contact was captured — UTM, referrer, which smart link, which page.
   * Backed by `crm_contacts.source_metadata` (20260824_add_conversion_layer.sql).
   *
   * Declared on the INSERT type and not on this one, so every reader that
   * selected it — `select('*')` returns it — had to cast or go without. The CRM
   * card derives its origin chip from exactly this.
   */
  source_metadata?: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Aggregated fields (optional, populated by list queries)
  bookings_count?: number;
  tasks_count?: number;
}

export interface CRMContactInsert {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  stage?: string;
  tags?: string[];
  custom_fields?: Record<string, any>;
  source?: string | null;
  // Lead attribution (UTM params, referrer, session) captured at first touch.
  // Backed by crm_contacts.source_metadata JSONB (20260824_add_conversion_layer.sql).
  source_metadata?: Record<string, unknown> | null;
  notes?: string | null;
}

export interface CRMContactUpdate {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  stage?: string;
  /** Where this contact came from. A real column, and the API already edits it. */
  source?: string | null;
  /**
   * The capture attribution. Updatable because `upsertByEmail` carries it on to
   * an existing contact — a returning client who arrives through a tagged link
   * should update how they got here, not keep their first visit's answer.
   */
  source_metadata?: Record<string, unknown> | null;
  tags?: string[];
  custom_fields?: Record<string, any>;
  notes?: string | null;
}

export interface CRMContactRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export interface CRMContactListOptions {
  stage?: string;
  tags?: string[];
  search?: string; // Search in name, email, phone
  /**
   * THE SEARCH BOX'S FILTERS, APPLIED IN SQL.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The orders page parses its search into terms and then filters the rows IN
   * MEMORY, which it can afford because it has them all. This list cannot: the
   * board pages twenty contacts per stage column, so a filter applied after a
   * page arrives would show three of twenty and silently hide every match
   * sitting on page two. The filter has to narrow the query, not its result.
   *
   * So the route parses the string and hands the parts down. Each is a LIST
   * because two chips of the same field read as "either" — nobody is in two
   * stages at once — and every list is AND-ed against the others.
   * ───────────────────────────────────────────────────────────────────────────
   */
  stages?: string[];
  sources?: string[];
  /** ALL of these, unlike `tags`, which matches any. */
  allTags?: string[];
  /**
   * Presence filters — `has:email`, `no:bookings`.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `email` and `phone` are columns, and "absent" means NULL or empty string: a
   * lead captured through a form that submitted a blank field has `''` rather
   * than null, and an owner looking for contacts with no email means both.
   *
   * `bookings` and `tasks` are the two tables this select already embeds, so
   * neither costs another query — but they do change the JOIN, which is why the
   * select is built rather than fixed. Verified against production in BOTH
   * directions, because an embedded filter that behaves like an inner join
   * silently drops the very contacts "never booked" is asking for.
   * ───────────────────────────────────────────────────────────────────────────
   */
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasBookings?: boolean;
  hasOpenTasks?: boolean;
  /** At least this many days in the current stage, from `stage_entered_at`. */
  inStageForDays?: number;
  /**
   * `created_at` bounds as INSTANTS, already resolved on the business's clock.
   *
   * Not days. A day is only a range of instants once you know the zone, and
   * this repository does not: a contact added at 23:00 in New York on the last
   * day of September is 03:00 UTC on the 1st of October, so bounding a UTC day
   * would drop them out of the month they were added in. The caller holds the
   * timezone and converts; this applies what it is given.
   */
  createdFromUtc?: string;
  createdToUtc?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'updated_at' | 'first_name' | 'last_name';
  orderDirection?: 'asc' | 'desc';
}

export class CRMContactRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Create a new contact
   */
  async create(
    contact: CRMContactInsert
  ): Promise<CRMContactRepositoryResult<CRMContact>> {
    try {
      logger.info({ userId: contact.user_id }, 'Creating CRM contact');

      const { data, error } = await this.supabase
        .from('crm_contacts')
        .insert({
          ...contact,
          stage: contact.stage || 'lead',
          tags: contact.tags || [],
          custom_fields: contact.custom_fields || {}
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ contactId: data.id, userId: contact.user_id }, 'CRM contact created');
      await this.logCreationActivity(data);
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: contact.user_id }, 'Failed to create CRM contact');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The first entry on a contact's own timeline.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS LIVES HERE AND NOT IN A TRIGGER OR A ROUTE
   *
   * `20260722_crm_contact_creation_activity.sql` defined a trigger to do this,
   * and that trigger is not live. Measured on production 2026-10-08: of 20
   * contacts, 14 had no creation entry, the only contact predating the route's
   * own write had none, and NOT ONE contact had two. If the trigger existed,
   * every contact added through `/api/crm/contacts` would carry two entries,
   * because that route also wrote one. So nothing in the database writes it.
   *
   * That route was the single one of about ten creation paths that compensated.
   * The other nine relied on the trigger and recorded nothing: website
   * bookings, intake forms, subscribers, chat, the AI data layer, bizql
   * mutate, the CRM plugin and the scheduling plugin. The production split was
   * exactly that -- all six `website_booking` contacts missing, `website_form`,
   * `newsletter` and `instagram` missing, while the hand-added ones had it.
   *
   * Every one of those paths already goes through this method, so writing it
   * once here is what makes the entry unconditional. The route's own write is
   * removed in the same change: leaving both would double-log, which is the
   * trap in simply re-applying the migration.
   *
   * Non-blocking by construction. A timeline entry is worth less than the
   * contact, so a failure here is logged and swallowed -- it must never turn a
   * saved contact into a failed request.
   */
  private async logCreationActivity(contact: CRMContact): Promise<void> {
    try {
      /*
       * The sentence is stored already written, in the business's language:
       * the drawer renders `title` as-is and reserves the JSON `description`
       * for the facts it re-translates at display time.
       */
      const { data: profile } = await this.supabase
        .from('business_profiles')
        .select('language')
        .eq('user_id', contact.user_id)
        .maybeSingle();

      const source = contact.source || null;
      const title = source
        // Named only when we know where they came from: "added from unknown"
        // is worse than saying nothing about it.
        ? activitySentence('contact_created_from', { source }, profile?.language)
        : activitySentence('contact_created', {}, profile?.language);

      const { error } = await this.supabase.from('crm_activities').insert({
        user_id: contact.user_id,
        contact_id: contact.id,
        activity_type: 'contact_created',
        title,
        description: JSON.stringify({
          kind: 'contact_created',
          source: source || undefined,
          stage: contact.stage || undefined,
        }),
        auto_logged: true,
        source_capability: 'crm',
        source_entity_id: contact.id,
        activity_date: contact.created_at,
      });

      if (error) throw error;
    } catch (err) {
      logger.warn(
        { err, contactId: contact.id, userId: contact.user_id },
        'Contact-created activity logging failed (non-blocking)'
      );
    }
  }

  /**
   * Find contact by ID
   */
  async findById(
    id: string,
    userId: string
  ): Promise<CRMContactRepositoryResult<CRMContact>> {
    try {
      const { data, error } = await this.supabase
        .from('crm_contacts')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, contactId: id, userId }, 'Failed to find CRM contact');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Ownership oracle: the contact's id if `userId` owns it, else null.
   *
   * For service-role paths that were handed a contact id by someone else (the
   * Stripe webhook vets metadata ids with it). Depends on `id` and `user_id`
   * only, so no join or schema change elsewhere can make it fail closed on
   * every call. Not found is a normal answer, not an error, and is not logged:
   * the caller decides what a miss means. No `deleted_at` filter: this answers
   * "whose is it", the same as `findById`.
   */
  async findOwnedId(
    id: string,
    userId: string
  ): Promise<CRMContactRepositoryResult<string>> {
    try {
      const { data, error } = await this.supabase
        .from('crm_contacts')
        .select('id')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      return { data: data?.id ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, contactId: id, userId }, 'Failed to check CRM contact ownership');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find contact by email
   */
  async findByEmail(
    email: string,
    userId: string
  ): Promise<CRMContactRepositoryResult<CRMContact>> {
    try {
      /*
       * ── OLDEST FIRST, ONE ROW ───────────────────────────────────────────
       *
       * This used `.single()`, and PostgREST answers PGRST116 for MORE than
       * one row as well as for none. The branch below reads that as "no
       * contact" either way — so on a tenant that already has two rows for one
       * address, every caller was told there was none and created a third.
       * Duplicates bred duplicates, and the helper reported success each time.
       *
       * `limit(1)` after an order is what the three hand-written copies in the
       * public booking flow already do, with a comment saying why. This is the
       * shared one catching up.
       *
       * Oldest rather than newest: the first row is the one other records
       * reference, so returning it keeps a caller from attaching new work to a
       * duplicate.
       */
      const { data, error } = await this.supabase
        .from('crm_contacts')
        .select('*')
        .eq('email', email)
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        // Not found is not an error in this case
        return { data: null, error: null };
      }

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, email, userId }, 'Failed to find CRM contact by email');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List contacts with filtering and pagination
   */
  async list(
    userId: string,
    options: CRMContactListOptions = {}
  ): Promise<CRMContactRepositoryResult<CRMContact[]>> {
    try {
      const {
        stage,
        tags,
        search,
        stages,
        sources,
        allTags,
        createdFromUtc,
        createdToUtc,
        hasEmail,
        hasPhone,
        hasBookings,
        hasOpenTasks,
        inStageForDays,
        limit = 50,
        offset = 0,
        orderBy = 'created_at',
        orderDirection = 'desc'
      } = options;

      /*
       * THE JOIN THAT FILTERS IS A SECOND, ALIASED EMBED — not the one that counts.
       *
       * ─────────────────────────────────────────────────────────────────────
       * `crm_tasks!inner(count)` DOES NOT FILTER. Measured: on an account with
       * two contacts, one of which has an open task, it returned both, while
       * `crm_tasks!inner(id)` returned the one. An embed that selects only an
       * aggregate does not constrain the join, so `!inner` on it is silently
       * inert — and a filter that silently matches everything is the worst
       * shape available, because the screen looks like an unfiltered list and
       * nothing says the filter did nothing.
       *
       * So the counting embeds stay exactly as they were, and a separate
       * aliased embed selecting a real column does the narrowing. PostgREST
       * allows the same relation twice under different names, and the count
       * comes back untouched beside it.
       * ─────────────────────────────────────────────────────────────────────
       */
      const filterEmbeds: string[] = [];

      if (hasBookings === true) filterEmbeds.push('purchases:scheduling_bookings!inner(id)');
      if (hasBookings === false) filterEmbeds.push('no_bookings:scheduling_bookings!left(id)');
      if (hasOpenTasks === true) filterEmbeds.push('open_tasks:crm_tasks!inner(id)');
      if (hasOpenTasks === false) filterEmbeds.push('no_tasks:crm_tasks!left(id)');

      let query = this.supabase
        .from('crm_contacts')
        .select(
          ['*', 'scheduling_bookings(count)', 'crm_tasks(count)', ...filterEmbeds].join(', ')
        )
        .eq('user_id', userId)
        /*
         * Count PURCHASES, not meetings.
         *
         * A package is one booking that contains its sessions: the container
         * carries no `parent_booking_id`, each session carries the container's.
         * `SchedulingBookingInsert` says so outright -- "`parent_booking_id IS
         * NULL` means a purchase for every reader that counts them" -- and this
         * reader was not applying it.
         *
         * So a client who bought one six-session package read as six bookings
         * on their pipeline card, next to a client who had booked six separate
         * times. Measured on production 2026-10-08: one contact showed 17 where
         * 11 is the truth.
         *
         * Filtering the EMBEDDED table narrows the count without narrowing the
         * contacts: a contact with no bookings still comes back, with a count
         * of nought. Verified against production rather than assumed, because
         * an embedded filter that behaved like an inner join would quietly drop
         * every contact who has never booked.
         */
        .is('scheduling_bookings.parent_booking_id', null);

      // Filter by stage
      if (stage) {
        query = query.eq('stage', stage);
      }

      // Filter by tags (contains any)
      if (tags && tags.length > 0) {
        query = query.overlaps('tags', tags);
      }

      /*
       * The search box's own filters — see `CRMContactListOptions`.
       *
       * `.in()` for stage and source, because two chips of one field read as
       * "either". `.contains()` for tags, which is ALL of them: asking for two
       * tags means both, where `tags` above (the pre-existing option) means
       * any. The two are deliberately separate rather than one option behaving
       * differently depending on who called it.
       */
      /*
       * Blank values dropped first, and that is not defensive tidying.
       * Measured: `.contains('tags', [undefined])` returned EVERY contact —
       * a filter that silently matches all is worse than one that errors,
       * because the screen looks like an unfiltered list and nobody is told
       * their filter did nothing.
       */
      const present = (values?: string[]) => (values ?? []).filter(value => value.trim().length > 0);

      const wantedStages = present(stages);
      const wantedSources = present(sources);
      const wantedTags = present(allTags);

      if (wantedStages.length > 0) {
        query = query.in('stage', wantedStages);
      }

      if (wantedSources.length > 0) {
        query = query.in('source', wantedSources);
      }

      if (wantedTags.length > 0) {
        query = query.contains('tags', wantedTags);
      }

      /* Instants, resolved by the caller on the business's clock — see the
         option's note. Inclusive at both ends, matching the period a chip
         describes. */
      if (createdFromUtc) {
        query = query.gte('created_at', createdFromUtc);
      }

      if (createdToUtc) {
        query = query.lte('created_at', createdToUtc);
      }

      /*
       * Absent means NULL **or** empty string. A form that submitted a blank
       * field wrote `''`, and an owner asking for contacts with no email means
       * those too — a filter that returned only the nulls would quietly leave
       * half the answer out.
       */
      if (hasEmail === true) {
        query = query.not('email', 'is', null).neq('email', '');
      } else if (hasEmail === false) {
        query = query.or('email.is.null,email.eq.');
      }

      if (hasPhone === true) {
        query = query.not('phone', 'is', null).neq('phone', '');
      } else if (hasPhone === false) {
        query = query.or('phone.is.null,phone.eq.');
      }

      /*
       * The predicates that go with those aliases. `!left` narrows nothing by
       * itself — `is null` on the alias is what turns it into "has none".
       *
       * "Has bookings" means has a PURCHASE, the same thing the count means: a
       * package is one booking containing its sessions, so a client who bought
       * one six-session block has one purchase and not six.
       */
      if (hasBookings === true) {
        query = query.is('purchases.parent_booking_id', null);
      } else if (hasBookings === false) {
        query = query.is('no_bookings.parent_booking_id', null).is('no_bookings', null);
      }

      if (hasOpenTasks === true) {
        query = query.neq('open_tasks.status', 'completed');
      } else if (hasOpenTasks === false) {
        query = query.is('no_tasks', null);
      }

      /*
       * Still where they were N days ago. `stage_entered_at` is an instant, so
       * this is "entered on or before the cutoff" — anyone who moved since has
       * a later one and falls out, which is exactly "stuck".
       */
      if (inStageForDays && inStageForDays > 0) {
        query = query.lte(
          'stage_entered_at',
          new Date(Date.now() - inStageForDays * 86_400_000).toISOString()
        );
      }

      // Search by name, email, or phone
      // Handle multi-word searches (e.g., "אופיר עומר" should match first_name="אופיר", last_name="עומר")
      if (search) {
        const searchTerms = search.trim().split(/\s+/);

        if (searchTerms.length === 1) {
          // Single word - search in all fields
          query = query.or(
            `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
          );
        } else {
          // Multi-word - search each word in name fields OR full string in email/phone
          // This allows "אופיר עומר" to match contacts where first_name contains "אופיר" AND last_name contains "עומר"
          const firstWord = searchTerms[0];
          const lastWord = searchTerms[searchTerms.length - 1];

          // Search for: (first word in first_name OR last word in last_name) OR (any word in email/phone)
          // Also include the full search term as fallback
          query = query.or(
            `first_name.ilike.%${firstWord}%,last_name.ilike.%${lastWord}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
          );
        }
      }

      // Ordering
      query = query.order(orderBy, { ascending: orderDirection === 'asc' });

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      /*
       * A package SOLD BY A QUOTE is one purchase, not two.
       *
       * Accepting a quote writes two bookings: the quote's own, and the package
       * container holding the meetings it bought. Both have a null
       * `parent_booking_id`, so both survive the filter above -- and the card
       * read one sale as two.
       *
       * The drawer already resolves this. `foldPackageMeetings` moves a
       * container's meetings onto the quote booking that sold them and drops
       * the container, which is why the card said 11 where the drawer showed 10
       * for the same client. The drawer is the one that is right: the client
       * agreed to one thing.
       *
       * Done as a second read rather than in the embedded count, because the
       * rule needs `proposals` and an embedded aggregate cannot reach another
       * table. Deduplicated by container, since a superseded quote and the
       * accepted one can both point at the same package.
       */
      const containerOwners = new Map<string, string>();
      const { data: soldPackages, error: proposalsError } = await this.supabase
        .from('proposals')
        .select('contact_id, package_booking_id')
        .eq('user_id', userId)
        .not('package_booking_id', 'is', null)
        .not('booking_id', 'is', null);

      if (proposalsError) {
        // Never fail a pipeline because a count could not be refined; the
        // unrefined figure is wrong by at most the number of quoted packages.
        logger.warn({ err: proposalsError, userId }, 'Could not fold quoted packages into booking counts');
      }
      for (const row of soldPackages ?? []) {
        if (row.package_booking_id && row.contact_id) containerOwners.set(row.package_booking_id, row.contact_id);
      }
      const absorbedByContact = new Map<string, number>();
      for (const contactId of containerOwners.values()) {
        absorbedByContact.set(contactId, (absorbedByContact.get(contactId) ?? 0) + 1);
      }

      // Transform to flatten counts from nested structure
      const contacts = (data || []).map((row: any) => {
        const { scheduling_bookings, crm_tasks, ...contact } = row;
        const counted = scheduling_bookings?.[0]?.count ?? 0;
        return {
          ...contact,
          // Never below nought, whatever the two reads disagree about.
          bookings_count: Math.max(0, counted - (absorbedByContact.get(contact.id) ?? 0)),
          tasks_count: crm_tasks?.[0]?.count ?? 0
        } as CRMContact;
      });

      return { data: contacts, error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to list CRM contacts');
      return { data: null, error: error as Error };
    }
  }

  /**
   * How many contacts were created inside a window.
   *
   * A half-open range [startUtc, endUtc), because the caller's window is a
   * business day: a contact created at exactly tomorrow's local midnight
   * belongs to tomorrow, and an inclusive upper bound would count it on both
   * days. Head-only — the briefing needs the number, never the rows.
   */
  /**
   * The people who got in touch during a window, not just how many.
   *
   * `countCreatedBetween` below answers "how many", which is what the morning
   * briefing said for a long time: *"2 new people got in touch today."* True,
   * and almost useless — the owner still had to open the CRM to find out who,
   * which is the whole thing they wanted to be told.
   *
   * Capped rather than paged. This feeds one line of a briefing; a business
   * with forty new leads in a day is told about a few of them and the count
   * covers the rest.
   */
  async listCreatedBetween(
    userId: string,
    startUtc: string,
    endUtc: string,
    limit: number = 5
  ): Promise<CRMContactRepositoryResult<CRMContact[]>> {
    try {
      const { data, error } = await this.supabase
        .from('crm_contacts')
        .select('id, first_name, last_name, email, source, custom_fields, created_at')
        .eq('user_id', userId)
        .gte('created_at', startUtc)
        .lt('created_at', endUtc)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) throw error;
      return { data: (data || []) as CRMContact[], error: null };
    } catch (error) {
      logger.error({ err: error, userId, startUtc, endUtc }, 'Failed to list new contacts');
      return { data: null, error: error as Error };
    }
  }

  async countCreatedBetween(
    userId: string,
    startUtc: string,
    endUtc: string
  ): Promise<CRMContactRepositoryResult<number>> {
    try {
      const { count, error } = await this.supabase
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', startUtc)
        .lt('created_at', endUtc);

      if (error) throw error;
      return { data: count || 0, error: null };
    } catch (error) {
      logger.error({ err: error, userId, startUtc, endUtc }, 'Failed to count new contacts');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Count contacts (optionally filtered)
   */
  async count(
    userId: string,
    options: Pick<CRMContactListOptions, 'stage' | 'tags' | 'search'> = {}
  ): Promise<CRMContactRepositoryResult<number>> {
    try {
      const { stage, tags, search } = options;

      let query = this.supabase
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (stage) {
        query = query.eq('stage', stage);
      }

      if (tags && tags.length > 0) {
        query = query.overlaps('tags', tags);
      }

      // Handle multi-word searches (same logic as list method)
      if (search) {
        const searchTerms = search.trim().split(/\s+/);

        if (searchTerms.length === 1) {
          query = query.or(
            `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
          );
        } else {
          const firstWord = searchTerms[0];
          const lastWord = searchTerms[searchTerms.length - 1];
          query = query.or(
            `first_name.ilike.%${firstWord}%,last_name.ilike.%${lastWord}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
          );
        }
      }

      const { count, error } = await query;

      if (error) throw error;

      return { data: count || 0, error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to count CRM contacts');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update contact
   */
  async update(
    id: string,
    userId: string,
    updates: CRMContactUpdate
  ): Promise<CRMContactRepositoryResult<CRMContact>> {
    try {
      logger.info({ contactId: id, userId }, 'Updating CRM contact');

      const { data, error } = await this.supabase
        .from('crm_contacts')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ contactId: id, userId }, 'CRM contact updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, contactId: id, userId }, 'Failed to update CRM contact');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update contact stage
   */
  async updateStage(
    id: string,
    userId: string,
    stage: string
  ): Promise<CRMContactRepositoryResult<CRMContact>> {
    return this.update(id, userId, { stage });
  }

  /**
   * Add tag to contact
   */
  async addTag(
    id: string,
    userId: string,
    tag: string
  ): Promise<CRMContactRepositoryResult<CRMContact>> {
    try {
      // Get current tags
      const contactResult = await this.findById(id, userId);
      if (contactResult.error || !contactResult.data) {
        return contactResult;
      }

      const currentTags = contactResult.data.tags || [];
      if (currentTags.includes(tag)) {
        // Tag already exists
        return { data: contactResult.data, error: null };
      }

      const newTags = [...currentTags, tag];
      return this.update(id, userId, { tags: newTags });
    } catch (error) {
      logger.error({ err: error, contactId: id, userId, tag }, 'Failed to add tag to contact');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Remove tag from contact
   */
  async removeTag(
    id: string,
    userId: string,
    tag: string
  ): Promise<CRMContactRepositoryResult<CRMContact>> {
    try {
      const contactResult = await this.findById(id, userId);
      if (contactResult.error || !contactResult.data) {
        return contactResult;
      }

      const currentTags = contactResult.data.tags || [];
      const newTags = currentTags.filter(t => t !== tag);

      return this.update(id, userId, { tags: newTags });
    } catch (error) {
      logger.error({ err: error, contactId: id, userId, tag }, 'Failed to remove tag from contact');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Upsert contact (create if doesn't exist, update if exists)
   * Matches by email
   */
  async upsertByEmail(
    contact: CRMContactInsert
  ): Promise<CRMContactRepositoryResult<CRMContact>> {
    try {
      if (!contact.email) {
        throw new Error('Email is required for upsert');
      }

      logger.info({ userId: contact.user_id, email: contact.email }, 'Upserting CRM contact by email');

      // Check if contact exists
      const existing = await this.findByEmail(contact.email, contact.user_id);

      if (existing.data) {
        // Update existing contact
        const { email, user_id, ...updates } = contact;
        return this.update(existing.data.id, contact.user_id, updates);
      } else {
        // Create new contact
        return this.create(contact);
      }
    } catch (error) {
      logger.error({ err: error, userId: contact.user_id }, 'Failed to upsert CRM contact');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete contact (hard delete)
   */
  async delete(
    id: string,
    userId: string
  ): Promise<CRMContactRepositoryResult<void>> {
    try {
      logger.info({ contactId: id, userId }, 'Deleting CRM contact');

      const { error } = await this.supabase
        .from('crm_contacts')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ contactId: id, userId }, 'CRM contact deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, contactId: id, userId }, 'Failed to delete CRM contact');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get contacts by stage (for Kanban view)
   */
  async getByStage(
    userId: string,
    stage: string
  ): Promise<CRMContactRepositoryResult<CRMContact[]>> {
    return this.list(userId, { stage, orderBy: 'updated_at', orderDirection: 'desc' });
  }

  /**
   * Get contacts by tag
   */
  async getByTag(
    userId: string,
    tag: string
  ): Promise<CRMContactRepositoryResult<CRMContact[]>> {
    return this.list(userId, { tags: [tag], orderBy: 'updated_at', orderDirection: 'desc' });
  }

  /**
   * Lightweight scalar list for chat / name-resolution paths.
   *
   * Selects only scalar contact fields (no booking/task count subqueries) so it stays cheap,
   * user-scoped. Supports an id-set, stage, and name/email search filter (same `or(ilike …)`
   * shape as the legacy inline queries) plus an optional limit (omit `limit` to return all).
   * Behavior-preserving replacement for the inline `crm_contacts` selects that previously
   * lived in ChatCommandExecutor (fuzzy matching, contact-by-ids, stage/search, name lookup).
   */
  async listBasic(
    userId: string,
    options: { ids?: string[]; stage?: string; search?: string; limit?: number } = {}
  ): Promise<CRMContactRepositoryResult<Pick<CRMContact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone' | 'stage' | 'source'>[]>> {
    try {
      /*
       * `source` is here because the mailable-audience list shows where each
       * person came from, and it is a scalar column like the rest — no join,
       * no subquery, so the "lightweight" promise above still holds. Added
       * rather than given its own method: a second near-identical select is
       * how two readers of one table drift apart.
       */
      let query = this.supabase
        .from('crm_contacts')
        .select('id, first_name, last_name, email, phone, stage, source')
        .eq('user_id', userId);

      if (options.ids) {
        query = query.in('id', options.ids);
      }
      if (options.stage) {
        query = query.eq('stage', options.stage);
      }
      if (options.search) {
        query = query.or(
          `first_name.ilike.%${options.search}%,last_name.ilike.%${options.search}%,email.ilike.%${options.search}%`
        );
      }
      if (options.limit !== undefined) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to list CRM contacts (basic)');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export (will be initialized with server-side Supabase client)
import { supabaseServer } from '@/lib/supabaseServer';
export const crmContactRepository = new CRMContactRepository(supabaseServer);
