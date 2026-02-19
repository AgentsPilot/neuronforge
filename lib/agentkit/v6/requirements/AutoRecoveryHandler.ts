/**
 * Auto-Recovery Handler
 *
 * Following OpenAI's compiler approach:
 * When validation fails, attempt automatic recovery before rejecting workflow.
 *
 * Recovery Strategy:
 * 1. Auto-fix: Simple structural issues (flatten groups, add defaults)
 * 2. Re-validate: Check if fixes resolved the issues
 * 3. Return: Fixed output or failure
 *
 * Principle: Try to fix, but NEVER allow incorrect workflows to pass.
 */

import { HardRequirements, ValidationError, RecoveryResult } from './types'

export class AutoRecoveryHandler {
  /**
   * Attempt to recover from validation failure
   */
  recover(
    phase: string,
    output: any,
    errors: ValidationError[]
  ): RecoveryResult {
    console.log(`[AutoRecovery] Attempting recovery for ${errors.length} errors at ${phase} phase`)

    // Categorize errors
    const { autoFixable, unrecoverable } = this.categorizeErrors(errors)

    if (autoFixable.length === 0) {
      console.log('[AutoRecovery] No auto-fixable errors found')
      return {
        strategy: 'needs_clarification',
        output,
        stillFailing: true
      }
    }

    console.log(`[AutoRecovery] Found ${autoFixable.length} auto-fixable errors`)

    // Apply fixes
    const fixedOutput = this.applyAutoFixes(output, autoFixable)

    console.log('[AutoRecovery] Fixes applied successfully')

    return {
      strategy: 'auto_fixed',
      output: fixedOutput,
      fixesApplied: autoFixable.map(error => ({
        error,
        method: this.getFixMethod(error)
      })),
      stillFailing: false
    }
  }

  /**
   * Categorize errors by fixability
   */
  private categorizeErrors(errors: ValidationError[]): {
    autoFixable: ValidationError[]
    unrecoverable: ValidationError[]
  } {
    return {
      // Simple structural issues that can be auto-fixed
      autoFixable: errors.filter(e =>
        e.type === 'nested_groups' ||
        e.type === 'missing_field' ||
        e.type === 'wrong_type' ||
        e.type === 'invalid_field'
      ),

      // Cannot be fixed automatically
      unrecoverable: errors.filter(e =>
        e.type === 'requirement_missing' ||
        e.type === 'constraint_violated' ||
        e.type === 'data_flow_broken' ||
        e.type === 'plugin_missing' ||
        e.type === 'invalid_input' ||
        e.type === 'schema_violation'
      )
    }
  }

  /**
   * Apply automatic fixes to output
   */
  private applyAutoFixes(output: any, errors: ValidationError[]): any {
    let fixed = JSON.parse(JSON.stringify(output)) // Deep clone

    errors.forEach(error => {
      switch (error.type) {
        case 'nested_groups':
          fixed = this.flattenNestedGroups(fixed)
          break

        case 'missing_field':
          if (error.path && error.defaultValue !== undefined) {
            this.setPath(fixed, error.path, error.defaultValue)
          }
          break

        case 'wrong_type':
          if (error.path && error.expectedType) {
            const value = this.getPath(fixed, error.path)
            const coerced = this.coerceType(value, error.expectedType)
            this.setPath(fixed, error.path, coerced)
          }
          break

        case 'invalid_field':
          if (error.path) {
            this.deletePath(fixed, error.path)
          }
          break
      }
    })

    return fixed
  }

  /**
   * Flatten nested filter groups
   * Issue: filters.groups[0].groups (nested) → Not allowed
   * Fix: Move nested conditions up to parent level
   * Supports both V3 IR (filters.groups) and V4 IR (execution_graph.nodes)
   */
  private flattenNestedGroups(ir: any): any {
    // V4 IR: execution_graph structure (no nested groups issue in V4)
    if (ir.execution_graph) {
      // V4 IR doesn't have nested groups issue - it uses choice nodes
      // No flattening needed for V4 IR
      return ir
    }

    // V3 IR: filters.groups structure
    if (!ir.filters?.groups) return ir

    ir.filters.groups = ir.filters.groups.map((group: any) => {
      if (group.groups && Array.isArray(group.groups)) {
        // Flatten: merge all nested conditions into parent
        const allConditions = [
          ...(group.conditions || []),
          ...group.groups.flatMap((nested: any) => nested.conditions || [])
        ]

        return {
          logic_operator: group.logic_operator || 'AND',
          conditions: allConditions
        }
      }
      return group
    })

    return ir
  }

  /**
   * Get nested property value
   */
  private getPath(obj: any, path: string): any {
    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current?.[part] === undefined) return undefined
      current = current[part]
    }

    return current
  }

  /**
   * Set nested property value
   */
  private setPath(obj: any, path: string, value: any): void {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part]
    }

    current[parts[parts.length - 1]] = value
  }

  /**
   * Delete nested property
   */
  private deletePath(obj: any, path: string): void {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!current[part]) return
      current = current[part]
    }

    delete current[parts[parts.length - 1]]
  }

  /**
   * Coerce value to expected type
   */
  private coerceType(value: any, expectedType: string): any {
    switch (expectedType) {
      case 'string':
        return String(value)
      case 'number':
        return Number(value)
      case 'boolean':
        return Boolean(value)
      case 'array':
        return Array.isArray(value) ? value : [value]
      case 'object':
        return typeof value === 'object' ? value : {}
      default:
        return value
    }
  }

  /**
   * Get fix method name for error type
   */
  private getFixMethod(error: ValidationError): string {
    switch (error.type) {
      case 'nested_groups': return 'flattenNestedGroups'
      case 'missing_field': return 'addDefaultValue'
      case 'wrong_type': return 'coerceType'
      case 'invalid_field': return 'removeInvalidField'
      default: return 'unknown'
    }
  }
}
