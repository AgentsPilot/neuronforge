/**
 * Logical IR Compiler
 *
 * This is the DETERMINISTIC compilation layer that converts Logical IR
 * into executable PILOT_DSL workflows.
 *
 * Key Principles:
 * 1. ZERO LLM calls - 100% rule-based
 * 2. Same IR → Same workflow (deterministic)
 * 3. Fast compilation (<100ms target)
 * 4. Extensible via compiler rules
 *
 * Architecture:
 * - Compiler iterates through rules
 * - First matching rule compiles the IR
 * - Rules use resolvers to map IR → workflow steps
 * - Output is PILOT_DSL format (reuses existing execution engine)
 */

import type { ExtendedLogicalIR } from '../logical-ir/schemas/extended-ir-types'
import type { CompilerRule } from './rules/CompilerRule'
import type { WorkflowStep } from '../../../pilot/types/pilot-dsl-types'
import type { PluginManagerV2 } from '../../../server/plugin-manager-v2'
import { createWorkflowValidator, type ValidationResult } from './validation/WorkflowValidator'

// ============================================================================
// Types
// ============================================================================

export interface CompilationResult {
  success: boolean
  workflow?: CompiledWorkflow
  errors?: string[]
  warnings?: string[]
  metadata?: {
    compilation_time_ms: number
    rule_used: string
    step_count: number
    deterministic_step_percentage: number
  }
  validation?: ValidationResult
}

export interface CompiledWorkflow {
  workflow_steps: WorkflowStep[]
  metadata: {
    ir_version: string
    goal: string
    compiled_at: string
    compiler_version: string
  }
}

export interface CompilerContext {
  ir: ExtendedLogicalIR
  available_plugins: string[]
  plugin_manager?: PluginManagerV2
  user_id?: string
  agent_id?: string
}

// ============================================================================
// Main Compiler Class
// ============================================================================

export class LogicalIRCompiler {
  private rules: CompilerRule[]
  private pluginManager?: PluginManagerV2
  private compilerVersion: string = '1.0.0'

  constructor(rules: CompilerRule[] = [], pluginManager?: PluginManagerV2) {
    console.log('[Compiler] Initializing with', rules.length, 'rules')
    this.rules = rules
    this.pluginManager = pluginManager

    if (pluginManager) {
      console.log('[Compiler] ✓ PluginManagerV2 integration enabled')
    } else {
      console.log('[Compiler] ⚠ Running without PluginManagerV2 (legacy mode)')
    }
  }

  /**
   * Add a compiler rule
   */
  addRule(rule: CompilerRule): void {
    console.log('[Compiler] Adding rule:', rule.name)
    this.rules.push(rule)
  }

  /**
   * Remove a compiler rule
   */
  removeRule(ruleName: string): void {
    console.log('[Compiler] Removing rule:', ruleName)
    this.rules = this.rules.filter(r => r.name !== ruleName)
  }

  /**
   * Get all registered rules
   */
  getRules(): CompilerRule[] {
    return [...this.rules]
  }

