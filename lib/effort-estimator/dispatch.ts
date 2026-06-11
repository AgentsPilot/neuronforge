/**
 * Effort Estimator — fire-and-forget dispatcher.
 *
 * SINGLE SOURCE OF TRUTH for the net-new "void async-IIFE().catch(...)"
 * pattern in this project (per SA conditional approval / CLAUDE.md mandatory
 * rule #7). One async caller currently consumes it:
 *   (1) V6 save site — `app/api/create-agent/route.ts` (post-AGENT_CREATED audit)
 *
 * A future v2 regeneration-on-prompt-edit trigger (Open Follow-Up #10) will
 * become a second caller — the helper stays generic in anticipation of that.
 *
 * The synchronous on-demand API endpoint
 *   POST /api/v2/agents/[agentId]/estimate-effort
 * does NOT use this dispatcher — it awaits `estimateEffort` directly so the
 * HTTP response carries the result + status code.
 *
 * Safety notes:
 *  - The dynamic `import('./EffortEstimator')` is wrapped inside the async
 *    IIFE so a (rare) cold-start module-resolution failure still routes
 *    through the outer `.catch(...)` instead of escaping as an unhandled
 *    rejection (addresses SA Phase-1 comment #13).
 *  - Caller is expected to pass a request-scoped child Pino logger.
 */
import type { Logger } from 'pino';
import type { EffortEstimatorInput } from './types';

/**
 * Dispatch an effort-estimator run without awaiting the result.
 *
 * The caller continues immediately; the estimator runs in the background and
 * either populates `agent_config.roi_estimate` or logs the failure. Either way,
 * this function never throws.
 */
export function dispatchEffortEstimate(input: EffortEstimatorInput, logger: Logger): void {
  void (async () => {
    const { estimateEffort } = await import('./EffortEstimator');
    await estimateEffort(input);
  })().catch((err) => {
    logger.error(
      {
        err,
        agentId: input.agentId,
        correlationId: input.correlationId,
        reason: input.reason,
      },
      'Effort estimator dispatch failed (non-blocking)'
    );
  });
}
