/**
 * Task Complexity Analyzer - Per-Step Intelligent Routing
 *
 * Analyzes individual Pilot workflow steps to determine complexity scores (0-10).
 * Uses configurable weights and thresholds from database to ensure admin control.
 *
 * Complexity Factors:
 * - Prompt Length: Character count of step prompt/description
 * - Data Size: Byte size of input data
 * - Condition Count: Number of conditional branches
 * - Context Depth: Number of variable references
 * - Reasoning Depth: Estimated logical reasoning complexity
 * - Output Complexity: Complexity of expected output structure
 *
 * @module lib/pilot/TaskComplexityAnalyzer
 */

import { WorkflowStep, ExecutionContext } from './types';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Complexity analysis result for a single step
 */
export interface ComplexityAnalysis {
  stepId: string;
  stepType: string;
  stepName: string;

  // Overall complexity score (0-10)
  complexityScore: number;

  // Individual factor scores (0-10)
  factorScores: {
    promptLength: number;
    dataSize: number;
    conditionCount: number;
    contextDepth: number;
    reasoningDepth: number;
    outputComplexity: number;
  };

  // Raw measurements
  rawMeasurements: {
    promptLength: number;      // characters
    dataSize: number;           // bytes
    conditionCount: number;     // count
    contextDepth: number;       // count
    reasoningDepth: number;     // estimated 0-10
    outputComplexity: number;   // estimated 0-10
  };

  // Applied weights
  appliedWeights: {
    promptLength: number;
    dataSize: number;
    conditionCount: number;
    contextDepth: number;
    reasoningDepth: number;
    outputComplexity: number;
  };
}

/**
 * Complexity factor weights for a step type
 */
interface ComplexityWeights {
  promptLength: number;
  dataSize: number;
  conditionCount: number;
  contextDepth: number;
  reasoningDepth: number;
  outputComplexity: number;
}

/**
 * Complexity scoring thresholds
 */
interface ComplexityThresholds {
  promptLength: { low: number; medium: number; high: number };
  dataSize: { low: number; medium: number; high: number };
  conditionCount: { low: number; medium: number; high: number };
  contextDepth: { low: number; medium: number; high: number };
}

/**
 * Configuration for complexity analysis (loaded from database)
 */
interface ComplexityConfig {
  weights: {
    llmDecision: ComplexityWeights;
    transform: ComplexityWeights;
    conditional: ComplexityWeights;
    action: ComplexityWeights;
    apiCall: ComplexityWeights;
    default: ComplexityWeights;
  };
  thresholds: ComplexityThresholds;
}

// ============================================================================
// TASK COMPLEXITY ANALYZER
// ============================================================================

export class TaskComplexityAnalyzer {
  private config: ComplexityConfig | null = null;
  private supabase: any;

  constructor() {
    // Initialize Supabase client with service role
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
  }

  /**
   * Load complexity configuration from database
   */
  private async loadConfig(): Promise<void> {
    try {
      // Fetch all complexity-related config keys
      const { data, error } = await this.supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', [
          'pilot_complexity_weights_llm_decision',
          'pilot_complexity_weights_transform',
          'pilot_complexity_weights_conditional',
          'pilot_complexity_weights_action',
          'pilot_complexity_weights_api_call',
          'pilot_complexity_weights_default',
          'pilot_complexity_thresholds_prompt_length',
          'pilot_complexity_thresholds_data_size',
          'pilot_complexity_thresholds_condition_count',
          'pilot_complexity_thresholds_context_depth'
        ]);

      if (error) {
        console.error('❌ [TaskComplexityAnalyzer] Failed to load config:', error);
        this.setDefaultConfig();
        return;
      }

      // Parse configuration
      const config: ComplexityConfig = {
        weights: {
          llmDecision: this.getDefaultWeights('llmDecision'),
          transform: this.getDefaultWeights('transform'),
          conditional: this.getDefaultWeights('conditional'),
          action: this.getDefaultWeights('action'),
          apiCall: this.getDefaultWeights('apiCall'),
          default: this.getDefaultWeights('default')
        },
        thresholds: {
          promptLength: { low: 200, medium: 500, high: 1000 },
          dataSize: { low: 1024, medium: 10240, high: 51200 },
          conditionCount: { low: 2, medium: 5, high: 10 },
          contextDepth: { low: 2, medium: 5, high: 10 }
        }
      };