  /**
   * Main compilation method
   */
  async compile(ir: ExtendedLogicalIR, context?: Partial<CompilerContext>): Promise<CompilationResult> {
    console.log('[Compiler] =====================================')
    console.log('[Compiler] Starting compilation...')
    console.log('[Compiler] IR goal:', ir.goal)
    console.log('[Compiler] IR version:', ir.ir_version)

    const startTime = Date.now()

    try {
      // Build full context
      const fullContext: CompilerContext = {
        ir,
        available_plugins: context?.available_plugins || [],
        plugin_manager: this.pluginManager,
        user_id: context?.user_id,
        agent_id: context?.agent_id
      }

      // Find matching rule
      console.log('[Compiler] Checking', this.rules.length, 'compiler rules...')
      const matchingRule = this.findMatchingRule(ir)

      if (!matchingRule) {
        console.log('[Compiler] ✗ No matching compiler rule found')
        return {
          success: false,
          errors: [
            'No compiler rule supports this IR pattern',
            'This may indicate an unsupported workflow type',
            `IR structure: data_sources=${ir.data_sources.length}, filters=${ir.filters?.length || 0}, ai_ops=${ir.ai_operations?.length || 0}, loops=${ir.loops?.length || 0}`
          ]
        }
      }

      console.log('[Compiler] ✓ Matched rule:', matchingRule.name)
      console.log('[Compiler] Rule description:', matchingRule.description)

      // Compile using matched rule
      console.log('[Compiler] Compiling with rule...')
      const workflowSteps = await matchingRule.compile(fullContext)

      console.log('[Compiler] ✓ Compilation successful')
      console.log('[Compiler] Generated', workflowSteps.length, 'workflow steps')

      // Validate the compiled workflow
      console.log('[Compiler] Validating workflow...')
      const validator = createWorkflowValidator()
      const validationResult = validator.validate(workflowSteps, ir)

      // Calculate metrics
      const metrics = this.calculateMetrics(workflowSteps)
      const compilationTime = Date.now() - startTime

      console.log('[Compiler] Deterministic steps:', metrics.deterministicPercentage.toFixed(1) + '%')
      console.log('[Compiler] Compilation time:', compilationTime + 'ms')
      console.log('[Compiler] =====================================')

      // If validation failed, return error
      if (!validationResult.valid) {
        return {
          success: false,
          errors: validationResult.errors.map(e => e.message),
          validation: validationResult,
          metadata: {
            compilation_time_ms: compilationTime,
            rule_used: matchingRule.name,
            step_count: workflowSteps.length,
            deterministic_step_percentage: metrics.deterministicPercentage
          }
        }
      }

      return {
        success: true,
        workflow: {
          workflow_steps: workflowSteps,
          metadata: {
            ir_version: ir.ir_version,
            goal: ir.goal,
            compiled_at: new Date().toISOString(),
            compiler_version: this.compilerVersion
          }
        },
        validation: validationResult,
        metadata: {
          compilation_time_ms: compilationTime,
          rule_used: matchingRule.name,
          step_count: workflowSteps.length,
          deterministic_step_percentage: metrics.deterministicPercentage
        }
      }
    } catch (error) {
      console.error('[Compiler] ✗ Compilation error:', error)
      console.log('[Compiler] =====================================')

      return {
        success: false,
        errors: [
          'Compilation failed',
          error instanceof Error ? error.message : 'Unknown error'
        ]
      }
    }
  }

  /**
   * Find the first rule that supports the given IR
   */
  private findMatchingRule(ir: ExtendedLogicalIR): CompilerRule | null {
    for (const rule of this.rules) {
      console.log('[Compiler] Testing rule:', rule.name)
      try {
        const supports = rule.supports(ir)
        console.log(`[Compiler] Rule "${rule.name}" supports: ${supports}`)
        if (supports) {
          return rule
        }
      } catch (error) {
        console.warn(`[Compiler] Rule "${rule.name}" threw error during supports check:`, error)
      }
    }
    return null
  }

  /**
   * Calculate workflow metrics
   */
  private calculateMetrics(steps: WorkflowStep[]): {
    totalSteps: number
    deterministicSteps: number
    aiSteps: number
    deterministicPercentage: number
  } {
    const totalSteps = steps.length
    const aiSteps = steps.filter(s => s.type === 'ai_processing').length
    const deterministicSteps = totalSteps - aiSteps
    const deterministicPercentage = totalSteps > 0 ? (deterministicSteps / totalSteps) * 100 : 100

    return {
      totalSteps,
      deterministicSteps,
      aiSteps,
      deterministicPercentage
    }
  }

