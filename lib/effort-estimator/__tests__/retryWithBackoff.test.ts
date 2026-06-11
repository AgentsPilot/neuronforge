/**
 * Effort Estimator — retryWithBackoff tests.
 *
 * Per the SA review (Phase-1 observation #6), the locked contract is:
 *  - `attempts === 3` on exhaustion (NOT 4)
 *  - 1-based attempts count on success
 *  - Budget enforcement aborts before an over-budget sleep
 */
import { retryWithBackoff } from '../retryWithBackoff';

describe('retryWithBackoff', () => {
  it('returns ok=true and attempts=1 when fn succeeds on the first try', async () => {
    const fn = jest.fn().mockResolvedValue('done');
    const result = await retryWithBackoff(fn, { delaysMs: [10, 20, 30] });

    expect(result.ok).toBe(true);
    expect(result.value).toBe('done');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and returns attempts=2 when fn succeeds on the second try', async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw new Error('transient');
      return 'eventually';
    });

    const result = await retryWithBackoff(fn, { delaysMs: [5, 10, 20] });

    expect(result.ok).toBe(true);
    expect(result.value).toBe('eventually');
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns ok=false and attempts=3 on exhaustion (SA observation #6: NOT 4)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));

    const result = await retryWithBackoff(fn, { delaysMs: [5, 10, 15] });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
    expect((result.error as Error).message).toBe('boom');
  });

  it('aborts retries when isRetryable returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fatal'));

    const result = await retryWithBackoff(fn, {
      delaysMs: [5, 10, 15],
      isRetryable: () => false,
    });

    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects totalBudgetMs and stops before the next over-budget sleep', async () => {
    // With delays [10, 5000, 5000] and a budget of 100ms, after attempt 1
    // fails we sleep 10ms (fine), attempt 2 fails, then the 5000ms sleep is
    // capped at remaining ≤ 100ms — and the third attempt should be the last.
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls += 1;
      throw new Error(`fail-${calls}`);
    });

    const start = Date.now();
    const result = await retryWithBackoff(fn, {
      delaysMs: [10, 5000, 5000],
      totalBudgetMs: 100,
    });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    // Should bail well within the budget (not run for 10+ seconds).
    expect(elapsed).toBeLessThan(500);
  });

  it('calls onAttempt with the 0-based attempt index', async () => {
    const onAttempt = jest.fn();
    const fn = jest.fn().mockRejectedValue(new Error('x'));

    await retryWithBackoff(fn, { delaysMs: [1, 1, 1], onAttempt });

    expect(onAttempt).toHaveBeenCalledTimes(3);
    expect(onAttempt.mock.calls[0][0]).toBe(0);
    expect(onAttempt.mock.calls[1][0]).toBe(1);
    expect(onAttempt.mock.calls[2][0]).toBe(2);
  });
});
