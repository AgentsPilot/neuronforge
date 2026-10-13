/**
 * A `fetch` for Supabase that will not open more connections than Supabase
 * will accept.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FIXES
 *
 * Opening one CRM contact drawer fires nine API routes at once, and each runs
 * several queries, so thirty-odd requests reach Supabase simultaneously. Node's
 * fetch puts no ceiling on connections per host, so thirty TLS handshakes open
 * together and the far end starts dropping them:
 *
 *     TypeError: fetch failed … read ECONNRESET
 *       at PluginConnectionRepository.findActiveByUser
 *
 *     TypeError: fetch failed … read ECONNRESET
 *       at GoTrueClient._getUser
 *     GET /api/scheduling/bookings  401 in 35529ms
 *
 * Both layers, same cause. And the shape of the failure is the worst one: a
 * dropped connection surfaces as "no rows" or "not authorised" rather than as
 * an outage, so a signed-in owner is told they have no bookings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUEUE, DO NOT DROP
 *
 * Past the limit a request WAITS instead of opening another socket. Waiting
 * 80ms for a free slot is invisible; being reset is a false 401. Supabase
 * answers in tens of milliseconds, so a queue of this depth drains faster than
 * a human notices.
 *
 * The cap is per process. On Vercel each instance gets its own, which is
 * correct — the limit that matters is how many sockets ONE process opens at
 * once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT A GLOBAL DISPATCHER
 *
 * `setGlobalDispatcher` from undici would cap every outbound request in the
 * process, including Stripe and the mail transport. Those are not the ones
 * flooding, and throttling a payment confirmation behind a queue of CRM reads
 * would be a far worse bug than the one being fixed. This wraps the Supabase
 * clients only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * How many Supabase requests may be in flight at once, per process.
 *
 * Twelve is comfortably above what any single page needs once `getUser` is
 * deduplicated, and well under what a burst was opening unbounded. Tune with
 * `SUPABASE_MAX_CONCURRENCY` if a deployment needs to.
 */
function limit(): number {
  const raw = Number(process.env.SUPABASE_MAX_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? raw : 12;
}

let active = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < limit()) {
    active++;
    return Promise.resolve();
  }

  return new Promise<void>(resolve => {
    waiting.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active--;

  /* Hand the slot to whoever has waited longest. */
  const next = waiting.shift();
  if (next) next();
}

/**
 * Drop-in replacement for `fetch`, bounded.
 *
 * The slot is released in a `finally`, so a thrown request cannot leak one —
 * leaking enough of them would stall every Supabase call in the process, which
 * is a worse outage than the one this prevents.
 */
/**
 * Connection-level failures worth trying again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The queue above reduces these; it cannot remove them. A socket still gets
 * reset by a sleeping laptop, a dev server rebuilding, a Supabase instance
 * recycling a connection — and undici reports all of it the same way:
 *
 *     TypeError: fetch failed
 *       at async Promise.all (index 1)
 *       at async GET (app/api/payments/money/route.ts)
 *
 * One of those took the whole orders page to a 500. The read was fine a
 * hundred milliseconds later; nothing was wrong except the socket.
 *
 * An HTTP RESPONSE is never retried here, whatever its status. A 500 from
 * PostgREST is an answer, and asking again gets the same answer more slowly.
 * This is only for the case where no response arrived at all.
 */
function isTransientConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  /* Our own timeout, or the caller's. Retrying a 20-second abort three times
     spends a minute to deliver the same failure. */
  if (error.name === 'AbortError') return false;

  const code = String((error as { cause?: { code?: unknown } }).cause?.code ?? '');
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return true;
  }

  /* undici's own wrapper, when the cause carries no code. */
  return error.name === 'TypeError' && /fetch failed|socket|network/i.test(error.message);
}

/**
 * Retried only for methods that can be.
 *
 * A connection error means no response arrived — it does NOT mean the request
 * never reached the server. Repeating a POST on that basis is how one payment
 * becomes two. Reads carry no such risk, and reads are what the orders page
 * does.
 */
const RETRYABLE_METHODS = new Set(['GET', 'HEAD']);

/** 50ms, then 150ms. Supabase answers in tens of milliseconds. */
const BACKOFF_MS = [50, 150];

/** One attempt, holding a concurrency slot for exactly its own duration. */
const attemptOnce: typeof fetch = async (input, init) => {
  await acquire();

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A TIMEOUT, OR THE QUEUE BECOMES THE OUTAGE.
   *
   * Node's fetch has no default timeout. A request that HANGS rather than
   * failing holds its slot for the life of the process, and twelve of those
   * block every Supabase call there is — the exact stall this file exists to
   * prevent, caused by the fix for it.
   *
   * Twenty seconds is far longer than Supabase's tens of milliseconds and far
   * shorter than the thirty-five-second waits seen in the logs before any of
   * this. An abort surfaces as a normal fetch rejection, which every caller
   * already handles.
   *
   * A caller's own `signal` still wins: whichever aborts first ends the
   * request.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  const callerSignal = init?.signal;
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener('abort', onCallerAbort);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
    release();
  }
};

/**
 * Drop-in replacement for `fetch`: bounded, timed out, and retried when the
 * connection rather than the server was the problem.
 *
 * The slot is released BETWEEN attempts — held across the backoff, a handful of
 * retrying reads would stall every other Supabase call in the process, which is
 * the outage this file exists to prevent.
 */
export const supabaseFetch: typeof fetch = async (input, init) => {
  const method = String(init?.method ?? 'GET').toUpperCase();
  const attempts = RETRYABLE_METHODS.has(method) ? BACKOFF_MS.length + 1 : 1;

  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptOnce(input, init);
    } catch (error) {
      const last = attempt >= attempts - 1;
      if (last || !isTransientConnectionError(error) || init?.signal?.aborted) throw error;

      await new Promise(resolve => setTimeout(resolve, BACKOFF_MS[attempt]));
    }
  }
};

/**
 * How long one Supabase request may take before it is abandoned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LONGER IN DEVELOPMENT, AND NOT BECAUSE SUPABASE IS SLOWER THERE.
 *
 * The clock starts after a slot is acquired, so this measures the REQUEST and
 * never the queue. Twenty seconds is therefore enormous against Supabase's
 * tens of milliseconds, and in production it means what it says: a request
 * taking this long has hung.
 *
 * The dev server is a different machine. It compiles routes on the same
 * process — `Compiled /api/scheduling/services in 45.9s` is a real line from a
 * real session — and nothing else progresses while it does. A fetch issued
 * before a compile and read after it can show twenty seconds of wall clock
 * with nothing wrong at either end, and the abort then surfaces as
 *
 *     DOMException [AbortError]: This operation was aborted
 *       at async SupabaseAuthClient._getUser
 *
 * which reads as an auth failure and is not one.
 *
 * So the ceiling is raised where the stalls are, and left alone where the
 * number is load-bearing. This treats the symptom: the cause is the compile
 * time, and the fix for that is the module graph.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function timeoutMs(): number {
  const raw = Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;

  return process.env.NODE_ENV === 'development' ? 60_000 : 20_000;
}

/**
 * For tests and diagnostics, alongside `timeoutMs` above: how saturated the
 * pool is right now.
 */
export function supabaseFetchStats(): { active: number; waiting: number; limit: number } {
  return { active, waiting: waiting.length, limit: limit() };
}
