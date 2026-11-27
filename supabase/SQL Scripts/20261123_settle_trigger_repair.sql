/*
 * REPAIR: the half of 20261123 that never landed.
 *
 * Paste the whole file into the Supabase SQL editor and run it once, then run
 * `20261123_refund_agent_checker.sql` beside this file — every row must read
 * `t`, including the four rows added on the strength of this repair.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * APPLIED 26 November 2026, and verified: all fourteen checker rows read `t`,
 * the last four of them asserting exactly what was missing. Kept as the record
 * of what was run, and because it is safe to run again (see below).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MISSING AND HOW WE KNEW
 *
 * Checked against the live database on 26 November 2026. Most of what 20261123
 * declares was present: all ten columns, both queue functions with their
 * definer rights and `search_path` pin, both indexes, and the widened status
 * CHECK. Two were not:
 *
 *   · public.settle_refund_request_on_refund()         not defined
 *   · settle_refund_request_on_refund_trigger          not found
 *
 * It was not a missing table — `payment_refunds` is there with 41 rows — so the
 * migration stopped between section 6 and section 7 rather than failing on a
 * dependency.
 *
 * 20261126 is also unapplied as a consequence: its entire content is a REVOKE
 * and a GRANT on that function, which errors while the function does not
 * exist. The REVOKE/GRANT below is the same pair, so running this makes that
 * migration a no-op rather than something still owed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS SAFE TO RUN
 *
 * Every statement is `CREATE OR REPLACE`, `DROP ... IF EXISTS` or a grant, and
 * the body is copied verbatim from the migration rather than retyped. Running
 * it on a database where the function DOES exist replaces it with the same
 * definition and changes nothing.
 *
 * It touches no rows. The trigger it installs only fires on future writes to
 * `payment_refunds`; the 41 rows already there are not revisited, and the four
 * existing refund_requests were settled by the owner deciding in the app, so
 * none of them is waiting on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGES AFTERWARDS
 *
 * A refund that lands by a route the application cannot see — the Stripe
 * dashboard, the Stripe plugin inside an agent workflow, or an async webhook
 * settling minutes later — will close its refund_request instead of leaving
 * the card open. That path is silent today.
 */

BEGIN;

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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THEN VERIFY, with the checker that shipped with the migration itself:
 *
 *   \i 'supabase/SQL Scripts/20261123_refund_agent_checker.sql'
 *
 * It is read-only and every row must read `t`. The four rows at its end were
 * added by this repair, because the original checker asserted the TRIGGER and
 * not the function behind it — so it reported the symptom, and a repair that
 * installed one without the other would still have read as green.
 *
 * The outcome on 26 November 2026: fourteen rows, all `t`.
 */
