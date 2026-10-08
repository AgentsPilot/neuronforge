-- ============================================================================
-- Close every remaining event gap that a trigger can close.
-- ============================================================================
--
-- `20261006_business_event_triggers.sql` closed the money spine. This closes
-- the rest, and records which gaps a trigger CANNOT close and why, so the next
-- person does not re-derive that list.
--
-- HOW THE PRIORITY WAS ESTABLISHED
--
-- `eventTypes` on a DETECTOR definition is decorative -- nothing reads it, and
-- the three detectors declaring `page.viewed` query `website_page_views`
-- directly. Same class of field as `minSamples`, which was declared by all 44
-- detectors and read by none.
--
-- `eventTypes` in `insight/metrics/types.ts` is NOT decorative:
-- `MetricsComputeService` counts `business_events` by type to produce
-- `derived_metrics`, and a metric definition has no table option -- the rail is
-- its only possible input. Five of its ten declared types were never emitted,
-- so five metrics computed from an empty set:
--
--   page.viewed          acquisition.page_views
--   contact.created      conversion.new_contacts
--   enquiry.replied      sales.enquiries_replied
--   enquiry.stalled      (time-based, see below)
--   calendar.slot_filled (no slot model, see below)
--
-- WHAT A TRIGGER CANNOT CLOSE, AND THE REAL REASON
--
--   enquiry.stalled      Not a transition. "N days passed with no reply" is a
--   ar.aged              condition that becomes true while NOTHING is written,
--                        so no row-level trigger can observe it. Needs a cron
--                        comparing timestamps, the way `markOverdueInvoices`
--                        already does for invoices.
--
--   calendar.slot_filled There is no slot entity. `OpsUtilizationLowDetector`
--   calendar.utilization_* measures booked hours against stated availability
--                        directly, which is the better answer anyway.
--
--   discount.applied     No `discount`, `intro`, `trial`, `promo` or `coupon`
--   intro_offer.used     column exists on services, invoices, proposals or
--   intro_offer.converted bookings. Verified 2026-10-06. This is why
--                        `PricingDiscountAbuse` is dark.
--
--   invoice.viewed       `payment_invoices` has `sent_at` but no `viewed_at`.
--                        Proposals have one; invoices never got it.
--
--   form.abandoned       Client-side only; nothing server-side ever learns it.
--   lead.qualified       A judgement no column records.
--
--   client.at_risk       CONCLUSIONS, not events. These are detector OUTPUT,
--   client.churned       and putting them on the rail would have detectors
--   client.rebooking_due reasoning from their own prior verdicts.
--
--   revenue.recognized   An accounting aggregate over `invoice.paid`, not a
--                        thing that happens.
--
-- A NOTE ON page.viewed VOLUME
--
-- This is the one event here with unbounded volume: one row per page view,
-- duplicating `website_page_views` roughly 1:1 (292 rows today). It is emitted
-- because the metrics layer has no way to read a table, and `is_owner_view`
-- rows are skipped so the owner testing their own site does not inflate it. If
-- traffic ever makes the duplication expensive, the right fix is to give
-- `MetricsComputeService` a table source and drop this trigger -- not to
-- sample it.
--
-- IDEMPOTENT: every object is CREATE OR REPLACE / DROP IF EXISTS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- website_page_views -> page.viewed / page.session_started
--
-- `page.session_started` fires on the FIRST view carrying a given session_id,
-- which is what makes it a session count rather than a second view count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_page_view_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- The owner checking their own page is not an audience. `countUniqueVisitors`
  -- in InsightRepository excludes these too; the two must agree.
  IF NEW.is_owner_view IS TRUE THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_business_event(
    NEW.user_id, 'page.viewed', 'acquisition', 'page', NEW.page_id, NULL,
    NULL,
    jsonb_build_object(
      'subdomain', NEW.subdomain,
      'device_type', NEW.device_type,
      'country_code', NEW.country_code,
      'utm_source', NEW.utm_source
    ),
    'website', NEW.viewed_at
  );

  IF NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.website_page_views v
    WHERE v.user_id = NEW.user_id
      AND v.session_id = NEW.session_id
      AND v.id <> NEW.id
  ) THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'page.session_started', 'acquisition', 'session', NEW.page_id, NULL,
      NULL,
      jsonb_build_object('session_id', NEW.session_id, 'referer', NEW.referer),
      'website', NEW.viewed_at
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_page_view_events ON public.website_page_views;
CREATE TRIGGER trg_page_view_events
  AFTER INSERT ON public.website_page_views
  FOR EACH ROW EXECUTE FUNCTION public.tg_page_view_events();

