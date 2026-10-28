SET default_transaction_read_only = on;

-- Checker for 20261099_business_os_first_plan_payments_view (MK5B-FU-1, SA-WP-M5F)
-- Read only. One row. Counts and names of objects only, never an account id or an amount
-- C-1 the view exists and is a plain view
-- C-2 the view is security invoker
-- C-3 the view columns are user_id uuid, livemode boolean, first_payment_at timestamptz, in that order, and nothing else
-- C-4 service_role holds SELECT only, and PUBLIC, anon and authenticated hold nothing
-- C-5 both partial indexes exist, are valid, and carry the expected columns and predicate
-- C-6 the view equals the earliest paid time per account and mode over the whole base table
-- C-7 no account and mode appears twice in the view
-- C-8 the base table still has RLS on, no client grant, and service_role SELECT and INSERT only
-- base_rows reports the base table size (M5F-C2). Above about one million rows, plain index builds need a new ruling
-- all_ok is true when C-1 to C-8 all hold. The EXPLAIN probe is a separate file and is not part of all_ok
WITH view_rel AS (
  SELECT pg_class.oid AS view_oid,
         pg_class.relkind::text AS view_kind,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS view_acl,
         pg_class.relowner AS owner_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_first_plan_payments'
),
base_rel AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl,
         pg_class.relowner AS owner_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_billing_events'
),
view_option AS (
  SELECT count(*) AS invoker_on
  FROM view_rel
  JOIN pg_class ON pg_class.oid = view_rel.view_oid
  CROSS JOIN LATERAL pg_options_to_table(pg_class.reloptions) AS option_row
  WHERE option_row.option_name = 'security_invoker'
    AND option_row.option_value = 'true'
),
view_columns AS (
  SELECT COALESCE(string_agg(pg_attribute.attname::text || ' ' || format_type(pg_attribute.atttypid, pg_attribute.atttypmod), ', ' ORDER BY pg_attribute.attnum), 'missing') AS signature
  FROM view_rel
  JOIN pg_attribute ON pg_attribute.attrelid = view_rel.view_oid
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
view_acl_entries AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.grantee AS grantee_oid,
         view_rel.owner_oid AS owner_oid,
         acl_item.privilege_type AS privilege_name
  FROM view_rel
  CROSS JOIN LATERAL aclexplode(view_rel.view_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
view_grants AS (
  SELECT (SELECT count(*) FROM view_acl_entries WHERE view_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')) AS client_total,
         (SELECT COALESCE(string_agg(view_acl_entries.privilege_name, ' ' ORDER BY view_acl_entries.privilege_name), 'none') FROM view_acl_entries WHERE view_acl_entries.grantee_name = 'service_role') AS service_listing,
         (SELECT count(*) FROM view_acl_entries WHERE view_acl_entries.grantee_oid <> view_acl_entries.owner_oid AND view_acl_entries.grantee_name NOT IN ('service_role')) AS other_total
),
index_rows AS (
  SELECT index_class.relname::text AS index_name,
         pg_index.indisvalid AS is_valid,
         pg_get_indexdef(pg_index.indexrelid) AS definition
  FROM pg_index
  JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
  WHERE pg_index.indrelid IN (SELECT base_rel.table_oid FROM base_rel)
    AND index_class.relname IN ('business_os_billing_events_first_payment_idx', 'business_os_billing_events_paid_month_idx')
),
index_summary AS (
  SELECT count(*) FILTER (WHERE index_rows.index_name = 'business_os_billing_events_first_payment_idx'
                            AND index_rows.is_valid
                            AND position('(user_id, livemode, paid_at, id)' IN index_rows.definition) > 0
                            AND position('invoice_paid' IN index_rows.definition) > 0
                            AND position('amount_minor > 0' IN index_rows.definition) > 0
                            AND position('paid_at IS NOT NULL' IN index_rows.definition) > 0) AS first_payment_index,
         count(*) FILTER (WHERE index_rows.index_name = 'business_os_billing_events_paid_month_idx'
                            AND index_rows.is_valid
                            AND position('(livemode, paid_at)' IN index_rows.definition) > 0
                            AND position('invoice_paid' IN index_rows.definition) > 0
                            AND position('amount_minor > 0' IN index_rows.definition) > 0
                            AND position('paid_at IS NOT NULL' IN index_rows.definition) > 0
                            AND position('user_id IS NOT NULL' IN index_rows.definition) > 0) AS paid_month_index
  FROM index_rows
),
expected_first AS (
  SELECT events.user_id, events.livemode, min(events.paid_at) AS first_at
  FROM public.business_os_billing_events AS events
  WHERE events.kind = 'invoice_paid'
    AND events.amount_minor > 0
    AND events.paid_at IS NOT NULL
    AND events.user_id IS NOT NULL
  GROUP BY events.user_id, events.livemode
),
view_first AS (
  SELECT first_rows.user_id, first_rows.livemode, first_rows.first_payment_at
  FROM public.business_os_first_plan_payments AS first_rows
),
equivalence AS (
  SELECT count(*) AS differing
  FROM expected_first
  FULL OUTER JOIN view_first
    ON view_first.user_id = expected_first.user_id
   AND view_first.livemode = expected_first.livemode
  WHERE expected_first.user_id IS NULL
     OR view_first.user_id IS NULL
     OR view_first.first_payment_at IS DISTINCT FROM expected_first.first_at
),
duplicates AS (
  SELECT count(*) AS duplicate_keys
  FROM (
    SELECT view_first.user_id, view_first.livemode
    FROM view_first
    GROUP BY view_first.user_id, view_first.livemode
    HAVING count(*) > 1
  ) AS repeated
),
base_acl_entries AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM base_rel
  CROSS JOIN LATERAL aclexplode(base_rel.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
base_state AS (
  SELECT (SELECT bool_and(base_rel.rls_on) FROM base_rel) AS rls_on,
         (SELECT count(*) FROM base_acl_entries WHERE base_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')) AS client_total,
         (SELECT COALESCE(string_agg(base_acl_entries.privilege_name, ' ' ORDER BY base_acl_entries.privilege_name), 'none') FROM base_acl_entries WHERE base_acl_entries.grantee_name = 'service_role') AS service_listing,
         (SELECT count(*) FROM public.business_os_billing_events) AS base_rows,
         (SELECT count(*) FROM view_first) AS view_rows
),
checks AS (
  SELECT (SELECT count(*) FROM view_rel WHERE view_rel.view_kind = 'v') = 1 AS c1_view_exists,
         (SELECT view_option.invoker_on FROM view_option) = 1 AS c2_security_invoker,
         (SELECT view_columns.signature FROM view_columns) = 'user_id uuid, livemode boolean, first_payment_at timestamp with time zone' AS c3_columns,
         (SELECT view_grants.client_total FROM view_grants) = 0
           AND (SELECT view_grants.service_listing FROM view_grants) = 'SELECT'
           AND (SELECT view_grants.other_total FROM view_grants) = 0 AS c4_privileges,
         (SELECT index_summary.first_payment_index FROM index_summary) = 1
           AND (SELECT index_summary.paid_month_index FROM index_summary) = 1 AS c5_indexes,
         (SELECT equivalence.differing FROM equivalence) = 0 AS c6_equals_min,
         (SELECT duplicates.duplicate_keys FROM duplicates) = 0 AS c7_no_duplicates,
         (SELECT base_state.rls_on FROM base_state)
           AND (SELECT base_state.client_total FROM base_state) = 0
           AND (SELECT base_state.service_listing FROM base_state) = 'INSERT SELECT' AS c8_base_unchanged
)
SELECT checks.c1_view_exists,
       checks.c2_security_invoker,
       checks.c3_columns,
       (SELECT view_columns.signature FROM view_columns) AS view_signature,
       checks.c4_privileges,
       (SELECT view_grants.service_listing FROM view_grants) AS view_service_privileges,
       checks.c5_indexes,
       checks.c6_equals_min,
       (SELECT equivalence.differing FROM equivalence) AS differing_keys,
       checks.c7_no_duplicates,
       (SELECT duplicates.duplicate_keys FROM duplicates) AS duplicate_keys,
       checks.c8_base_unchanged,
       (SELECT base_state.base_rows FROM base_state) AS base_rows,
       (SELECT base_state.view_rows FROM base_state) AS view_rows,
       (checks.c1_view_exists AND checks.c2_security_invoker AND checks.c3_columns AND checks.c4_privileges
        AND checks.c5_indexes AND checks.c6_equals_min AND checks.c7_no_duplicates AND checks.c8_base_unchanged) AS all_ok
FROM checks;
