-- ============================================================================
-- Every business event, captured at the table instead of at the call site.
-- ============================================================================
--
-- WHY THIS IS IN THE DATABASE
--
-- The rail was emitted from repositories, and an audit on 2026-10-06 found
-- TWELVE write paths that never reach one. They are not obscure paths -- they
-- are the paths that matter:
--
--   stripe webhook x4   insert a succeeded payment_transaction directly
--   stripe webhook x2   set payment_invoices.status = 'paid'
--   stripe webhook x1   set payment_invoices.status = 'overdue'
--   invoiceSettlement   does both of the above
--   booking/finalize    inserts a succeeded transaction
--   bookings/:id/refund sets refund_status directly
--   website/booking/create  inserts the booking a CLIENT made
--
-- So `invoice.paid` only ever fired when the owner marked an invoice by hand,
-- never when Stripe actually paid it, and `booking.created` fired only for
-- bookings the owner typed in themselves. CLAUDE.md rule 1 says all DB access
-- goes through repositories; the Stripe webhook writes with the service role
-- across ~20 statements and does not.
--
-- Adding twelve emit calls would fix those twelve and miss the thirteenth
-- somebody adds next month -- which is exactly how the rail got here. A trigger
-- cannot be bypassed: there is no way to write the row without it firing, from
-- any route, any script, any psql session, now or later.
--
-- WHY IT CANNOT DUPLICATE
--
-- The application check was `read status; write; compare`, which is not atomic:
-- live data had `booking.completed` three times for one booking inside 0.7
-- seconds because three concurrent callers each read the pre-state. A trigger
-- sees OLD and NEW of the same row inside the same transaction, so
-- `OLD.status IS DISTINCT FROM NEW.status` is exact. Concurrent writers are
-- serialised by the row lock and only one of them produces a transition.
--
-- `IS DISTINCT FROM` rather than `<>` because either side can be NULL, and
-- `NULL <> 'paid'` is NULL, which would skip the event.
--
-- WHAT IT DOES NOT COVER
--
-- `enquiry.received` and `form.submitted` stay in the application: they are
-- judgements about app state, not a row transition any table can observe.
-- Those have no bypass problem -- LeadAlertService is their only writer.
--
-- IDEMPOTENT AND REPEATABLE: every object is CREATE OR REPLACE / DROP IF
-- EXISTS, so applying this twice is harmless.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared writer.
--
-- SECURITY DEFINER because the trigger must write `business_events` on behalf
-- of whichever role made the original write, including the anon role on a
-- public booking page. `search_path` is pinned per Supabase linter guidance:
-- a SECURITY DEFINER function with a mutable search_path is a privilege
-- escalation vector.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_business_event(
  p_user_id uuid,
  p_event_type text,
  p_category text,
  p_entity_type text,
  p_entity_id uuid,
  p_contact_id uuid,
  p_value numeric,
  p_metadata jsonb,
  p_source text,
  p_occurred_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A row with no owner or no subject is not an event.
  IF p_user_id IS NULL OR p_entity_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.business_events (
    user_id, event_type, category, entity_type, entity_id,
    contact_id, value_usd, metadata, source_capability, created_at
  ) VALUES (
    p_user_id, p_event_type, p_category, p_entity_type, p_entity_id,
    p_contact_id,
    -- Zero is "worth nothing", NULL is "not known". Keep them distinct.
    NULLIF(p_value, 0),
    COALESCE(p_metadata, '{}'::jsonb),
    p_source,
    COALESCE(p_occurred_at, now())
  );
EXCEPTION WHEN OTHERS THEN
  /*
   * The rail must never fail the business write.
   *
   * A booking is booked and an invoice is paid whether or not we managed to
   * take a note about it. Swallowing here is the SQL equivalent of the
   * application's `void emit(...).catch()`, and it is why this trigger is safe
   * to put on a payment table: the worst case is a missing event, which
   * `scripts/backfill-business-events.ts` reconstructs.
   */
  RAISE WARNING 'business event not recorded: % % (%)', p_event_type, p_entity_id, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.record_business_event(uuid,text,text,text,uuid,uuid,numeric,jsonb,text,timestamptz) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- scheduling_bookings -> booking.created / .cancelled / .completed / .no_show
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_booking_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  /*
   * The open end of the lifecycle. The three ways a booking ENDS were already
   * on the rail; nothing recorded one beginning, so a cancellation rate had a
   * numerator and no denominator. INSERT-only trigger, so no status handling.
   */
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'booking.created', 'retention', 'booking', NEW.id, NEW.contact_id,
      NULL,
      jsonb_build_object(
        'service_id', NEW.service_id,
        'booking_source', NEW.booking_source,
        'is_recurrence_child', NEW.parent_booking_id IS NOT NULL
      ),
      'scheduling', NEW.created_at
    );
    RETURN NEW;
  END IF;

  /*
   * DELIBERATELY NOT HERE: booking.cancelled / .completed / .no_show.
   *
   * Exactly one writer per event type, or the two mechanisms duplicate each
   * other. Those three are the only table-derived events with NO bypass --
   * `SchedulingBookingRepository.update()` is the single place booking status
   * changes, verified by audit -- and they are already emitted there through an
   * atomic `.neq('status', target)` claim. Moving them here would gain nothing
   * and would break capture for anyone who has not yet applied this migration.
   *
   * Everything else in this file is a type whose application path WAS bypassed,
   * so the trigger is the only writer and there is nothing to collide with.
   */
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_events ON public.scheduling_bookings;
CREATE TRIGGER trg_booking_events
  AFTER INSERT ON public.scheduling_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_events();

