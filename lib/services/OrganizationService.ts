/**
 * OrganizationService - Business logic for organization management
 *
 * Provides higher-level operations for organizations including:
 * - Auto-creation of organizations for new users
 * - Organization analytics and statistics
 * - Integration with other services
 *
 * @module lib/services/OrganizationService
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import {
  OrganizationRepository,
  Organization,
  OrganizationMember,
  OrganizationRole,
} from '@/lib/repositories/OrganizationRepository';
import {
  WorkflowGroupRepository,
  WorkflowGroupWithStats,
} from '@/lib/repositories/WorkflowGroupRepository';

const logger = createLogger({ service: 'OrganizationService' });

// ============================================================================
// Types
// ============================================================================

export interface OrganizationWithStats extends Organization {
  member_count: number;
  agent_count: number;
  group_count: number;
}

export interface OrganizationAnalytics {
  organization: Organization;
  stats: {
    member_count: number;
    agent_count: number;
    group_count: number;
    total_executions_30d: number;
    total_time_saved_seconds_30d: number;
    success_rate_30d: number;
  };
  groups: WorkflowGroupWithStats[];
  top_agents: Array<{
    id: string;
    name: string;
    execution_count: number;
    success_rate: number;
    time_saved_seconds: number;
  }>;
}

// ============================================================================
// Service
// ============================================================================

export class OrganizationService {
  private orgRepo: OrganizationRepository;
  private groupRepo: WorkflowGroupRepository;
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.orgRepo = new OrganizationRepository(this.supabase);
    this.groupRepo = new WorkflowGroupRepository(this.supabase);
  }

  // ============================================================================
  // Organization Management
  // ============================================================================

  /**
   * Get or create an organization for a user.
   * This is the primary entry point for ensuring a user has an organization.
   */
  async ensureUserOrganization(userId: string): Promise<Organization | null> {
    try {
      // First try to get existing organization
      const existing = await this.getCurrentOrganization(userId);
      if (existing) {
        return existing;
      }

      // Try to use RPC function first (if it exists)
      try {
        const result = await this.orgRepo.getOrCreateForUser(userId);
        if (result.data) {
          return result.data;
        }
      } catch {
        logger.debug({ userId }, 'RPC not available, using fallback');
      }

      // Fallback: Create organization directly
      logger.info({ userId }, 'Creating organization for user (fallback)');

      // Use user ID as default org name (simple approach)
      const orgName = `Organization ${userId.slice(0, 8)}`;

      const createResult = await this.orgRepo.create({
        name: orgName,
        owner_user_id: userId,
        settings: {},
      });

      if (createResult.error) {
        logger.error({ err: createResult.error, userId }, 'Failed to create organization');
        return null;
      }

      return createResult.data;
    } catch (error) {
      logger.error({ err: error, userId }, 'Error ensuring user organization');
      return null;
    }
  }

  /**
   * Get the current user's organization
   */
  async getCurrentOrganization(userId: string): Promise<Organization | null> {
    const result = await this.orgRepo.findByOwnerId(userId);
    if (result.error) {
      logger.error({ err: result.error, userId }, 'Failed to get current organization');
      return null;
    }
    return result.data;
  }

  /**
   * Get organization with statistics
   */
  async getOrganizationWithStats(userId: string): Promise<OrganizationWithStats | null> {
    try {
      // Get organization
      const org = await this.getCurrentOrganization(userId);
      if (!org) return null;

      // Get stats
      const statsResult = await this.orgRepo.getStats(org.id);
      if (statsResult.error || !statsResult.data) {
        return { ...org, member_count: 1, agent_count: 0, group_count: 0 };
      }

      return {
        ...org,
        ...statsResult.data,
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get organization with stats');
      return null;
    }
  }

  /**
   * Update organization settings
   */
  async updateOrganization(
    userId: string,
    updates: { name?: string; settings?: Record<string, unknown> }
  ): Promise<Organization | null> {
    try {
      const org = await this.getCurrentOrganization(userId);
      if (!org) {
        logger.warn({ userId }, 'No organization found for user');
        return null;
      }

      const result = await this.orgRepo.update(org.id, userId, updates);
      if (result.error) {
        logger.error({ err: result.error, orgId: org.id }, 'Failed to update organization');
        return null;
      }

      return result.data;
    } catch (error) {
      logger.error({ err: error, userId }, 'Error updating organization');
      return null;
    }
  }

  // ============================================================================
  // Analytics
  // ============================================================================

  /**
   * Get comprehensive organization analytics
   */
  async getOrganizationAnalytics(userId: string): Promise<OrganizationAnalytics | null> {
    try {
      const org = await this.getCurrentOrganization(userId);
      if (!org) return null;

      // Get stats
      const statsResult = await this.orgRepo.getStats(org.id);

      // Get groups with stats
      const groupsResult = await this.groupRepo.findByOrgIdWithStats(org.id);

      // Get execution metrics for last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: executionMetrics } = await this.supabase
        .from('execution_metrics')
        .select('agent_id, total_items, time_saved_seconds, executed_at, failed_step_count')
        .gte('executed_at', thirtyDaysAgo.toISOString())
        .in('agent_id', await this.getOrgAgentIds(org.id));

      // Calculate 30-day stats
      let totalExecutions30d = executionMetrics?.length || 0;
      let totalTimeSaved30d = 0;
      let successfulExecutions30d = 0;

      if (executionMetrics) {
        executionMetrics.forEach(metric => {
          totalTimeSaved30d += metric.time_saved_seconds || 0;
          if ((metric.failed_step_count || 0) === 0) {
            successfulExecutions30d++;
          }
        });
      }

      const successRate30d = totalExecutions30d > 0
        ? (successfulExecutions30d / totalExecutions30d)
        : 1.0;

      // Get top agents
      const topAgents = await this.getTopAgents(org.id, 5);

      return {
        organization: org,
        stats: {
          member_count: statsResult.data?.member_count || 1,
          agent_count: statsResult.data?.agent_count || 0,
          group_count: statsResult.data?.group_count || 0,
          total_executions_30d: totalExecutions30d,
          total_time_saved_seconds_30d: totalTimeSaved30d,
          success_rate_30d: successRate30d,
        },
        groups: groupsResult.data || [],
        top_agents: topAgents,
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get organization analytics');
      return null;
    }
  }

  /**
   * Get agent IDs for an organization
   */
  private async getOrgAgentIds(orgId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('agents')
      .select('id')
      .eq('org_id', orgId)
      .neq('status', 'deleted');

    return data?.map(a => a.id) || [];
  }

  /**
   * Get top performing agents for an organization
   */
  private async getTopAgents(orgId: string, limit: number): Promise<Array<{
    id: string;
    name: string;
    execution_count: number;
    success_rate: number;
    time_saved_seconds: number;
  }>> {
    try {
      // Get agents with their execution stats
      const { data: agents } = await this.supabase
        .from('agents')
        .select(`
          id,
          agent_name,
          execution_metrics!inner (
            total_items,
            time_saved_seconds,
            failed_step_count
          )
        `)
        .eq('org_id', orgId)
        .neq('status', 'deleted')
        .limit(100);

      if (!agents || agents.length === 0) return [];

      // Aggregate stats per agent
      const agentStats = new Map<string, {
        name: string;
        execution_count: number;
        successful_count: number;
        time_saved_seconds: number;
      }>();

      agents.forEach((agent: any) => {
        const metrics = agent.execution_metrics || [];
        const existing = agentStats.get(agent.id) || {
          name: agent.agent_name,
          execution_count: 0,
          successful_count: 0,
          time_saved_seconds: 0,
        };

        metrics.forEach((metric: any) => {
          existing.execution_count++;
          existing.time_saved_seconds += metric.time_saved_seconds || 0;
          if ((metric.failed_step_count || 0) === 0) {
            existing.successful_count++;
          }
        });

        agentStats.set(agent.id, existing);
      });

      // Convert to array and sort by time saved
      const result = Array.from(agentStats.entries())
        .map(([id, stats]) => ({
          id,
          name: stats.name,
          execution_count: stats.execution_count,
          success_rate: stats.execution_count > 0
            ? stats.successful_count / stats.execution_count
            : 1.0,
          time_saved_seconds: stats.time_saved_seconds,
        }))
        .sort((a, b) => b.time_saved_seconds - a.time_saved_seconds)
        .slice(0, limit);

      return result;
    } catch (error) {
      logger.error({ err: error, orgId }, 'Failed to get top agents');
      return [];
    }
  }

  // ============================================================================
  // Group Management (Delegated to GroupRepository)
  // ============================================================================

  /**
   * Get all workflow groups for the user's organization
   */
  async getWorkflowGroups(userId: string): Promise<WorkflowGroupWithStats[]> {
    const org = await this.getCurrentOrganization(userId);
    if (!org) return [];

    const result = await this.groupRepo.findByOrgIdWithStats(org.id);
    return result.data || [];
  }

  /**
   * Get workflow group tree structure
   */
  async getWorkflowGroupTree(userId: string): Promise<WorkflowGroupWithStats[]> {
    const org = await this.getCurrentOrganization(userId);
    if (!org) return [];

    const result = await this.groupRepo.getGroupTree(org.id);
    return result.data || [];
  }

  // ============================================================================
  // Member Management (For Future Teams Support)
  // ============================================================================

  /**
   * Get organization members
   */
  async getMembers(userId: string): Promise<OrganizationMember[]> {
    const org = await this.getCurrentOrganization(userId);
    if (!org) return [];

    const result = await this.orgRepo.getMembers(org.id);
    return result.data || [];
  }

  /**
   * Check if user has a specific role or higher
   */
  async hasRole(userId: string, requiredRole: OrganizationRole): Promise<boolean> {
    const org = await this.getCurrentOrganization(userId);
    if (!org) return false;

    const roleResult = await this.orgRepo.getUserRole(org.id, userId);
    if (!roleResult.data) return false;

    const roleHierarchy: OrganizationRole[] = ['viewer', 'analyst', 'admin', 'owner'];
    const userRoleIndex = roleHierarchy.indexOf(roleResult.data);
    const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);

    return userRoleIndex >= requiredRoleIndex;
  }
}

// Singleton export for convenience
export const organizationService = new OrganizationService();
