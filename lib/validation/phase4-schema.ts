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
 * Branch output for control/branching steps
 * Used when a step has multiple possible next steps based on conditions
 */
export const BranchOutputSchema = z.object({
  type: z.string(),
  next_step: z.string().regex(/^step\d+(_\d+)*$/, 'next_step must reference a valid step ID')
});

/**
 * Step output value can be:
 * - A string type label (e.g., "object[]", "string", "GmailMessage[]")
 * - A branch object with type and next_step for branching control steps
 */
export const StepOutputValueSchema = z.union([
  z.string(),
  BranchOutputSchema
]);

/**
 * Step output definition
 * Supports both simple string outputs and branch objects for routing
 * Reserved field: "next_step" - points to the next step ID
 */
export const StepOutputSchema = z.record(z.string(), StepOutputValueSchema);

/**
 * Base step fields shared by all step types
 * The v13 prompt defines a unified structure for all steps with mandatory routing
 */
const BaseStepFields = {
  id: z.string().regex(/^step\d+(_\d+)*$/, 'Step ID must be in format "stepN", "stepN_M", or "stepN_M_P" for deeply nested steps'),
  description: z.string().min(1),
  plugin: z.string().optional(),  // Present for operation and some transform steps
  action: z.string().optional(),  // Present for operation and some transform steps
  inputs: z.record(z.string(), StepInputSchema).optional(),
  outputs: StepOutputSchema.optional(),
  is_last_step: z.boolean().optional(),  // Marks the final step(s) - must be true and no next_step
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
 * Control configuration for loops (for_each)
 */
export const ForEachControlSchema = z.object({
  type: z.literal('for_each'),
  item_name: z.string().min(1),      // Variable name for current item (e.g., "email_payload")
  collection_ref: z.string().min(1), // Reference to array to iterate (e.g., "step3.emails")
});

/**
 * Control configuration for conditionals (if/else)
 */
export const IfControlSchema = z.object({
  type: z.literal('if'),
  condition: z.string().min(1),      // Condition expression (e.g., "step5.missing_owner.length > 0")
});

/**
 * Legacy control configuration (for backwards compatibility)
 */
export const LegacyControlSchema = z.object({
  type: z.string().min(1),
  condition: z.string().optional(),
  item_name: z.string().optional(),
  collection_ref: z.string().optional(),
});

/**
 * Union of control configurations
 */
export const ControlConfigSchema = z.union([
  ForEachControlSchema,
  IfControlSchema,
  LegacyControlSchema,
]);

/**
 * Base control step fields (without nested steps - used for lazy reference)
 */
const ControlStepBaseFields = {
  id: z.string().regex(/^step\d+(_\d+)*$/, 'Step ID must be in format "stepN", "stepN_M", or "stepN_M_P" for deeply nested steps'),
  kind: z.literal('control'),
  description: z.string().optional(),
  control: ControlConfigSchema.optional(),
  // Control steps may also have plugin/action for compatibility
  plugin: z.string().optional(),
  action: z.string().optional(),
  inputs: z.record(z.string(), StepInputSchema).optional(),
  outputs: StepOutputSchema.optional(),
  is_last_step: z.boolean().optional(),  // Marks the final step(s) - must be true and no next_step
};

/**
 * Control step - conditional logic, loops, etc.
 * Uses lazy() for recursive nested steps
 */
export const ControlStepSchema: z.ZodType<any> = z.lazy(() => z.object({
  ...ControlStepBaseFields,
  // Nested steps for loop body or if-then branch
  steps: z.array(TechnicalWorkflowStepSchema).optional(),
  // Nested steps for if-else branch
  else_steps: z.array(TechnicalWorkflowStepSchema).optional(),
}));

/**
 * Union of all step types
 * Note: Using z.union instead of z.discriminatedUnion because z.lazy() schemas
 * don't work with discriminatedUnion (Zod can't introspect lazy schema shapes).
 * The 'kind' field still provides runtime discrimination.
 */
export const TechnicalWorkflowStepSchema: z.ZodType<any> = z.lazy(() => z.union([
  OperationStepSchema,
  TransformStepSchema,
  ControlStepSchema,
]));

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
export type OperationStep = z.infer<typeof OperationStepSchema>;
export type TransformStep = z.infer<typeof TransformStepSchema>;
export type StepInput = z.infer<typeof StepInputSchema>;
export type TechnicalInputRequired = z.infer<typeof TechnicalInputRequiredSchema>;
export type Feasibility = z.infer<typeof FeasibilitySchema>;
export type BlockingIssue = z.infer<typeof BlockingIssueSchema>;
export type FeasibilityWarning = z.infer<typeof FeasibilityWarningSchema>;
export type Phase4Metadata = z.infer<typeof Phase4MetadataSchema>;
export type ForEachControl = z.infer<typeof ForEachControlSchema>;
export type IfControl = z.infer<typeof IfControlSchema>;

/**
 * Branch output type for routing in control steps
 */
export interface BranchOutput {
  type: string;
  next_step: string;
}

/**
 * Step output value - can be a string type label or a branch object
 */
export type StepOutputValue = string | BranchOutput;

/**
 * Control step with explicit nested steps support
 */
export interface ControlStep {
  id: string;
  kind: 'control';
  description?: string;
  control?: {
    type: string;
    condition?: string;      // For 'if' type
    item_name?: string;      // For 'for_each' type
    collection_ref?: string; // For 'for_each' type
  };
  plugin?: string;
  action?: string;
  inputs?: Record<string, StepInput>;
  outputs?: Record<string, StepOutputValue>;  // Supports string or branch objects with next_step
  is_last_step?: boolean;                      // Marks final step(s)
  steps?: TechnicalWorkflowStep[];             // Loop body or if-then branch
  else_steps?: TechnicalWorkflowStep[];        // If-else branch
}

/**
 * Union of all technical workflow step types
 */
export type TechnicalWorkflowStep = OperationStep | TransformStep | ControlStep;

/**
 * Type guards for step kinds
 */
export function isOperationStep(step: TechnicalWorkflowStep): step is OperationStep {
  return step.kind === 'operation';
}

export function isTransformStep(step: TechnicalWorkflowStep): step is TransformStep {
  return step.kind === 'transform';
}

export function isControlStep(step: TechnicalWorkflowStep): step is ControlStep {
  return step.kind === 'control';
}

/**
 * Type guards for control step types
 */
export function isForEachControl(step: ControlStep): boolean {
  return step.control?.type === 'for_each';
}

export function isIfControl(step: ControlStep): boolean {
  return step.control?.type === 'if';
}

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