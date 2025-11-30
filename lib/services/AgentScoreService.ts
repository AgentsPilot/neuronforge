import { SupabaseClient } from '@supabase/supabase-js'

export interface QualityScore {
  overall_score: number
  reliability_score: number
  efficiency_score: number
  adoption_score: number
  complexity_score: number
}

export interface AgentIntensityMetrics {
  // Reliability metrics
  success_rate: number
  total_executions: number
  successful_executions: number
  failed_executions: number
  retry_rate: number
  error_recovery_count: number

  // Efficiency metrics
  avg_tokens_per_run: number
  avg_execution_duration_ms: number
  avg_plugins_per_run: number
  unique_plugins_used: number

  // Complexity metrics
  workflow_steps_count: number
  conditional_branches_count: number
  loop_iterations_count: number
  parallel_execution_count: number
}

/**
 * Service for calculating data-driven quality scores for shared agents
 * Scores are based on execution metrics, not user ratings (anti-abuse)
 */
export class AgentScoreService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Calculate comprehensive quality score for an agent
   * @param agentId - The original agent ID
   * @returns QualityScore object with overall and component scores
   */
  async calculateQualityScore(agentId: string): Promise<QualityScore> {
    // 1. Get agent intensity metrics
    const { data: metrics, error: metricsError } = await this.supabase
      .from('agent_intensity_metrics')
      .select('*')
      .eq('agent_id', agentId)
      .maybeSingle()

    if (metricsError || !metrics) {
      throw new Error(`Agent has no intensity metrics: ${metricsError?.message || 'Not found'}`)
    }

    // 2. Get import stats (if already shared)
    const { data: sharedAgent } = await this.supabase
      .from('shared_agents')
      .select('import_count, shared_at')
      .eq('original_agent_id', agentId)
      .maybeSingle()

    // 3. Calculate component scores
    const reliability_score = this.calculateReliability(metrics)
    const efficiency_score = this.calculateEfficiency(metrics)
    const complexity_score = this.calculateComplexity(metrics)
    const adoption_score = this.calculateAdoption({
      import_count: sharedAgent?.import_count || 0,
      shared_at: sharedAgent?.shared_at
    })

    // 4. Calculate overall score (weighted average)
    const overall_score = (
      reliability_score * 0.40 +
      efficiency_score * 0.30 +
      adoption_score * 0.20 +
      complexity_score * 0.10
    )

    return {
      overall_score: Math.round(overall_score * 100) / 100,
      reliability_score: Math.round(reliability_score * 100) / 100,
      efficiency_score: Math.round(efficiency_score * 100) / 100,
      adoption_score: Math.round(adoption_score * 100) / 100,
      complexity_score: Math.round(complexity_score * 100) / 100
    }
  }

  /**
   * Calculate reliability score (40% weight)
   * Based on: success rate, retry rate, error recovery
   */
  private calculateReliability(metrics: Partial<AgentIntensityMetrics>): number {
    const success_rate = metrics.success_rate || 0
    const retry_rate = metrics.retry_rate || 0
    const total_executions = metrics.total_executions || 0
    const failed_executions = metrics.failed_executions || 0
    const error_recovery_count = metrics.error_recovery_count || 0

    // Error recovery score
    const error_recovery_score = failed_executions > 0
      ? Math.min((error_recovery_count / failed_executions) * 100, 100)
      : 50  // Neutral if no failures

    // Base reliability score
    const base_score = (
      success_rate * 0.60 +                    // 60%: Core success rate
      (100 - retry_rate) * 0.20 +              // 20%: Low retry rate is good
      error_recovery_score * 0.20              // 20%: Can recover from errors
    )

    // Apply execution count weighting (more data = more reliable score)
    // Minimum 3 executions required, max benefit at 20 executions
    const execution_weight = Math.min(total_executions / 20, 1)
    const weighted_score = base_score * Math.max(execution_weight, 0.15)  // Min 15% weight

    return weighted_score
  }

  /**
   * Calculate efficiency score (30% weight)
   * Based on: token usage, execution speed, plugin efficiency
   */
  private calculateEfficiency(metrics: Partial<AgentIntensityMetrics>): number {
    const avg_tokens_per_run = metrics.avg_tokens_per_run || 0
    const avg_execution_duration_ms = metrics.avg_execution_duration_ms || 0
    const avg_plugins_per_run = metrics.avg_plugins_per_run || 0
    const unique_plugins_used = metrics.unique_plugins_used || 0

    // Token efficiency (lower is better)
    // Baseline: 2000 tokens is average, score decreases above baseline
    const baseline_tokens = 2000
    const token_efficiency = Math.max(0, Math.min(100,
      100 - ((avg_tokens_per_run - baseline_tokens) / baseline_tokens * 50)
    ))

    // Speed score (faster is better)
    // Baseline: 30 seconds is average, score decreases above baseline
    const baseline_ms = 30000
    const speed_score = Math.max(0, Math.min(100,
      100 - ((avg_execution_duration_ms - baseline_ms) / baseline_ms * 50)
    ))

    // Plugin efficiency (efficient use of plugins)
    // Lower plugin calls per unique plugin is better
    const plugin_efficiency = unique_plugins_used > 0 && avg_plugins_per_run > 0
      ? Math.min((unique_plugins_used / avg_plugins_per_run) * 100, 100)
      : 50  // Neutral if no plugins

    return (
      token_efficiency * 0.50 +
      speed_score * 0.30 +
      plugin_efficiency * 0.20
    )
  }

  /**
   * Calculate complexity score (10% weight)
   * Bonus for sophisticated workflows
   */
  private calculateComplexity(metrics: Partial<AgentIntensityMetrics>): number {
    const workflow_steps_count = metrics.workflow_steps_count || 0
    const unique_plugins_used = metrics.unique_plugins_used || 0
    const conditional_branches_count = metrics.conditional_branches_count || 0
    const loop_iterations_count = metrics.loop_iterations_count || 0
    const parallel_execution_count = metrics.parallel_execution_count || 0

    return Math.min(
      (
        workflow_steps_count * 10 +              // 10 points per step
        unique_plugins_used * 15 +               // 15 points per plugin
        (conditional_branches_count > 0 ? 20 : 0) + // Bonus for conditionals
        (loop_iterations_count > 0 ? 15 : 0) +      // Bonus for loops
        (parallel_execution_count > 0 ? 25 : 0)     // Bonus for parallelism
      ),
      100
    )
  }

  /**
   * Calculate adoption score (20% weight)
   * Based on: import count, freshness
   */
  private calculateAdoption(params: {
    import_count: number
    shared_at?: string
  }): number {
    // Logarithmic import score (prevents mega-popular dominance)
    // Max score at 40 imports
    const import_score = Math.min(
      Math.log10(params.import_count + 1) * 25,
      100
    )

    // Freshness score (decays over 90 days)
    let freshness_score = 100
    if (params.shared_at) {
      const days_since_shared = this.daysSince(params.shared_at)
      freshness_score = Math.max(0, 100 - (days_since_shared / 90 * 100))
    }

    return (
      import_score * 0.70 +
      freshness_score * 0.30
    )
  }

  /**
   * Update shared agent score in database
   */
  async updateSharedAgentScore(
    sharedAgentId: string,
    scores: QualityScore
  ): Promise<void> {
    const { error } = await this.supabase
      .from('shared_agents')
      .update({
        quality_score: scores.overall_score,
        reliability_score: scores.reliability_score,
        efficiency_score: scores.efficiency_score,
        adoption_score: scores.adoption_score,
        complexity_score: scores.complexity_score,
        score_calculated_at: new Date().toISOString()
      })
      .eq('id', sharedAgentId)

    if (error) {
      throw new Error(`Failed to update shared agent score: ${error.message}`)
    }
  }

  /**
   * Get number of unique importers (anti-abuse)
   */
  async getUniqueImporterCount(sharedAgentId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('shared_agent_imports')
      .select('imported_by_user_id')
      .eq('shared_agent_id', sharedAgentId)

    if (error || !data) return 0

    const uniqueUsers = new Set(data.map(d => d.imported_by_user_id))
    return uniqueUsers.size
  }

  /**
   * Check execution diversity (anti-abuse)
   * Returns penalty multiplier (0.7-1.0) based on execution patterns
   */
  async getExecutionDiversityPenalty(agentId: string): Promise<number> {
    const { data: executions } = await this.supabase
      .from('agent_executions')
      .select('started_at')
      .eq('agent_id', agentId)
      .not('started_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(20)

    if (!executions || executions.length < 5) {
      return 1.0  // Not enough data, no penalty
    }

    // Get unique days
    const unique_days = new Set(
      executions.map(e => new Date(e.started_at!).toDateString())
    )

    // If all executions on same day and we have many executions, apply penalty
    if (unique_days.size === 1 && executions.length > 5) {
      return 0.7  // 30% penalty for suspicious pattern
    }

    return 1.0  // No penalty
  }

  /**
   * Helper: Calculate days since a date
   */
  private daysSince(dateString: string): number {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    return Math.floor(diff / (1000 * 60 * 60 * 24))
  }
}
