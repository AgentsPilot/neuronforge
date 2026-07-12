/**
 * AllFailedStepDetector (Calibration — Item 10 / Finding 5)
 *
 * Surfaces the hidden-failure anti-pattern (Principle 11 / WP-34): a step or
 * scatter where 100% of items ERROR or return EMPTY / FALLBACK data gets swallowed
 * into valid-looking empty results (the extractor catches its own throw, the
 * executor applies fallback values, the scatter records per-item "success"), so a
 * step that failed on every item produces ZERO calibration signal (the run showed
 * 14/0/0 with only a cosmetic issue). This detector inspects the produced data of
 * each step and raises a BLOCKING-class issue when an entire step/scatter is
 * all-failed or all-empty/all-fallback, so it can never be silently passed (G1a).
 *
 * Generic — it uses the shared data-quality signal (no plugin-specific fields) and
 * the generic per-item `success:false` marker; zero plugin-name branches.
 */

import { createLogger } from '@/lib/logger';
import { assessItemsDataQuality, isMeaningfulItem } from '@/lib/pilot/shadow/dataQuality';

const logger = createLogger({ module: 'AllFailedStepDetector', service: 'shadow-agent' });

export interface DegradedStepIssue {
  /** The step whose produced data is entirely failed/empty. */
  stepId: string;
  /** 'all_failed' when 100% of items carry an error/success:false marker;
   *  'all_empty' when 100% carry no meaningful data (empty/fallback). */
  kind: 'all_failed' | 'all_empty';
  itemCount: number;
  /** Always true — an all-failed/all-empty step is blocking-class (G1a). */
  blocking: true;
}

/** Coerce a step output to an array of items when possible. */
function toItems(output: unknown): unknown[] | null {
  if (Array.isArray(output)) return output;
  if (output && typeof output === 'object') {
    for (const key of ['items', 'rows', 'data', 'results', 'records']) {
      const inner = (output as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner;
    }
  }
  return null;
}

/** True when an item declares an explicit failure marker. */
function isFailedItem(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const o = item as Record<string, unknown>;
  if (o.success === false) return true;
  if (o.error !== undefined && o.error !== null && o.error !== false) return true;
  if (typeof o.status === 'string' && ['failed', 'error'].includes(o.status.toLowerCase())) return true;
  return false;
}

export class AllFailedStepDetector {
  /**
   * @param stepOutputs Map of `stepId → produced output` (e.g. the execution
   *   result's `output`). Only steps whose output is an array of items (size ≥ 1)
   *   are assessed; scalar/single-object outputs are skipped (nothing to judge
   *   across "all items").
   */
  detect(stepOutputs: Record<string, unknown> | null | undefined): DegradedStepIssue[] {
    const issues: DegradedStepIssue[] = [];
    if (!stepOutputs || typeof stepOutputs !== 'object') return issues;

    for (const [stepId, output] of Object.entries(stepOutputs)) {
      const items = toItems(output);
      if (!items || items.length === 0) continue; // nothing to judge

      // 100% explicit failures → all_failed.
      const failedCount = items.filter(isFailedItem).length;
      if (failedCount === items.length) {
        issues.push({ stepId, kind: 'all_failed', itemCount: items.length, blocking: true });
        continue;
      }

      // 100% empty/fallback data → all_empty (the swallowed-failure case).
      const quality = assessItemsDataQuality(items);
      if (quality.assessed && quality.allBlank) {
        issues.push({ stepId, kind: 'all_empty', itemCount: items.length, blocking: true });
      }
    }

    if (issues.length > 0) {
      logger.warn(
        { issues: issues.map(i => `${i.stepId}:${i.kind}(${i.itemCount})`) },
        '[AllFailedStep] Detected all-failed / all-empty step(s) — blocking'
      );
    }
    return issues;
  }
}

// Re-exported for callers that only need the item-level predicate.
export { isMeaningfulItem };
