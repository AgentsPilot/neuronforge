SET default_transaction_read_only = on;

WITH watched AS (
  SELECT watched_row.fn_name,
         watched_row.fn_signature,
         watched_row.fn_order,
         watched_row.expected_grantees,
         watched_row.keeps_authenticated
  FROM (VALUES
    ('advance_contact_on_completed_booking', 'public.advance_contact_on_completed_booking()', 1, 'PUBLIC postgres anon authenticated service_role', false),
    ('auto_set_agent_org_id', 'public.auto_set_agent_org_id()', 2, 'PUBLIC postgres anon authenticated service_role', false),
    ('create_user_settings', 'public.create_user_settings()', 3, 'PUBLIC postgres anon authenticated service_role', false),
    ('increment_smart_link_click_count', 'public.increment_smart_link_click_count()', 4, 'PUBLIC postgres anon authenticated service_role', false),
    ('link_subscriber_to_contact', 'public.link_subscriber_to_contact()', 5, 'PUBLIC postgres anon authenticated service_role', false),
    ('log_document_activity', 'public.log_document_activity()', 6, 'PUBLIC postgres anon authenticated service_role', false),
    ('log_exchange_rate_change', 'public.log_exchange_rate_change()', 7, 'PUBLIC postgres anon authenticated service_role', false),
    ('marketing_consent_project', 'public.marketing_consent_project()', 8, 'PUBLIC postgres anon authenticated service_role', false),
    ('promote_contact_on_payment', 'public.promote_contact_on_payment()', 9, 'PUBLIC postgres anon authenticated service_role', false),
    ('update_user_storage_used', 'public.update_user_storage_used()', 10, 'PUBLIC postgres anon authenticated service_role', false),
    ('tg_activity_reply_events', 'public.tg_activity_reply_events()', 11, 'PUBLIC postgres anon authenticated service_role', false),
    ('tg_booking_events', 'public.tg_booking_events()', 12, 'PUBLIC postgres anon authenticated service_role', false),
    ('tg_contact_events', 'public.tg_contact_events()', 13, 'PUBLIC postgres anon authenticated service_role', false),
    ('tg_invoice_events', 'public.tg_invoice_events()', 14, 'PUBLIC postgres anon authenticated service_role', false),
    ('tg_page_view_events', 'public.tg_page_view_events()', 15, 'PUBLIC postgres anon authenticated service_role', false),
    ('tg_proposal_events', 'public.tg_proposal_events()', 16, 'PUBLIC postgres anon authenticated service_role', false),
    ('tg_service_events', 'public.tg_service_events()', 17, 'PUBLIC postgres anon authenticated service_role', false),
    ('tg_transaction_events', 'public.tg_transaction_events()', 18, 'PUBLIC postgres anon authenticated service_role', false)
  ) AS watched_row (fn_name, fn_signature, fn_order, expected_grantees, keeps_authenticated)
),
watched_fn AS (
  SELECT watched.*,
         'public' || chr(46) || watched.fn_name AS qualified_name,
         strpos(watched.expected_grantees, 'PUBLIC') > 0 AS expects_public,
         pg_catalog.to_regprocedure(watched.fn_signature) AS fn_oid
  FROM watched
),
fn_state AS (
  SELECT watched_fn.*,
         pg_catalog.pg_get_userbyid(pg_proc.proowner)::text AS owner_name,
         pg_proc.prosecdef AS is_secdef,
         COALESCE(array_to_string(pg_proc.proconfig, ' '), 'none') AS config_text,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS fn_acl,
         pg_proc.prorettype = 'trigger'::regtype AS returns_trigger,
         pg_catalog.format_type(pg_proc.prorettype, NULL) AS return_type,
         fn_language.lanname::text AS language_name
  FROM watched_fn
  LEFT JOIN pg_catalog.pg_proc ON pg_proc.oid = watched_fn.fn_oid
  LEFT JOIN pg_catalog.pg_language AS fn_language ON fn_language.oid = pg_proc.prolang
),
fn_execute_entry AS (
  SELECT fn_state.fn_name,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl_item.grantee)::text END AS grantee_name,
         pg_catalog.pg_get_userbyid(acl_item.grantor)::text AS grantor_name
  FROM fn_state
  CROSS JOIN LATERAL aclexplode(fn_state.fn_acl) AS acl_item
  WHERE fn_state.fn_oid IS NOT NULL
    AND acl_item.privilege_type = 'EXECUTE'
),
caller_proc AS (
  SELECT fn_state.fn_name,
         fn_state.fn_order,
         fn_state.keeps_authenticated,
         caller_namespace.nspname AS caller_schema,
         pg_proc.proname AS caller_name,
         pg_proc.prosecdef AS caller_secdef,
         pg_proc.prorettype = 'trigger'::regtype AS caller_is_trigger,
         pg_catalog.has_function_privilege('anon', pg_proc.oid, 'EXECUTE') AS caller_anon_executes,
         pg_catalog.pg_get_userbyid(pg_proc.proowner)::text AS caller_owner,
         COALESCE(array_to_string(pg_proc.proconfig, ' '), 'none') AS caller_config,
         strpos(lower(pg_proc.prosrc), fn_state.qualified_name) > 0 AS is_qualified
  FROM fn_state
  JOIN pg_catalog.pg_proc ON strpos(lower(pg_proc.prosrc), fn_state.fn_name) > 0
  JOIN pg_catalog.pg_namespace AS caller_namespace ON caller_namespace.oid = pg_proc.pronamespace
  WHERE left(caller_namespace.nspname, 3) <> 'pg_'
    AND caller_namespace.nspname <> 'information_schema'
    AND pg_proc.oid IS DISTINCT FROM fn_state.fn_oid
),
caller_verdict AS (
  SELECT caller_proc.*,
         CASE
           WHEN caller_proc.caller_secdef THEN caller_proc.caller_owner <> 'postgres'
           WHEN NOT caller_proc.keeps_authenticated THEN true
           WHEN caller_proc.caller_is_trigger THEN true
           ELSE caller_proc.caller_anon_executes
         END AS needs_stop
  FROM caller_proc
),
policy_hit AS (
  SELECT fn_state.fn_name,
         fn_state.fn_order,
         pg_policies.schemaname AS policy_schema,
         pg_policies.tablename AS policy_table,
         pg_policies.policyname AS policy_name,
         pg_policies.cmd AS policy_command,
         pg_policies.roles::text AS policy_roles,
         CASE
           WHEN fn_state.keeps_authenticated
             THEN NOT (pg_policies.roles <@ ARRAY['authenticated', 'service_role']::name[])
           ELSE pg_policies.roles && ARRAY['public', 'anon', 'authenticated']::name[]
         END AS needs_stop
  FROM fn_state
  JOIN pg_catalog.pg_policies
    ON strpos(lower(COALESCE(pg_policies.qual, '') || ' ' || COALESCE(pg_policies.with_check, '')), fn_state.fn_name) > 0
),
view_source AS (
  SELECT pg_views.schemaname AS view_schema,
         pg_views.viewname AS view_name,
         pg_views.definition AS view_definition
  FROM pg_catalog.pg_views
  UNION ALL
  SELECT pg_matviews.schemaname, pg_matviews.matviewname, pg_matviews.definition
  FROM pg_catalog.pg_matviews
),
view_hit AS (
  SELECT fn_state.fn_name,
         fn_state.fn_order,
         view_source.view_schema,
         view_source.view_name
  FROM fn_state
  JOIN view_source ON strpos(lower(view_source.view_definition), fn_state.fn_name) > 0
  WHERE left(view_source.view_schema, 3) <> 'pg_'
    AND view_source.view_schema <> 'information_schema'
),
dependent_hit AS (
  SELECT fn_state.fn_name,
         fn_state.fn_order,
         COALESCE(pg_catalog.pg_describe_object(pg_depend.classid, pg_depend.objid, pg_depend.objsubid), 'undescribed') AS dependent_description,
         pg_depend.classid::regclass::text AS dependent_catalog,
         pg_depend.deptype::text AS dependent_type,
         COALESCE(dependent_trigger.tgrelid::regclass::text, 'none') AS trigger_table,
         COALESCE(dependent_trigger.tgenabled::text, 'none') AS trigger_enabled,
         (pg_depend.classid = 'pg_trigger'::regclass AND dependent_trigger.oid IS NOT NULL) AS is_trigger_dependent,
         NOT (pg_depend.classid = 'pg_trigger'::regclass AND dependent_trigger.oid IS NOT NULL) AS needs_stop
  FROM fn_state
  JOIN pg_catalog.pg_depend
    ON pg_depend.refclassid = 'pg_proc'::regclass
   AND pg_depend.refobjid = fn_state.fn_oid
  LEFT JOIN pg_catalog.pg_trigger AS dependent_trigger
    ON pg_depend.classid = 'pg_trigger'::regclass
   AND dependent_trigger.oid = pg_depend.objid
  WHERE fn_state.fn_oid IS NOT NULL
),
d1_known AS (
  SELECT known_row.fn_name
  FROM (VALUES
    ('tg_service_events'),
    ('update_scheduling_services_updated_at'),
    ('service_currency_lock')
  ) AS known_row (fn_name)
),
d1_surface AS (
  SELECT pg_trigger.tgrelid::regclass::text AS table_name,
         pg_trigger.tgname::text AS trigger_name,
         trigger_namespace.nspname::text || chr(46) || trigger_proc.proname::text AS function_name,
         (trigger_namespace.nspname = 'public'
          AND (trigger_proc.proname IN (SELECT d1_known.fn_name FROM d1_known)
               OR trigger_proc.proname IN (SELECT watched.fn_name FROM watched))) AS is_known,
         (strpos(lower(COALESCE(trigger_proc.prosrc, '')), 'http') > 0
          OR strpos(lower(COALESCE(trigger_proc.prosrc, '')), 'dblink') > 0) AS names_remote
  FROM pg_catalog.pg_trigger
  JOIN pg_catalog.pg_proc AS trigger_proc ON trigger_proc.oid = pg_trigger.tgfoid
  JOIN pg_catalog.pg_namespace AS trigger_namespace ON trigger_namespace.oid = trigger_proc.pronamespace
  WHERE NOT pg_trigger.tgisinternal
    AND (pg_trigger.tgrelid = pg_catalog.to_regclass('public.scheduling_services')
         OR pg_trigger.tgrelid = pg_catalog.to_regclass('public.business_events'))
),
report AS (
  SELECT 0 AS sort_order,
         'READ ME' AS item,
         'this session is now read only so run the migration in a NEW tab' AS detail

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 10,
         'Q1 exists ' || fn_state.fn_name,
         CASE WHEN fn_state.fn_oid IS NULL THEN 'MISSING stop here' ELSE 'present' END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 20,
         'Q2 owner ' || fn_state.fn_name,
         CASE
           WHEN fn_state.owner_name IS NULL THEN 'missing stop here'
           WHEN fn_state.owner_name = 'postgres' THEN 'postgres ok'
           ELSE fn_state.owner_name || ' stop here'
         END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 30,
         'Q3 secdef ' || fn_state.fn_name,
         'secdef ' || COALESCE(fn_state.is_secdef::text, 'missing')
           || ' returns ' || COALESCE(fn_state.return_type, 'missing')
           || ' language ' || COALESCE(fn_state.language_name, 'missing')
           || ' config ' || COALESCE(fn_state.config_text, 'missing')
           || CASE WHEN fn_state.is_secdef IS TRUE AND fn_state.returns_trigger IS TRUE THEN ' ok' ELSE ' stop here' END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 40,
         'Q4 privileges ' || fn_state.fn_name || ' expected public ' || fn_state.expects_public::text,
         CASE
           WHEN fn_state.fn_oid IS NULL THEN 'missing stop here'
           ELSE 'public ' || pg_catalog.has_function_privilege('public', fn_state.fn_oid, 'EXECUTE')::text
             || ' anon ' || pg_catalog.has_function_privilege('anon', fn_state.fn_oid, 'EXECUTE')::text
             || ' authenticated ' || pg_catalog.has_function_privilege('authenticated', fn_state.fn_oid, 'EXECUTE')::text
             || ' service_role ' || pg_catalog.has_function_privilege('service_role', fn_state.fn_oid, 'EXECUTE')::text
             || CASE
                  WHEN pg_catalog.has_function_privilege('public', fn_state.fn_oid, 'EXECUTE') = fn_state.expects_public
                   AND pg_catalog.has_function_privilege('anon', fn_state.fn_oid, 'EXECUTE')
                   AND pg_catalog.has_function_privilege('authenticated', fn_state.fn_oid, 'EXECUTE')
                   AND pg_catalog.has_function_privilege('service_role', fn_state.fn_oid, 'EXECUTE')
                    THEN ' ok'
                  ELSE ' stop here'
                END
         END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 50,
         'Q5 grantees ' || fn_state.fn_name || ' expected ' || fn_state.expected_grantees,
         COALESCE(
           (SELECT string_agg(fn_execute_entry.grantee_name, ' ' ORDER BY fn_execute_entry.grantee_name COLLATE "C")
            FROM fn_execute_entry
            WHERE fn_execute_entry.fn_name = fn_state.fn_name),
           'none')
         || CASE
              WHEN (SELECT string_agg(fn_execute_entry.grantee_name, ' ' ORDER BY fn_execute_entry.grantee_name COLLATE "C")
                    FROM fn_execute_entry
                    WHERE fn_execute_entry.fn_name = fn_state.fn_name)
                 = (SELECT string_agg(expected_grantee, ' ' ORDER BY expected_grantee COLLATE "C")
                    FROM unnest(string_to_array(fn_state.expected_grantees, ' ')) AS expected_grantee)
                THEN ' match'
              ELSE ' DIFFERS stop here rollback must change'
            END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 55,
         'Q5 grantors ' || fn_state.fn_name,
         COALESCE(
           (SELECT string_agg(fn_execute_entry.grantee_name || ' by ' || fn_execute_entry.grantor_name, ' '
                              ORDER BY fn_execute_entry.grantee_name COLLATE "C")
            FROM fn_execute_entry
            WHERE fn_execute_entry.fn_name = fn_state.fn_name),
           'none')
         || CASE
              WHEN fn_state.fn_oid IS NULL THEN ' stop here'
              WHEN EXISTS (SELECT 1 FROM fn_execute_entry
                           WHERE fn_execute_entry.fn_name = fn_state.fn_name
                             AND fn_execute_entry.grantor_name IS DISTINCT FROM fn_state.owner_name)
                THEN ' OTHER GRANTOR stop here'
              ELSE ' owner granted all'
            END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 60,
         'Q6 callers count ' || fn_state.fn_name,
         (SELECT count(*) FROM caller_verdict WHERE caller_verdict.fn_name = fn_state.fn_name)::text
           || ' found '
           || (SELECT count(*) FROM caller_verdict
               WHERE caller_verdict.fn_name = fn_state.fn_name AND caller_verdict.needs_stop)::text
           || ' flagged'
  FROM fn_state

  UNION ALL
  SELECT caller_verdict.fn_order * 1000 + 61,
         'Q6 caller ' || caller_verdict.caller_schema || ' ' || caller_verdict.caller_name || ' of ' || caller_verdict.fn_name,
         'secdef ' || caller_verdict.caller_secdef::text
           || ' owner ' || caller_verdict.caller_owner
           || ' trigger ' || caller_verdict.caller_is_trigger::text
           || ' anon executes ' || caller_verdict.caller_anon_executes::text
           || ' config ' || caller_verdict.caller_config
           || ' qualified ' || caller_verdict.is_qualified::text
           || CASE WHEN caller_verdict.needs_stop THEN ' stop here' ELSE ' ok' END
  FROM caller_verdict

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 70,
         'Q7 policies count ' || fn_state.fn_name,
         (SELECT count(*) FROM policy_hit WHERE policy_hit.fn_name = fn_state.fn_name)::text
  FROM fn_state

  UNION ALL
  SELECT policy_hit.fn_order * 1000 + 71,
         'Q7 policy ' || policy_hit.policy_schema || ' ' || policy_hit.policy_table || ' ' || policy_hit.policy_name
           || ' of ' || policy_hit.fn_name,
         'command ' || policy_hit.policy_command
           || ' roles ' || policy_hit.policy_roles
           || CASE WHEN policy_hit.needs_stop THEN ' stop here' ELSE ' ok' END
  FROM policy_hit

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 80,
         'Q8 views count ' || fn_state.fn_name,
         (SELECT count(*) FROM view_hit WHERE view_hit.fn_name = fn_state.fn_name)::text
  FROM fn_state

  UNION ALL
  SELECT view_hit.fn_order * 1000 + 81,
         'Q8 view ' || view_hit.view_schema || ' ' || view_hit.view_name || ' of ' || view_hit.fn_name,
         'stop here'
  FROM view_hit

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 90,
         'Q9 cron ' || fn_state.fn_name,
         CASE
           WHEN pg_catalog.to_regclass('cron.job') IS NULL THEN 'cron not installed'
           WHEN strpos(lower(query_to_xml('TABLE cron.job', true, false, '')::text), fn_state.fn_name) > 0
             THEN 'NAMED visible jobs only stop here'
           ELSE 'none visible jobs only'
         END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 100,
         'Q11 dependents count ' || fn_state.fn_name,
         (SELECT count(*) FROM dependent_hit WHERE dependent_hit.fn_name = fn_state.fn_name)::text
           || ' found '
           || (SELECT count(*) FROM dependent_hit
               WHERE dependent_hit.fn_name = fn_state.fn_name AND dependent_hit.is_trigger_dependent)::text
           || ' triggers'
           || CASE
                WHEN (SELECT count(*) FROM dependent_hit
                      WHERE dependent_hit.fn_name = fn_state.fn_name AND dependent_hit.is_trigger_dependent) = 1
                  THEN ' ok'
                ELSE ' expected exactly 1 trigger stop here'
              END
  FROM fn_state

  UNION ALL
  SELECT dependent_hit.fn_order * 1000 + 101,
         'Q11 dependent ' || dependent_hit.dependent_description || ' of ' || dependent_hit.fn_name,
         'catalog ' || dependent_hit.dependent_catalog
           || ' deptype ' || dependent_hit.dependent_type
           || ' table ' || dependent_hit.trigger_table
           || ' enabled ' || dependent_hit.trigger_enabled
           || CASE WHEN dependent_hit.needs_stop THEN ' stop here' ELSE ' ok' END
  FROM dependent_hit

  UNION ALL
  SELECT 90000 + row_number() OVER (ORDER BY d1_surface.table_name COLLATE "C", d1_surface.trigger_name COLLATE "C"),
         'Q12 d1 surface ' || d1_surface.table_name || ' ' || d1_surface.trigger_name,
         'function ' || d1_surface.function_name
           || CASE WHEN d1_surface.is_known THEN ' known' ELSE ' UNKNOWN' END
           || CASE WHEN d1_surface.names_remote THEN ' names http or dblink' ELSE ' no remote call' END
           || CASE WHEN d1_surface.is_known AND NOT d1_surface.names_remote THEN ' D1 may run' ELSE ' D1 SKIP use the logs' END
  FROM d1_surface

  UNION ALL
  SELECT 90000,
         'Q12 d1 verdict information only',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM d1_surface) THEN 'no trigger found on the D1 tables D1 SKIP use the logs'
           WHEN EXISTS (SELECT 1 FROM d1_surface WHERE NOT d1_surface.is_known OR d1_surface.names_remote)
             THEN 'D1 SKIP use the logs'
           ELSE 'D1 may run'
         END

  UNION ALL
  SELECT 99000, 'checked at utc', (now() AT TIME ZONE 'UTC')::text
)
SELECT final_report.sort_order, final_report.item, final_report.detail
FROM (
  SELECT 1 AS sort_order,
         'PRECHECK STATUS' AS item,
         CASE
           WHEN (SELECT count(*) FROM report WHERE strpos(report.detail, 'stop here') > 0) = 0 THEN 'CLEAN'
           ELSE 'STOP ' || (SELECT count(*) FROM report WHERE strpos(report.detail, 'stop here') > 0)::text
             || ' rows need review'
         END AS detail
  UNION ALL
  SELECT report.sort_order, report.item, report.detail FROM report
) AS final_report
ORDER BY final_report.sort_order, final_report.item;
