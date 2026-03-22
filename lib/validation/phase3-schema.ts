import { z } from 'zod';

// ===== BASE SCHEMAS =====

/**
 * Valid status values for analysis dimensions
 */
export const DimensionStatusSchema = z.enum(['clear', 'partial', 'missing']);

/**
 * Individual dimension analysis (data, actions, output, delivery, etc.)
 */
export const AnalysisDimensionSchema = z.object({
  status: DimensionStatusSchema,
  confidence: z.number().min(0).max(1),
  detected: z.string().min(1), // Must be non-empty
});

/**
 * Complete analysis object covering all workflow dimensions
 * Note: trigger and error_handling are optional in Phase 3 (more relevant to Phase 1)
 */
export const AnalysisObjectSchema = z.object({
  data: AnalysisDimensionSchema,
  trigger: AnalysisDimensionSchema.optional(),
  output: AnalysisDimensionSchema,
  actions: AnalysisDimensionSchema,
  delivery: AnalysisDimensionSchema,
  error_handling: AnalysisDimensionSchema.optional(),
});

/**
 * Enhanced prompt sections (all as bullet-pointed string arrays)
 * Each array item represents one bullet point
 */
export const EnhancedPromptSectionsSchema = z.object({
  data: z.array(z.string().min(1)),      // Array of bullet points
  actions: z.array(z.string().min(1)),   // Array of bullet points
  output: z.array(z.string().min(1)),    // Array of bullet points
  delivery: z.array(z.string().min(1)),  // Array of bullet points
  processing_steps: z.array(z.string().min(1)).optional(), // v7 compatibility - optional
});

/**
 * V10: Resolved user input schema
 * Represents inputs that were previously in user_inputs_required but now have values
 */
export const ResolvedUserInputSchema = z.object({
  key: z.string().min(1),    // Machine-friendly key (e.g., "accountant_email", "user_email")
  value: z.union([z.string(), z.number()]).transform(v => String(v)).pipe(z.string().min(1)),  // Resolved value - coerces numbers to strings
});

/**
 * Enhanced prompt with plan details and specifics
 */
export const EnhancedPromptSchema = z.object({
  plan_title: z.string().min(1),
  plan_description: z.string().min(1),
  sections: EnhancedPromptSectionsSchema,
  specifics: z.object({
    services_involved: z.array(z.string()),
    user_inputs_required: z.array(z.string()),  // Labels for inputs still missing
    resolved_user_inputs: z.array(ResolvedUserInputSchema).optional(),  // V10: Previously required inputs that now have values
  }),
});

/**
 * Strict Phase 3 metadata schema
 * All fields explicitly defined, no arbitrary keys
 */
export const Phase3MetadataSchema = z.object({
  all_clarifications_applied: z.boolean(),
  ready_for_generation: z.boolean(),
  confirmation_needed: z.boolean(),
  implicit_services_detected: z.array(z.string()),
  provenance_checked: z.boolean(),
  provenance_note: z.string().optional(),
  declined_plugins_blocking: z.array(z.string()).optional(),
  oauth_required: z.boolean().optional(),
  oauth_message: z.string().optional(),
  plugins_adjusted: z.array(z.string()).optional(),
  adjustment_reason: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * Complete Phase 3 response schema
 * Used for strict validation of LLM output
 * Note: ready_for_generation is ONLY in metadata, not at top level
 */
export const Phase3ResponseSchema = z.object({
  analysis: AnalysisObjectSchema,
  requiredServices: z.array(z.string()),
  missingPlugins: z.array(z.string()),
  pluginWarning: z.record(z.string(), z.string()),
  clarityScore: z.number().min(0).max(100),
  enhanced_prompt: EnhancedPromptSchema,
  metadata: Phase3MetadataSchema,
  conversationalSummary: z.string().min(1),
  needsClarification: z.boolean().optional(),
  error: z.string().optional(),
});

/**
 * Infer TypeScript type from Zod schema
 */
export type ValidatedPhase3Response = z.infer<typeof Phase3ResponseSchema>;

/**
 * Normalize LLM response before validation.
 * Handles common LLM quirks like returning arrays where strings are expected.
 */
function normalizePhase3Response(data: unknown): unknown {
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
export function validatePhase3Response(data: unknown): {
  success: boolean;
  data?: ValidatedPhase3Response;
  errors?: string[];
} {
  // Normalize the data to handle LLM quirks before validation
  const normalizedData = normalizePhase3Response(data);

  const result = Phase3ResponseSchema.safeParse(normalizedData);

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
