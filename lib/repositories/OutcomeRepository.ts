/**
 * OutcomeRepository - Track insight action outcomes
 *
 * Records what actions were taken on insights and measures
 * the effectiveness of those actions over time.
 *
 * @module lib/repositories/OutcomeRepository
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer'
import { createLogger, Logger } from '@/lib/logger'

const logger = createLogger({ service: 'OutcomeRepository' })

// ============================================================================
// Types
// ============================================================================

export interface InsightOutcome {
  id: string
  insight_id: string
  user_id: string
  action_type: string
  action_date: string
  action_metadata?: Record<string, unknown>
  metric_name: string
  metric_before: number | null
  metric_after: number | null
  metric_unit: string
  measurement_start?: string
  measurement_end?: string
  executions_measured?: number
  success: boolean | null
  improvement_percentage: number | null
  user_rating?: number
  user_notes?: string
  created_at: string
}

export interface CreateOutcomeInput {
  insight_id: string
  user_id: string
  action_type: string
  action_metadata?: Record<string, unknown>
  metric_name: string
  metric_before?: number
  metric_unit: string
}

export interface UpdateOutcomeInput {
  metric_after?: number
  measurement_end?: string
  executions_measured?: number
  success?: boolean
  improvement_percentage?: number
  user_rating?: number
  user_notes?: string
}

export interface OutcomeRepositoryResult<T> {
  data: T | null
  error: Error | null
}

export interface OutcomeSummary {
  total_actions: number
  successful_actions: number
  average_improvement: number
  actions_by_type: Record<string, number>
}

// ============================================================================
// Repository
// ============================================================================

export class OutcomeRepository {
  private supabase: SupabaseClient
  private logger: Logger

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase
    this.logger = createLogger({ service: 'OutcomeRepository' })
  }

  /**
   * Record a new outcome when an action is taken
   */
  async create(input: CreateOutcomeInput): Promise<OutcomeRepositoryResult<InsightOutcome>> {
    try {
      const { data, error } = await this.supabase
        .from('insight_outcomes')
        .insert({
          insight_id: input.insight_id,
          user_id: input.user_id,
          action_type: input.action_type,
          action_date: new Date().toISOString(),
          action_metadata: input.action_metadata || {},
          metric_name: input.metric_name,
          metric_before: input.metric_before ?? null,
          metric_unit: input.metric_unit,
          measurement_start: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) throw error

      this.logger.info({
        outcomeId: data?.id,
        insightId: input.insight_id,
        actionType: input.action_type,
      }, 'Outcome recorded')

      return { data, error: null }
    } catch (error) {
      this.logger.error({ err: error, input }, 'Failed to create outcome')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Update outcome with measured results
   */
  async update(
    id: string,
    userId: string,
    input: UpdateOutcomeInput
  ): Promise<OutcomeRepositoryResult<InsightOutcome>> {
    try {
      // Calculate improvement if we have before/after values
      let improvement: number | null = null
      if (input.metric_after !== undefined) {
        const { data: current } = await this.supabase
          .from('insight_outcomes')
          .select('metric_before')
          .eq('id', id)
          .single()

        if (current?.metric_before && current.metric_before > 0) {
          improvement = ((input.metric_after - current.metric_before) / current.metric_before) * 100
        }
      }

      const updateData: Record<string, unknown> = { ...input }
      if (improvement !== null && input.improvement_percentage === undefined) {
        updateData.improvement_percentage = improvement
      }

      const { data, error } = await this.supabase
        .from('insight_outcomes')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single()

      if (error) throw error

      this.logger.info({ outcomeId: id }, 'Outcome updated')
      return { data, error: null }
    } catch (error) {
      this.logger.error({ err: error, outcomeId: id }, 'Failed to update outcome')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Find outcomes by insight ID
   */
  async findByInsightId(insightId: string): Promise<OutcomeRepositoryResult<InsightOutcome[]>> {
    try {
      const { data, error } = await this.supabase
        .from('insight_outcomes')
        .select('*')
        .eq('insight_id', insightId)
        .order('action_date', { ascending: false })

      if (error) throw error
      return { data: data || [], error: null }
    } catch (error) {
      this.logger.error({ err: error, insightId }, 'Failed to find outcomes by insight')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Find outcomes by user ID
   */
  async findByUserId(
    userId: string,
    options?: { limit?: number; actionType?: string }
  ): Promise<OutcomeRepositoryResult<InsightOutcome[]>> {
    try {
      let query = this.supabase
        .from('insight_outcomes')
        .select('*')
        .eq('user_id', userId)
        .order('action_date', { ascending: false })

      if (options?.actionType) {
        query = query.eq('action_type', options.actionType)
      }

      if (options?.limit) {
        query = query.limit(options.limit)
      }

      const { data, error } = await query

      if (error) throw error
      return { data: data || [], error: null }
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to find outcomes by user')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Get summary of outcomes for a user
   */
  async getSummary(userId: string): Promise<OutcomeRepositoryResult<OutcomeSummary>> {
    try {
      const { data: outcomes, error } = await this.supabase
        .from('insight_outcomes')
        .select('action_type, success, improvement_percentage')
        .eq('user_id', userId)

      if (error) throw error

      if (!outcomes || outcomes.length === 0) {
        return {
          data: {
            total_actions: 0,
            successful_actions: 0,
            average_improvement: 0,
            actions_by_type: {},
          },
          error: null,
        }
      }

      // Calculate summary
      const actionsByType: Record<string, number> = {}
      let successCount = 0
      let totalImprovement = 0
      let improvementCount = 0

      outcomes.forEach(outcome => {
        // Count by type
        actionsByType[outcome.action_type] = (actionsByType[outcome.action_type] || 0) + 1

        // Count successes
        if (outcome.success === true) {
          successCount++
        }

        // Sum improvements
        if (outcome.improvement_percentage !== null) {
          totalImprovement += outcome.improvement_percentage
          improvementCount++
        }
      })

      return {
        data: {
          total_actions: outcomes.length,
          successful_actions: successCount,
          average_improvement: improvementCount > 0 ? totalImprovement / improvementCount : 0,
          actions_by_type: actionsByType,
        },
        error: null,
      }
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to get outcome summary')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Add user feedback to an outcome
   */
  async addFeedback(
    id: string,
    userId: string,
    rating: number,
    notes?: string
  ): Promise<OutcomeRepositoryResult<InsightOutcome>> {
    try {
      const { data, error } = await this.supabase
        .from('insight_outcomes')
        .update({
          user_rating: rating,
          user_notes: notes,
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single()

      if (error) throw error

      this.logger.info({ outcomeId: id, rating }, 'Feedback added to outcome')
      return { data, error: null }
    } catch (error) {
      this.logger.error({ err: error, outcomeId: id }, 'Failed to add feedback')
      return { data: null, error: error as Error }
    }
  }

  /**
   * Find outcomes that need measurement (action taken but no result yet)
   */
  async findPendingMeasurement(
    userId: string,
    daysSinceAction = 7
  ): Promise<OutcomeRepositoryResult<InsightOutcome[]>> {
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - daysSinceAction)

      const { data, error } = await this.supabase
        .from('insight_outcomes')
        .select('*')
        .eq('user_id', userId)
        .is('metric_after', null)
        .lte('action_date', cutoffDate.toISOString())
        .order('action_date', { ascending: true })

      if (error) throw error
      return { data: data || [], error: null }
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to find pending measurements')
      return { data: null, error: error as Error }
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let repositoryInstance: OutcomeRepository | null = null

export function getOutcomeRepository(supabaseClient?: SupabaseClient): OutcomeRepository {
  if (!repositoryInstance) {
    repositoryInstance = new OutcomeRepository(supabaseClient)
  }
  return repositoryInstance
}

export const outcomeRepository = new OutcomeRepository()
