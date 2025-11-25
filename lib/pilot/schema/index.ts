/**
 * Pilot Schema Module
 *
 * Exports:
 * - PILOT_DSL_SCHEMA: JSON Schema for OpenAI structured outputs
 * - validateWorkflowStructure: Runtime validation function
 * - validateWorkflowWithUserMessage: Validation with user-friendly messages
 *
 * @module lib/pilot/schema
 */

export { PILOT_DSL_SCHEMA, getSchemaSize, getSchemaStats } from './pilot-dsl-schema';
export {
  validateWorkflowStructure,
  validateWorkflowWithUserMessage,
  type ValidationResult
} from './runtime-validator';
