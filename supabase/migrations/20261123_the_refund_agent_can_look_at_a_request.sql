/*
 * The refund agent can look at a request before the owner does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS ADDS, AND WHAT IT STILL DOES NOT DO
 *
 * Still no money. `refund_requests` remains a record of a client ASKING and an
 * owner DECIDING; `lib/payments/RefundService.ts` remains the only thing that
 * returns a payment, with the over-refund check under a row lock, the
 * cross-currency refusal, two layers of idempotency and the ledger row written
 * before Stripe is called.
 *
 * What arrives here is the queue the assessment is claimed from, and the
 * columns its answer is written to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LIFECYCLE
 *
 *   submitted ──claim──► assessing ──► awaiting_owner ──► refunded
 *        ▲                   │                      └──► declined
 *        └───reap, backoff───┘                      └──► withdrawn
 *                            │                      └──► superseded
 *                            └──max attempts──► awaiting_owner, COLD
 *
 * THE LAST ARROW IS THE IMPORTANT ONE. A queue normally dead-letters a row it
 * cannot process, and a dead-lettered row is invisible until somebody goes
 * looking. This queue must not: the row is a person asking for their money
 * back. An assessment that fails five times means the OWNER did not get a
 * recommendation, never that the CLIENT did not ask.
 *
 * So the reaper's terminal state is `awaiting_owner` with no recommendation —
 * exactly what a business that never installed the agent sees. The card renders
 * the request cold, which is the state this whole feature shipped in before the
 * agent existed, and is strictly better than a hidden row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OPEN SET GREW BY ONE, IN THREE PLACES AT ONCE
 *
 * `assessing` is a row somebody is still waiting on, so it is OPEN: the card
 * must show it, the portal must not offer the booking again, and the unique
 * index must still refuse a second request. Those three readers are the
 * partial unique index below, `refundableBookingsFor`, and the
 * `refund_requested` gap — and they must agree or a client is offered a
 * booking whose insert then fails. `OPEN_REFUND_REQUEST_STATUSES` in
 * `RefundRequestRepository.ts` is the one spelling the TypeScript side reads.
 *
 * Requirement: docs/requirements/BUSINESS_OS_REFUND_AGENT_REQUIREMENT.md
 * Queue shape: BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1
 */

BEGIN;

/* ── 1. THE QUEUE COLUMNS (§8.1) ──────────────────────────────────────── */

ALTER TABLE public.refund_requests
  /* The runner instance holding the lease. */
  ADD COLUMN IF NOT EXISTS claimed_by uuid,
  /* The lease clock. A row still `assessing` past the lease is provably dead:
     the platform hard-kills at maxDuration, which the lease exceeds. */
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  /* Bumped on every claim, which is what drives the give-up above. */
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  /* Exponential backoff gate. NULL means eligible now. */
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

/* ── 2. WHAT THE AGENT ANSWERS ────────────────────────────────────────── */

ALTER TABLE public.refund_requests
  /*
   * What it would do, from a deliberately narrow set.
   *
   * No CHECK: the set will change as the agent is tuned, and a CHECK would
   * make every change a migration — the same reasoning as `reason`. The
   * drain validates against the schema it asked the model for, which is the
   * layer that actually knows what it accepted.
   *
   *   refund_full     return everything still refundable
   *   refund_partial  return `recommended_amount`
   *   decline         return nothing, and say why
   *   needs_owner     it will not call this one
   */
  ADD COLUMN IF NOT EXISTS recommendation text,
  /*
   * How much, in the request's own currency.
   *
   * A RECOMMENDATION, not a decision and not a cap. The owner edits it before
   * approving, and `RefundService` caps what actually moves against what was
   * really paid. Stored beside `currency`, which the row already carries, for
   * the same reason `amount_requested` is: a figure without its own currency
   * is a number nobody can safely add up.
   */
  ADD COLUMN IF NOT EXISTS recommended_amount numeric(12,2),
  /* Why, for the OWNER to read, in the owner's language. */
  ADD COLUMN IF NOT EXISTS reasoning text,
  /*
   * A reply to the client, in the CLIENT's language.
   *
   * Never sent by anything automatic. It reaches the client only through the
   * owner's own reply box, with their eyes on it and a second tap — the same
   * path the receptionist's drafts take.
   */
  ADD COLUMN IF NOT EXISTS client_message_draft text,
  /* When it looked. NULL means nothing has, which is what the card reads to
     decide between showing a recommendation and offering to install one. */
  ADD COLUMN IF NOT EXISTS assessed_at timestamptz,
  /*
   * Which payment this is about, resolved once.
   *
   * The request names a BOOKING, because that is what the client was thinking
   * of. The refund needs a transaction. Resolving it at assessment time and
   * keeping it is what lets the owner's approval name a specific payment
   * rather than a booking that might have two.
   */
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL;

