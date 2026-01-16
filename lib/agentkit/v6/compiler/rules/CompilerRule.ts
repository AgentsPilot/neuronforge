/**
 * Compiler Rule Interface
 *
 * Compiler rules are pattern matchers that determine how to compile
 * specific IR patterns into PILOT_DSL workflows.
 *
 * Each rule:
 * 1. Declares what IR patterns it supports
 * 2. Compiles matching IR into workflow steps
 * 3. Uses resolvers to map IR fields → steps
 *
 * Rules are checked in order until one matches.
 */

import type { ExtendedLogicalIR } from '../../logical-ir/schemas/extended-ir-types'
import type { CompilerContext } from '../LogicalIRCompiler'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'

// ============================================================================
// Compiler Rule Interface
// ============================================================================

export interface CompilerRule {
  /**
   * Unique rule name for identification
   */
  name: string

  /**
   * Human-readable description of what this rule handles
   */
  description: string

  /**
   * Priority (higher = checked first)
   * Default: 100
   * Use higher for more specific patterns, lower for fallbacks
   */
  priority: number

  /**
   * Check if this rule can compile the given IR
   *
   * @param ir - The Logical IR to check
   * @returns true if this rule can handle the IR
   *
   * Example:
   * ```typescript
   * supports(ir: ExtendedLogicalIR): boolean {
   *   return ir.data_sources.length === 1 &&
   *          ir.data_sources[0].type === 'tabular' &&
   *          ir.partitions !== undefined &&
   *          ir.grouping?.emit_per_group === true
   * }
   * ```
   */
  supports(ir: ExtendedLogicalIR): boolean

  /**
   * Compile the IR into workflow steps
   *
   * @param context - Compilation context with IR and metadata
   * @returns Array of workflow steps in PILOT_DSL format
   *
   * Example:
   * ```typescript
   * async compile(context: CompilerContext): Promise<WorkflowStep[]> {
   *   const steps: WorkflowStep[] = []
   *
   *   // Use resolvers to map IR → steps
   *   steps.push(...await this.dataSourceResolver.resolve(context.ir.data_sources))
   *   steps.push(...await this.transformResolver.resolve(context.ir.filters))
   *   steps.push(...await this.deliveryResolver.resolve(context.ir.delivery))
   *
   *   return steps
   * }
   * ```
   */
  compile(context: CompilerContext): Promise<WorkflowStep[]>

  /**
   * Optional: Validate IR before compilation
   *
   * @param ir - The Logical IR to validate
   * @returns Validation result with errors/warnings
   */
  validate?(ir: ExtendedLogicalIR): {
    valid: boolean
    errors?: string[]
    warnings?: string[]
  }

  /**
   * Optional: Get estimated compilation metrics
   *
   * @param ir - The Logical IR
   * @returns Estimated step count and characteristics
   */
  estimate?(ir: ExtendedLogicalIR): {
    estimatedSteps: number
    estimatedAISteps: number
    estimatedDeterministicSteps: number
  }
}

// ============================================================================
// Base Compiler Rule (Abstract Class)
// ============================================================================

/**
 * Base class for compiler rules with common utilities
 */
export abstract class BaseCompilerRule implements CompilerRule {
  abstract name: string
  abstract description: string
  priority: number = 100

  abstract supports(ir: ExtendedLogicalIR): boolean
  abstract compile(context: CompilerContext): Promise<WorkflowStep[]>

  /**
   * Generate unique step ID
   */
  protected generateStepId(prefix: string, index: number): string {
    return `${prefix}_${index + 1}`
  }

  /**
   * Check if IR has specific feature
   */
  protected hasFilters(ir: ExtendedLogicalIR): boolean {
    return ir.filters !== undefined && ir.filters.length > 0
  }

  protected hasTransforms(ir: ExtendedLogicalIR): boolean {
    return ir.transforms !== undefined && ir.transforms.length > 0
  }

  protected hasAIOperations(ir: ExtendedLogicalIR): boolean {
    return ir.ai_operations !== undefined && ir.ai_operations.length > 0
  }

  protected hasConditionals(ir: ExtendedLogicalIR): boolean {
    return ir.conditionals !== undefined && ir.conditionals.length > 0
  }

  protected hasLoops(ir: ExtendedLogicalIR): boolean {
    return ir.loops !== undefined && ir.loops.length > 0
  }

  protected hasPartitions(ir: ExtendedLogicalIR): boolean {
    return ir.partitions !== undefined && ir.partitions.length > 0
  }

  protected hasGrouping(ir: ExtendedLogicalIR): boolean {
    return ir.grouping !== undefined
  }

  /**
   * Check data source type
   */
  protected isTabularDataSource(ir: ExtendedLogicalIR): boolean {
    return ir.data_sources.some(ds => ds.type === 'tabular')
  }

  protected isAPIDataSource(ir: ExtendedLogicalIR): boolean {
    return ir.data_sources.some(ds => ds.type === 'api')
  }

  protected isWebhookDataSource(ir: ExtendedLogicalIR): boolean {
    return ir.data_sources.some(ds => ds.type === 'webhook')
  }

  /**
   * Check delivery type
   */
  protected hasEmailDelivery(ir: ExtendedLogicalIR): boolean {
    return ir.delivery.some(d => d.method === 'email')
  }

  protected hasSlackDelivery(ir: ExtendedLogicalIR): boolean {
    return ir.delivery.some(d => d.method === 'slack')
  }

  /**
   * Get single data source (for rules that expect only one)
   */
  protected getSingleDataSource(ir: ExtendedLogicalIR) {
    if (ir.data_sources.length !== 1) {
      throw new Error(`Expected single data source, found ${ir.data_sources.length}`)
    }
    return ir.data_sources[0]
  }

  /**
   * Count total operations
   */
  protected countOperations(ir: ExtendedLogicalIR): number {
    let count = 0
    count += ir.filters?.length || 0
    count += ir.transforms?.length || 0
    count += ir.ai_operations?.length || 0
    count += ir.conditionals?.length || 0
    count += ir.loops?.length || 0
    return count
  }

  /**
   * Log rule execution
   */
  protected log(message: string): void {
    console.log(`[${this.name}] ${message}`)
  }

  protected logError(message: string, error?: any): void {
    console.error(`[${this.name}] ✗ ${message}`, error)
  }

  protected logSuccess(message: string): void {
    console.log(`[${this.name}] ✓ ${message}`)
  }
}

// ============================================================================
// Rule Registry Utilities
// ============================================================================

/**
 * Sort rules by priority (higher first)
 */
export function sortRulesByPriority(rules: CompilerRule[]): CompilerRule[] {
  return [...rules].sort((a, b) => b.priority - a.priority)
}

/**
 * Find rule by name
 */
export function findRuleByName(rules: CompilerRule[], name: string): CompilerRule | undefined {
  return rules.find(r => r.name === name)
}

/**
 * Get rules that support a given IR
 */
export function getMatchingRules(rules: CompilerRule[], ir: ExtendedLogicalIR): CompilerRule[] {
  return rules.filter(r => {
    try {
      return r.supports(ir)
    } catch (error) {
      console.warn(`Rule ${r.name} threw error during supports check:`, error)
      return false
    }
  })
}
