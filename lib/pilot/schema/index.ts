/**
 * Pilot Schema Module
 *
 * Exports:
 * - PILOT_DSL_SCHEMA: JSON Schema for OpenAI structured outputs
 * - validateWorkflowStructure: workflow-structure validation (pre-save AND
 *   optionally pre-flight via Pilot runtime — see Phase 6 — Tier 3 Fix #11)
 * - validateWorkflowWithUserMessage: validation with user-friendly messages
 *
 * @module lib/pilot/schema
 */

export { PILOT_DSL_SCHEMA, getSchemaSize, getSchemaStats } from './pilot-dsl-schema';
export {
  validateWorkflowStructure,
  validateWorkflowWithUserMessage,
  type ValidationResult
} from './workflow-structure-validator';
