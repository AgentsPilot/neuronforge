/**
 * CRM Task Repository
 * Handles all database operations for CRM tasks/follow-ups
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'CRMTaskRepository' });

// Type definitions
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface CRMTask {
  id: string;
  user_id: string;
  contact_id: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  reminder_at: string | null;
  completed_at: string | null;
  created_by: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  // Joined contact info
  contact?: {
    first_name: string;
    last_name: string | null;
    email: string | null;
  };
}

export interface CRMTaskInsert {
  user_id: string;
  contact_id?: string | null;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date?: string | null;
  reminder_at?: string | null;
  created_by?: string;
  source_entity_type?: string | null;
  source_entity_id?: string | null;
  tags?: string[];
}

export interface CRMTaskUpdate {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date?: string | null;
  reminder_at?: string | null;
  contact_id?: string | null;
  tags?: string[];
}

export interface CRMTaskRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export interface CRMTaskListOptions {
  contact_id?: string;
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority;
  due_before?: string;
  due_after?: string;
  created_by?: string;
  include_completed?: boolean;
  search?: string; // Search in title and description
  limit?: number;
  offset?: number;
  orderBy?: 'due_date' | 'created_at' | 'priority';
  orderDirection?: 'asc' | 'desc';
}

export class CRMTaskRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Create a new task
   */
  async create(
    task: CRMTaskInsert
  ): Promise<CRMTaskRepositoryResult<CRMTask>> {
    try {
      logger.info(
        { userId: task.user_id, contactId: task.contact_id, title: task.title },
        'Creating CRM task'
      );

      const { data, error } = await this.supabase
        .from('crm_tasks')
        .insert({
          ...task,
          priority: task.priority ?? 'medium',
          status: task.status ?? 'pending',
          created_by: task.created_by ?? 'manual',
          tags: task.tags ?? []
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ taskId: data.id, userId: task.user_id }, 'CRM task created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: task.user_id }, 'Failed to create CRM task');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find task by ID
   */
  async findById(
    id: string,
    userId: string
  ): Promise<CRMTaskRepositoryResult<CRMTask>> {
    try {
      const { data, error } = await this.supabase
        .from('crm_tasks')
        .select('*, contact:crm_contacts(first_name, last_name, email)')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, taskId: id, userId }, 'Failed to find CRM task');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List tasks with filtering options
   */
  async list(
    userId: string,
    options: CRMTaskListOptions = {}
  ): Promise<CRMTaskRepositoryResult<CRMTask[]>> {
    try {
      const {
        contact_id,
        status,
        priority,
        due_before,
        due_after,
        created_by,
        include_completed = false,
        limit = 50,
        offset = 0,
        orderBy = 'due_date',
        orderDirection = 'asc'
      } = options;

      let query = this.supabase
        .from('crm_tasks')
        .select('*, contact:crm_contacts(first_name, last_name, email)')
        .eq('user_id', userId);

      // Filter by contact
      if (contact_id) {
        query = query.eq('contact_id', contact_id);
      }

      // Filter by status
      if (status) {
        if (Array.isArray(status)) {
          query = query.in('status', status);
        } else {
          query = query.eq('status', status);
        }
      } else if (!include_completed) {
        // Default: exclude completed and cancelled tasks
        query = query.in('status', ['pending', 'in_progress']);
      }

      // Filter by priority
      if (priority) {
        query = query.eq('priority', priority);
      }

      // Filter by due date range
      if (due_before) {
        query = query.lte('due_date', due_before);
      }
      if (due_after) {
        query = query.gte('due_date', due_after);
      }

      // Filter by creator
      if (created_by) {
        query = query.eq('created_by', created_by);
      }

      // Search by title or description
      if (options.search) {
        const searchPattern = `%${options.search}%`;
        query = query.or(`title.ilike.${searchPattern},description.ilike.${searchPattern}`);
      }

      // Order
      // For priority ordering, we need to handle it specially
      if (orderBy === 'priority') {
        // Priority order: urgent > high > medium > low
        query = query.order('priority', { ascending: orderDirection === 'asc' });
      } else if (orderBy === 'due_date') {
        // Put null due dates last
        query = query.order('due_date', { ascending: orderDirection === 'asc', nullsFirst: false });
      } else {
        query = query.order(orderBy, { ascending: orderDirection === 'asc' });
      }

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to list CRM tasks');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get tasks for a specific contact
   */
  async listByContact(
    contactId: string,
    userId: string,
    options: Omit<CRMTaskListOptions, 'contact_id'> = {}
  ): Promise<CRMTaskRepositoryResult<CRMTask[]>> {
    return this.list(userId, { ...options, contact_id: contactId });
  }

  /**
   * Get overdue tasks
   */
  async getOverdue(
    userId: string,
    limit: number = 20
  ): Promise<CRMTaskRepositoryResult<CRMTask[]>> {
    const now = new Date().toISOString();
    return this.list(userId, {
      due_before: now,
      status: ['pending', 'in_progress'],
      limit,
      orderBy: 'due_date',
      orderDirection: 'asc'
    });
  }

  /**
   * Get upcoming tasks (due in next N days)
   */
  async getUpcoming(
    userId: string,
    days: number = 7,
    limit: number = 20
  ): Promise<CRMTaskRepositoryResult<CRMTask[]>> {
    const now = new Date();
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    return this.list(userId, {
      due_after: now.toISOString(),
      due_before: futureDate.toISOString(),
      status: ['pending', 'in_progress'],
      limit,
      orderBy: 'due_date',
      orderDirection: 'asc'
    });
  }

  /**
   * Count tasks by status
   */
  async countByStatus(
    userId: string,
    contactId?: string
  ): Promise<CRMTaskRepositoryResult<Record<TaskStatus, number>>> {
    try {
      let query = this.supabase
        .from('crm_tasks')
        .select('status')
        .eq('user_id', userId);

      if (contactId) {
        query = query.eq('contact_id', contactId);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Count by status
      const counts: Record<TaskStatus, number> = {
        pending: 0,
        in_progress: 0,
        completed: 0,
        cancelled: 0
      };

      for (const task of data || []) {
        counts[task.status as TaskStatus]++;
      }

      return { data: counts, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to count CRM tasks');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update task
   */
  async update(
    id: string,
    userId: string,
    updates: CRMTaskUpdate
  ): Promise<CRMTaskRepositoryResult<CRMTask>> {
    try {
      logger.info({ taskId: id, userId }, 'Updating CRM task');

      const { data, error } = await this.supabase
        .from('crm_tasks')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ taskId: id, userId }, 'CRM task updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, taskId: id, userId }, 'Failed to update CRM task');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark task as completed
   */
  async complete(
    id: string,
    userId: string
  ): Promise<CRMTaskRepositoryResult<CRMTask>> {
    return this.update(id, userId, { status: 'completed' });
  }

  /**
   * Mark task as in progress
   */
  async startProgress(
    id: string,
    userId: string
  ): Promise<CRMTaskRepositoryResult<CRMTask>> {
    return this.update(id, userId, { status: 'in_progress' });
  }

  /**
   * Cancel task
   */
  async cancel(
    id: string,
    userId: string
  ): Promise<CRMTaskRepositoryResult<CRMTask>> {
    return this.update(id, userId, { status: 'cancelled' });
  }

  /**
   * Delete task
   */
  async delete(
    id: string,
    userId: string
  ): Promise<CRMTaskRepositoryResult<void>> {
    try {
      logger.info({ taskId: id, userId }, 'Deleting CRM task');

      const { error } = await this.supabase
        .from('crm_tasks')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ taskId: id, userId }, 'CRM task deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, taskId: id, userId }, 'Failed to delete CRM task');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export with server-side Supabase client
import { supabaseServer } from '@/lib/supabaseServer';
export const crmTaskRepository = new CRMTaskRepository(supabaseServer);