-- ---------------------------------------------------------------------------
-- crm_contacts -> contact.created / contact.stage_changed
--
-- `stage_entered_at` (20260928) already records WHEN a stage was entered on the
-- contact row. This records THAT it happened, with the stage moved from, which
-- the column cannot carry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_contact_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'contact.created', 'conversion', 'contact', NEW.id, NEW.id,
      NULL,
      jsonb_build_object('stage', NEW.stage, 'source', NEW.source),
      'crm', NEW.created_at
    );
    RETURN NEW;
  END IF;

  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'contact.stage_changed', 'conversion', 'contact', NEW.id, NEW.id,
      NULL,
      -- The pair is the whole content: a move INTO a client stage and a move
      -- OUT of one are opposite facts about the same contact.
      jsonb_build_object('from_stage', OLD.stage, 'to_stage', NEW.stage),
      'crm', COALESCE(NEW.stage_entered_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_events ON public.crm_contacts;
CREATE TRIGGER trg_contact_events
  AFTER INSERT OR UPDATE ON public.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_contact_events();

-- ---------------------------------------------------------------------------
-- crm_activities -> enquiry.replied
--
-- The outbound set is copied from `SalesReplySlowDetector`, which already
-- treats exactly these as "the owner got back to them". Keep the two in step:
-- if one gains a type and the other does not, the metric and the detector will
-- disagree about what a reply is.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_activity_reply_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.activity_type NOT IN (
    'email', 'booking_link_sent', 'booking_confirmation_sent', 'proposal_sent', 'invoice_sent'
  ) THEN
    RETURN NEW;
  END IF;

  -- An activity with no contact is not a reply to anybody.
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_business_event(
    NEW.user_id, 'enquiry.replied', 'sales', 'activity', NEW.id, NEW.contact_id,
    NULL,
    jsonb_build_object('activity_type', NEW.activity_type, 'auto_logged', NEW.auto_logged),
    'crm', COALESCE(NEW.activity_date, NEW.created_at)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activity_reply_events ON public.crm_activities;
CREATE TRIGGER trg_activity_reply_events
  AFTER INSERT ON public.crm_activities
  FOR EACH ROW EXECUTE FUNCTION public.tg_activity_reply_events();

-- ---------------------------------------------------------------------------
-- scheduling_services -> service.created / .updated / .disabled, pricing.changed
--
-- `pricing.changed` is the one event here with no other home: nothing records a
-- price history, so without it "did raising the price lose bookings" is
-- unanswerable even in principle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_service_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'service.created', 'operations', 'service', NEW.id, NULL,
      NEW.price,
      jsonb_build_object('service_name', NEW.service_name, 'currency', NEW.currency, 'status', NEW.status),
      'scheduling', NEW.created_at
    );
    RETURN NEW;
  END IF;

  -- Price first: it is the one change with a number worth carrying.
  IF OLD.price IS DISTINCT FROM NEW.price THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'pricing.changed', 'pricing', 'service', NEW.id, NULL,
      NEW.price,
      jsonb_build_object(
        'from_price', OLD.price,
        'to_price', NEW.price,
        'currency', NEW.currency,
        'service_name', NEW.service_name
      ),
      'scheduling', now()
    );
  END IF;

  IF OLD.is_active IS DISTINCT FROM NEW.is_active AND NEW.is_active IS FALSE THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'service.disabled', 'operations', 'service', NEW.id, NULL,
      NEW.price,
      jsonb_build_object('service_name', NEW.service_name, 'status', NEW.status),
      'scheduling', now()
    );
    RETURN NEW;
  END IF;

  /*
   * `service.updated` covers the rest, and deliberately does NOT fire for a
   * price change or a disable -- those are the specific things that happened,
   * and emitting both would double-count one edit.
   *
   * `updated_at` is excluded from the comparison because every write touches
   * it, so including it would make this fire on no change at all.
   */
  IF OLD.price IS NOT DISTINCT FROM NEW.price
     AND OLD.is_active IS NOT DISTINCT FROM NEW.is_active
     AND (
       OLD.service_name IS DISTINCT FROM NEW.service_name
       OR OLD.duration_minutes IS DISTINCT FROM NEW.duration_minutes
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.availability IS DISTINCT FROM NEW.availability
     ) THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'service.updated', 'operations', 'service', NEW.id, NULL,
      NEW.price,
      jsonb_build_object('service_name', NEW.service_name, 'status', NEW.status),
      'scheduling', now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_events ON public.scheduling_services;
