/*
 * A client can ask for their money back, and the business finds out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * A REQUEST. Nothing here moves money, and nothing here may ever be allowed to.
 * The refund itself is `lib/payments/RefundService.ts`, which owns the guards
 * that make one safe: the over-refund check under a row lock, the cross-currency
 * refusal, two layers of idempotency, the ledger row written before Stripe is
 * called. A row in this table is a client saying "please", and an owner's
 * decision about it.
 *
 * Today a refund request arrives as an email and lives in an inbox. The owner
 * reads it, hunts the CRM for the booking, opens Stripe for the charge, decides,
 * and answers. Nothing is recorded and the client waits a day.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT NAMES A BOOKING, NOT A PAYMENT
 *
 * Because that is what the person asking is thinking of — "the session I
 * cancelled", never `a876d569`. The money behind a booking is resolved at the
 * moment it matters, by code that already knows the two ways a payment hangs
 * off one (`booking_id` on the transaction, or an invoice that carries it).
 *
 * `amount_requested` is what they ASKED for, frozen as they typed it. It is not
 * what will be refunded: the owner decides that, and the database decides what
 * is possible. Keeping the ask is what lets a card say "they asked for ₪400"
 * next to "you returned ₪300".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ON DELETE FOR EACH LINK, EACH FOR ITS OWN REASON
 *
 *   user_id      CASCADE. The business goes, its clients' requests go. The FK
 *                to `business_profiles` below is what actually enforces that —
 *                see 20261119, and the pipeline stages that leaked without it.
 *   contact_id   SET NULL. A deleted contact must not take the record of what
 *                they asked for with it; the owner may still owe them an answer.
 *   booking_id   SET NULL, for the same reason, and because `payment_refunds`
 *                already carries the authoritative record of any money moved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO QUEUE COLUMNS YET, DELIBERATELY
 *
 * `claimed_by`, `attempts` and a claim RPC belong with the drain that uses
 * them, and nothing drains this in the first slice — the owner reads the
 * request on their card and acts. The durable-queue rule is "never schedule
 * the cron before the claim exists"; this is the same rule one step earlier.
 *
 * Requirement: docs/requirements/BUSINESS_OS_REFUND_AGENT_REQUIREMENT.md
 */

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /* Whose business this is. Denormalised so RLS is stated on this row alone. */
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  /* Who asked. Null once a contact is deleted; the request survives them. */
  contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,

  /* What it is about, in the client's own terms. */
  booking_id uuid REFERENCES public.scheduling_bookings(id) ON DELETE SET NULL,

  /*
   * What they asked for, and in what.
   *
   * The currency is stored beside the amount and never inferred: a business may
   * price one client in another currency, `scheduling_services.currency` is the
   * authority, and a figure without its own currency is a number nobody can
   * safely add up. CLAUDE.md § Currency.
   */
  amount_requested numeric(12,2) NOT NULL CHECK (amount_requested > 0),
  currency text NOT NULL,

  /*
   * Why, in the five words the owner's own refund dialog already uses
   * (lib/payments/refundReasons.ts). Plain text and not an enum, for the same
   * reason `payment_refunds.reason` is: the list has changed once and a CHECK
   * would have made that a migration.
   */
  reason text,
  /* And anything they wanted to add, in their words. */
  note text,

  /*
   * Where it got to.
   *
   *   submitted       the client sent it; nobody has looked
   *   awaiting_owner  it is on the owner's card, waiting for a decision
   *   refunded        the owner returned money. `payment_refunds` has the truth
   *   declined        the owner said no
   *   withdrawn       the client took it back
   *   superseded      the money was refunded another way before this was answered
   *
   * No `assessing`: nothing assesses it yet.
   */
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'awaiting_owner', 'refunded', 'declined', 'withdrawn', 'superseded')),

  /* How it reached us, so the card can say so and so the email path can be
     measured against the portal one later. */
  source text NOT NULL DEFAULT 'portal_form'
    CHECK (source IN ('portal_form', 'email', 'owner')),

  /*
   * One live request per booking.
   *
   * A client pressing send twice, or asking again next week while the first is
   * still open, must not produce two cards about one thing. Partial, so a
   * settled request does not block a later, genuine one — somebody refunded a
   * deposit in March may reasonably ask about the balance in June.
   */
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_one_open_per_booking
  ON public.refund_requests(user_id, booking_id)
  WHERE status IN ('submitted', 'awaiting_owner') AND booking_id IS NOT NULL;

/* The card's own query: this owner's open requests, newest first. */
CREATE INDEX IF NOT EXISTS idx_refund_requests_open
  ON public.refund_requests(user_id, status, created_at DESC);

/* And the contact drawer's: everything this person ever asked. */
CREATE INDEX IF NOT EXISTS idx_refund_requests_contact
  ON public.refund_requests(contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

/*
 * BUSINESS OWNERSHIP, the constraint that is easy to forget and silent to miss.
 *
 * `20260916_business_data_ownership.sql` gives every table carrying a `user_id`
 * a foreign key to `business_profiles(user_id)`, so removing the business row
 * removes its data. A table left out keeps its rows: they survive the deletion
 * and are inherited by whoever next holds that `user_id`. That is how the
 * pipeline stages and the capabilities leaked (20261119), and a client's refund
 * request — their words, about their money — is a bad row to leave behind.
 *
 * Added HERE because that migration's loop has already run on every existing
 * database and will never see this name. `NOT VALID` matches the loop: new and
 * changed rows are checked without re-reading a table that is empty anyway.
 */
DO $business_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_requests_business_fk'
      AND conrelid = 'public.refund_requests'::regclass
  ) THEN
    ALTER TABLE public.refund_requests
      ADD CONSTRAINT refund_requests_business_fk
      FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END
$business_fk$;

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage their own refund requests" ON public.refund_requests;
CREATE POLICY "Owners manage their own refund requests"
  ON public.refund_requests FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
/*
 * The CLIENT never reaches this policy. They have no session — the portal
 * writes through the service role after verifying a signed token against the
 * booking's own contact email, exactly as cancel, reschedule and intake do.
 * There is deliberately no `anon` or `authenticated` grant here.
 */

COMMENT ON TABLE public.refund_requests IS
  'A client asking for money back, and the owner''s decision. Never moves money: '
  'the refund itself goes through lib/payments/RefundService.ts, which owns the '
  'over-refund, currency and idempotency guards. amount_requested is what was '
  'ASKED, not what was returned — payment_refunds holds that.';
