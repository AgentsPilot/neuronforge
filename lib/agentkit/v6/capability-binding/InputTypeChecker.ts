/**
 * InputTypeChecker — Phase 2b input-type compatibility validation
 *
 * After CapabilityBinderV2 picks a candidate action and DataSchemaBuilder
 * constructs the data_schema, this checker validates that the action's
 * input-type requirements (from_type) are compatible with the source
 * variable's semantic type (semantic_type on the SchemaField).
 *
 * Design doc: docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md (Deep Dive C, §C.5)
 */

import type { ActionDefinition } from '@/lib/types/plugin-types'
import type { WorkflowDataSchema, SchemaField } from '../logical-ir/schemas/workflow-data-schema'
import {
  isTypeCompatible,
  getActionInputTypeConstraints,
  FILE_PROPERTY_MARKERS,
  TEXT_PROPERTY_MARKERS,
  PRIMARY_CONTENT_PARAMS,
  SEMANTIC_FILE_ATTACHMENT,
  SEMANTIC_TEXT_CONTENT,
} from './input-type-compat'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ module: 'InputTypeChecker', service: 'V6' })

export interface InputTypeViolation {
  param_name: string
  required_from_type: string
  source_ref: string
  source_semantic_type: string | undefined
  reason: string
}

export interface InputTypeCheckResult {
  compatible: boolean
  violations: InputTypeViolation[]
}

export class InputTypeChecker {
  /**
   * Check if a bound action's input-type requirements are compatible with
   * the source data available in the workflow's data_schema.
   *
   * @param action      The plugin action definition (has parameters with from_type)
   * @param stepInputs  The step's declared inputs (RefNames from IntentContract)
   * @param dataSchema  The workflow data schema built by DataSchemaBuilder
   * @param stepId      For logging
   */
  check(
    action: ActionDefinition,
    stepInputs: string[] | undefined,
    dataSchema: WorkflowDataSchema | undefined,
    stepId: string,
  ): InputTypeCheckResult {
    const violations: InputTypeViolation[] = []

    // Get this action's input-type constraints
    const constraints = getActionInputTypeConstraints(action.parameters?.properties)
    if (constraints.length === 0) {
      // No from_type constraints on any param → compatible by default
      return { compatible: true, violations: [] }
    }

    // If no data_schema or no step inputs, we can't check → pass (warn separately)
    if (!dataSchema?.slots || !stepInputs || stepInputs.length === 0) {
      logger.debug(
        { stepId, constraintCount: constraints.length },
        '[InputTypeChecker] Cannot check — no data_schema or step inputs. Passing by default.'
      )
      return { compatible: true, violations: [] }
    }

    // Only check constraints on primary content/data params (defined in input-type-compat.ts).
    // Non-primary params (folder_id, parent_id, labels, attachments) get their
    // values from config or other variables, not from the step's inputs[].
    const primaryConstraints = constraints.filter(c => PRIMARY_CONTENT_PARAMS.has(c.param))
    if (primaryConstraints.length === 0) {
      // No primary content param has a from_type constraint → compatible
      return { compatible: true, violations: [] }
    }

    // For each primary constrained param, check against step inputs
    for (const { param, from_type } of primaryConstraints) {
      for (const inputRef of stepInputs) {
        const sourceSlot = dataSchema.slots[inputRef]
        if (!sourceSlot) continue

        const sourceSemanticType = resolveSemanticType(sourceSlot.schema, inputRef, dataSchema)
        const compat = isTypeCompatible(from_type, sourceSemanticType)

        if (!compat.compatible) {
          violations.push({
            param_name: param,
            required_from_type: from_type,
            source_ref: inputRef,
            source_semantic_type: sourceSemanticType,
            reason: compat.reason || `from_type="${from_type}" incompatible with source semantic_type="${sourceSemanticType}"`,
          })
        }
      }
    }

    if (violations.length > 0) {
      logger.info(
        {
          stepId,
          violationCount: violations.length,
          violations: violations.map(v => `${v.param_name}: ${v.reason}`),
        },
        '[InputTypeChecker] Input-type violations found'
      )
    }

    return {
      compatible: violations.length === 0,
      violations,
    }
  }
}

/**
 * Resolve the semantic type of a source slot.
 *
 * Priority:
 * 1. Explicit `semantic_type` on the SchemaField (set from plugin `x-semantic-type` annotation)
 * 2. Infer from schema structure — walk properties looking for known markers
 * 3. For arrays, resolve the item type
 */
function resolveSemanticType(
  schema: SchemaField,
  slotName: string,
  dataSchema: WorkflowDataSchema,
): string | undefined {
  // 1. Explicit annotation
  if (schema.semantic_type) {
    return schema.semantic_type
  }

  // 2. For arrays, resolve item type
  if (schema.type === 'array' && schema.items) {
    return resolveSemanticType(schema.items, slotName, dataSchema)
  }

  // 3. Infer from property markers (same heuristic as WP-12's tactical fix,
  //    but now centralized and replaceable by annotations over time)
  if (schema.type === 'object' && schema.properties) {
    const keys = Object.keys(schema.properties)

    const hasFile = keys.some(k => FILE_PROPERTY_MARKERS.has(k))
    const hasText = keys.some(k => TEXT_PROPERTY_MARKERS.has(k))

    if (hasFile && !hasText) return SEMANTIC_FILE_ATTACHMENT
    if (hasText && !hasFile) return SEMANTIC_TEXT_CONTENT
    if (hasFile && hasText) return SEMANTIC_TEXT_CONTENT // email with attachments field is still text-primary
  }

  return undefined
}
