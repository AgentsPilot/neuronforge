/**
 * SLARepository - Service Level Agreement Management
 *
 * Allows users to define performance targets for their workflows
 * and tracks when those targets are breached.
 *
 * @module lib/repositories/SLARepository
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer'
import { createLogger, Logger } from '@/lib/logger'

const logger = createLogger({ service: 'SLARepository' })

// ============================================================================
// Types
// ============================================================================

export type SLAMetricName =
  | 'success_rate'
  | 'avg_duration_ms'
  | 'items_processed'
  | 'time_saved_seconds'
  | 'execution_count'

export type ThresholdType = 'above' | 'below' | 'between'

export interface AutomationSLA {
  id: string
  user_id: string
  org_id?: string | null
  name: string
  description?: string | null
  agent_id?: string | null         // Specific workflow
  group_id?: string | null         // All workflows in a group
  applies_to_all: boolean          // Or all workflows
  metric_name: SLAMetricName
  target_value: number
  threshold_type: ThresholdType
  threshold_max?: number | null    // For 'between' type
  alert_channels?: AlertChannel[]
  escalation_after_minutes?: number
  status: 'active' | 'paused' | 'violated' | 'meeting'
  current_value?: number | null
  last_checked_at?: string | null
  created_at: string
  updated_at: string
}

export interface AlertChannel {
  type: 'email' | 'webhook' | 'slack'
  value: string
}

export interface SLAEvent {
  id: string
  sla_id: string
  event_type: 'violation' | 'recovery' | 'acknowledged'
  event_time: string
  actual_value: number
  agent_id?: string
  resolved_at?: string | null
  resolution_notes?: string | null
  acknowledged_by?: string | null
}

export interface CreateSLAInput {
  user_id: string
  org_id?: string
  name: string
  description?: string
  agent_id?: string
  group_id?: string
  applies_to_all?: boolean
  metric_name: SLAMetricName
  target_value: number
  threshold_type: ThresholdType
  threshold_max?: number
  alert_channels?: AlertChannel[]
  escalation_after_minutes?: number
}

export interface UpdateSLAInput {
  name?: string
  description?: string
  target_value?: number
  threshold_type?: ThresholdType
  threshold_max?: number
  alert_channels?: AlertChannel[]
  escalation_after_minutes?: number
  status?: 'active' | 'paused' | 'violated' | 'meeting'
}

export interface SLARepositoryResult<T> {
  data: T | null
  error: Error | null
}

export interface SLAStatus {
  sla: AutomationSLA
  current_value: number
  is_healthy: boolean
  last_violation?: SLAEvent
  violations_24h: number
}

// ============================================================================
// Repository
// ============================================================================

export class SLARepository {
  private supabase: SupabaseClient
  private logger: Logger

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase
    this.logger = createLogger({ service: 'SLARepository' })
  }

  // ============================================================================
  // SLA CRUD
  // ============================================================================

  /**
   * Create a new SLA
   */
  async create(input: CreateSLAInput): Promise<SLARepositoryResult<AutomationSLA>> {
    try {
      const { data, error } = await this.supabase
        .from('automation_slas')
        .insert({
          user_id: input.user_id,
          org_id: input.org_id || null,
          name: input.name,
          description: input.description || null,
          agent_id: input.agent_id || null,
          group_id: input.group_id || null,
          applies_to_all: input.applies_to_all || false,
          metric_name: input.metric_name,
          target_value: input.target_value,
          threshold_type: input.threshold_type,
          threshold_max: input.threshold_max || null,
          alert_channels: input.alert_channels || [],
          escalation_after_minutes: input.escalation_after_minutes || null,
          status: 'active',
        })
        .select()
        .single()

      if (error) throw error

      this.logger.info({ slaId: data?.id, name: input.name }, 'SLA created')
      return { data, error: null }
    } catch (error) {
      this.logger.error({ err: error, input }, 'Failed to create SLA')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Find SLA by ID
   */
  async findById(id: string): Promise<SLARepositoryResult<AutomationSLA>> {
    try {
      const { data, error } = await this.supabase
        .from('automation_slas')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      this.logger.error({ err: error, slaId: id }, 'Failed to find SLA')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Find all SLAs for a user
   */
  async findByUserId(userId: string): Promise<SLARepositoryResult<AutomationSLA[]>> {
    try {
      const { data, error } = await this.supabase
        .from('automation_slas')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return { data: data || [], error: null }
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to find SLAs by user')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Find SLAs applicable to a specific agent
   */
  async findByAgentId(agentId: string, userId: string): Promise<SLARepositoryResult<AutomationSLA[]>> {
    try {
      // Get SLAs that apply to this agent directly, via group, or apply to all
      const { data: agent } = await this.supabase
        .from('agents')
        .select('org_id')
        .eq('id', agentId)
        .single()

      // Get group memberships
      const { data: memberships } = await this.supabase
        .from('agent_group_memberships')
        .select('group_id')
        .eq('agent_id', agentId)

      const groupIds = memberships?.map(m => m.group_id) || []

      // Build query for applicable SLAs (exclude paused)
      let query = this.supabase
        .from('automation_slas')
        .select('*')
        .eq('user_id', userId)
        .neq('status', 'paused')

      // SLAs that apply to this agent OR its groups OR all
      const { data, error } = await query.or(
        `agent_id.eq.${agentId},applies_to_all.eq.true${
          groupIds.length > 0 ? `,group_id.in.(${groupIds.join(',')})` : ''
        }`
      )

      if (error) throw error
      return { data: data || [], error: null }
    } catch (error) {
      this.logger.error({ err: error, agentId }, 'Failed to find SLAs by agent')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Update an SLA
   */
  async update(
    id: string,
    userId: string,
    input: UpdateSLAInput
  ): Promise<SLARepositoryResult<AutomationSLA>> {
    try {
      const { data, error } = await this.supabase
        .from('automation_slas')
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single()

      if (error) throw error

      this.logger.info({ slaId: id }, 'SLA updated')
      return { data, error: null }
    } catch (error) {
      this.logger.error({ err: error, slaId: id }, 'Failed to update SLA')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Delete an SLA
   */
  async delete(id: string, userId: string): Promise<SLARepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('automation_slas')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)

      if (error) throw error

      this.logger.info({ slaId: id }, 'SLA deleted')
      return { data: true, error: null }
    } catch (error) {
      this.logger.error({ err: error, slaId: id }, 'Failed to delete SLA')
      return { data: null, error: error as Error }
    }
  }

  // ============================================================================
  // SLA Events
  // ============================================================================

  /**
   * Record an SLA violation
   */
  async recordViolation(
    slaId: string,
    actualValue: number,
    agentId?: string
  ): Promise<SLARepositoryResult<SLAEvent>> {
    try {
      const { data, error } = await this.supabase
        .from('sla_events')
        .insert({
          sla_id: slaId,
          event_type: 'violation',
          event_time: new Date().toISOString(),
          actual_value: actualValue,
          agent_id: agentId || null,
        })
        .select()
        .single()

      if (error) throw error

      this.logger.warn({ slaId, actualValue, agentId }, 'SLA violation recorded')
      return { data, error: null }
    } catch (error) {
      this.logger.error({ err: error, slaId }, 'Failed to record violation')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Record an SLA recovery
   */
  async recordRecovery(
    slaId: string,
    actualValue: number,
    agentId?: string
  ): Promise<SLARepositoryResult<SLAEvent>> {
    try {
      // Mark previous violation as resolved
      await this.supabase
        .from('sla_events')
        .update({ resolved_at: new Date().toISOString() })
        .eq('sla_id', slaId)
        .eq('event_type', 'violation')
        .is('resolved_at', null)

      // Record recovery event
      const { data, error } = await this.supabase
        .from('sla_events')
        .insert({
          sla_id: slaId,
          event_type: 'recovery',
          event_time: new Date().toISOString(),
          actual_value: actualValue,
          agent_id: agentId || null,
        })
        .select()
        .single()

      if (error) throw error

      this.logger.info({ slaId, actualValue }, 'SLA recovery recorded')
      return { data, error: null }
    } catch (error) {
      this.logger.error({ err: error, slaId }, 'Failed to record recovery')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Acknowledge an SLA violation
   */
  async acknowledgeViolation(
    eventId: string,
    userId: string,
    notes?: string
  ): Promise<SLARepositoryResult<SLAEvent>> {
    try {
      const { data, error } = await this.supabase
        .from('sla_events')
        .update({
          acknowledged_by: userId,
          resolution_notes: notes || null,
        })
        .eq('id', eventId)
        .select()
        .single()

      if (error) throw error

      this.logger.info({ eventId, userId }, 'SLA violation acknowledged')
      return { data, error: null }
    } catch (error) {
      this.logger.error({ err: error, eventId }, 'Failed to acknowledge violation')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Get recent events for an SLA
   */
  async getEvents(
    slaId: string,
    options?: { limit?: number; eventType?: string }
  ): Promise<SLARepositoryResult<SLAEvent[]>> {
    try {
      let query = this.supabase
        .from('sla_events')
        .select('*')
        .eq('sla_id', slaId)
        .order('event_time', { ascending: false })

      if (options?.eventType) {
        query = query.eq('event_type', options.eventType)
      }

      if (options?.limit) {
        query = query.limit(options.limit)
      }

      const { data, error } = await query

      if (error) throw error
      return { data: data || [], error: null }
    } catch (error) {
      this.logger.error({ err: error, slaId }, 'Failed to get SLA events')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Get open violations (not resolved or acknowledged)
   */
  async getOpenViolations(userId: string): Promise<SLARepositoryResult<SLAEvent[]>> {
    try {
      const { data: slas } = await this.findByUserId(userId)
      if (!slas || slas.length === 0) {
        return { data: [], error: null }
      }

      const slaIds = slas.map(s => s.id)

      const { data, error } = await this.supabase
        .from('sla_events')
        .select('*')
        .in('sla_id', slaIds)
        .eq('event_type', 'violation')
        .is('resolved_at', null)
        .is('acknowledged_by', null)
        .order('event_time', { ascending: false })

      if (error) throw error
      return { data: data || [], error: null }
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to get open violations')
      return { data: null, error: error as Error }
    }
  }

  // ============================================================================
  // SLA Evaluation
  // ============================================================================

  /**
   * Check if a value meets the SLA target
   */
  evaluateSLA(sla: AutomationSLA, actualValue: number): boolean {
    switch (sla.threshold_type) {
      case 'above':
        return actualValue >= sla.target_value
      case 'below':
        return actualValue <= sla.target_value
      case 'between':
        return actualValue >= sla.target_value &&
               actualValue <= (sla.threshold_max || Infinity)
      default:
        return true
    }
  }

  /**
   * Get SLA status with current metrics
   */
  async getSLAStatus(sla: AutomationSLA): Promise<SLARepositoryResult<SLAStatus>> {
    try {
      // Get current metric value based on SLA scope
      let currentValue = 0

      // This would need to be implemented based on the specific metric
      // For now, return a placeholder
      const twentyFourHoursAgo = new Date()
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)

      const { data: violations } = await this.supabase
        .from('sla_events')
        .select('*')
        .eq('sla_id', sla.id)
        .eq('event_type', 'violation')
        .gte('event_time', twentyFourHoursAgo.toISOString())

      const { data: lastViolation } = await this.supabase
        .from('sla_events')
        .select('*')
        .eq('sla_id', sla.id)
        .eq('event_type', 'violation')
        .order('event_time', { ascending: false })
        .limit(1)
        .single()

      return {
        data: {
          sla,
          current_value: currentValue,
          is_healthy: this.evaluateSLA(sla, currentValue),
          last_violation: lastViolation || undefined,
          violations_24h: violations?.length || 0,
        },
        error: null,
      }
    } catch (error) {
      this.logger.error({ err: error, slaId: sla.id }, 'Failed to get SLA status')
      return { data: null, error: error as Error }
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let repositoryInstance: SLARepository | null = null

export function getSLARepository(supabaseClient?: SupabaseClient): SLARepository {
  if (!repositoryInstance) {
    repositoryInstance = new SLARepository(supabaseClient)
  }
  return repositoryInstance
}

export const slaRepository = new SLARepository()
