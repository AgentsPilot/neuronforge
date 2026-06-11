/**
 * Effort Estimator — barrel exports.
 *
 * Public API:
 *   - `estimateEffort(input)` — awaitable estimator entry (used by the API route).
 *   - `EffortEstimator` — class form for tests / DI.
 *   - `dispatchEffortEstimate(input, logger)` — fire-and-forget dispatcher
 *     (used by the V6 save site + PUT regen handler).
 *   - `ROIEstimate`, `EffortEstimatorInput`, `EffortEstimatorResult`,
 *     `ROIEstimateV1Schema`, `ROI_ESTIMATE_SCHEMA_VERSION` — types + schema.
 */
export { estimateEffort, EffortEstimator } from './EffortEstimator';
export { dispatchEffortEstimate } from './dispatch';
export {
  ROIEstimateV1Schema,
  ROI_ESTIMATE_SCHEMA_VERSION,
  type ROIEstimate,
  type ROIEstimateV1,
  type EffortEstimatorInput,
  type EffortEstimatorResult,
} from './types';
