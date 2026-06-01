import { z } from 'zod';
import { createLogger } from '@/lib/logger';

// F3 (2026-05-30): module-level logger for the normalizer's debug breadcrumbs.
// Fires whenever the normalizer touches a `resolved_user_inputs[*].value` so
// future LLM quirks aren't silently coerced or dropped. Module scope (not a
// request-child) keeps the schema module decoupled from route plumbing.
const schemaLogger = createLogger({ module: 'Phase3SchemaNormalizer' });

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
 * Handles common LLM quirks for `resolved_user_inputs[*].value`:
 *   - Array              → comma-separated string (e.g. `["a","b"]` → `"a, b"`)
 *   - null / undefined   → DROP the row (F3, 2026-05-30); an unresolved input
 *     belongs in `user_inputs_required`, not `resolved_user_inputs`. Letting it
 *     through previously caused a Zod union failure that triggered the Phase 3
 *     retry, which in turn used the Phase-2-entrenchment corrective nudge —
 *     misleading and pure dice-rolling. See workplan § F3.
 *   - boolean            → `'true'` / `'false'`
 *   - object (non-array) → `JSON.stringify(value)` (preserves structured data
 *     like `{ from, to }` date ranges as a string the schema can accept)
 * Any normalization or drop is logged as a debug breadcrumb so we can see what
 * the LLM is actually emitting and tighten v16 if a quirk becomes a pattern.
 */
function normalizePhase3Response(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;

  const normalized = JSON.parse(JSON.stringify(data)); // Deep clone

  // Normalize resolved_user_inputs values — see function-doc comment above.
  if (
    normalized.enhanced_prompt?.specifics?.resolved_user_inputs &&
    Array.isArray(normalized.enhanced_prompt.specifics.resolved_user_inputs)
  ) {
    const inputs: any[] = normalized.enhanced_prompt.specifics.resolved_user_inputs;
    const next: any[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const item = inputs[i];
      if (!item || typeof item !== 'object') {
        // Non-object row — pass through; Zod will catch it.
        next.push(item);
        continue;
      }
      const value = (item as any).value;

      if (value === null || value === undefined) {
        // DROP — half-baked "resolved" entry. Conservative + accurate.
        schemaLogger.debug(
          { index: i, key: item.key },
          'Normalizer dropped resolved_user_inputs row with null/undefined value'
        );
        continue;
      }
      if (Array.isArray(value)) {
        next.push({ ...item, value: value.join(', ') });
        continue;
      }
      if (typeof value === 'boolean') {
        schemaLogger.debug(
          { index: i, key: item.key, originalType: 'boolean' },
          'Normalizer coerced resolved_user_inputs boolean value to string'
        );
        next.push({ ...item, value: value ? 'true' : 'false' });
        continue;
      }
      if (typeof value === 'object') {
        // Non-array, non-null object — preserve as a JSON string.
        schemaLogger.debug(
          { index: i, key: item.key, originalType: 'object' },
          'Normalizer JSON-stringified resolved_user_inputs object value'
        );
        next.push({ ...item, value: JSON.stringify(value) });
        continue;
      }
      // string | number — leave for the Zod transform/pipe.
      next.push(item);
    }
    normalized.enhanced_prompt.specifics.resolved_user_inputs = next;
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
