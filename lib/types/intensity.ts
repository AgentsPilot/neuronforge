// lib/types/intensity.ts
// TypeScript types for Agent Intensity tracking system

/**
 * Agent Intensity Metrics
 * Comprehensive complexity metrics used to calculate dynamic pricing multipliers
 */
export interface AgentIntensityMetrics {
  id: string;
  agent_id: string;
  user_id: string;

  // === THREE SCORE SYSTEM ===
  creation_score: number;        // NEW: 0-10 score for creation complexity
  execution_score: number;       // NEW: 0-10 score for execution complexity (avg per run)
  combined_score: number;        // NEW: Weighted average (creation*0.3 + execution*0.7)

  /**
   * @deprecated Use combined_score instead. Kept for backward compatibility.
   * Will be removed in v2.0
   */
  intensity_score: number;       // DEPRECATED: Same as combined_score

  // === CREATION DIMENSION SCORES (4 dimensions) ===
  creation_workflow_score: number;      // NEW: 0-10 (based on workflow steps count)
  creation_plugin_score: number;        // NEW: 0-10 (based on number of plugins)
  creation_io_score: number;            // NEW: 0-10 (based on I/O schema complexity)
  creation_trigger_score: number;       // NEW: 0-2 (bonus for trigger type)

  // OLD (deprecated but kept for backward compatibility)
  creation_complexity_score: number;          // DEPRECATED: Use creation dimension scores
  creation_token_efficiency_score: number;    // DEPRECATED: Use creation dimension scores

  // === EXECUTION COMPONENT SCORES (5 components) ===
  token_complexity_score: number;
  execution_complexity_score: number;
  plugin_complexity_score: number;
  workflow_complexity_score: number;
  memory_complexity_score: number;  // NEW: Memory complexity (5th component)

  // Token Statistics
  total_tokens_used: number;
  avg_tokens_per_run: number;
  peak_tokens_single_run: number;
  input_output_ratio: number;
  creation_tokens_used: number; // NEW: Tokens used during agent creation
  total_creation_cost_usd: number; // NEW: USD cost of creation

  // Output Token Growth Tracking (NEW)
  avg_output_tokens_per_run: number;      // Average output tokens across all executions
  output_token_growth_rate: number;       // Percentage growth vs baseline
  output_token_baseline: number;          // Rolling average baseline (all executions)
  output_token_alert_level: 'none' | 'monitor' | 'rescore' | 'upgrade'; // Alert level based on growth

  // Memory Complexity Tracking (NEW)
  avg_memory_tokens_per_run: number;      // Average memory tokens injected per execution
  memory_token_ratio: number;             // Ratio of memory tokens to total input tokens
  memory_entry_count: number;             // Average number of memory entries loaded
  memory_type_diversity: number;          // Number of distinct memory types used

  // Execution Statistics
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  avg_execution_duration_ms: number;
  peak_execution_duration_ms: number;
  total_iterations: number;
  avg_iterations_per_run: number;

  // Plugin/Tool Usage
  total_plugin_calls: number;
  unique_plugins_used: number;
  avg_plugins_per_run: number;
  tool_orchestration_overhead_ms: number;

  // Workflow Complexity
  workflow_steps_count: number;
  conditional_branches_count: number;
  loop_iterations_count: number;
  parallel_execution_count: number;

  // Reliability Metrics
  success_rate: number;
  retry_rate: number;
  error_recovery_count: number;

  // Resource Usage
  memory_footprint_mb: number;
  api_calls_per_run: number;

  // Metadata
  calculation_method: string;
  last_calculated_at: string;
  metrics_version: number;

  // Timestamps
  created_at: string;
  updated_at: string;
}

/**
 * Input data for calculating intensity from a single agent execution
 */
export interface AgentExecutionData {
  agent_id: string;
  user_id: string;

  // Token usage from this execution
  tokens_used: number;
  input_tokens?: number;
  output_tokens?: number;