/* ── 3. THE OPEN SET GREW: REBUILD THE UNIQUE INDEX ───────────────────── */

/*
 * Dropped and recreated rather than altered: a partial index's predicate
 * cannot be changed in place. The pair becomes a trio, and `assessing` joins
 * it because a request being looked at is still a request nobody has answered.
 */
DROP INDEX IF EXISTS public.idx_refund_requests_one_open_per_booking;

CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_one_open_per_booking
  ON public.refund_requests(user_id, booking_id)
  WHERE status IN ('submitted', 'assessing', 'awaiting_owner') AND booking_id IS NOT NULL;

/*
 * THE CLAIM'S OWN INDEX, on exactly the predicate the claim filters.
 *
 * The claim is the hot path and it reads one status. Indexing `created_at`
 * under `status = 'submitted'` is what keeps it a lookup rather than a scan of
 * every request this database has ever held.
 */
CREATE INDEX IF NOT EXISTS idx_refund_requests_claimable
  ON public.refund_requests(created_at)
  WHERE status = 'submitted';

/* ── 4. THE STATUS SET ────────────────────────────────────────────────── */

/*
 * `assessing` is the only addition. There is deliberately no `approved`,
 * `refunding` or `refund_failed`: those would describe money in flight, and
 * money in flight is `payment_refunds`, which has the row lock, the idempotency
 * and the ledger. A second table claiming to know the state of a refund is a
 * second answer to the question "did the money go back".
 */
ALTER TABLE public.refund_requests DROP CONSTRAINT IF EXISTS refund_requests_status_check;

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_status_check
  CHECK (status IN (
    'submitted',
    'assessing',
    'awaiting_owner',
    'refunded',
    'declined',
    'withdrawn',
    'superseded'
  ));

/* ── 5. THE CLAIM (§8.1) ──────────────────────────────────────────────── */

/*
 * `FOR UPDATE SKIP LOCKED` is why this is an RPC: the Supabase JS client
 * cannot express it, and without it two overlapping drains read the same rows
 * and assess them twice. One round trip, `RETURNING *` — claimed and read
 * together, never claimed then re-selected.
 */
