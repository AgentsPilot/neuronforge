SET default_transaction_read_only = on;

WITH watched AS (
  SELECT watched_row.fn_name, watched_row.fn_signature, watched_row.fn_order, watched_row.keeps_authenticated
  FROM (VALUES
    ('advance_contact_on_completed_booking', 'public.advance_contact_on_completed_booking()', 1, false),
    ('auto_set_agent_org_id', 'public.auto_set_agent_org_id()', 2, false),
    ('create_user_settings', 'public.create_user_settings()', 3, false),
    ('increment_smart_link_click_count', 'public.increment_smart_link_click_count()', 4, false),
    ('link_subscriber_to_contact', 'public.link_subscriber_to_contact()', 5, false),
    ('log_document_activity', 'public.log_document_activity()', 6, false),
    ('log_exchange_rate_change', 'public.log_exchange_rate_change()', 7, false),
    ('marketing_consent_project', 'public.marketing_consent_project()', 8, false),
    ('promote_contact_on_payment', 'public.promote_contact_on_payment()', 9, false),
    ('update_user_storage_used', 'public.update_user_storage_used()', 10, false),
    ('tg_activity_reply_events', 'public.tg_activity_reply_events()', 11, false),
    ('tg_booking_events', 'public.tg_booking_events()', 12, false),
    ('tg_contact_events', 'public.tg_contact_events()', 13, false),
    ('tg_invoice_events', 'public.tg_invoice_events()', 14, false),
    ('tg_page_view_events', 'public.tg_page_view_events()', 15, false),
    ('tg_proposal_events', 'public.tg_proposal_events()', 16, false),
    ('tg_service_events', 'public.tg_service_events()', 17, false),
    ('tg_transaction_events', 'public.tg_transaction_events()', 18, false)
  ) AS watched_row (fn_name, fn_signature, fn_order, keeps_authenticated)
),
slice_function AS (
  SELECT watched.fn_name,
         watched.fn_order,
         watched.keeps_authenticated,
         pg_catalog.to_regprocedure(watched.fn_signature) AS fn_oid
  FROM watched
),
slice_owner AS (
  SELECT slice_function.fn_name,
         slice_function.fn_order,
         slice_function.keeps_authenticated,
         slice_function.fn_oid,
         pg_catalog.pg_get_userbyid(pg_proc.proowner)::text AS owner_name
  FROM slice_function
  LEFT JOIN pg_catalog.pg_proc ON pg_proc.oid = slice_function.fn_oid
),
role_expectation AS (
  SELECT expected.role_name, expected.expected_held, expected.check_order
  FROM (VALUES
    ('public', false, 3),
    ('anon', false, 4),
    ('authenticated', false, 5),
    ('service_role', true, 6)
  ) AS expected (role_name, expected_held, check_order)
),
role_privilege AS (
  SELECT slice_owner.fn_name,
         slice_owner.fn_order,
         role_expectation.role_name,
         role_expectation.expected_held
           OR (role_expectation.role_name = 'authenticated' AND slice_owner.keeps_authenticated) AS expected_held,
         role_expectation.check_order,
         CASE WHEN slice_owner.fn_oid IS NULL THEN NULL
              ELSE pg_catalog.has_function_privilege(role_expectation.role_name, slice_owner.fn_oid, 'EXECUTE')
         END AS is_held
  FROM slice_owner
  CROSS JOIN role_expectation
),
checks AS (
  SELECT slice_owner.fn_order * 100 + 1 AS sort_order,
         'C1 exists ' || slice_owner.fn_name AS check_name,
         CASE WHEN slice_owner.fn_oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
         CASE WHEN slice_owner.fn_oid IS NOT NULL THEN 'present' ELSE 'missing' END AS detail
  FROM slice_owner

  UNION ALL
  SELECT slice_owner.fn_order * 100 + 2,
         'C2 owner postgres ' || slice_owner.fn_name,
         CASE WHEN slice_owner.owner_name = 'postgres' THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(slice_owner.owner_name, 'missing')
  FROM slice_owner

  UNION ALL
  SELECT role_privilege.fn_order * 100 + role_privilege.check_order,
         'C' || role_privilege.check_order::text || ' ' || role_privilege.role_name || ' ' || role_privilege.fn_name,
         CASE
           WHEN role_privilege.expected_held AND role_privilege.is_held IS TRUE THEN 'PASS'
           WHEN NOT role_privilege.expected_held AND role_privilege.is_held IS FALSE THEN 'PASS'
           ELSE 'FAIL'
         END,
         CASE
           WHEN role_privilege.is_held IS NULL THEN 'function missing'
           ELSE 'held ' || role_privilege.is_held::text || ' expected ' || role_privilege.expected_held::text
         END
  FROM role_privilege
)
SELECT report.check_name, report.result, report.detail
FROM (
  SELECT 0 AS sort_order,
         'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result <> 'PASS') THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM checks WHERE checks.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.result <> 'PASS') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.result, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
