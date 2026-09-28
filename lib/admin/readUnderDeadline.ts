/**
 * Run one admin read under a deadline (admin reorganisation slice 4 C-4; moved
 * here from `app/api/admin/health-summary/route.ts` in slice 5 so the Health
 * route and the jobs & queues read share one copy).
 *
 * The signal is handed to the read so paging stops (not only the wait) once
 * the deadline passes. The timer is always cleared, and a read that settles
 * after its deadline is swallowed, never an unhandled rejection. A failure
 * records an error CLASS (its name), never a message.
 *
 * Reads the clock for timings, so it is not part of any "pure" module.
 *
 * @module lib/admin/readUnderDeadline
 */

/** Per-read deadline (slice 4 F-4). A read past it counts as failed. */
export const ADMIN_READ_DEADLINE_MS = 5000;

export class ReadDeadlineError extends Error {
  constructor() {
    super('Read deadline passed');
    this.name = 'ReadDeadlineError';
  }
}

export type RepoResult<T> = { data: T | null; error: Error | null };

export interface ReadTiming {
  read: string;
  ms: number;
  ok: boolean;
  /** An error CLASS, never a message. */
  failure?: string;
  rows?: number;
  pages?: number;
}

/** `error` is for the caller's own classification (e.g. "table missing"); never shown or logged as text. */
export type DeadlineRead<T> = { ok: true; value: T } | { ok: false; error?: Error };

export async function underDeadline<T>(
  read: string,
  timings: ReadTiming[],
  run: (signal: AbortSignal) => Promise<RepoResult<T>>,
  deadlineMs: number = ADMIN_READ_DEADLINE_MS
): Promise<DeadlineRead<T>> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ReadDeadlineError());
    }, deadlineMs);
  });
  deadline.catch(() => undefined);

  let work: Promise<RepoResult<T>>;
  try {
    work = run(controller.signal);
  } catch (error) {
    work = Promise.reject(error);
  }
  work.catch(() => undefined);

  try {
    const result = await Promise.race([work, deadline]);
    if (result.error || result.data === null) {
      timings.push({ read, ms: Date.now() - started, ok: false, failure: result.error?.name ?? 'NoData' });
      return result.error ? { ok: false, error: result.error } : { ok: false };
    }
    timings.push({ read, ms: Date.now() - started, ok: true });
    return { ok: true, value: result.data };
  } catch (error) {
    timings.push({
      read,
      ms: Date.now() - started,
      ok: false,
      failure: error instanceof Error ? error.name : 'Unknown',
    });
    return error instanceof Error ? { ok: false, error } : { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Wrap a promise that does not return `{ data, error }`. */
export async function asRepoResult<T>(promise: Promise<T>): Promise<RepoResult<T>> {
  try {
    return { data: await promise, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('Read failed') };
  }
}
