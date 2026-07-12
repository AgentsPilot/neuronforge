/**
 * CalibrationVerdict (Calibration — Item 6 + G1 anti-false-success guarantee)
 *
 * The single place that decides a calibration run's verdict. It replaces the old
 * inverted logic (`hasCriticalIssues ? 'needs_review' : 'failed'`, which marked a
 * session `failed` whenever ANY unresolved issue remained — even a cosmetic
 * user-confirm-only nag — while a real blocking defect could slip to a pass).
 *
 * The verdict keys on issue CLASS, not raw count (requirement Item 6):
 *   - A BLOCKING-class issue (G1a) ALWAYS prevents a pass — it can never be waved.
 *   - Only provably-cosmetic, user-confirm-only issues may be waved (G1b): they no
 *     longer by themselves force a hard `failed`.
 *   - A run that never exercised the real/failure-prone path resolves to
 *     `inconclusive` — never a clean pass (G1c coverage floor).
 *   - When Item 7 corrected a stored workflow in place but the re-run still did
 *     not exercise the real path, the verdict caps at `corrected_not_verified`
 *     (a corrected-THEN-re-verified pass is a legitimate `passed`).
 *
 * Pure and deterministic — no I/O, no plugin names.
 */

/** Fine-grained verdict surfaced to the user (plain-language labels below). */
export type CalibrationVerdict =
  | 'passed'
  | 'failed'
  | 'needs_review'
  | 'inconclusive'
  | 'corrected_not_verified';

/**
 * DB `calibration_history.status` values allowed by the table CHECK constraint.
 * New verdict states map onto `needs_review` at the DB layer (no migration); the
 * precise verdict is carried in `metadata.verdict` + the API response.
 */
export type CalibrationDbStatus = 'success' | 'failed' | 'needs_review' | 'verification_only';

/**
 * Issue types that are BLOCKING-class (G1a): they always prevent a passing
 * verdict and can never be downgraded to cosmetic/user-confirm-only. Extensible
 * — later phases add the compiler-gate type here too.
 */
export const BLOCKING_ISSUE_TYPES: ReadonlySet<string> = new Set([
  'plugin_field_fidelity_mismatch', // Item 3 / 5b — declared field vs plugin-real field
  'broken_variable_reference',      // a ref to a genuinely non-existent producer field
  'degraded_step_all_empty',        // Item 10 — a step/scatter delivered 100% empty/fallback items
  'degraded_step_all_failed',       // Item 10 — a step/scatter where 100% of items errored
]);

/**
 * Issue types that MAY be waved (G1b): provably-cosmetic AND user-confirm-only.
 * Waving one of these no longer forces a `failed` verdict. Nothing outside this
 * allow-list is ever waveable.
 */
export const WAVEABLE_ISSUE_TYPES: ReadonlySet<string> = new Set([
  'hardcode_detected',
  'parameterization',
]);

/** Minimal issue shape the verdict reasons over (calibration issue objects). */
export interface VerdictIssue {
  type?: string;
  severity?: string; // 'critical' | 'high' | 'medium' | 'low'
  blocking?: boolean;
  requiresUserInput?: boolean;
  autoRepairAvailable?: boolean;
}

export interface CoverageSignal {
  /**
   * Whether the real / failure-prone path was actually exercised — a ROW-COUNT
   * signal (processed items produced delivered items). Necessary but NOT
   * sufficient (Finding 4): see `deliveredAllBlank`.
   */
  exercisedRealPath: boolean;
  /** Human-readable reason when the real path was not exercised. */
  reason?: string;
  /**
   * Finding 4 (data-quality floor, tightens G1c): true when the delivered set was
   * inspected and 100% of its items are empty / fallback. An all-blank delivered
   * set can NEVER count as "real path exercised", so a positive row count alone
   * cannot earn a pass. Undefined/false when not assessed or data was meaningful.
   */
  deliveredAllBlank?: boolean;
}

export interface VerdictInput {
  issues: VerdictIssue[];
  coverage: CoverageSignal;
  /** True when Item 7 applied an in-place field-fidelity correction this run. */
  corrected?: boolean;
}

export interface VerdictResult {
  verdict: CalibrationVerdict;
  dbStatus: CalibrationDbStatus;
  /** The blocking-class issues found (empty when none). */
  blockingIssues: VerdictIssue[];
  /** True only for a genuine `passed`. */
  isPassing: boolean;
  /** Plain-language explanation of the verdict. */
  reason: string;
}

/** Human-readable labels so "not tested" is never shown as "working". */
export const VERDICT_LABELS: Record<CalibrationVerdict, string> = {
  passed: 'Ready to run',
  failed: 'Not working — needs fixing',
  needs_review: 'Needs your review before it can run',
  inconclusive: 'Not fully tested — needs representative data',
  corrected_not_verified: 'We fixed an issue, but could not fully verify it yet',
};

