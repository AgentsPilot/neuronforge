BEGIN;

GRANT EXECUTE ON FUNCTION public.advance_contact_on_completed_booking() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_set_agent_org_id() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_user_settings() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_smart_link_click_count() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_subscriber_to_contact() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_document_activity() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_exchange_rate_change() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_consent_project() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_contact_on_payment() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_storage_used() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_activity_reply_events() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_booking_events() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_contact_events() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_invoice_events() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_page_view_events() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_proposal_events() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_service_events() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_transaction_events() TO PUBLIC, anon, authenticated;

DO $$
DECLARE
  slice_signature text;
  slice_function regprocedure;
BEGIN
  FOREACH slice_signature IN ARRAY ARRAY[
    'public.advance_contact_on_completed_booking()',
    'public.auto_set_agent_org_id()',
    'public.create_user_settings()',
    'public.increment_smart_link_click_count()',
    'public.link_subscriber_to_contact()',
    'public.log_document_activity()',
    'public.log_exchange_rate_change()',
    'public.marketing_consent_project()',
    'public.promote_contact_on_payment()',
    'public.update_user_storage_used()',
    'public.tg_activity_reply_events()',
    'public.tg_booking_events()',
    'public.tg_contact_events()',
    'public.tg_invoice_events()',
    'public.tg_page_view_events()',
    'public.tg_proposal_events()',
    'public.tg_service_events()',
    'public.tg_transaction_events()'
  ]
  LOOP
    slice_function := pg_catalog.to_regprocedure(slice_signature);
    IF slice_function IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 5 rollback function missing so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 5 rollback public cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 5 rollback anon cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 5 rollback authenticated cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 5 rollback service_role cannot execute so nothing was restored ' || slice_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