  // Execution metrics
  execution_duration_ms: number;
  iterations_count: number;
  was_successful: boolean;
  retry_count?: number;

  // Plugin/tool usage
  plugins_used: string[];
  tool_calls_count: number;
  tool_orchestration_time_ms?: number;

  // Workflow data
  workflow_steps?: number;
  conditional_branches?: number;
  loop_iterations?: number;
  parallel_executions?: number;

  // Resource usage (optional)
  memory_usage_mb?: number;
  api_calls?: number;

  // Memory context data (optional)
  memory_tokens?: number;           // Number of memory tokens injected
  memory_entry_count?: number;      // Number of memory entries loaded
  memory_types?: string[];          // Types of memory used (e.g., ['user_context', 'summaries'])
}

/**
 * Input data for tracking agent creation costs
 */
export interface AgentCreationData {
  agent_id: string;
  user_id: string;

  // Token usage from creation process
  tokens_used: number;
  input_tokens?: number;
  output_tokens?: number;

  // Creation phases
  prompt_analysis_tokens?: number;
  clarification_tokens?: number;
  enhancement_tokens?: number;
  generation_tokens?: number;

  // Creation duration
  creation_duration_ms: number;
}

/**
 * Creation component scores (4 dimensions)
 */
export interface CreationComponentScores {
  workflow_structure: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  plugin_diversity: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  io_schema: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  trigger_type: {
    score: number;
    weight: number;
    weighted_score: number;
  };
}

/**
 * Execution component scores (5 components - includes memory)
 */
export interface IntensityComponentScores {
  token_complexity: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  execution_complexity: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  plugin_complexity: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  workflow_complexity: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  memory_complexity: {
    score: number;
    weight: number;
    weighted_score: number;
  };
}

/**
 * Complete intensity breakdown for display
 */
export interface IntensityBreakdown {
  // === THREE SCORES ===
  creation_score: number;              // NEW
  execution_score: number;             // NEW
  combined_score: number;              // NEW

  creation_multiplier: number;         // NEW: 1.0 + (creation_score / 10)
  execution_multiplier: number;        // NEW: 1.0 + (execution_score / 10)
  combined_multiplier: number;         // NEW: 1.0 + (combined_score / 10)

  /**
   * @deprecated Use combined_score instead
   */
  overall_score: number;               // DEPRECATED: Same as combined_score
  /**
   * @deprecated Use combined_multiplier instead
   */
  pricing_multiplier: number;          // DEPRECATED: Same as combined_multiplier

  // === COMPONENT BREAKDOWNS ===
  creation_components: CreationComponentScores;   // NEW
  execution_components: IntensityComponentScores; // RENAMED (was "components")

  details: {
    creation_stats: {
      creation_tokens_used: number;
      total_creation_cost_usd: number;
      creation_complexity_score: number;       // NEW
      creation_efficiency_score: number;       // NEW
    };
    design_stats: {
      workflow_steps: number;
      connected_plugins: number;
      input_fields: number;
      output_fields: number;
      trigger_type: string;
    };
    token_stats: {
      avg_tokens_per_run: number;
      peak_tokens: number;
      total_tokens: number;
      input_output_ratio: number;
    };
    execution_stats: {
      total_executions: number;
      success_rate: number;
      avg_duration_ms: number;
      avg_iterations: number;
    };
    plugin_stats: {
      unique_plugins: number;
      avg_plugins_per_run: number;
      total_calls: number;
      orchestration_overhead_ms: number;
    };
    workflow_stats: {
      workflow_steps: number;
      branches: number;
      loops: number;
      parallel_executions: number;
    };
    memory_stats: {
      avg_memory_tokens_per_run: number;
      memory_token_ratio: number;
      memory_entry_count: number;
      memory_type_diversity: number;
    };
  };
}

/**
 * Intensity distribution analytics
 */
export interface IntensityDistribution {
  intensity_range: 'Low (0-3)' | 'Medium (3-6)' | 'High (6-10)';
  agent_count: number;
  avg_score: number;
  avg_total_tokens: number;
  avg_success_rate: number;
  avg_plugins_used: number;
}

