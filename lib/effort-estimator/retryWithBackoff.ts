/**
 * Effort Estimator — retry helper.
 *
 * Purpose-built for the requirement-locked 3-attempt exponential backoff
 * (1s / 4s / 16s) with a 30s total budget.
 *
 * Why not reuse `lib/agentkit/v6/utils/ProviderFallback.ts:withProviderFallback`:
 *  - That helper does *provider* fallback (anthropic → openai), not single-provider retry.
 *  - Its delays default to 1s / 2s / 4s with a 10s cap.
 *  - It has no total-budget enforcement.
 *
 * Why not reuse `lib/pilot/ErrorRecovery.ts`: that targets pilot-step recovery,
 * a different concern.
 *
 * Contract (locked in the workplan + SA observation #6):
 *  - `attempts` returned on **exhaustion** equals `delays.length` (default 3),
 *    NOT `delays.length + 1`. The previous draft over-counted by one because
 *    a final `try` after the last delay would have yielded `attempts === 4`.
 *  - `attempts` returned on **success** equals 1-based attempt index of the
 *    successful try (1, 2, or 3).
 *  - The total wall-clock is bounded by `totalBudgetMs` (default 30000ms). If
 *    the next delay would push past the budget, we bail without sleeping.
 *  - `isRetryable` can short-circuit retries for non-recoverable errors (e.g.
 *    Zod validation that will never succeed regardless of retries).
 */

export interface RetryOpts {
  /** Delays between attempts in milliseconds. Length = max retries. Default [1000, 4000, 16000] gives 3 total tries. */
  delaysMs?: number[];
  /** Hard wall-clock cap. Default 30s. Once exceeded, we stop trying. */
  totalBudgetMs?: number;
  /** Return `false` to abort retries for non-retryable errors. Default: retry all. */
  isRetryable?: (err: unknown) => boolean;
  /** Called before each attempt with the 0-based attempt index and last error (if any). */
  onAttempt?: (attempt: number, lastError?: unknown) => void;
}

export interface RetryResult<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
  /** Number of attempts performed (1-based). On exhaustion equals `delays.length`. */
  attempts: number;
  totalDurationMs: number;
}

const DEFAULT_DELAYS_MS = [1000, 4000, 16000];
const DEFAULT_BUDGET_MS = 30000;

/**
 * Retry an async function with exponential backoff and a wall-clock budget.
 *
 * Loop shape: we perform `delays.length` attempts total. Between attempts we
 * sleep for `delays[attemptIndex]`. The final attempt has no trailing sleep.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {}
): Promise<RetryResult<T>> {
  const delays = opts.delaysMs ?? DEFAULT_DELAYS_MS;
  const budget = opts.totalBudgetMs ?? DEFAULT_BUDGET_MS;
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt < delays.length; attempt++) {
    // Pre-attempt budget check — if we're already over budget, stop.
    if (Date.now() - start > budget) break;

    opts.onAttempt?.(attempt, lastError);

    try {
      const value = await fn();
      return {
        ok: true,
        value,
        attempts: attempt + 1,
        totalDurationMs: Date.now() - start,
      };
    } catch (err) {
      lastError = err;

      // Caller says this error class is fatal — don't burn the budget.
      if (opts.isRetryable && !opts.isRetryable(err)) break;

      // Last attempt — no sleep after the loop ends.
      const isLast = attempt === delays.length - 1;
      if (isLast) break;

      const delay = delays[attempt];
      const remaining = budget - (Date.now() - start);
      if (remaining <= 0) break;

      await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
    }
  }

  return {
    ok: false,
    error: lastError,
    attempts: delays.length,
    totalDurationMs: Date.now() - start,
  };
}
