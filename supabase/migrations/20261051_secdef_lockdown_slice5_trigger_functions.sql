BEGIN;

REVOKE EXECUTE ON FUNCTION public.advance_contact_on_completed_booking() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_contact_on_completed_booking() TO service_role;

REVOKE EXECUTE ON FUNCTION public.auto_set_agent_org_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_set_agent_org_id() TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_user_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_user_settings() TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_smart_link_click_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_smart_link_click_count() TO service_role;

REVOKE EXECUTE ON FUNCTION public.link_subscriber_to_contact() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_subscriber_to_contact() TO service_role;

REVOKE EXECUTE ON FUNCTION public.log_document_activity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_document_activity() TO service_role;

REVOKE EXECUTE ON FUNCTION public.log_exchange_rate_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_exchange_rate_change() TO service_role;

REVOKE EXECUTE ON FUNCTION public.marketing_consent_project() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_consent_project() TO service_role;

REVOKE EXECUTE ON FUNCTION public.promote_contact_on_payment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_contact_on_payment() TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_user_storage_used() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_storage_used() TO service_role;

REVOKE EXECUTE ON FUNCTION public.tg_activity_reply_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_activity_reply_events() TO service_role;

REVOKE EXECUTE ON FUNCTION public.tg_booking_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_booking_events() TO service_role;

REVOKE EXECUTE ON FUNCTION public.tg_contact_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_contact_events() TO service_role;

REVOKE EXECUTE ON FUNCTION public.tg_invoice_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_invoice_events() TO service_role;

REVOKE EXECUTE ON FUNCTION public.tg_page_view_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_page_view_events() TO service_role;

REVOKE EXECUTE ON FUNCTION public.tg_proposal_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_proposal_events() TO service_role;

REVOKE EXECUTE ON FUNCTION public.tg_service_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_service_events() TO service_role;

REVOKE EXECUTE ON FUNCTION public.tg_transaction_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_transaction_events() TO service_role;

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
      RAISE EXCEPTION USING MESSAGE = 'Slice 5 lockdown function missing so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 5 public still executes so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 5 anon still executes so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 5 authenticated still executes so nothing was applied ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 5 service_role lost EXECUTE so nothing was applied ' || slice_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