  /**
   * Validate IR before compilation
   */
  async validateBeforeCompilation(ir: ExtendedLogicalIR): Promise<{
    valid: boolean
    errors: string[]
    warnings: string[]
  }> {
    console.log('[Compiler] Running pre-compilation validation...')

    const errors: string[] = []
    const warnings: string[] = []

    // Check if any rule supports this IR
    const hasMatchingRule = this.findMatchingRule(ir) !== null
    if (!hasMatchingRule) {
      errors.push('No compiler rule supports this IR pattern')
    }

    // Check for common issues
    if (ir.data_sources.length === 0) {
      errors.push('IR must have at least one data source')
    }

    if (ir.delivery.length === 0) {
      errors.push('IR must have at least one delivery method')
    }

    // Check for AI operations without output schema
    if (ir.ai_operations) {
      for (const aiOp of ir.ai_operations) {
        if (!aiOp.output_schema) {
          errors.push(`AI operation "${aiOp.type}" missing output_schema`)
        }
      }
    }

    // Warnings for optimization opportunities
    if (ir.ai_operations && ir.ai_operations.length > ir.data_sources.length * 2) {
      warnings.push(`High AI operation count (${ir.ai_operations.length}) may slow execution`)
    }

    console.log(`[Compiler] Pre-compilation validation: ${errors.length} errors, ${warnings.length} warnings`)

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Get compilation plan (dry run)
   */
  async getCompilationPlan(ir: ExtendedLogicalIR): Promise<{
    rule: string | null
    estimatedSteps: number
    deterministicPercentage: number
    warnings: string[]
  }> {
    console.log('[Compiler] Generating compilation plan (dry run)...')

    const matchingRule = this.findMatchingRule(ir)

    if (!matchingRule) {
      return {
        rule: null,
        estimatedSteps: 0,
        deterministicPercentage: 0,
        warnings: ['No matching compiler rule found']
      }
    }

    // Estimate step count
    let estimatedSteps = 1 // At least 1 step (data source)
    estimatedSteps += ir.filters?.length || 0
    estimatedSteps += ir.transforms?.length || 0
    estimatedSteps += ir.ai_operations?.length || 0
    estimatedSteps += ir.conditionals?.length || 0
    estimatedSteps += ir.loops?.length || 0
    estimatedSteps += ir.delivery.length

    const aiSteps = ir.ai_operations?.length || 0
    const deterministicPercentage = estimatedSteps > 0
      ? ((estimatedSteps - aiSteps) / estimatedSteps) * 100
      : 100

    const warnings: string[] = []
    if (deterministicPercentage < 60) {
      warnings.push('High AI operation usage - consider using deterministic operations where possible')
    }

    console.log('[Compiler] Compilation plan:', {
      rule: matchingRule.name,
      estimatedSteps,
      deterministicPercentage: deterministicPercentage.toFixed(1) + '%'
    })

    return {
      rule: matchingRule.name,
      estimatedSteps,
      deterministicPercentage,
      warnings
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create compiler with default rules
 */
export async function createCompiler(pluginManager?: PluginManagerV2): Promise<LogicalIRCompiler> {
  console.log('[Compiler] Creating compiler with default rules...')

  const compiler = new LogicalIRCompiler([], pluginManager)

  // Import rules dynamically to avoid circular dependencies
  const { createTabularGroupedDeliveryRule } = await import('./rules/TabularGroupedDeliveryRule')
  const { ConditionalBranchingRule } = await import('./rules/ConditionalBranchingRule')
  const { ParallelProcessingRule } = await import('./rules/ParallelProcessingRule')
  const { APIDataSourceWithLoopsRule } = await import('./rules/APIDataSourceWithLoopsRule')
  const { LinearTransformDeliveryRule } = await import('./rules/LinearTransformDeliveryRule')
  const { createSimpleWorkflowRule } = await import('./rules/SimpleWorkflowRule')

  // Add rules in priority order (higher priority first)
  // This order is CRITICAL - more specific rules must come before general ones
  compiler.addRule(createTabularGroupedDeliveryRule())  // Priority: 200 - Tabular + partitioning + grouping
  compiler.addRule(new ConditionalBranchingRule())      // Priority: 150 - Conditional branching (if/then/else)
  compiler.addRule(new ParallelProcessingRule())        // Priority: 120 - Parallel processing without AI
  compiler.addRule(new APIDataSourceWithLoopsRule())    // Priority: 100 - API + loops + AI operations
  compiler.addRule(new LinearTransformDeliveryRule())   // Priority: 80  - Simple linear workflows
  compiler.addRule(createSimpleWorkflowRule())          // Priority: 50  - Legacy fallback (deprecated)

  console.log('[Compiler] Compiler created with', compiler.getRules().length, 'rules')

  return compiler
}

/**
 * Quick compile function
 */
export async function compileIR(
  ir: ExtendedLogicalIR,
  context?: Partial<CompilerContext>
): Promise<CompilationResult> {
  const compiler = await createCompiler()
  return await compiler.compile(ir, context)
}
