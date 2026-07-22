/**
 * Calibration finish gate (Group A — A1).
 *
 * A calibration run may transition to the finish / success screen ONLY when the
 * server verdict is passing — `success === true` AND there are no critical
 * issues. A cosmetic-only run passes with `summary.total > 0` (the surfaced
 * suggestions), so the finish gate must NOT key on `summary.total === 0`; it keys
 * on the verdict. A run with any blocking/critical issue (`success:false`, or
 * `summary.critical > 0`) can never finish as success.
 *
 * Pure and deterministic so the finish transition is unit-testable without
 * mounting the sandbox page.
 */

export interface CalibrationResultLike {
  success?: boolean;
  status?: string;
  verdict?: string;
  summary?: { critical?: number };
  issues?: {
    critical?: unknown[];
    warnings?: unknown[];
    autoRepairs?: unknown[];
  };
}

export function canFinishCalibration(result: CalibrationResultLike | null | undefined): boolean {
  return result?.success === true && (result?.summary?.critical ?? 0) === 0;
}

/**
 * Whether a persisted `calibration_history.status` represents a PASS, for the
 * Phase-2 calibration gate (`agents.calibration_status`).
 *
 * The batch route writes history status `'success'` ONLY when the Item 6 verdict
 * is passing — a clean pass OR the Item 6a "passable with cosmetic suggestions
 * only" relaxation; non-passing verdicts write `'needs_review'` / `'failed'`. So
 * `status === 'success'` IS the persisted form of the verdict's `isPassing`.
 * Using this (instead of a second `&& issuesRemaining === 0` check) keeps the gate
 * consistent with the verdict — a cosmetic-only pass that retains a waveable
 * suggestion is still a pass and must NOT flip the gate to 'failed'.
 */
export function isCalibrationHistoryPass(historyStatus: string | null | undefined): boolean {
  return historyStatus === 'success';
}

/** An optional, non-blocking suggestion surfaced on the finish/success screen. */
export interface PassSuggestion {
  title: string;
  message: string;
}

/**
 * A3 UI half: the optional cosmetic suggestions to surface on a
 * passed-with-suggestions finish screen. Sourced DIRECTLY from the verdict
 * result's `issues.warnings` — on a passing verdict these are exactly the
 * provably-cosmetic, user-confirm-only suggestions the verdict waved (it only
 * returns `passed` when no non-waveable issue remains), so we do NOT re-derive
 * "is this cosmetic" here — we trust the verdict that already decided it.
 *
 * Returns [] for a plain pass with zero suggestions (keep the clean screen), and
 * [] for any non-passing result (those don't render the finish screen at all).
 */
export function getPassSuggestions(result: CalibrationResultLike | null | undefined): PassSuggestion[] {
  if (!canFinishCalibration(result)) return [];
  const warnings = Array.isArray(result?.issues?.warnings) ? result!.issues!.warnings! : [];
  return warnings
    .map((w): PassSuggestion => {
      const o = (w ?? {}) as { title?: unknown; message?: unknown };
      return {
        title: typeof o.title === 'string' && o.title.trim() ? o.title : 'Optional suggestion',
        message: typeof o.message === 'string' ? o.message : '',
      };
    })
    .filter(s => Boolean(s.title || s.message));
}
