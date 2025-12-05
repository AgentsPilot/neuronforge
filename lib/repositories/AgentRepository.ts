// lib/repositories/AgentRepository.ts
// Repository for managing agent persistence and status transitions

import { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/lib/supabaseClient';
import type {
  Agent,
  AgentStatus,
  CreateAgentInput,
  UpdateAgentInput,
  AgentRepositoryResult,
} from './types';
import { STATUS_TRANSITIONS } from './types';

export class AgentRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
  }

  // ============ Query Operations ============

  /**
   * Find an agent by ID (excludes soft-deleted)
   */
  async findById(id: string, userId: string): Promise<AgentRepositoryResult<Agent>> {
    try {
      const { data, error } = await this.supabase
        .from('agents')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find all agents for a user (excludes soft-deleted and inactive by default)
   * @param userId - The user ID
   * @param options.status - Filter by specific status (overrides includeInactive)
   * @param options.includeInactive - Include inactive agents (default: false)
   * @param options.limit - Limit number of results
   * @param options.offset - Offset for pagination
   */
  async findAllByUser(
    userId: string,
    options?: { status?: AgentStatus; includeInactive?: boolean; limit?: number; offset?: number }
  ): Promise<AgentRepositoryResult<Agent[]>> {
    try {
      let query = this.supabase
        .from('agents')
        .select('*')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      // If specific status is requested, use that
      if (options?.status) {
        query = query.eq('status', options.status);
      } else if (!options?.includeInactive) {
        // By default, exclude inactive agents unless includeInactive is true
        query = query.neq('status', 'inactive');
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }
      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find inactive agents for a user (for admin/recovery purposes)
   */
  async findInactive(userId: string): Promise<AgentRepositoryResult<Agent[]>> {
    try {
      const { data, error } = await this.supabase
        .from('agents')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'inactive')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find soft-deleted agents (for recovery/admin purposes)
   */
  async findDeleted(userId: string): Promise<AgentRepositoryResult<Agent[]>> {
    try {
      const { data, error } = await this.supabase
        .from('agents')
        .select('*')
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Check if agent exists and belongs to user
   */
  async exists(id: string, userId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('agents')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();

    return !!data;
  }

  // ============ CRUD Operations ============

  /**
   * Create a new agent
   */
  async create(input: CreateAgentInput): Promise<AgentRepositoryResult<Agent>> {
    try {
      const { data, error } = await this.supabase
        .from('agents')
        .insert({
          ...input,
          status: input.status || 'draft',
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update an agent (does not change status - use status methods for that)
   */
  async update(
    id: string,
    userId: string,
    input: UpdateAgentInput
  ): Promise<AgentRepositoryResult<Agent>> {
    try {
      const { data, error } = await this.supabase
        .from('agents')
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  // ============ Status Management ============

  /**
   * Update agent status with validation
   */
  async updateStatus(
    id: string,
    userId: string,
    newStatus: AgentStatus,
    reason?: string
  ): Promise<AgentRepositoryResult<Agent>> {
    try {
      // Get current agent to validate transition
      const { data: current, error: fetchError } = await this.findById(id, userId);
      if (fetchError) throw fetchError;
      if (!current) throw new Error('Agent not found');

      // Validate status transition
      const allowedTransitions = STATUS_TRANSITIONS[current.status];
      if (!allowedTransitions.includes(newStatus)) {
        throw new Error(
          `Invalid status transition: ${current.status} → ${newStatus}. ` +
            `Allowed transitions from '${current.status}': ${allowedTransitions.join(', ') || 'none'}`
        );
      }

      const updateData: Record<string, unknown> = {
        status: newStatus,
        updated_at: new Date().toISOString(),
      };

      // Add deactivation reason when pausing
      if (newStatus === 'inactive' && reason) {
        updateData.deactivation_reason = reason;
      }

      // Clear deactivation reason when reactivating
      if (newStatus === 'active') {
        updateData.deactivation_reason = null;
      }

      const { data, error } = await this.supabase
        .from('agents')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Activate an agent (draft → active, or inactive → active)
   */
  async activate(id: string, userId: string): Promise<AgentRepositoryResult<Agent>> {
    return this.updateStatus(id, userId, 'active');
  }

  /**
   * Pause/deactivate an agent (active → inactive)
   */
  async pause(id: string, userId: string, reason?: string): Promise<AgentRepositoryResult<Agent>> {
    return this.updateStatus(id, userId, 'inactive', reason);
  }

  /**
   * Get current status of an agent
   */
  async getStatus(id: string, userId: string): Promise<AgentRepositoryResult<AgentStatus>> {
    const { data, error } = await this.findById(id, userId);
    if (error) return { data: null, error };
    if (!data) return { data: null, error: new Error('Agent not found') };
    return { data: data.status, error: null };
  }

  // ============ Delete Operations ============

  /**
   * Soft delete - marks agent as deleted but keeps data for potential recovery
   */
  async softDelete(id: string, userId: string): Promise<AgentRepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('agents')
        .update({
          deleted_at: new Date().toISOString(),
          status: 'inactive',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', userId)
        .is('deleted_at', null);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      return { data: false, error: error as Error };
    }
  }

  /**
   * Hard delete - permanently removes agent from database
   * Use with caution - this cannot be undone
   */
  async hardDelete(id: string, userId: string): Promise<AgentRepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('agents')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      return { data: false, error: error as Error };
    }
  }

  /**
   * Restore a soft-deleted agent
   */
  async restore(id: string, userId: string): Promise<AgentRepositoryResult<Agent>> {
    try {
      const { data, error } = await this.supabase
        .from('agents')
        .update({
          deleted_at: null,
          status: 'draft', // Restore to draft status for safety
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Permanently delete all soft-deleted agents older than specified days
   * Useful for cleanup jobs
   */
  async purgeDeleted(userId: string, olderThanDays: number = 30): Promise<AgentRepositoryResult<number>> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const { data, error } = await this.supabase
        .from('agents')
        .delete()
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoffDate.toISOString())
        .select('id');

      if (error) throw error;
      return { data: data?.length || 0, error: null };
    } catch (error) {
      return { data: 0, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const agentRepository = new AgentRepository();