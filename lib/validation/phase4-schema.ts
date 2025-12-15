import { z } from 'zod';
import {
  AnalysisObjectSchema,
  EnhancedPromptSchema,
  Phase3MetadataSchema
} from './phase3-schema';

// ===== PHASE 4 SPECIFIC SCHEMAS =====

/**
 * Input source types for technical workflow steps
 */
export const InputSourceSchema = z.enum([
  'constant',      // Literal values from enhanced_prompt
  'from_step',     // Output from previous step
  'user_input',    // User must provide (e.g., sheet ID, channel ID)
  'env',           // Environment-level config
  'plugin_config'  // Plugin-level configuration
]);

/**
 * Step input parameter schema
 * Defines where the value comes from
 */
export const StepInputSchema = z.object({
  source: InputSourceSchema,
  value: z.any().optional(),           // For 'constant' source
  ref: z.string().optional(),          // For 'from_step' source (e.g., "step1.messages")
  key: z.string().optional(),          // For 'user_input' source
  plugin: z.string().optional(),       // For 'user_input' source - which plugin needs this
  action: z.string().optional(),       // Optional - which action consumes this
});

/**
 * Step output definition
 */
export const StepOutputSchema = z.record(z.string(), z.string());

/**
 * Base step fields shared by all step types
 * The v11 prompt defines a unified structure for all steps
 */
const BaseStepFields = {
  id: z.string().regex(/^step\d+$/, 'Step ID must be in format "stepN"'),
  description: z.string().min(1),
  plugin: z.string().optional(),  // Present for operation and some transform steps
  action: z.string().optional(),  // Present for operation and some transform steps
  inputs: z.record(z.string(), StepInputSchema).optional(),
  outputs: StepOutputSchema.optional(),
};

/**
 * Operation step - maps to a real plugin action
 * Plugin and action are required for operation steps
 */
export const OperationStepSchema = z.object({
  ...BaseStepFields,
  kind: z.literal('operation'),
  plugin: z.string().min(1),  // Required for operation
  action: z.string().min(1),  // Required for operation
  inputs: z.record(z.string(), StepInputSchema),
  outputs: StepOutputSchema,
});

/**
 * Transform step - data transformation (e.g., LLM processing, filtering)
 * The v11 prompt uses the same structure as operation steps for transforms
 * (with plugin/action fields to identify the transform type)
 */
export const TransformStepSchema = z.object({
  ...BaseStepFields,
  kind: z.literal('transform'),
  // Transform steps may use plugin/action (e.g., chatgpt-research.research)
  // or operation: { type } for generic transforms
  plugin: z.string().optional(),
  action: z.string().optional(),
  operation: z.object({
    type: z.string().min(1),
  }).optional(),
  inputs: z.record(z.string(), StepInputSchema).optional(),
  outputs: StepOutputSchema.optional(),
});

/**
 * Control step - conditional logic, loops, etc.
 */
export const ControlStepSchema = z.object({
  id: z.string().regex(/^step\d+$/, 'Step ID must be in format "stepN"'),
  kind: z.literal('control'),
  description: z.string().optional(),
  control: z.object({
    type: z.string().min(1),       // e.g., "condition", "loop", "branch"
    condition: z.string().min(1),  // Human-readable condition description
  }).optional(),
  // Control steps may also have plugin/action for compatibility
  plugin: z.string().optional(),
  action: z.string().optional(),
  inputs: z.record(z.string(), StepInputSchema).optional(),
  outputs: StepOutputSchema.optional(),
});

/**
 * Union of all step types
 */
export const TechnicalWorkflowStepSchema = z.discriminatedUnion('kind', [
  OperationStepSchema,
  TransformStepSchema,
  ControlStepSchema,
]);

/**
 * Technical input required from user
 * These are surfaced to the UI for collection
 */
export const TechnicalInputRequiredSchema = z.object({
  key: z.string().min(1),              // Machine-friendly identifier (e.g., "slack_channel_id")
  plugin: z.string().min(1),           // Which plugin needs this input
  actions: z.array(z.string()).optional(), // Which actions use this input
  type: z.string().optional(),         // Suggested UI type (string, fileId, folderId)
  description: z.string().min(1),      // Human-friendly description for UI
});

/**
 * Blocking issue in feasibility check
 */
export const BlockingIssueSchema = z.object({
  type: z.string().min(1),            // e.g., "missing_plugin", "missing_operation", "unsupported_pattern"
  description: z.string().min(1),     // Human-readable description
});

/**
 * Warning in feasibility check (non-blocking)
 */
export const FeasibilityWarningSchema = z.object({
  type: z.string().min(1),            // e.g., "assumption", "expensive_operation", "data_shape"
  description: z.string().min(1),
});

/**
 * Feasibility assessment for the technical workflow
 */
