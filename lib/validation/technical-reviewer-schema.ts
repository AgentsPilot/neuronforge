import { z } from 'zod';
import { TechnicalWorkflowStepSchema } from './phase4-schema';

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
 * Warning identified by the reviewer (non-blocking)
 */
export const ReviewerWarningSchema = z.object({
  type: z.string().min(1),
  details: z.string().min(1),
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
  warnings: z.array(ReviewerWarningSchema).optional(),
  step_changes: z.array(StepChangeSchema).optional(),
});

/**
 * Feasibility assessment from the technical reviewer
 * Note: This is different from Phase4's FeasibilitySchema which uses objects for issues/warnings
 * The reviewer uses simpler string arrays
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

export type BlockingGap = z.infer<typeof BlockingGapSchema>;
export type ReviewerWarning = z.infer<typeof ReviewerWarningSchema>;
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