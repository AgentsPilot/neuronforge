/**
 * CRM Contact Repository
 * Handles all database operations for CRM contacts
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

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
}

export interface CRMContactUpdate {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  stage?: string;
  tags?: string[];
  custom_fields?: Record<string, any>;
}

export interface CRMContactRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export interface CRMContactListOptions {
  stage?: string;
  tags?: string[];
  search?: string; // Search in name, email, phone
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
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: contact.user_id }, 'Failed to create CRM contact');
      return { data: null, error: error as Error };
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
   * Find contact by email
   */
  async findByEmail(
    email: string,
    userId: string
  ): Promise<CRMContactRepositoryResult<CRMContact>> {
    try {
      const { data, error } = await this.supabase
        .from('crm_contacts')
        .select('*')
        .eq('email', email)
        .eq('user_id', userId)
        .single();

      if (error) {
        // Not found is not an error in this case
        if (error.code === 'PGRST116') {
          return { data: null, error: null };
        }
        throw error;
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
        limit = 50,
        offset = 0,
        orderBy = 'created_at',
        orderDirection = 'desc'
      } = options;

      let query = this.supabase
        .from('crm_contacts')
        .select('*, scheduling_bookings(count), crm_tasks(count)')
        .eq('user_id', userId);

      // Filter by stage
      if (stage) {
        query = query.eq('stage', stage);
      }

      // Filter by tags (contains any)
      if (tags && tags.length > 0) {
        query = query.overlaps('tags', tags);
      }

      // Search by name, email, or phone
      if (search) {
        query = query.or(
          `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
        );
      }

      // Ordering
      query = query.order(orderBy, { ascending: orderDirection === 'asc' });

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      // Transform to flatten counts from nested structure
      const contacts = (data || []).map((row: any) => {
        const { scheduling_bookings, crm_tasks, ...contact } = row;
        return {
          ...contact,
          bookings_count: scheduling_bookings?.[0]?.count ?? 0,
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

      if (search) {
        query = query.or(
          `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
        );
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
  ): Promise<CRMContactRepositoryResult<Pick<CRMContact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone' | 'stage'>[]>> {
    try {
      let query = this.supabase
        .from('crm_contacts')
        .select('id, first_name, last_name, email, phone, stage')
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