-- ---------------------------------------------------------------------------
-- payment_invoices -> invoice.created / .paid / .overdue / .cancelled
--
-- `amount` is the money column. There is NO `total` column on this table --
-- the repository already warns about the phantom `total_amount`, and `total`
-- is the same mistake by another name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_invoice_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meta jsonb;
BEGIN
  v_meta := jsonb_build_object('currency', NEW.currency, 'due_date', NEW.due_date);

  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'invoice.created', 'cash_flow', 'invoice', NEW.id, NEW.contact_id,
      NEW.amount, v_meta, 'payments', NEW.created_at
    );
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'paid' THEN
      PERFORM public.record_business_event(
        NEW.user_id, 'invoice.paid', 'cash_flow', 'invoice', NEW.id, NEW.contact_id,
        NEW.amount, v_meta, 'payments',
        -- When it was actually paid, not when the row was touched.
        COALESCE(NEW.paid_at, now())
      );
    ELSIF NEW.status = 'overdue' THEN
      PERFORM public.record_business_event(
        NEW.user_id, 'invoice.overdue', 'cash_flow', 'invoice', NEW.id, NEW.contact_id,
        NEW.amount, v_meta, 'payments', now()
      );
    ELSIF NEW.status = 'cancelled' THEN
      PERFORM public.record_business_event(
        NEW.user_id, 'invoice.cancelled', 'cash_flow', 'invoice', NEW.id, NEW.contact_id,
        NEW.amount, v_meta, 'payments', now()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_events ON public.payment_invoices;
CREATE TRIGGER trg_invoice_events
  AFTER INSERT OR UPDATE ON public.payment_invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_events();

-- ---------------------------------------------------------------------------
-- payment_transactions -> payment.completed / payment.failed / refund.completed
--
-- One row can be BOTH a completed payment and a completed refund: a partial
-- refund leaves `status = 'succeeded'` and only moves `refund_status`. The two
-- branches below are therefore independent, not an IF/ELSE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_transaction_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meta jsonb;
BEGIN
  v_meta := jsonb_build_object('invoice_id', NEW.invoice_id, 'currency', NEW.currency);

  -- Money in. On insert when it already succeeded, or on the transition into it.
  IF (TG_OP = 'INSERT' AND NEW.status = 'succeeded')
     OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'succeeded') THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'payment.completed', 'cash_flow', 'invoice', NEW.id, NEW.contact_id,
      NEW.amount, v_meta, 'payments', NEW.created_at
    );
  END IF;

  /*
   * A failed charge, only on the transition.
   *
   * Deliberately NOT emitted on insert: a retry writes another row, so
   * counting failures from inserts counts one struggling payment many times.
   */
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'failed' THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'payment.failed', 'cash_flow', 'invoice', NEW.id, NEW.contact_id,
      NEW.amount, v_meta, 'payments', now()
    );
  END IF;

  -- Money back. The REFUNDED amount, not the original charge.
  IF NEW.refund_status IN ('full', 'partial')
     AND (TG_OP = 'INSERT' OR OLD.refund_status IS DISTINCT FROM NEW.refund_status) THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'refund.completed', 'cash_flow', 'invoice', NEW.id, NEW.contact_id,
      COALESCE(NULLIF(NEW.refunded_amount, 0), NEW.amount),
      v_meta || jsonb_build_object(
        'reason', NEW.refund_reason,
        'is_full_refund', NEW.refund_status = 'full',
        'original_amount', NEW.amount
      ),
      'payments', COALESCE(NEW.refunded_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transaction_events ON public.payment_transactions;
CREATE TRIGGER trg_transaction_events
  AFTER INSERT OR UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_transaction_events();

-- ---------------------------------------------------------------------------
-- proposals -> proposal.sent / .accepted / .rejected
--
-- `proposal.rejected` is the taxonomy's name for it; the column that carries
-- the reason is `decline_reason` and the status is `declined`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_proposal_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meta jsonb;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_meta := jsonb_build_object(
    'currency', NEW.currency,
    'service_id', NEW.service_id,
    'from_status', OLD.status
  );

  IF NEW.status = 'sent' THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'proposal.sent', 'sales', 'proposal', NEW.id, NEW.contact_id,
      NEW.total, v_meta, 'crm', COALESCE(NEW.sent_at, now())
    );
  ELSIF NEW.status = 'accepted' THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'proposal.accepted', 'sales', 'proposal', NEW.id, NEW.contact_id,
      NEW.total, v_meta, 'crm', COALESCE(NEW.decided_at, now())
    );
  ELSIF NEW.status = 'declined' THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'proposal.rejected', 'sales', 'proposal', NEW.id, NEW.contact_id,
      NEW.total,
      -- The reason is the entire content of ConvDeclineReasonDetector.
      v_meta || jsonb_build_object('decline_reason', NEW.decline_reason),
      'crm', COALESCE(NEW.decided_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposal_events ON public.proposals;
CREATE TRIGGER trg_proposal_events
  AFTER UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_proposal_events();

COMMENT ON FUNCTION public.record_business_event(uuid,text,text,text,uuid,uuid,numeric,jsonb,text,timestamptz)
  IS 'Single writer for business_events from table triggers. Swallows its own errors: the rail must never fail a payment or a booking. Added 2026-10-06 after an audit found 12 application write paths that bypassed the repository emitters.';