CREATE OR REPLACE FUNCTION public.claim_due_refund_requests(p_runner uuid, p_batch int)
RETURNS SETOF public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $claim$
BEGIN
  RETURN QUERY
  UPDATE public.refund_requests
  SET status = 'assessing',
      claimed_by = p_runner,
      claimed_at = now(),
      attempts = attempts + 1
  WHERE id IN (
    SELECT inner_rows.id
    FROM public.refund_requests AS inner_rows
    WHERE inner_rows.status = 'submitted'
      AND (inner_rows.next_attempt_at IS NULL OR inner_rows.next_attempt_at <= now())
    ORDER BY inner_rows.created_at
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END
$claim$;

REVOKE ALL ON FUNCTION public.claim_due_refund_requests(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_refund_requests(uuid, int) TO service_role;

/* ── 6. THE REAPER, WHICH GIVES UP TOWARDS THE OWNER ──────────────────── */

/*
 * A row still `assessing` past the lease is provably dead rather than slow:
 * the lease is longer than the route's `maxDuration`, and the platform kills
 * the function at that. So it is safe to take it back.
 *
 * Under the attempt limit it returns to `submitted` with backoff. AT the limit
 * it goes to `awaiting_owner` — see the header. The owner sees the request
 * with no recommendation, which is what a business without the agent sees and
 * is the whole point: the agent failing must cost the owner a recommendation,
 * never cost the client their request.
 */
CREATE OR REPLACE FUNCTION public.reap_stale_refund_requests(p_lease_seconds int, p_max_attempts int)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $reap$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    SELECT id, attempts
    FROM public.refund_requests
    WHERE status = 'assessing'
      AND claimed_at IS NOT NULL
      AND claimed_at < now() - make_interval(secs => p_lease_seconds)
    FOR UPDATE SKIP LOCKED
  ),
  reclaimed AS (
    UPDATE public.refund_requests AS target
    SET
      status = CASE WHEN stale.attempts >= p_max_attempts THEN 'awaiting_owner' ELSE 'submitted' END,
      claimed_by = NULL,
      claimed_at = NULL,
      /* Backoff only matters for a row that will be tried again. Doubling per
         attempt, capped by the arithmetic rather than by a branch. */
      next_attempt_at = CASE
        WHEN stale.attempts >= p_max_attempts THEN NULL
        ELSE now() + make_interval(secs => least(3600, 60 * power(2, stale.attempts)::int))
      END
    FROM stale
    WHERE target.id = stale.id
    RETURNING target.id
  )
  SELECT count(*) INTO v_count FROM reclaimed;

  RETURN v_count;
END
$reap$;

REVOKE ALL ON FUNCTION public.reap_stale_refund_requests(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_refund_requests(int, int) TO service_role;

/* ── 7. MONEY WENT BACK, SO THE REQUEST IS ANSWERED ───────────────────── */

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEREVER THE REFUND CAME FROM.
 *
 * A client asks on a form; the owner can answer from the card, the Finance
 * page, the chat, the Stripe dashboard, or the Stripe plugin inside an agent
 * workflow. Only the first three are paths this application can see. The other
 * two arrive as a webhook, as does any refund this app issued that Stripe
 * finished asynchronously — `refund()` returns IN_FLIGHT and the money settles
 * minutes later.
 *
 * All of them write one row: `payment_refunds`, status `succeeded`. That is the
 * one place that knows money came back, so that is where the request is
 * answered. A hook in application code would have had to be added to each path
 * and would still have missed the two it cannot reach.
 *
 * IT CANNOT BREAK A REFUND. The exception block is the point: recording that
 * money went back must never fail because of bookkeeping about a request. A
 * failure leaves a settled refund and a stale card, warns in the Postgres log,
 * and is recoverable by hand. The reverse — a refund rolled back because a
 * request could not be updated — is not.
 *
 * It is scoped to the open statuses, so it cannot overwrite a decision, and to
 * the refund's own `user_id`, so one business cannot settle another's request.
 * Running twice changes nothing the first run did not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
CREATE OR REPLACE FUNCTION public.settle_refund_request_on_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $settle$
DECLARE
  v_booking_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'succeeded' THEN
    RETURN NEW;
  END IF;

  BEGIN
    /*
     * Which booking this payment was for. The same two links the portal
     * follows: a website sale writes `booking_id` on the transaction, while an
     * invoiced booking leaves it null and carries the booking on the invoice.
     */
    SELECT coalesce(tx.booking_id, inv.booking_id)
      INTO v_booking_id
      FROM public.payment_transactions AS tx
      LEFT JOIN public.payment_invoices AS inv ON inv.id = tx.invoice_id
     WHERE tx.id = NEW.transaction_id
       AND tx.user_id = NEW.user_id;

    IF v_booking_id IS NULL THEN
      RETURN NEW;
    END IF;

    UPDATE public.refund_requests
       SET status = 'refunded',
           decided_at = now(),
           updated_at = now()
     WHERE user_id = NEW.user_id
       AND booking_id = v_booking_id
       AND status IN ('submitted', 'assessing', 'awaiting_owner');

  EXCEPTION WHEN OTHERS THEN
    /* Warned, not raised. See the header: a refund outlives its bookkeeping. */
    RAISE WARNING 'Could not settle the refund request for transaction %: %',
      NEW.transaction_id, SQLERRM;
  END;

  RETURN NEW;
END
$settle$;

/*
 * INSERT and UPDATE, never DELETE.
 *
 * A refund can be born succeeded (the app issued it and Stripe answered at
 * once, or the owner settled it by hand) or become succeeded later (Stripe
 * finished it and the webhook moved the row on). Both must answer the request.
 *
 * Deliberately NOT a DELETE trigger: `G-17` of the operator cleanup refuses
 * every check and delete on an unreviewed DELETE trigger over a table in its
 * plan, and this needs no such thing. `G-21` reviews UPDATE triggers only on
 * the login and the anonymise-blank tables, which this is not. So no
 * regeneration of the cleanup function is required by this migration.
 */
/*
 * LOCKED DOWN LIKE THE TWO RPCs ABOVE.
 *
 * `SECURITY DEFINER` means this runs with the definer's rights, so leaving
 * EXECUTE with PUBLIC lets any signed-in client call it directly rather than
 * only through the trigger. It writes `refund_requests.status`, so a direct
 * caller could settle somebody's refund request out from under them.
 *
 * The claim and reap functions in this same file were revoked; this one was
 * missed. `security-definer-surface.guard` caught it (rule R-a).
 *
 * Nothing breaks: a trigger executes as the table owner and never consults
 * the caller's EXECUTE grant, so revoking it changes no behaviour at all.
 *
 * ALSO APPLIED BY 20261126, because this migration had already run in
 * production by the time the omission was found — editing a file that has
 * been applied changes nothing on the database.
 */
REVOKE EXECUTE ON FUNCTION public.settle_refund_request_on_refund() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_refund_request_on_refund() TO service_role;

DROP TRIGGER IF EXISTS settle_refund_request_on_refund_trigger ON public.payment_refunds;

CREATE TRIGGER settle_refund_request_on_refund_trigger
  AFTER INSERT OR UPDATE OF status ON public.payment_refunds
  FOR EACH ROW
  EXECUTE FUNCTION public.settle_refund_request_on_refund();

COMMENT ON COLUMN public.refund_requests.recommendation IS
  'What the agent would do. A RECOMMENDATION: the owner decides, and RefundService '
  'decides what is possible. Never read as an instruction by anything that moves money.';

COMMIT;
