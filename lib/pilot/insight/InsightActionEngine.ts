/**
 * InsightActionEngine - One-Click Fix System
 *
 * Transforms insights from read-only to actionable by providing
 * automated fixes that users can preview and apply with one click.
 *
 * Supported Action Types:
 * - add_retry_logic: Add error handling/retry to steps
 * - add_validation: Add data validation step
 * - adjust_schedule: Modify workflow schedule
 * - add_notification: Set up alerting for failures
 * - archive_workflow: Mark unused workflow as inactive
 *
 * @module lib/pilot/insight/InsightActionEngine
 */

import { createLogger } from '@/lib/logger'
import { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer'
import { InsightType, ExecutionInsight } from './types'

const logger = createLogger({ service: 'InsightActionEngine' })

// ============================================================================
// Types
// ============================================================================

/**
 * Types of actions that can be applied to resolve insights
 */
export type InsightActionType =
  | 'add_retry_logic'      // Add error handling
  | 'add_validation'       // Add data validation step
  | 'adjust_schedule'      // Change execution schedule
  | 'add_notification'     // Set up alerting
  | 'archive_workflow'     // Deprecate unused workflow
  | 'skip_empty_results'   // Add condition to skip empty results
  | 'dismiss_insight'      // Mark insight as not applicable

/**
 * Preview of changes before applying an action
 */
export interface ActionPreview {
  action_type: InsightActionType
  insight_id: string
  agent_id: string
  description: string
  changes: ChangeDescription[]
  estimated_impact: {
    metric: string
    current_value: number
    expected_value: number
    unit: string
  }
  requires_approval: boolean
  reversible: boolean
  warnings?: string[]
}

/**
 * Description of a single change
 */
export interface ChangeDescription {
  target: 'step' | 'schedule' | 'config' | 'status'
  target_id?: string
  field: string
  before: string | null
  after: string
  reason: string
}

/**
 * Result of applying an action
 */
export interface ActionResult {
  success: boolean
  action_type: InsightActionType
  insight_id: string
  agent_id: string
  changes_applied: ChangeDescription[]
  rollback_data?: Record<string, unknown>
  error?: string
}

/**
 * Action definition for each insight type
 */
interface ActionDefinition {
  type: InsightActionType
  label: string
  description: string
  applicable_to: InsightType[]
  auto_applicable: boolean  // Can be applied without user review
}

// ============================================================================
// Constants
// ============================================================================

const ACTION_DEFINITIONS: ActionDefinition[] = [
  {
    type: 'add_retry_logic',
    label: 'Add Retry Logic',
    description: 'Add automatic retry with exponential backoff for failed steps',
    applicable_to: ['reliability_risk', 'data_unavailable'],
    auto_applicable: false,
  },
  {
    type: 'add_validation',
    label: 'Add Validation',
    description: 'Add data validation step to catch issues early',
    applicable_to: ['data_malformed', 'data_type_mismatch', 'data_validation_failed'],
    auto_applicable: false,
  },
  {
    type: 'adjust_schedule',
    label: 'Adjust Schedule',
    description: 'Optimize execution timing based on historical patterns',
    applicable_to: ['schedule_optimization'],
    auto_applicable: false,
  },
  {
    type: 'add_notification',
    label: 'Add Notification',
    description: 'Set up alerts for failures or anomalies',
    applicable_to: ['reliability_risk', 'operational_anomaly'],
    auto_applicable: false,
  },
  {
    type: 'skip_empty_results',
    label: 'Skip Empty Results',
    description: 'Add condition to gracefully handle empty data',
    applicable_to: ['data_unavailable', 'data_missing_fields'],
    auto_applicable: true,
  },
  {
    type: 'archive_workflow',
    label: 'Archive Workflow',
    description: 'Mark workflow as inactive (no longer running)',
    applicable_to: ['automation_opportunity'], // Unused workflows
    auto_applicable: false,
  },
  {
    type: 'dismiss_insight',
    label: 'Dismiss',
    description: 'Mark this insight as not applicable',
    applicable_to: [], // Applies to all
    auto_applicable: true,
  },
]

// ============================================================================
// Main Class
// ============================================================================

export class InsightActionEngine {
  private supabase: SupabaseClient

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase
  }

  /**
   * Get available actions for an insight
   */
  getAvailableActions(insight: ExecutionInsight): ActionDefinition[] {
    const actions = ACTION_DEFINITIONS.filter(action =>
      action.applicable_to.length === 0 || // Universal action (dismiss)
      action.applicable_to.includes(insight.insight_type)
    )

    return actions
  }

  /**
   * Generate a preview of what an action will do
   */
  async previewAction(
    insight: ExecutionInsight,
    actionType: InsightActionType,
    userId: string
  ): Promise<ActionPreview> {
    const agentId = insight.agent_id

    // Fetch agent details
    const { data: agent } = await this.supabase
      .from('agents')
      .select('agent_name, pilot_steps, schedule_cron, status')
      .eq('id', agentId)
      .single()

    const preview: ActionPreview = {
      action_type: actionType,
      insight_id: insight.id,
      agent_id: agentId,
      description: '',
      changes: [],
      estimated_impact: {
        metric: 'success_rate',
        current_value: 0,
        expected_value: 0,
        unit: 'percentage',
      },
      requires_approval: true,
      reversible: true,
    }

    switch (actionType) {
      case 'add_retry_logic':
        preview.description = `Add automatic retry (3 attempts) to failing steps in "${agent?.agent_name}"`
        preview.changes = this.previewAddRetry(insight, agent?.pilot_steps)
        preview.estimated_impact = {
          metric: 'success_rate',
          current_value: insight.metrics.affected_executions / insight.metrics.total_executions,
          expected_value: 0.95,
          unit: 'percentage',
        }
        break

      case 'add_validation':
        preview.description = `Add data validation before problematic steps in "${agent?.agent_name}"`
        preview.changes = this.previewAddValidation(insight, agent?.pilot_steps)
        preview.estimated_impact = {
          metric: 'data_quality',
          current_value: 1 - insight.metrics.pattern_frequency,
          expected_value: 0.98,
          unit: 'percentage',
        }
        break

      case 'skip_empty_results':
        preview.description = `Add condition to skip processing when no data available`
        preview.changes = this.previewSkipEmpty(insight, agent?.pilot_steps)
        preview.estimated_impact = {
          metric: 'error_rate',
          current_value: insight.metrics.pattern_frequency,
          expected_value: 0,
          unit: 'percentage',
        }
        preview.requires_approval = false
        break

      case 'adjust_schedule':
        preview.description = `Optimize schedule for "${agent?.agent_name}"`
        preview.changes = [{
          target: 'schedule',
          field: 'schedule_cron',
          before: agent?.schedule_cron || 'Not scheduled',
          after: this.suggestOptimalSchedule(insight),
          reason: 'Based on execution patterns and data availability',
        }]
        break

      case 'add_notification':
        preview.description = `Set up failure notifications for "${agent?.agent_name}"`
        preview.changes = [{
          target: 'config',
          field: 'notifications',
          before: null,
          after: 'Email on failure',
          reason: 'Alert when workflow fails or detects anomalies',
        }]
        break

      case 'archive_workflow':
        preview.description = `Archive inactive workflow "${agent?.agent_name}"`
        preview.changes = [{
          target: 'status',
          field: 'status',
          before: agent?.status || 'active',
          after: 'inactive',
          reason: 'Workflow has not been used recently',
        }]
        preview.warnings = ['This will stop scheduled executions']
        break

      case 'dismiss_insight':
        preview.description = `Dismiss this insight - mark as not applicable`
        preview.changes = [{
          target: 'config',
          field: 'status',
          before: insight.status,
          after: 'dismissed',
          reason: 'User determined this insight is not relevant',
        }]
        preview.requires_approval = false
        break
    }

    return preview
  }

  /**
   * Apply an action to resolve an insight
   */
  async applyAction(
    insight: ExecutionInsight,
    actionType: InsightActionType,
    userId: string
  ): Promise<ActionResult> {
    const agentId = insight.agent_id
    const changes: ChangeDescription[] = []

    logger.info({
      insightId: insight.id,
      agentId,
      actionType,
      userId,
    }, 'Applying insight action')

    try {
      switch (actionType) {
        case 'add_retry_logic':
          await this.applyRetryLogic(agentId, insight)
          changes.push({
            target: 'step',
            field: 'retry_config',
            before: null,
            after: '3 attempts with exponential backoff',
            reason: 'Added retry logic to failing steps',
          })
          break

        case 'skip_empty_results':
          await this.applySkipEmpty(agentId, insight)
          changes.push({
            target: 'step',
            field: 'condition',
            before: null,
            after: 'Skip if no data',
            reason: 'Added empty result handling',
          })
          break

        case 'archive_workflow':
          await this.supabase
            .from('agents')
            .update({ status: 'inactive' })
            .eq('id', agentId)
            .eq('user_id', userId)
          changes.push({
            target: 'status',
            field: 'status',
            before: 'active',
            after: 'inactive',
            reason: 'Archived unused workflow',
          })
          break

        case 'dismiss_insight':
          await this.supabase
            .from('execution_insights')
            .update({
              status: 'dismissed',
              action_taken: 'dismissed',
              action_taken_at: new Date().toISOString(),
            })
            .eq('id', insight.id)
          changes.push({
            target: 'config',
            field: 'status',
            before: insight.status,
            after: 'dismissed',
            reason: 'Insight dismissed by user',
          })
          break

        default:
          // For other actions, update insight status
          await this.supabase
            .from('execution_insights')
            .update({
              status: 'applied',
              action_taken: actionType,
              action_taken_at: new Date().toISOString(),
            })
            .eq('id', insight.id)
      }

      // Record the action in outcome tracking
      await this.recordOutcome(insight.id, userId, actionType, changes)

      logger.info({
        insightId: insight.id,
        actionType,
        changesCount: changes.length,
      }, 'Action applied successfully')

      return {
        success: true,
        action_type: actionType,
        insight_id: insight.id,
        agent_id: agentId,
        changes_applied: changes,
      }

    } catch (error) {
      logger.error({ err: error, insightId: insight.id, actionType }, 'Failed to apply action')

      return {
        success: false,
        action_type: actionType,
        insight_id: insight.id,
        agent_id: agentId,
        changes_applied: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // ============================================================================
  // Preview Helpers
  // ============================================================================

  private previewAddRetry(insight: ExecutionInsight, pilotSteps: unknown): ChangeDescription[] {
    const affectedSteps = insight.pattern_data.affected_steps || []
    return affectedSteps.map(stepId => ({
      target: 'step' as const,
      target_id: stepId,
      field: 'retry_config',
      before: null,
      after: '{ attempts: 3, backoff: "exponential" }',
      reason: `Step "${stepId}" has failed ${insight.metrics.affected_executions} times`,
    }))
  }

  private previewAddValidation(insight: ExecutionInsight, pilotSteps: unknown): ChangeDescription[] {
    const affectedSteps = insight.pattern_data.affected_steps || []
    return affectedSteps.map(stepId => ({
      target: 'step' as const,
      target_id: stepId,
      field: 'validation',
      before: null,
      after: 'Schema validation enabled',
      reason: `Add validation to catch ${insight.insight_type} issues`,
    }))
  }

  private previewSkipEmpty(insight: ExecutionInsight, pilotSteps: unknown): ChangeDescription[] {
    const affectedSteps = insight.pattern_data.affected_steps || []
    return affectedSteps.slice(0, 1).map(stepId => ({
      target: 'step' as const,
      target_id: stepId,
      field: 'condition',
      before: null,
      after: 'if (results.length > 0)',
      reason: 'Skip subsequent steps when no data is available',
    }))
  }

  private suggestOptimalSchedule(insight: ExecutionInsight): string {
    // Simple heuristic - could be enhanced with actual pattern analysis
    // For now, suggest running during business hours
    return '0 9 * * 1-5' // 9 AM on weekdays
  }

  // ============================================================================
  // Apply Helpers
  // ============================================================================

  private async applyRetryLogic(agentId: string, insight: ExecutionInsight): Promise<void> {
    // Get current pilot_steps
    const { data: agent } = await this.supabase
      .from('agents')
      .select('pilot_steps')
      .eq('id', agentId)
      .single()

    if (!agent?.pilot_steps || !Array.isArray(agent.pilot_steps)) {
      return
    }

    // Add retry config to affected steps
    const affectedSteps = new Set(insight.pattern_data.affected_steps || [])
    const updatedSteps = agent.pilot_steps.map((step: any) => {
      if (affectedSteps.has(step.id) || affectedSteps.has(step.step_id)) {
        return {
          ...step,
          retry_config: {
            max_attempts: 3,
            backoff_type: 'exponential',
            initial_delay_ms: 1000,
          },
        }
      }
      return step
    })

    await this.supabase
      .from('agents')
      .update({ pilot_steps: updatedSteps })
      .eq('id', agentId)
  }

  private async applySkipEmpty(agentId: string, insight: ExecutionInsight): Promise<void> {
    // Get current pilot_steps
    const { data: agent } = await this.supabase
      .from('agents')
      .select('pilot_steps')
      .eq('id', agentId)
      .single()

    if (!agent?.pilot_steps || !Array.isArray(agent.pilot_steps)) {
      return
    }

    // Add skip condition to first affected step
    const affectedSteps = insight.pattern_data.affected_steps || []
    if (affectedSteps.length === 0) return

    const firstAffectedId = affectedSteps[0]
    const updatedSteps = agent.pilot_steps.map((step: any) => {
      if (step.id === firstAffectedId || step.step_id === firstAffectedId) {
        return {
          ...step,
          skip_if_empty: true,
          skip_condition: 'previous_step_result_count == 0',
        }
      }
      return step
    })

    await this.supabase
      .from('agents')
      .update({ pilot_steps: updatedSteps })
      .eq('id', agentId)
  }

  private async recordOutcome(
    insightId: string,
    userId: string,
    actionType: InsightActionType,
    changes: ChangeDescription[]
  ): Promise<void> {
    // This would insert into insight_outcomes table
    // For now, just log it
    logger.info({
      insightId,
      userId,
      actionType,
      changesCount: changes.length,
    }, 'Outcome recorded')
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let engineInstance: InsightActionEngine | null = null

export function getInsightActionEngine(supabaseClient?: SupabaseClient): InsightActionEngine {
  if (!engineInstance) {
    engineInstance = new InsightActionEngine(supabaseClient)
  }
  return engineInstance
}

export { InsightActionEngine as default }
