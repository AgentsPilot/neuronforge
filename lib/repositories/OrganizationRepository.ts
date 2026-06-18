/**
 * OrganizationRepository - Data access layer for organizations
 *
 * Handles CRUD operations for organizations and organization members.
 * Currently 1 organization = 1 user, but designed for future teams support.
 *
 * @module lib/repositories/OrganizationRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

export type OrganizationRole = 'owner' | 'admin' | 'analyst' | 'viewer';

export interface Organization {
  id: string;
  name: string;
  owner_user_id: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  org_id: string;
  user_id: string;
  role: OrganizationRole;
  created_at: string;
}

export interface CreateOrganizationInput {
  name: string;
  owner_user_id: string;
  settings?: Record<string, unknown>;
}

export interface UpdateOrganizationInput {
  name?: string;
  settings?: Record<string, unknown>;
}

export interface OrganizationRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ============================================================================
// Repository
// ============================================================================

export class OrganizationRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'OrganizationRepository' });
  }

  // ============================================================================
  // Organization CRUD
  // ============================================================================

  /**
   * Find organization by ID
   */
  async findById(id: string): Promise<OrganizationRepositoryResult<Organization>> {
    try {
      const { data, error } = await this.supabase
        .from('organizations')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId: id }, 'Failed to find organization by ID');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find organization by owner user ID
   * Since currently 1 user = 1 org, this is the primary lookup method.
   */
  async findByOwnerId(userId: string): Promise<OrganizationRepositoryResult<Organization>> {
    try {
      const { data, error } = await this.supabase
        .from('organizations')
        .select('*')
        .eq('owner_user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      return { data: data || null, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to find organization by owner');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find all organizations a user belongs to (as owner or member)
   */
  async findByUserId(userId: string): Promise<OrganizationRepositoryResult<Organization[]>> {
    try {
      // First get org IDs from memberships
      const { data: memberships, error: memberError } = await this.supabase
        .from('organization_members')
        .select('org_id')
        .eq('user_id', userId);

      if (memberError) throw memberError;

      if (!memberships || memberships.length === 0) {
        return { data: [], error: null };
      }

      const orgIds = memberships.map(m => m.org_id);

      // Then get organization details
      const { data: orgs, error: orgError } = await this.supabase
        .from('organizations')
        .select('*')
        .in('id', orgIds);

      if (orgError) throw orgError;
      return { data: orgs || [], error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to find organizations by user');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create a new organization
   */
  async create(input: CreateOrganizationInput): Promise<OrganizationRepositoryResult<Organization>> {
    try {
      const { data, error } = await this.supabase
        .from('organizations')
        .insert({
          name: input.name,
          owner_user_id: input.owner_user_id,
          settings: input.settings || {},
        })
        .select()
        .single();

      if (error) throw error;

      // Also add the owner as a member
      if (data) {
        await this.addMember(data.id, input.owner_user_id, 'owner');
      }

      this.logger.info({ orgId: data?.id, ownerId: input.owner_user_id }, 'Organization created');
      return { data, error: null };
    } catch (error) {
      this.logger.error({ err: error, input }, 'Failed to create organization');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update an organization
   */
  async update(
    id: string,
    userId: string,
    input: UpdateOrganizationInput
  ): Promise<OrganizationRepositoryResult<Organization>> {
    try {
      const { data, error } = await this.supabase
        .from('organizations')
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('owner_user_id', userId) // Only owner can update
        .select()
        .single();

      if (error) throw error;
      this.logger.info({ orgId: id }, 'Organization updated');
      return { data, error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId: id }, 'Failed to update organization');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get or create organization for a user
   * Uses the database function for atomicity.
   */
  async getOrCreateForUser(userId: string): Promise<OrganizationRepositoryResult<Organization>> {
    try {
      // Call the database function
      const { data: orgId, error: rpcError } = await this.supabase
        .rpc('get_or_create_user_organization', { p_user_id: userId });

      if (rpcError) throw rpcError;

      // Fetch the full organization record
      return this.findById(orgId);
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to get or create organization');
      return { data: null, error: error as Error };
    }
  }

  // ============================================================================
  // Member Management
  // ============================================================================

  /**
   * Add a member to an organization
   */
  async addMember(
    orgId: string,
    userId: string,
    role: OrganizationRole
  ): Promise<OrganizationRepositoryResult<OrganizationMember>> {
    try {
      const { data, error } = await this.supabase
        .from('organization_members')
        .insert({
          org_id: orgId,
          user_id: userId,
          role,
        })
        .select()
        .single();

      if (error) throw error;
      this.logger.info({ orgId, userId, role }, 'Member added to organization');
      return { data, error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId, userId }, 'Failed to add member');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get all members of an organization
   */
  async getMembers(orgId: string): Promise<OrganizationRepositoryResult<OrganizationMember[]>> {
    try {
      const { data, error } = await this.supabase
        .from('organization_members')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId }, 'Failed to get members');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get a user's role in an organization
   */
  async getUserRole(orgId: string, userId: string): Promise<OrganizationRepositoryResult<OrganizationRole | null>> {
    try {
      const { data, error } = await this.supabase
        .from('organization_members')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return { data: data?.role || null, error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId, userId }, 'Failed to get user role');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update a member's role
   */
  async updateMemberRole(
    orgId: string,
    userId: string,
    newRole: OrganizationRole,
    requesterId: string
  ): Promise<OrganizationRepositoryResult<OrganizationMember>> {
    try {
      // Verify requester is owner
      const { data: requesterRole } = await this.getUserRole(orgId, requesterId);
      if (requesterRole !== 'owner') {
        throw new Error('Only organization owner can update member roles');
      }

      // Prevent demoting the owner
      const org = await this.findById(orgId);
      if (org.data?.owner_user_id === userId && newRole !== 'owner') {
        throw new Error('Cannot change the role of the organization owner');
      }

      const { data, error } = await this.supabase
        .from('organization_members')
        .update({ role: newRole })
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      this.logger.info({ orgId, userId, newRole }, 'Member role updated');
      return { data, error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId, userId }, 'Failed to update member role');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Remove a member from an organization
   */
  async removeMember(
    orgId: string,
    userId: string,
    requesterId: string
  ): Promise<OrganizationRepositoryResult<boolean>> {
    try {
      // Verify requester is owner or removing themselves
      const { data: requesterRole } = await this.getUserRole(orgId, requesterId);
      if (requesterRole !== 'owner' && requesterId !== userId) {
        throw new Error('Only organization owner can remove members');
      }

      // Prevent removing the owner
      const org = await this.findById(orgId);
      if (org.data?.owner_user_id === userId) {
        throw new Error('Cannot remove the organization owner');
      }

      const { error } = await this.supabase
        .from('organization_members')
        .delete()
        .eq('org_id', orgId)
        .eq('user_id', userId);

      if (error) throw error;
      this.logger.info({ orgId, userId }, 'Member removed from organization');
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ err: error, orgId, userId }, 'Failed to remove member');
      return { data: null, error: error as Error };
    }
  }

  // ============================================================================
  // Analytics Helpers
  // ============================================================================

  /**
   * Get organization statistics
   */
  async getStats(orgId: string): Promise<OrganizationRepositoryResult<{
    member_count: number;
    agent_count: number;
    group_count: number;
  }>> {
    try {
      // Get member count
      const { count: memberCount } = await this.supabase
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId);

      // Get agent count
      const { count: agentCount } = await this.supabase
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .neq('status', 'deleted');

      // Get group count
      const { count: groupCount } = await this.supabase
        .from('workflow_groups')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId);

      return {
        data: {
          member_count: memberCount || 0,
          agent_count: agentCount || 0,
          group_count: groupCount || 0,
        },
        error: null,
      };
    } catch (error) {
      this.logger.error({ err: error, orgId }, 'Failed to get organization stats');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export for convenience
export const organizationRepository = new OrganizationRepository();
