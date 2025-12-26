import { z } from 'zod';
import {
  AnalysisObjectSchema,
  EnhancedPromptSchema,
  Phase3MetadataSchema
} from './phase3-schema';

// ===== PHASE 4 SPECIFIC SCHEMAS =====

/**
 * Deterministic transform types (no LLM required)
 * These transforms can be executed without calling an AI model
 */
export const DeterministicTransformTypes = [
  'filter',       // keep/remove items based on a boolean condition
  'map',          // reshape items and/or compute derived fields per item
  'sort',         // order items by one or more keys
  'group_by',     // bucket items into groups by a key
  'aggregate',    // compute metrics (count/sum/min/max/avg) over items or per group
  'reduce',       // fold a list into a single value using a deterministic rule
  'deduplicate',  // remove duplicates by one or more keys
  'flatten',      // convert nested structures into a flatter structure
  'pick_fields',  // select a subset of fields from objects
  'format',       // render data into a string or HTML/markdown structure
  'merge',        // combine two objects/arrays using a deterministic precedence rule
  'split',        // break a string/list into parts or partition items into named buckets
  'convert',      // coerce types (string→number/date/bool), normalize nulls, standardize formats
] as const;

/**
 * LLM-assisted transform types (requires AI processing)
 * These transforms require an LLM-capable service in requiredServices
 */
export const LLMAssistedTransformTypes = [
  'summarize_with_llm',   // produce a concise summary from text
  'classify_with_llm',    // assign labels/categories to text items
  'extract_with_llm',     // extract structured fields from unstructured text
  'analyze_with_llm',     // produce analysis/insights from text or mixed inputs
  'generate_with_llm',    // generate new text content from inputs/instructions
  'translate_with_llm',   // translate text between languages
  'enrich_with_llm',      // add inferred attributes/metadata to items using text understanding
] as const;

/**
 * All allowed transform types
 */
export const AllTransformTypes = [...DeterministicTransformTypes, ...LLMAssistedTransformTypes] as const;

/**
 * Zod schema for transform type validation
 */
export const TransformTypeSchema = z.enum(AllTransformTypes as unknown as [string, ...string[]]);

/**
 * Type for deterministic transforms
 */
export type DeterministicTransformType = typeof DeterministicTransformTypes[number];

/**
 * Type for LLM-assisted transforms
 */
export type LLMAssistedTransformType = typeof LLMAssistedTransformTypes[number];

/**
 * Type for all transform types
 */
export type TransformType = typeof AllTransformTypes[number];

/**
 * Check if a transform type requires LLM
 */
export function isLLMAssistedTransform(type: string): boolean {
  return type.endsWith('_with_llm');
}

/**
 * Validate LLM-assisted transform has required service
 * Returns warning message if validation fails, undefined if valid
 */
export function validateLLMTransformService(
  transformType: string,
  requiredServices: string[]
): string | undefined {
  if (!isLLMAssistedTransform(transformType)) {
    return undefined; // Not an LLM transform, no validation needed
  }

  // Check if any LLM-capable service is in requiredServices
  const llmCapableServices = ['chatgpt-research', 'openai', 'anthropic', 'claude'];
  const hasLLMService = requiredServices.some(service =>
    llmCapableServices.some(llm => service.toLowerCase().includes(llm))
  );

  if (!hasLLMService) {
    return `Transform type "${transformType}" requires an LLM-capable service in requiredServices, but none found. Available: ${requiredServices.join(', ') || 'none'}`;
  }

  return undefined;
}

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
  next_step: z.string().min(1, 'next_step must be a non-empty string')
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
  id: z.string().min(1, 'Step ID must be a non-empty string'),
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
 * v14: Transform steps MUST include a top-level `type` field from the allowed transform types
 */