      // Populate from database
      data?.forEach(item => {
        const value = JSON.parse(item.config_value);

        if (item.config_key === 'pilot_complexity_weights_llm_decision') {
          config.weights.llmDecision = value;
        } else if (item.config_key === 'pilot_complexity_weights_transform') {
          config.weights.transform = value;
        } else if (item.config_key === 'pilot_complexity_weights_conditional') {
          config.weights.conditional = value;
        } else if (item.config_key === 'pilot_complexity_weights_action') {
          config.weights.action = value;
        } else if (item.config_key === 'pilot_complexity_weights_api_call') {
          config.weights.apiCall = value;
        } else if (item.config_key === 'pilot_complexity_weights_default') {
          config.weights.default = value;
        } else if (item.config_key === 'pilot_complexity_thresholds_prompt_length') {
          config.thresholds.promptLength = value;
        } else if (item.config_key === 'pilot_complexity_thresholds_data_size') {
          config.thresholds.dataSize = value;
        } else if (item.config_key === 'pilot_complexity_thresholds_condition_count') {
          config.thresholds.conditionCount = value;
        } else if (item.config_key === 'pilot_complexity_thresholds_context_depth') {
          config.thresholds.contextDepth = value;
        }
      });

      this.config = config;
      console.log('✅ [TaskComplexityAnalyzer] Configuration loaded from database');
    } catch (err) {
      console.error('❌ [TaskComplexityAnalyzer] Exception loading config:', err);
      this.setDefaultConfig();
    }
  }

  /**
   * Set default configuration (fallback)
   */
  private setDefaultConfig(): void {
    this.config = {
      weights: {
        llmDecision: this.getDefaultWeights('llmDecision'),
        transform: this.getDefaultWeights('transform'),
        conditional: this.getDefaultWeights('conditional'),
        action: this.getDefaultWeights('action'),
        apiCall: this.getDefaultWeights('apiCall'),
        default: this.getDefaultWeights('default')
      },
      thresholds: {
        promptLength: { low: 200, medium: 500, high: 1000 },
        dataSize: { low: 1024, medium: 10240, high: 51200 },
        conditionCount: { low: 2, medium: 5, high: 10 },
        contextDepth: { low: 2, medium: 5, high: 10 }
      }
    };
    console.log('⚠️ [TaskComplexityAnalyzer] Using default configuration');
  }

  /**
   * Get default weights for a step type
   */
  private getDefaultWeights(stepType: string): ComplexityWeights {
    const defaults: Record<string, ComplexityWeights> = {
      llmDecision: {
        promptLength: 0.15,
        dataSize: 0.10,
        conditionCount: 0.15,
        contextDepth: 0.15,
        reasoningDepth: 0.30,
        outputComplexity: 0.15
      },
      transform: {
        promptLength: 0.15,
        dataSize: 0.30,
        conditionCount: 0.10,
        contextDepth: 0.15,
        reasoningDepth: 0.15,
        outputComplexity: 0.15
      },
      conditional: {
        promptLength: 0.15,
        dataSize: 0.10,
        conditionCount: 0.30,
        contextDepth: 0.15,
        reasoningDepth: 0.20,
        outputComplexity: 0.10
      },
      action: {
        promptLength: 0.20,
        dataSize: 0.15,
        conditionCount: 0.15,
        contextDepth: 0.15,
        reasoningDepth: 0.20,
        outputComplexity: 0.15
      },
      apiCall: {
        promptLength: 0.20,
        dataSize: 0.20,
        conditionCount: 0.15,
        contextDepth: 0.15,
        reasoningDepth: 0.15,
        outputComplexity: 0.15
      },
      default: {
        promptLength: 0.20,
        dataSize: 0.15,
        conditionCount: 0.15,
        contextDepth: 0.15,
        reasoningDepth: 0.20,
        outputComplexity: 0.15
      }
    };

    return defaults[stepType] || defaults.default;
  }

  /**
   * Analyze step complexity
   */
  async analyzeStep(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<ComplexityAnalysis> {
    // Load config if not already loaded
    if (!this.config) {
      await this.loadConfig();
    }

    // Get raw measurements
    const raw = this.measureRawFactors(step, context);

    // Get weights for this step type
    const weights = this.getWeightsForStepType(step.type);

    // Score each factor (0-10)
    const factorScores = {
      promptLength: this.scorePromptLength(raw.promptLength),
      dataSize: this.scoreDataSize(raw.dataSize),
      conditionCount: this.scoreConditionCount(raw.conditionCount),
      contextDepth: this.scoreContextDepth(raw.contextDepth),
      reasoningDepth: raw.reasoningDepth,  // Already 0-10
      outputComplexity: raw.outputComplexity  // Already 0-10
    };

    // Calculate weighted complexity score
    const complexityScore =
      factorScores.promptLength * weights.promptLength +
      factorScores.dataSize * weights.dataSize +
      factorScores.conditionCount * weights.conditionCount +
      factorScores.contextDepth * weights.contextDepth +
      factorScores.reasoningDepth * weights.reasoningDepth +
      factorScores.outputComplexity * weights.outputComplexity;

    return {
      stepId: step.id,
      stepType: step.type,
      stepName: step.name,
      complexityScore: Math.min(10, Math.max(0, complexityScore)),
      factorScores,
      rawMeasurements: raw,
      appliedWeights: weights
    };
  }

  /**
   * Measure raw factor values for a step
   */
  private measureRawFactors(
    step: WorkflowStep,
    context: ExecutionContext
  ): ComplexityAnalysis['rawMeasurements'] {
    return {
      promptLength: this.measurePromptLength(step),
      dataSize: this.measureDataSize(step, context),
      conditionCount: this.measureConditionCount(step),
      contextDepth: this.measureContextDepth(step),
      reasoningDepth: this.estimateReasoningDepth(step),
      outputComplexity: this.estimateOutputComplexity(step)
    };
  }

  /**
   * Measure prompt length (characters)
   */
  private measurePromptLength(step: WorkflowStep): number {
    let length = 0;

    // Add step name and description
    length += step.name?.length || 0;
    length += step.description?.length || 0;

    // Add type-specific prompt content
    if ('prompt' in step && step.prompt) {
      length += step.prompt.length;
    }

    // Add params as JSON string length
    if ('params' in step && step.params) {
      length += JSON.stringify(step.params).length;
    }

    return length;
  }

  /**
   * Measure data size (bytes)
   */
  private measureDataSize(step: WorkflowStep, context: ExecutionContext): number {
    let size = 0;

    // Estimate based on params
    if ('params' in step && step.params) {
      size += Buffer.byteLength(JSON.stringify(step.params), 'utf8');
    }

    // Estimate based on input references
    if ('input' in step && typeof step.input === 'string') {
      // Try to resolve variable and measure
      const resolved = this.resolveVariable(step.input, context);
      if (resolved) {
        size += Buffer.byteLength(JSON.stringify(resolved), 'utf8');
      }
    }

    return size;
  }

  /**
   * Count conditional branches
   */
  private measureConditionCount(step: WorkflowStep): number {
    let count = 0;

    // Conditional step
    if (step.type === 'conditional' && 'condition' in step) {
      count += this.countConditions(step.condition);
    }

    // Execute if condition
    if (step.executeIf) {
      count += this.countConditions(step.executeIf);
    }

    // Switch step
    if (step.type === 'switch' && 'cases' in step) {
      count += Object.keys(step.cases).length;
    }

    return count;
  }

  /**
   * Count conditions recursively
   */
  private countConditions(condition: any): number {
    if (typeof condition === 'string') return 1;
    if (!condition || typeof condition !== 'object') return 0;

    let count = 0;

    if (condition.and) {
      count += condition.and.length;
      condition.and.forEach((c: any) => count += this.countConditions(c));
    }
    if (condition.or) {
      count += condition.or.length;
      condition.or.forEach((c: any) => count += this.countConditions(c));
    }
    if (condition.not) {
      count += 1 + this.countConditions(condition.not);
    }
    if (condition.field && condition.operator) {
      count += 1;
    }

    return count;
  }

  /**
   * Measure context depth (variable references)
   */
  private measureContextDepth(step: WorkflowStep): number {
    const stepJson = JSON.stringify(step);
    const matches = stepJson.match(/\{\{[^}]+\}\}/g);
    return matches ? matches.length : 0;
  }

  /**
   * Estimate reasoning depth (0-10)
   */
  private estimateReasoningDepth(step: WorkflowStep): number {
    // LLM Decision steps typically require high reasoning
    if (step.type === 'llm_decision' || step.type === 'ai_processing') {
      return 8;
    }

    // Conditional steps require moderate reasoning
    if (step.type === 'conditional' || step.type === 'switch') {
      return 6;
    }

    // Transform steps require some reasoning
    if (step.type === 'transform') {
      return 4;
    }

    // Action/API steps require minimal reasoning
    if (step.type === 'action') {
      return 2;
    }

    // Default
    return 3;
  }

  /**
   * Estimate output complexity (0-10)
   */
  private estimateOutputComplexity(step: WorkflowStep): number {
    // Transform steps with complex operations
    if (step.type === 'transform' && 'config' in step) {
      const config = step.config;
      if (config.aggregations && config.aggregations.length > 3) return 8;
      if (config.mapping && Object.keys(config.mapping).length > 5) return 7;
      return 5;
    }

    // LLM Decision steps can have complex outputs
    if (step.type === 'llm_decision' || step.type === 'ai_processing') {
      return 7;
    }

    // Enrichment/validation steps
    if (step.type === 'enrichment' || step.type === 'validation') {
      return 6;
    }

    // Simple action steps
    if (step.type === 'action') {
      return 3;
    }

    // Default
    return 4;
  }

  /**
   * Score prompt length based on thresholds
   */
  private scorePromptLength(length: number): number {
    const t = this.config!.thresholds.promptLength;
    if (length < t.low) return 2;
    if (length < t.medium) return 5;
    if (length < t.high) return 7;
    return 9;
  }

  /**
   * Score data size based on thresholds
   */
  private scoreDataSize(size: number): number {
    const t = this.config!.thresholds.dataSize;
    if (size < t.low) return 2;
    if (size < t.medium) return 5;
    if (size < t.high) return 7;
    return 9;
  }

  /**
   * Score condition count based on thresholds
   */
  private scoreConditionCount(count: number): number {
    const t = this.config!.thresholds.conditionCount;
    if (count < t.low) return 2;
    if (count < t.medium) return 5;
    if (count < t.high) return 7;
    return 9;
  }

  /**
   * Score context depth based on thresholds
   */
  private scoreContextDepth(depth: number): number {
    const t = this.config!.thresholds.contextDepth;
    if (depth < t.low) return 2;
    if (depth < t.medium) return 5;
    if (depth < t.high) return 7;
    return 9;
  }

  /**
   * Get weights for step type
   */
  private getWeightsForStepType(stepType: string): ComplexityWeights {
    const typeMap: Record<string, keyof ComplexityConfig['weights']> = {
      llm_decision: 'llmDecision',
      ai_processing: 'llmDecision',
      transform: 'transform',
      conditional: 'conditional',
      switch: 'conditional',
      action: 'action',
      api_call: 'apiCall'
    };

    const configKey = typeMap[stepType] || 'default';
    return this.config!.weights[configKey];
  }

  /**
   * Resolve variable reference
   */
  private resolveVariable(varRef: string, context: ExecutionContext): any {
    // Simple variable resolution (supports {{stepId.field}})
    const match = varRef.match(/\{\{([^}]+)\}\}/);
    if (!match) return null;

    const path = match[1].split('.');
    let value: any = context.variables;

    for (const key of path) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return null;
      }
    }

    return value;
  }
}
