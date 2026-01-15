import { z } from 'zod';
import { TechnicalWorkflowStepSchema } from './phase4-schema';

// ===== OUTPUT CONTRACT SCHEMAS (Phase 5 Enhancement) =====

/**
 * JSON Schema representation for output contracts
 * Supports both simple types and complex object schemas
 */
export const JSONSchemaSchema: z.ZodType<any> = z.lazy(() => z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']),
  description: z.string().optional(),
  properties: z.record(z.string(), JSONSchemaSchema).optional(),
  items: JSONSchemaSchema.optional(),
  required: z.array(z.string()).optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  format: z.string().optional(),
  additionalProperties: z.union([z.boolean(), JSONSchemaSchema]).optional(),
  // Allow extension fields
}).passthrough());

/**
 * Output contract for a single step output
 * Supports three ways to declare schema:
 * 1. $ref - reference to a registered schema (e.g., "$ref:plugins/gmail/draft")
 * 2. type - simple type label (e.g., "string", "Lead[]")
 * 3. schema - inline JSON Schema for complex structures
 */
export const OutputContractSchema = z.object({
  /** Schema reference (e.g., "$ref:plugins/gmail/draft", "$ref:ai/leads") */
  $ref: z.string().regex(/^\$ref:[a-z]+\/[a-z0-9_\-\/]+$/).optional(),
  /** Simple type label (e.g., "string", "Lead[]", "GmailMessage") */
  type: z.string().optional(),
  /** Inline JSON Schema for complex structures */
  schema: JSONSchemaSchema.optional(),
  /** Human-readable description */
  description: z.string().optional(),
}).refine(
  (data) => data.$ref || data.type || data.schema,
  { message: 'OutputContract must have at least one of: $ref, type, or schema' }
);

/**
 * AI Output Schema declaration for ai_processing steps
 * Defines the expected structure of LLM-generated output
 */
export const AIOutputSchemaSchema = z.object({
  /** Fields expected in the output */
  properties: z.record(z.string(), z.object({
    type: z.string(),
    description: z.string().optional(),
    enum: z.array(z.string()).optional(),
  })),
  /** Required fields in the output */
  required: z.array(z.string()).optional(),
});

// ===== TECHNICAL REVIEWER RESPONSE SCHEMAS =====

/**
 * Blocking gap identified by the reviewer
 * Describes an issue that prevents workflow execution
 */
export const BlockingGapSchema = z.object({
  type: z.string().min(1),
  details: z.string().min(1),
  how_to_fix_in_phase2: z.string().optional(),
});

/**
 * Step change made by the reviewer during repair
 */
export const StepChangeSchema = z.object({
  change_type: z.enum(['edit', 'insert', 'delete', 'move']),
  step_id: z.string().min(1),
  reason: z.string().min(1),
  evidence_refs: z.array(z.string()).optional(),
});

/**
 * Reviewer summary - status and changes made
 */
export const ReviewerSummarySchema = z.object({
  status: z.enum(['approved', 'repaired', 'blocked']),
  blocking_gaps: z.array(BlockingGapSchema).optional(),
  warnings: z.array(z.string()).optional(),
  step_changes: z.array(StepChangeSchema).optional(),
});

/**
 * Feasibility assessment from the technical reviewer
 * Uses simple string arrays for blocking_issues and warnings
 */
export const TechnicalReviewerFeasibilitySchema = z.object({
  can_execute: z.boolean(),
  blocking_issues: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});

/**
 * Complete Technical Reviewer response schema
 */
export const TechnicalReviewerResponseSchema = z.object({
  reviewer_summary: ReviewerSummarySchema,
  technical_workflow: z.array(TechnicalWorkflowStepSchema),
  feasibility: TechnicalReviewerFeasibilitySchema,
});

// ===== TYPE EXPORTS =====

// Phase 5 Output Contract types
export type JSONSchema = z.infer<typeof JSONSchemaSchema>;
export type OutputContract = z.infer<typeof OutputContractSchema>;
export type AIOutputSchema = z.infer<typeof AIOutputSchemaSchema>;

// Technical Reviewer types
export type BlockingGap = z.infer<typeof BlockingGapSchema>;
export type StepChange = z.infer<typeof StepChangeSchema>;
export type ReviewerSummary = z.infer<typeof ReviewerSummarySchema>;
export type TechnicalReviewerFeasibility = z.infer<typeof TechnicalReviewerFeasibilitySchema>;
export type TechnicalReviewerResponse = z.infer<typeof TechnicalReviewerResponseSchema>;

/**
 * Validation helper with detailed error formatting
 */
export function validateTechnicalReviewerResponse(data: unknown): {
  success: boolean;
  data?: TechnicalReviewerResponse;
  errors?: string[];
} {
  const result = TechnicalReviewerResponseSchema.safeParse(data);

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
 * Validate an output contract declaration
 */
export function validateOutputContract(data: unknown): {
  success: boolean;
  data?: OutputContract;
  errors?: string[];
} {
  const result = OutputContractSchema.safeParse(data);

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
 * Validate an AI output schema declaration
 */
export function validateAIOutputSchema(data: unknown): {
  success: boolean;
  data?: AIOutputSchema;
  errors?: string[];
} {
  const result = AIOutputSchemaSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors.map(err => {
    const path = err.path.join('.');
    return `${path}: ${err.message}`;
  });

  return { success: false, errors };
}