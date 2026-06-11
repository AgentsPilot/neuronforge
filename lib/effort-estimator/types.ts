/**
 * Effort Estimator — type definitions.
 *
 * See docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md § Output Schema.
 *
 * The persisted ROIEstimate is the JSON shape written to
 * `agent_config.roi_estimate`. The downstream readers (MetricsCollector,
 * BusinessInsightGenerator.calculateROIMetrics) read `is_bulk_workflow` and
 * `total_manual_time_seconds` as separate fields, so we keep those required
 * and explicit — they are NOT inferred from presence-of-field.
 */
import { z } from 'zod';
import type { UserContext } from '@/lib/user-context';

/**
 * Schema version for the persisted ROIEstimate JSON.
 * Bump when the on-disk shape changes so future migrations are unambiguous.
 */
export const ROI_ESTIMATE_SCHEMA_VERSION = '1' as const;

/**
 * The exact JSON shape written to `agent_config.roi_estimate`.
 * Backward-compatible with the reader at
 *   lib/pilot/MetricsCollector.ts:198-223
 * which reads `roi_estimate.is_bulk_workflow` and
 * `roi_estimate.total_manual_time_seconds`.
 */
export const ROIEstimateV1Schema = z.object({
  reasoning: z.string().min(1), // MUST mention persona by name — AC-3
  is_bulk_workflow: z.boolean(), // explicit flag, NOT inferred
  total_manual_time_seconds: z.number().nonnegative(),
  confidence: z.union([z.string(), z.number()]).optional(),
  generated_at: z.string().datetime(),
  model: z.string().min(1),
  version: z.literal(ROI_ESTIMATE_SCHEMA_VERSION),
});

export type ROIEstimateV1 = z.infer<typeof ROIEstimateV1Schema>;

/**
 * Active version alias — current consumers should import this name.
 * When v2 lands, change this to `ROIEstimateV2 | ROIEstimateV1` (union) and
 * add a migration adapter in the reader.
 */
export type ROIEstimate = ROIEstimateV1;

/**
 * Schema the LLM is asked to produce.
 *
 * Differences from the persisted shape (`ROIEstimateV1Schema`):
 *  - The LLM does NOT supply `generated_at`, `model`, or `version` — the
 *    estimator stamps those itself. We strip them here so that a model that
 *    helpfully includes them does not cause a Zod failure.
 *  - We `passthrough` rather than `strict` so the LLM can include extra
 *    fields without forcing a retry; we discard them on the way to persistence.
 */
export const LLMResponseSchema = z
  .object({
    reasoning: z.string().min(1),
    is_bulk_workflow: z.boolean(),
    total_manual_time_seconds: z.number().nonnegative(),
    confidence: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

/**
 * Input to the estimator.
 *
 * `enhancedPrompt` is optional. When omitted (or empty after trimming) the
 * estimator fetches the agent via `AgentRepository.findById` and falls back
 * to `enhanced_prompt → user_prompt → ''`. This avoids the in-band
 * empty-string sentinel that was flagged during SA review (Phase-1 #4).
 */
export interface EffortEstimatorInput {
  agentId: string;
  userId: string;
  /** V6 enhanced prompt when available; falls back to `user_prompt` inside the estimator. */
  enhancedPrompt?: string;
  userContext: UserContext;
  correlationId: string;
  reason: 'agent_created' | 'agent_regenerated' | 'api_request';
}

export interface EffortEstimatorResult {
  success: boolean;
  estimate?: ROIEstimate;
  previousEstimate?: ROIEstimate | null;
  errorMessage?: string;
  attempts: number;
  totalDurationMs: number;
}