/**
 * Top complex agents view
 */
export interface TopComplexAgent {
  id: string;
  agent_name: string;
  user_id: string;
  intensity_score: number;
  pricing_multiplier: number;
  total_executions: number;
  total_tokens_used: number;
  success_rate: number;
  unique_plugins_used: number;
  last_calculated_at: string;
}

/**
 * Creation score weights (2 components)
 */
export const CREATION_WEIGHTS = {
  CREATION_COMPLEXITY: 0.5,    // 50% weight (token volume)
  CREATION_EFFICIENCY: 0.5,    // 50% weight (tokens per phase)
} as const;

/**
 * Execution score weights (5 components)
 *
 * @deprecated DO NOT USE - These constants are deprecated as of Phase 6.
 * Load weights from database using AISConfigService.getExecutionWeights() instead.
 *
 * These values are kept only for backward compatibility and type definitions.
 * They will be removed in v2.0.
 *
 * @see AISConfigService.getExecutionWeights() for database-driven weights
 *
 * UPDATED: Rebalanced to include memory complexity
 */
export const EXECUTION_WEIGHTS = {
  TOKEN_COMPLEXITY: 0.30,      // 30% weight (reduced from 35%)
  EXECUTION_COMPLEXITY: 0.25,  // 25% weight (unchanged)
  PLUGIN_COMPLEXITY: 0.20,     // 20% weight (reduced from 25%)
  WORKFLOW_COMPLEXITY: 0.15,   // 15% weight (unchanged)
  MEMORY_COMPLEXITY: 0.10,     // 10% weight (NEW - 5th component)
} as const;

/**
 * Combined score weights (creation + execution)
 *
 * @deprecated DO NOT USE - These constants are deprecated as of Phase 6.
 * Load weights from database using AISConfigService.getCombinedWeights() instead.
 *
 * These values are kept only for backward compatibility and type definitions.
 * They will be removed in v2.0.
 *
 * @see AISConfigService.getCombinedWeights() for database-driven weights
 */
export const COMBINED_WEIGHTS = {
  CREATION: 0.3,               // 30% weight (creation score)
  EXECUTION: 0.7,              // 70% weight (execution score)
} as const;

/**
 * @deprecated Use EXECUTION_WEIGHTS instead
 */
export const INTENSITY_WEIGHTS = EXECUTION_WEIGHTS;

/**
 * Intensity score ranges for classification
 */
export const INTENSITY_RANGES = {
  LOW: { min: 0, max: 3 },
  MEDIUM: { min: 3, max: 6 },
  HIGH: { min: 6, max: 10 },
} as const;

/**
 * Pricing multiplier range (maps intensity 0-10 to multiplier 1.0-2.0)
 */
export const PRICING_MULTIPLIER = {
  MIN: 1.0,
  MAX: 2.0,
  FORMULA: (intensity_score: number) => 1.0 + (intensity_score / 10.0),
} as const;

/**
 * Default values for new agents
 */