export const FeasibilitySchema = z.object({
  can_execute: z.boolean(),
  blocking_issues: z.array(BlockingIssueSchema),
  warnings: z.array(FeasibilityWarningSchema),
});

/**
 * Phase 4 specific metadata fields
 */
export const Phase4MetadataExtensionSchema = z.object({
  can_execute: z.boolean(),
  needs_technical_inputs: z.boolean(),
  needs_user_feedback: z.boolean(),
});

/**
 * Extended metadata schema for Phase 4
 * Includes all Phase 3 fields plus Phase 4 specific fields
 * Note: phase4 is optional because LLM may not always include it
 */
export const Phase4MetadataSchema = Phase3MetadataSchema.extend({
  phase4: Phase4MetadataExtensionSchema.optional(),
});

/**
 * Complete Phase 4 response schema
 * Extends Phase 3 with technical workflow fields
 */
export const Phase4ResponseSchema = z.object({
  // Inherited from Phase 3 structure
  analysis: AnalysisObjectSchema,
  requiredServices: z.array(z.string()),
  missingPlugins: z.array(z.string()),
  pluginWarning: z.record(z.string(), z.string()),
  clarityScore: z.number().min(0).max(100),
  needsClarification: z.boolean().optional(),
  enhanced_prompt: EnhancedPromptSchema,
  conversationalSummary: z.string().min(1),
  suggestions: z.array(z.string()).optional(),

  // Phase 4 specific fields
  technical_workflow: z.array(TechnicalWorkflowStepSchema),
  technical_inputs_required: z.array(TechnicalInputRequiredSchema),
  feasibility: FeasibilitySchema,
  metadata: Phase4MetadataSchema,

  // Optional error field
  error: z.string().optional(),
});

/**
 * Infer TypeScript type from Zod schema
 */
export type ValidatedPhase4Response = z.infer<typeof Phase4ResponseSchema>;
export type TechnicalWorkflowStep = z.infer<typeof TechnicalWorkflowStepSchema>;
export type OperationStep = z.infer<typeof OperationStepSchema>;
export type TransformStep = z.infer<typeof TransformStepSchema>;
export type ControlStep = z.infer<typeof ControlStepSchema>;
export type StepInput = z.infer<typeof StepInputSchema>;
export type TechnicalInputRequired = z.infer<typeof TechnicalInputRequiredSchema>;
export type Feasibility = z.infer<typeof FeasibilitySchema>;
export type BlockingIssue = z.infer<typeof BlockingIssueSchema>;
export type FeasibilityWarning = z.infer<typeof FeasibilityWarningSchema>;
export type Phase4Metadata = z.infer<typeof Phase4MetadataSchema>;

/**
 * Normalize LLM response before validation.
 * Handles common LLM quirks like returning arrays where strings are expected.
 */
function normalizePhase4Response(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;

  const normalized = JSON.parse(JSON.stringify(data)); // Deep clone

  // Normalize resolved_user_inputs: convert array values to comma-separated strings
  if (
    normalized.enhanced_prompt?.specifics?.resolved_user_inputs &&
    Array.isArray(normalized.enhanced_prompt.specifics.resolved_user_inputs)
  ) {
    normalized.enhanced_prompt.specifics.resolved_user_inputs =
      normalized.enhanced_prompt.specifics.resolved_user_inputs.map((item: any) => {
        if (item && typeof item === 'object' && Array.isArray(item.value)) {
          // Convert array to comma-separated string
          return {
            ...item,
            value: item.value.join(', ')
          };
        }
        return item;
      });
  }

  return normalized;
}

/**
 * Validation helper with detailed error formatting
 */
export function validatePhase4Response(data: unknown): {
  success: boolean;
  data?: ValidatedPhase4Response;
  errors?: string[];
} {
  // Normalize the data to handle LLM quirks before validation
  const normalizedData = normalizePhase4Response(data);

  const result = Phase4ResponseSchema.safeParse(normalizedData);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format Zod errors for better debugging
  const errors = result.error.errors.map(err => {
    const path = err.path.join('.');
    return `${path}: ${err.message}`;
  });

  return { success: false, errors };
}

/**
 * Check if Phase 4 response indicates ready for agent generation
 * Based on v11 prompt readiness rules
 */
export function isPhase4ReadyForGeneration(response: ValidatedPhase4Response): boolean {
  // If phase4 metadata is missing, check feasibility instead
  const canExecute = response.metadata.phase4?.can_execute ?? response.feasibility.can_execute;
  const needsTechnicalInputs = response.metadata.phase4?.needs_technical_inputs ??
    (response.technical_inputs_required.length > 0);

  return (
    response.clarityScore === 100 &&
    response.missingPlugins.length === 0 &&
    Object.keys(response.pluginWarning).length === 0 &&
    canExecute === true &&
    needsTechnicalInputs === false
  );
}