/**
 * WorkflowGroupRepository - Data access layer for workflow groups
 *
 * Handles CRUD operations for user-defined workflow groupings.
 * Groups are completely domain-agnostic - users define their own structure.
 *
 * @module lib/repositories/WorkflowGroupRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

export interface WorkflowGroup {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  parent_group_id: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowGroupWithStats extends WorkflowGroup {
  agent_count: number;
  total_executions?: number;
  total_time_saved_seconds?: number;
}

export interface CreateWorkflowGroupInput {
  org_id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  parent_group_id?: string | null;
  display_order?: number;
}

export interface UpdateWorkflowGroupInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  parent_group_id?: string | null;
  display_order?: number;
}

export interface WorkflowGroupRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ============================================================================
// Repository
// ============================================================================

export class WorkflowGroupRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'WorkflowGroupRepository' });
  }

  // ============================================================================
  // Group CRUD
  // ============================================================================

  /**
   * Find group by ID
   */
  async findById(id: string): Promise<WorkflowGroupRepositoryResult<WorkflowGroup>> {
    try {
      const { data, error } = await this.supabase
        .from('workflow_groups')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      this.logger.error({ err: error, groupId: id }, 'Failed to find group by ID');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find all groups for an organization
   */
  async findByOrgId(orgId: string): Promise<WorkflowGroupRepositoryResult<WorkflowGroup[]>> {
    try {
      const { data, error } = await this.supabase
        .from('workflow_groups')
        .select('*')
        .eq('org_id', orgId)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId }, 'Failed to find groups by org');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find all groups for an organization with agent counts
   */
  async findByOrgIdWithStats(orgId: string): Promise<WorkflowGroupRepositoryResult<WorkflowGroupWithStats[]>> {
    try {
      // Get groups
      const { data: groups, error: groupError } = await this.supabase
        .from('workflow_groups')
        .select('*')
        .eq('org_id', orgId)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (groupError) throw groupError;
      if (!groups || groups.length === 0) {
        return { data: [], error: null };
      }

      // Get agent counts per group
      const groupIds = groups.map(g => g.id);
      const { data: memberships, error: memberError } = await this.supabase
        .from('agent_group_memberships')
        .select('group_id, agent_id')
        .in('group_id', groupIds);

      if (memberError) throw memberError;

      // Count agents per group
      const countMap = new Map<string, number>();
      if (memberships) {
        memberships.forEach(m => {
          const count = countMap.get(m.group_id) || 0;
          countMap.set(m.group_id, count + 1);
        });
      }

      // Combine groups with stats
      const groupsWithStats: WorkflowGroupWithStats[] = groups.map(group => ({
        ...group,
        agent_count: countMap.get(group.id) || 0,
      }));

      return { data: groupsWithStats, error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId }, 'Failed to find groups with stats');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find child groups of a parent group
   */
  async findChildren(parentGroupId: string): Promise<WorkflowGroupRepositoryResult<WorkflowGroup[]>> {
    try {
      const { data, error } = await this.supabase
        .from('workflow_groups')
        .select('*')
        .eq('parent_group_id', parentGroupId)
        .order('display_order', { ascending: true });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      this.logger.error({ err: error, parentGroupId }, 'Failed to find child groups');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find root groups (no parent) for an organization
   */
  async findRootGroups(orgId: string): Promise<WorkflowGroupRepositoryResult<WorkflowGroup[]>> {
    try {
      const { data, error } = await this.supabase
        .from('workflow_groups')
        .select('*')
        .eq('org_id', orgId)
        .is('parent_group_id', null)
        .order('display_order', { ascending: true });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId }, 'Failed to find root groups');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create a new group
   */
  async create(input: CreateWorkflowGroupInput): Promise<WorkflowGroupRepositoryResult<WorkflowGroup>> {
    try {
      const { data, error } = await this.supabase
        .from('workflow_groups')
        .insert({
          org_id: input.org_id,
          name: input.name,
          description: input.description || null,
          color: input.color || null,
          icon: input.icon || null,
          parent_group_id: input.parent_group_id || null,
          display_order: input.display_order || 0,
        })
        .select()
        .single();

      if (error) throw error;
      this.logger.info({ groupId: data?.id, orgId: input.org_id }, 'Workflow group created');
      return { data, error: null };
    } catch (error) {
      this.logger.error({ err: error, input }, 'Failed to create workflow group');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update a group
   */
  async update(
    id: string,
    orgId: string,
    input: UpdateWorkflowGroupInput
  ): Promise<WorkflowGroupRepositoryResult<WorkflowGroup>> {
    try {
      // Prevent circular parent references
      if (input.parent_group_id === id) {
        throw new Error('A group cannot be its own parent');
      }

      const { data, error } = await this.supabase
        .from('workflow_groups')
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single();

      if (error) throw error;
      this.logger.info({ groupId: id }, 'Workflow group updated');
      return { data, error: null };
    } catch (error) {
      this.logger.error({ err: error, groupId: id }, 'Failed to update workflow group');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete a group
   * Note: Agent memberships are automatically deleted via CASCADE
   */
  async delete(id: string, orgId: string): Promise<WorkflowGroupRepositoryResult<boolean>> {
    try {
      // First, update any child groups to have no parent
      await this.supabase
        .from('workflow_groups')
        .update({ parent_group_id: null })
        .eq('parent_group_id', id);

      // Then delete the group
      const { error } = await this.supabase
        .from('workflow_groups')
        .delete()
        .eq('id', id)
        .eq('org_id', orgId);

      if (error) throw error;
      this.logger.info({ groupId: id }, 'Workflow group deleted');
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ err: error, groupId: id }, 'Failed to delete workflow group');
      return { data: null, error: error as Error };
    }
  }

  // ============================================================================
  // Agent Group Membership
  // ============================================================================

  /**
   * Get all groups for an agent
   */
  async getAgentGroups(agentId: string): Promise<WorkflowGroupRepositoryResult<WorkflowGroup[]>> {
    try {
      const { data: memberships, error: memberError } = await this.supabase
        .from('agent_group_memberships')
        .select('group_id')
        .eq('agent_id', agentId);

      if (memberError) throw memberError;
      if (!memberships || memberships.length === 0) {
        return { data: [], error: null };
      }

      const groupIds = memberships.map(m => m.group_id);
      const { data: groups, error: groupError } = await this.supabase
        .from('workflow_groups')
        .select('*')
        .in('id', groupIds);

      if (groupError) throw groupError;
      return { data: groups || [], error: null };
    } catch (error) {
      this.logger.error({ err: error, agentId }, 'Failed to get agent groups');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get all agents in a group
   */
  async getGroupAgentIds(groupId: string): Promise<WorkflowGroupRepositoryResult<string[]>> {
    try {
      const { data, error } = await this.supabase
        .from('agent_group_memberships')
        .select('agent_id')
        .eq('group_id', groupId);

      if (error) throw error;
      return { data: data?.map(m => m.agent_id) || [], error: null };
    } catch (error) {
      this.logger.error({ err: error, groupId }, 'Failed to get group agent IDs');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get all memberships for an organization's groups
   */
  async getAllMemberships(orgId: string): Promise<WorkflowGroupRepositoryResult<Array<{ agent_id: string; group_id: string }>>> {
    try {
      // First get all group IDs for this org
      const { data: groups, error: groupError } = await this.supabase
        .from('workflow_groups')
        .select('id')
        .eq('org_id', orgId);

      if (groupError) throw groupError;
      if (!groups || groups.length === 0) {
        return { data: [], error: null };
      }

      const groupIds = groups.map(g => g.id);
      const { data, error } = await this.supabase
        .from('agent_group_memberships')
        .select('agent_id, group_id')
        .in('group_id', groupIds);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId }, 'Failed to get all memberships');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Add an agent to a group
   */
  async addAgentToGroup(agentId: string, groupId: string): Promise<WorkflowGroupRepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('agent_group_memberships')
        .upsert({ agent_id: agentId, group_id: groupId }, { onConflict: 'agent_id,group_id' });

      if (error) throw error;
      this.logger.info({ agentId, groupId }, 'Agent added to group');
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ err: error, agentId, groupId }, 'Failed to add agent to group');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Remove an agent from a group
   */
  async removeAgentFromGroup(agentId: string, groupId: string): Promise<WorkflowGroupRepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('agent_group_memberships')
        .delete()
        .eq('agent_id', agentId)
        .eq('group_id', groupId);

      if (error) throw error;
      this.logger.info({ agentId, groupId }, 'Agent removed from group');
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ err: error, agentId, groupId }, 'Failed to remove agent from group');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Set an agent's groups (replaces all existing memberships)
   */
  async setAgentGroups(agentId: string, groupIds: string[]): Promise<WorkflowGroupRepositoryResult<boolean>> {
    try {
      // Remove all existing memberships
      await this.supabase
        .from('agent_group_memberships')
        .delete()
        .eq('agent_id', agentId);

      // Add new memberships
      if (groupIds.length > 0) {
        const memberships = groupIds.map(groupId => ({
          agent_id: agentId,
          group_id: groupId,
        }));

        const { error } = await this.supabase
          .from('agent_group_memberships')
          .insert(memberships);

        if (error) throw error;
      }

      this.logger.info({ agentId, groupCount: groupIds.length }, 'Agent groups updated');
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ err: error, agentId }, 'Failed to set agent groups');
      return { data: null, error: error as Error };
    }
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * Reorder groups within an organization
   */
  async reorderGroups(
    orgId: string,
    groupOrders: Array<{ id: string; display_order: number }>
  ): Promise<WorkflowGroupRepositoryResult<boolean>> {
    try {
      // Update each group's display_order
      for (const { id, display_order } of groupOrders) {
        const { error } = await this.supabase
          .from('workflow_groups')
          .update({ display_order })
          .eq('id', id)
          .eq('org_id', orgId);

        if (error) throw error;
      }

      this.logger.info({ orgId, count: groupOrders.length }, 'Groups reordered');
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId }, 'Failed to reorder groups');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get group hierarchy as a tree structure
   */
  async getGroupTree(orgId: string): Promise<WorkflowGroupRepositoryResult<WorkflowGroupWithStats[]>> {
    try {
      const { data: groups, error } = await this.findByOrgIdWithStats(orgId);
      if (error || !groups) return { data: null, error };

      // Build tree structure (groups with children property)
      const groupMap = new Map<string, WorkflowGroupWithStats & { children?: WorkflowGroupWithStats[] }>();
      const rootGroups: (WorkflowGroupWithStats & { children?: WorkflowGroupWithStats[] })[] = [];

      // First pass: create map
      groups.forEach(group => {
        groupMap.set(group.id, { ...group, children: [] });
      });

      // Second pass: build tree
      groups.forEach(group => {
        const node = groupMap.get(group.id)!;
        if (group.parent_group_id && groupMap.has(group.parent_group_id)) {
          groupMap.get(group.parent_group_id)!.children!.push(node);
        } else {
          rootGroups.push(node);
        }
      });

      return { data: rootGroups, error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId }, 'Failed to get group tree');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export for convenience
export const workflowGroupRepository = new WorkflowGroupRepository();