export const DEFAULT_INTENSITY_METRICS: Partial<AgentIntensityMetrics> = {
  // Three scores
  creation_score: 5.0,            // NEW
  execution_score: 5.0,           // NEW
  combined_score: 5.0,            // NEW
  intensity_score: 5.0,           // DEPRECATED but keep

  // Creation dimension scores (4 dimensions)
  creation_workflow_score: 5.0,
  creation_plugin_score: 5.0,
  creation_io_score: 5.0,
  creation_trigger_score: 0.0,

  // OLD (deprecated)
  creation_complexity_score: 5.0,
  creation_token_efficiency_score: 5.0,

  // Execution component scores (5 components)
  token_complexity_score: 5.0,
  execution_complexity_score: 5.0,
  plugin_complexity_score: 5.0,
  workflow_complexity_score: 5.0,
  memory_complexity_score: 0.0,    // NEW: Memory complexity (default 0 until memory is used)
  total_tokens_used: 0,
  avg_tokens_per_run: 0,
  peak_tokens_single_run: 0,
  input_output_ratio: 1.0,
  creation_tokens_used: 0,
  total_creation_cost_usd: 0,

  // Output token growth tracking
  avg_output_tokens_per_run: 0,
  output_token_growth_rate: 0,
  output_token_baseline: 0,
  output_token_alert_level: 'none' as 'none' | 'monitor' | 'rescore' | 'upgrade',

  // Memory complexity tracking
  avg_memory_tokens_per_run: 0,
  memory_token_ratio: 0,
  memory_entry_count: 0,
  memory_type_diversity: 0,

  total_executions: 0,
  successful_executions: 0,
  failed_executions: 0,
  avg_execution_duration_ms: 0,
  peak_execution_duration_ms: 0,
  total_iterations: 0,
  avg_iterations_per_run: 1.0,
  total_plugin_calls: 0,
  unique_plugins_used: 0,
  avg_plugins_per_run: 0,
  tool_orchestration_overhead_ms: 0,
  workflow_steps_count: 0,
  conditional_branches_count: 0,
  loop_iterations_count: 0,
  parallel_execution_count: 0,
  success_rate: 100.0,
  retry_rate: 0.0,
  error_recovery_count: 0,
  memory_footprint_mb: 0,
  api_calls_per_run: 0,
  calculation_method: 'weighted_average',
  metrics_version: 1,
};

/**
 * Type guard to check if metrics exist
 */
export function hasIntensityMetrics(
  metrics: AgentIntensityMetrics | null | undefined
): metrics is AgentIntensityMetrics {
  return metrics !== null && metrics !== undefined && !!metrics.agent_id;
}

/**
 * Helper to calculate pricing multiplier from intensity score
 * @deprecated Use calculateCombinedMultiplier instead
 */
export function calculatePricingMultiplier(intensity_score: number): number {
  // Ensure score is within bounds
  const clampedScore = Math.max(0, Math.min(10, intensity_score));
  return PRICING_MULTIPLIER.FORMULA(clampedScore);
}

/**
 * Calculate creation score multiplier (1.0-2.0 range)
 */
export function calculateCreationMultiplier(creation_score: number): number {
  const clampedScore = Math.max(0, Math.min(10, creation_score));
  return 1.0 + (clampedScore / 10);
}

/**
 * Calculate execution score multiplier (1.0-2.0 range)
 */
export function calculateExecutionMultiplier(execution_score: number): number {
  const clampedScore = Math.max(0, Math.min(10, execution_score));
  return 1.0 + (clampedScore / 10);
}

/**
 * Calculate combined score multiplier (1.0-2.0 range)
 */
export function calculateCombinedMultiplier(combined_score: number): number {
  const clampedScore = Math.max(0, Math.min(10, combined_score));
  return 1.0 + (clampedScore / 10);
}

/**
 * Helper to classify intensity into range
 */
export function classifyIntensityRange(
  intensity_score: number
): 'Low (0-3)' | 'Medium (3-6)' | 'High (6-10)' {
  if (intensity_score < 3.0) return 'Low (0-3)';
  if (intensity_score < 6.0) return 'Medium (3-6)';
  return 'High (6-10)';
}

/**
 * Helper to format intensity score with color
 */
export function getIntensityColor(intensity_score: number): string {
  if (intensity_score < 3.0) return 'text-green-600';
  if (intensity_score < 6.0) return 'text-yellow-600';
  if (intensity_score < 8.0) return 'text-orange-600';
  return 'text-red-600';
}

/**
 * Helper to get intensity badge color
 */
export function getIntensityBadgeColor(intensity_score: number): string {
  if (intensity_score < 3.0) return 'bg-green-100 text-green-800';
  if (intensity_score < 6.0) return 'bg-yellow-100 text-yellow-800';
  if (intensity_score < 8.0) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
}