export const TransformStepSchema = z.object({
  ...BaseStepFields,
  kind: z.literal('transform'),
  // v14: Required top-level type field - must be one of the allowed transform types
  type: TransformTypeSchema,
  // Optional plugin/action for LLM-assisted transforms that use a specific plugin
  plugin: z.string().optional(),
  action: z.string().optional(),
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
  id: z.string().min(1, 'Step ID must be a non-empty string'),
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
 * Phase 4 LLM Response schema (v14)
 * This is what the LLM actually returns - slim version without Phase 3 fields
 * Phase 3 fields (analysis, requiredServices, etc.) are merged in from thread context
 */
export const Phase4LLMResponseSchema = z.object({
  // Phase 4 specific fields only
  needsClarification: z.boolean().optional(),
  metadata: Phase4MetadataSchema,
  technical_workflow: z.array(TechnicalWorkflowStepSchema),
  technical_inputs_required: z.array(TechnicalInputRequiredSchema).optional().default([]),
  feasibility: FeasibilitySchema,
  conversationalSummary: z.string().min(1),
  suggestions: z.array(z.string()).optional(),

  // Optional error field
  error: z.string().optional(),
});

/**
 * Phase 3 cached data schema
 * These fields are cached from Phase 3 and merged into Phase 4 response
 */
export const Phase3CachedDataSchema = z.object({
  analysis: AnalysisObjectSchema,
  requiredServices: z.array(z.string()),
  missingPlugins: z.array(z.string()),
  pluginWarning: z.record(z.string(), z.string()),
  clarityScore: z.number().min(0).max(100),
  enhanced_prompt: EnhancedPromptSchema,
});

/**
 * Complete Phase 4 response schema (merged)
 * Includes Phase 3 cached data + Phase 4 LLM response
 */
export const Phase4ResponseSchema = z.object({
  // Phase 3 cached fields (merged in from thread context)
  analysis: AnalysisObjectSchema,
  requiredServices: z.array(z.string()),
  missingPlugins: z.array(z.string()),
  pluginWarning: z.record(z.string(), z.string()),
  clarityScore: z.number().min(0).max(100),
  enhanced_prompt: EnhancedPromptSchema,

  // Phase 4 specific fields
  needsClarification: z.boolean().optional(),
  conversationalSummary: z.string().min(1),
  suggestions: z.array(z.string()).optional(),
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
export type Phase4LLMResponse = z.infer<typeof Phase4LLMResponseSchema>;
export type Phase3CachedData = z.infer<typeof Phase3CachedDataSchema>;
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
 * Validate Phase 4 LLM response (what the LLM actually returns in v14)
 * Does not include Phase 3 fields - those are merged separately
 */
export function validatePhase4LLMResponse(data: unknown): {
  success: boolean;
  data?: Phase4LLMResponse;
  errors?: string[];
} {
  const result = Phase4LLMResponseSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors.map(err => {
    const path = err.path.join('.');
    return `${path}: ${err.message}`;
  });

  return { success: false, errors };
}

/**
 * Merge Phase 4 LLM response with cached Phase 3 data
 * Creates a complete Phase 4 response for validation and storage
 */
export function mergePhase4WithPhase3(
  phase4LLMResponse: Phase4LLMResponse,
  phase3CachedData: Phase3CachedData
): unknown {
  return {
    // Phase 3 cached fields
    analysis: phase3CachedData.analysis,
    requiredServices: phase3CachedData.requiredServices,
    missingPlugins: phase3CachedData.missingPlugins,
    pluginWarning: phase3CachedData.pluginWarning,
    clarityScore: phase3CachedData.clarityScore,
    enhanced_prompt: phase3CachedData.enhanced_prompt,

    // Phase 4 specific fields
    needsClarification: phase4LLMResponse.needsClarification,
    metadata: phase4LLMResponse.metadata,
    technical_workflow: phase4LLMResponse.technical_workflow,
    technical_inputs_required: phase4LLMResponse.technical_inputs_required || [],
    feasibility: phase4LLMResponse.feasibility,
    conversationalSummary: phase4LLMResponse.conversationalSummary,
    suggestions: phase4LLMResponse.suggestions,
    error: phase4LLMResponse.error,
  };
}

/**
 * Validate Phase 3 cached data
 */
export function validatePhase3CachedData(data: unknown): {
  success: boolean;
  data?: Phase3CachedData;
  errors?: string[];
} {
  const result = Phase3CachedDataSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

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