CREATE TRIGGER trg_service_events
  AFTER INSERT OR UPDATE ON public.scheduling_services
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_events();

-- ---------------------------------------------------------------------------
-- booking.confirmed, added to the existing booking trigger.
--
-- The booking trigger was INSERT-only so it could not collide with the three
-- end-states the application still owns. `confirmed` is not one of those three,
-- so it is safe here and completes the funnel: without it, "booked but never
-- confirmed" is invisible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_booking_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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
   * ONLY `confirmed` on update.
   *
   * `cancelled`, `completed` and `no_show` stay with
   * `SchedulingBookingRepository.update()`, which emits them off an atomic
   * `.neq('status', target)` claim. Exactly one writer per event type, or the
   * two mechanisms duplicate each other.
   */
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'confirmed' THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'booking.confirmed', 'retention', 'booking', NEW.id, NEW.contact_id,
      NEW.payment_amount,
      jsonb_build_object('service_id', NEW.service_id, 'from_status', OLD.status),
      'scheduling', now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_events ON public.scheduling_bookings;
CREATE TRIGGER trg_booking_events
  AFTER INSERT OR UPDATE ON public.scheduling_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_events();

-- ---------------------------------------------------------------------------
-- invoice.sent, added to the existing invoice trigger.
--
-- This is the AR clock. Until now "how long did this take to get paid" could
-- only be measured from `invoice.created`, which is when it was DRAFTED.
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
    IF NEW.status = 'sent' THEN
      PERFORM public.record_business_event(
        NEW.user_id, 'invoice.sent', 'cash_flow', 'invoice', NEW.id, NEW.contact_id,
        NEW.amount, v_meta, 'payments', COALESCE(NEW.sent_at, now())
      );
    ELSIF NEW.status = 'paid' THEN
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
-- proposal.viewed, added to the existing proposal trigger.
--
-- `proposals.viewed_at` exists and `ProposalRepository.markViewed()` writes it,
-- so this needs no new column -- it was simply never on the rail. Keyed on the
-- column going from NULL to set, so a second view of the same quote is not a
-- second event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_proposal_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meta jsonb;
BEGIN
  v_meta := jsonb_build_object(
    'currency', NEW.currency,
    'service_id', NEW.service_id,
    'from_status', OLD.status
  );

  IF OLD.viewed_at IS NULL AND NEW.viewed_at IS NOT NULL THEN
    PERFORM public.record_business_event(
      NEW.user_id, 'proposal.viewed', 'sales', 'proposal', NEW.id, NEW.contact_id,
      NEW.total, v_meta, 'crm', NEW.viewed_at
    );
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

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
