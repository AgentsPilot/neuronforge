/**
 * SLAEvaluator - Post-Execution SLA Evaluation Service
 *
 * Runs after each execution to:
 * 1. Calculate current metrics based on SLA scope
 * 2. Evaluate SLAs against calculated metrics
 * 3. Record violations/recoveries in sla_events
 * 4. Update current_value on SLA records
 *
 * @module lib/services/SLAEvaluator
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer'
import { createLogger } from '@/lib/logger'
import {
  SLARepository,
  AutomationSLA,
  SLAMetricName,
} from '@/lib/repositories/SLARepository'

const logger = createLogger({ service: 'SLAEvaluator' })

// ============================================================================
// Types
// ============================================================================

interface EvaluationResult {
  slaId: string
  slaName: string
  metricName: SLAMetricName
  targetValue: number
  currentValue: number
  isHealthy: boolean
  wasViolation: boolean
  wasRecovery: boolean
}

interface EvaluationSummary {
  agentId: string
  executionId: string
  evaluatedCount: number
  violationsCount: number
  recoveriesCount: number
  results: EvaluationResult[]
}

// ============================================================================
// SLAEvaluator
// ============================================================================

export class SLAEvaluator {
  private supabase: SupabaseClient
  private slaRepo: SLARepository

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase
    this.slaRepo = new SLARepository(this.supabase)
  }

  /**
   * Evaluate all applicable SLAs after an execution completes
   * Called from StateManager.completeExecution()
   */
  async evaluateAfterExecution(
    executionId: string,
    agentId: string,
    userId: string
  ): Promise<EvaluationSummary> {
    const evalLogger = logger.child({ executionId, agentId })

    try {
      // 1. Get all SLAs applicable to this agent
      const { data: slas, error: slaError } = await this.slaRepo.findByAgentId(
        agentId,
        userId
      )

      if (slaError || !slas || slas.length === 0) {
        evalLogger.debug('No active SLAs for this agent')
        return {
          agentId,
          executionId,
          evaluatedCount: 0,
          violationsCount: 0,
          recoveriesCount: 0,
          results: [],
        }
      }

      evalLogger.info({ slaCount: slas.length }, 'Evaluating SLAs')

      // 2. Calculate metrics for each SLA type
      const results: EvaluationResult[] = []
      let violationsCount = 0
      let recoveriesCount = 0

      for (const sla of slas) {
        const result = await this.evaluateSingleSLA(sla, agentId, userId)
        results.push(result)

        if (result.wasViolation) violationsCount++
        if (result.wasRecovery) recoveriesCount++
      }

      evalLogger.info(
        { evaluatedCount: slas.length, violationsCount, recoveriesCount },
        'SLA evaluation complete'
      )

      return {
        agentId,
        executionId,
        evaluatedCount: slas.length,
        violationsCount,
        recoveriesCount,
        results,
      }
    } catch (error) {
      evalLogger.error({ err: error }, 'SLA evaluation failed')
      // Return empty result - don't fail execution due to SLA evaluation errors
      return {
        agentId,
        executionId,
        evaluatedCount: 0,
        violationsCount: 0,
        recoveriesCount: 0,
        results: [],
      }
    }
  }

  /**
   * Evaluate a single SLA
   */
  private async evaluateSingleSLA(
    sla: AutomationSLA,
    agentId: string,
    userId: string
  ): Promise<EvaluationResult> {
    // Calculate current metric value based on scope
    const currentValue = await this.calculateMetric(sla, agentId, userId)

    // Evaluate against threshold
    const isHealthy = this.slaRepo.evaluateSLA(sla, currentValue)
    const wasViolated = sla.status === 'violated'

    let wasViolation = false
    let wasRecovery = false

    // Determine if this is a new violation or recovery
    if (!isHealthy && !wasViolated) {
      // New violation
      wasViolation = true
      await this.handleViolation(sla, currentValue, agentId)
    } else if (isHealthy && wasViolated) {
      // Recovery from violation
      wasRecovery = true
      await this.handleRecovery(sla, currentValue, agentId)
    }

    // Update current_value on SLA record
    await this.updateSLACurrentValue(sla.id, currentValue, isHealthy)

    return {
      slaId: sla.id,
      slaName: sla.name,
      metricName: sla.metric_name,
      targetValue: sla.target_value,
      currentValue,
      isHealthy,
      wasViolation,
      wasRecovery,
    }
  }

  /**
   * Calculate the current metric value based on SLA scope and metric type
   */
  private async calculateMetric(
    sla: AutomationSLA,
    agentId: string,
    userId: string
  ): Promise<number> {
    // Determine scope - agent_id, group_id, or all
    const scope = this.determineScope(sla, agentId)

    // Calculate based on metric type
    switch (sla.metric_name) {
      case 'success_rate':
        return this.calculateSuccessRate(scope, userId)
      case 'avg_duration_ms':
        return this.calculateAvgDuration(scope, userId)
      case 'items_processed':
        return this.calculateItemsProcessed(scope, userId)
      case 'time_saved_seconds':
        return this.calculateTimeSaved(scope, userId)
      case 'execution_count':
        return this.calculateExecutionCount(scope, userId)
      default:
        return 0
    }
  }

  /**
   * Determine the scope for metric calculation
   */
  private determineScope(
    sla: AutomationSLA,
    currentAgentId: string
  ): { type: 'agent' | 'group' | 'all'; id?: string } {
    if (sla.agent_id) {
      return { type: 'agent', id: sla.agent_id }
    }
    if (sla.group_id) {
      return { type: 'group', id: sla.group_id }
    }
    // For applies_to_all, still evaluate at agent level
    return { type: 'agent', id: currentAgentId }
  }

  /**
   * Calculate success rate (last 7 days)
   */
  private async calculateSuccessRate(
    scope: { type: 'agent' | 'group' | 'all'; id?: string },
    userId: string
  ): Promise<number> {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    let query = this.supabase
      .from('workflow_executions')
      .select('status, agents!inner(user_id)')
      .eq('agents.user_id', userId)
      .eq('run_mode', 'production')
      .gte('created_at', sevenDaysAgo.toISOString())

    if (scope.type === 'agent' && scope.id) {
      query = query.eq('agent_id', scope.id)
    } else if (scope.type === 'group' && scope.id) {
      // Get agents in group
      const { data: memberships } = await this.supabase
        .from('agent_group_memberships')
        .select('agent_id')
        .eq('group_id', scope.id)

      if (memberships && memberships.length > 0) {
        const agentIds = memberships.map((m) => m.agent_id)
        query = query.in('agent_id', agentIds)
      }
    }

    const { data: executions } = await query

    if (!executions || executions.length === 0) return 100 // No executions = 100% success

    const successCount = executions.filter(
      (e) => e.status === 'completed' || e.status === 'success'
    ).length

    return Math.round((successCount / executions.length) * 100)
  }

  /**
   * Calculate average duration (last 7 days)
   */
  private async calculateAvgDuration(
    scope: { type: 'agent' | 'group' | 'all'; id?: string },
    userId: string
  ): Promise<number> {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    let query = this.supabase
      .from('workflow_executions')
      .select('total_execution_time_ms, agents!inner(user_id)')
      .eq('agents.user_id', userId)
      .eq('run_mode', 'production')
      .eq('status', 'completed')
      .gte('created_at', sevenDaysAgo.toISOString())

    if (scope.type === 'agent' && scope.id) {
      query = query.eq('agent_id', scope.id)
    } else if (scope.type === 'group' && scope.id) {
      const { data: memberships } = await this.supabase
        .from('agent_group_memberships')
        .select('agent_id')
        .eq('group_id', scope.id)

      if (memberships && memberships.length > 0) {
        const agentIds = memberships.map((m) => m.agent_id)
        query = query.in('agent_id', agentIds)
      }
    }

    const { data: executions } = await query

    if (!executions || executions.length === 0) return 0

    const totalDuration = executions.reduce(
      (sum, e) => sum + (e.total_execution_time_ms || 0),
      0
    )

    return Math.round(totalDuration / executions.length)
  }

  /**
   * Calculate total items processed (last 7 days)
   */
  private async calculateItemsProcessed(
    scope: { type: 'agent' | 'group' | 'all'; id?: string },
    userId: string
  ): Promise<number> {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    let query = this.supabase
      .from('execution_metrics')
      .select('total_items, workflow_executions!inner(agent_id, agents!inner(user_id))')
      .eq('workflow_executions.agents.user_id', userId)
      .gte('created_at', sevenDaysAgo.toISOString())

    if (scope.type === 'agent' && scope.id) {
      query = query.eq('workflow_executions.agent_id', scope.id)
    } else if (scope.type === 'group' && scope.id) {
      const { data: memberships } = await this.supabase
        .from('agent_group_memberships')
        .select('agent_id')
        .eq('group_id', scope.id)

      if (memberships && memberships.length > 0) {
        const agentIds = memberships.map((m) => m.agent_id)
        query = query.in('workflow_executions.agent_id', agentIds)
      }
    }

    const { data: metrics } = await query

    if (!metrics || metrics.length === 0) return 0

    return metrics.reduce((sum, m) => sum + (m.total_items || 0), 0)
  }

  /**
   * Calculate total time saved (last 7 days)
   */
  private async calculateTimeSaved(
    scope: { type: 'agent' | 'group' | 'all'; id?: string },
    userId: string
  ): Promise<number> {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    let query = this.supabase
      .from('execution_metrics')
      .select('time_saved_seconds, workflow_executions!inner(agent_id, agents!inner(user_id))')
      .eq('workflow_executions.agents.user_id', userId)
      .gte('created_at', sevenDaysAgo.toISOString())

    if (scope.type === 'agent' && scope.id) {
      query = query.eq('workflow_executions.agent_id', scope.id)
    } else if (scope.type === 'group' && scope.id) {
      const { data: memberships } = await this.supabase
        .from('agent_group_memberships')
        .select('agent_id')
        .eq('group_id', scope.id)

      if (memberships && memberships.length > 0) {
        const agentIds = memberships.map((m) => m.agent_id)
        query = query.in('workflow_executions.agent_id', agentIds)
      }
    }

    const { data: metrics } = await query

    if (!metrics || metrics.length === 0) return 0

    return metrics.reduce((sum, m) => sum + (m.time_saved_seconds || 0), 0)
  }

  /**
   * Calculate execution count (last 7 days)
   */
  private async calculateExecutionCount(
    scope: { type: 'agent' | 'group' | 'all'; id?: string },
    userId: string
  ): Promise<number> {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    let query = this.supabase
      .from('workflow_executions')
      .select('id, agents!inner(user_id)', { count: 'exact', head: true })
      .eq('agents.user_id', userId)
      .eq('run_mode', 'production')
      .gte('created_at', sevenDaysAgo.toISOString())

    if (scope.type === 'agent' && scope.id) {
      query = query.eq('agent_id', scope.id)
    } else if (scope.type === 'group' && scope.id) {
      const { data: memberships } = await this.supabase
        .from('agent_group_memberships')
        .select('agent_id')
        .eq('group_id', scope.id)

      if (memberships && memberships.length > 0) {
        const agentIds = memberships.map((m) => m.agent_id)
        query = query.in('agent_id', agentIds)
      }
    }

    const { count } = await query

    return count || 0
  }

  /**
   * Handle a new violation
   */
  private async handleViolation(
    sla: AutomationSLA,
    currentValue: number,
    agentId: string
  ): Promise<void> {
    logger.warn(
      {
        slaId: sla.id,
        slaName: sla.name,
        targetValue: sla.target_value,
        currentValue,
        agentId,
      },
      'SLA violation detected'
    )

    // Record violation event
    await this.slaRepo.recordViolation(sla.id, currentValue, agentId)

    // TODO: Send alerts based on sla.alert_channels
    // This would integrate with NotificationService
  }

  /**
   * Handle a recovery from violation
   */
  private async handleRecovery(
    sla: AutomationSLA,
    currentValue: number,
    agentId: string
  ): Promise<void> {
    logger.info(
      {
        slaId: sla.id,
        slaName: sla.name,
        targetValue: sla.target_value,
        currentValue,
        agentId,
      },
      'SLA recovery detected'
    )

    // Record recovery event
    await this.slaRepo.recordRecovery(sla.id, currentValue, agentId)
  }

  /**
   * Update current_value and status on SLA record
   */
  private async updateSLACurrentValue(
    slaId: string,
    currentValue: number,
    isHealthy: boolean
  ): Promise<void> {
    const newStatus = isHealthy ? 'meeting' : 'violated'

    const { error } = await this.supabase
      .from('automation_slas')
      .update({
        current_value: currentValue,
        status: newStatus,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', slaId)

    if (error) {
      logger.error({ err: error, slaId }, 'Failed to update SLA current_value')
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let evaluatorInstance: SLAEvaluator | null = null

export function getSLAEvaluator(supabaseClient?: SupabaseClient): SLAEvaluator {
  if (!evaluatorInstance) {
    evaluatorInstance = new SLAEvaluator(supabaseClient)
  }
  return evaluatorInstance
}