/** G1a: is this issue blocking-class? */
export function isBlockingIssue(issue: VerdictIssue): boolean {
  if (issue.blocking === true) return true;
  if (issue.severity === 'critical') return true;
  if (issue.type && BLOCKING_ISSUE_TYPES.has(issue.type)) return true;
  return false;
}

/**
 * G1b: is this issue waveable — i.e. both non-blocking AND user-confirm-only?
 * Only allow-listed cosmetic types with low/medium severity qualify.
 */
export function isWaveable(issue: VerdictIssue): boolean {
  if (isBlockingIssue(issue)) return false;
  if (!issue.type || !WAVEABLE_ISSUE_TYPES.has(issue.type)) return false;
  if (issue.severity === 'critical' || issue.severity === 'high') return false;
  // User-confirm-only signal (defaults to true for the allow-listed nag types,
  // which are constructed as user-confirm-only suggestions by IssueCollector).
  const userConfirmOnly = issue.requiresUserInput === true || issue.autoRepairAvailable === false;
  return userConfirmOnly !== false;
}

export function mapVerdictToDbStatus(verdict: CalibrationVerdict): CalibrationDbStatus {
  switch (verdict) {
    case 'passed':
      return 'success';
    case 'failed':
      return 'failed';
    case 'needs_review':
    case 'inconclusive':
    case 'corrected_not_verified':
      return 'needs_review';
  }
}

/**
 * Decide the calibration verdict from the remaining issues + coverage + whether
 * an in-place correction was applied. See module header for the G1 rules.
 */
export function computeVerdict(input: VerdictInput): VerdictResult {
  const { issues, coverage, corrected } = input;
  const blockingIssues = issues.filter(isBlockingIssue);

  // G1a/G1b — a blocking-class issue always prevents a pass, no matter what else.
  if (blockingIssues.length > 0) {
    const types = Array.from(new Set(blockingIssues.map(i => i.type ?? 'unknown')));
    return {
      verdict: 'needs_review',
      dbStatus: 'needs_review',
      blockingIssues,
      isPassing: false,
      reason: `Blocking issue(s) present (${types.join(', ')}); the agent cannot pass until they are resolved.`,
    };
  }

  // G1c — "exercised" requires the real path to have RUN (row count) AND carried
  // MEANINGFUL DATA (Finding 4). An all-blank delivered set never counts as
  // exercised, so a 13-row all-blank report can never be a clean pass.
  const effectivelyExercised = coverage.exercisedRealPath && coverage.deliveredAllBlank !== true;

  // G1c — the real/failure-prone path was never exercised (or delivered all blanks)
  // → never a clean pass.
  if (!effectivelyExercised) {
    // Distinguish "ran but delivered blanks" (Finding 4) from "never ran".
    const deliveredBlanks = coverage.exercisedRealPath && coverage.deliveredAllBlank === true;
    const note = deliveredBlanks ? 'delivered rows carried no meaningful data' : coverage.reason;
    if (corrected) {
      return {
        verdict: 'corrected_not_verified',
        dbStatus: 'needs_review',
        blockingIssues: [],
        isPassing: false,
        reason:
          `A field-fidelity correction was applied, but the re-run ${deliveredBlanks ? 'delivered no meaningful data' : 'did not exercise the real path'}` +
          `${note ? ` (${note})` : ''}, so it is not yet verified.`,
      };
    }
    return {
      verdict: 'inconclusive',
      dbStatus: 'needs_review',
      blockingIssues: [],
      isPassing: false,
      reason: deliveredBlanks
        ? `The real path ran but delivered no meaningful data${note ? ` (${note})` : ''}; this cannot pass — provide representative data / fix the empty output.`
        : `The real path was not exercised${note ? ` (${note})` : ''}; provide representative data to verify this agent.`,
    };
  }

  // No blocking issues and the real path WAS exercised. Any remaining issue that
  // is NOT waveable (non-blocking user-confirm-only) still holds back a pass.
  const nonWaveable = issues.filter(i => !isWaveable(i));
  if (nonWaveable.length > 0) {
    return {
      verdict: 'needs_review',
      dbStatus: 'needs_review',
      blockingIssues: [],
      isPassing: false,
      reason: `Unresolved non-cosmetic issue(s) remain (${nonWaveable.length}); review before running.`,
    };
  }

  // Zero issues, or only waveable cosmetic suggestions → genuine pass. A
  // corrected-then-re-verified pass is legitimate (the real defect was removed).
  return {
    verdict: 'passed',
    dbStatus: 'success',
    blockingIssues: [],
    isPassing: true,
    reason: corrected
      ? 'A field-fidelity correction was applied and the re-run exercised the real path successfully.'
      : issues.length > 0
        ? 'Only optional cosmetic suggestions remain; the agent is ready to run.'
        : 'No issues found; the agent is ready to run.',
  };
}
