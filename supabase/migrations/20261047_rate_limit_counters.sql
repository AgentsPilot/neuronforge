-- Throttling for the endpoints that have no login in front of them.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS FOR
--
-- Sixteen routes under /api/book/manage, /api/public and /api/proposal are
-- reachable without a session: the signed token or the id in the URL is the
-- whole authorisation. None of them had any throttle at all.
--
-- Forgery is not the concern — HS256 with a real secret is not brute-forceable
-- in any practical sense. The concerns are:
--
--   * unauthenticated WRITES. `invites/signup/*` creates accounts and
--     `intake/upload` consumes object storage, both from strangers.
--   * unauthenticated STATE CHANGES. `cancel`, `reschedule` and the proposal
--     POST act on real bookings and real money.
--   * DETECTION. A burst of FAILED token verifications is the signal that
--     somebody is probing. Nothing recorded it, so nothing could notice it.
--     That last point is why failures are counted under their own key.
--
-- ---------------------------------------------------------------------------
-- WHY POSTGRES AND NOT REDIS
--
-- Redis is the reflexive answer for serverless rate limiting, and the reasons
-- are real at scale: sub-millisecond reads, free TTL, and keeping counter
-- writes off the primary database. None of them bind here. These endpoints are
-- opened by a handful of a business's own clients, and every one of them
-- already makes several round trips to this database before it answers.
--
-- What it costs to avoid: one more vendor to inventory, assess, sign a DPA
-- with, review annually and name as a subprocessor. For a company heading into
-- SOC 2 that is the expensive part, and it buys nothing at this volume.
--
-- ---------------------------------------------------------------------------
-- FIXED WINDOW, DELIBERATELY
--
-- `window_start` is the current instant floored to the window length, so all
-- requests in the same window share one row and the counter is a single atomic
-- upsert. A sliding window would be more precise at the boundary — a caller can
-- spend a full allowance at the end of one window and again at the start of the
-- next — and that precision is not worth a second table and a range scan for
-- what is an abuse brake, not a billing meter.
--
-- SECURITY INVOKER, not DEFINER: every caller is a route holding the service
-- role, so the function needs no elevation. 20261044_secdef_lockdown is
-- removing DEFINER where it is not required and this must not cut against it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key           text        NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

COMMENT ON TABLE public.rate_limit_counters IS
  'Fixed-window request counters for the unauthenticated public endpoints. One row per (key, window). Written only by public.rate_limit_hit(); pruned by the queue cron. Holds no personal data: a key is a route name plus a hashed caller address.';

-- Pruning scans by age, and nothing else ever queries this table by window.
CREATE INDEX IF NOT EXISTS rate_limit_counters_window_idx
  ON public.rate_limit_counters (window_start);

/*
 * No client may read or write these rows directly.
 *
 * There is no RLS policy below on purpose: RLS is enabled and NO policy is
 * created, which denies everything to anon and authenticated. The service role
 * bypasses RLS and is the only caller, via the function.
 */
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limit_counters FROM PUBLIC, anon, authenticated;

/*
 * Count one request and say whether it is still within the allowance.
 *
 * Atomic: the INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING happens in one
 * statement, so two requests arriving together cannot both read "4 of 5". Doing
 * this as a select-then-write in TypeScript is the same race the durable queue
 * drain exists to avoid, and under load it is exactly when it matters.
 *
 * Returns the count as well as the verdict so the caller can log how close a
 * caller came, which is the part an audit asks about.
 */
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_key            text,
  p_window_seconds integer,
  p_limit          integer
)
RETURNS TABLE (allowed boolean, hits integer)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window timestamptz;
  v_count  integer;
BEGIN
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'rate_limit_hit: p_window_seconds must be positive';
  END IF;

  -- The instant, floored to the window. Every request inside one window lands
  -- on the same row.
  v_window := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limit_counters AS c (key, window_start, count)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = c.count + 1
  RETURNING c.count INTO v_count;

  RETURN QUERY SELECT (v_count <= p_limit), v_count;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_hit(text, integer, integer) IS
  'Atomically counts one request against a fixed window and returns whether it is within p_limit. The only writer of rate_limit_counters.';

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;

/*
 * Old windows are dead weight the moment they close.
 *
 * Called from the queue cron rather than a pg_cron job, so it is visible in the
 * same place as the platform's other periodic work. Deleting by `window_start`
 * uses the index above.
 */
CREATE OR REPLACE FUNCTION public.rate_limit_prune(p_older_than interval DEFAULT interval '1 day')
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.rate_limit_counters
  WHERE window_start < now() - p_older_than;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_prune(interval) FROM PUBLIC, anon, authenticated;
