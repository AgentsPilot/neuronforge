-- Finance check 24: run AFTER applying migrations 20261072 and 20261073, read only.
-- Every row must show ok = true. If one does not, stop and tell the session.
-- The function must name the events table six times, once per insert point.
-- The md5 and the cleanup stamp are those of the files in this pull request.
with t as (
  select to_regclass('public.business_os_boost_reversal_events') as tbl,
         to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)') as fn,
         to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') as cleanup_fn
)
select 'table exists' as item, t.tbl is not null as ok from t
union all
select 'row level security on', coalesce((select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t.tbl), false) from t
union all
select 'no policy on the table', not exists (select 1 from pg_catalog.pg_policy pol where pol.polrelid = t.tbl) from t
union all
select 'anon has no privilege on the table or any column', not coalesce(has_table_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, REFERENCES'), true) from t
union all
select 'authenticated has no privilege on the table or any column', not coalesce(has_table_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, REFERENCES'), true) from t
union all
select 'service_role can select', coalesce(has_table_privilege('service_role', t.tbl, 'SELECT'), false) from t
union all
select 'service_role can insert kind', coalesce(has_column_privilege('service_role', t.tbl, 'kind', 'INSERT'), false) from t
union all
select 'service_role can insert purchase_id', coalesce(has_column_privilege('service_role', t.tbl, 'purchase_id', 'INSERT'), false) from t
union all
select 'service_role can insert exactly nine columns',
  coalesce((select count(*) from pg_catalog.pg_attribute a
            where a.attrelid = t.tbl and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('service_role', t.tbl, a.attnum, 'INSERT')) = 9, false) from t
union all
select 'service_role cannot set recorded_at', not coalesce(has_column_privilege('service_role', t.tbl, 'recorded_at', 'INSERT'), true) from t
union all
select 'service_role cannot set id', not coalesce(has_column_privilege('service_role', t.tbl, 'id', 'INSERT'), true) from t
union all
select 'service_role cannot update', not coalesce(has_table_privilege('service_role', t.tbl, 'UPDATE') or has_any_column_privilege('service_role', t.tbl, 'UPDATE'), true) from t
union all
select 'service_role cannot delete', not coalesce(has_table_privilege('service_role', t.tbl, 'DELETE, TRUNCATE'), true) from t
union all
select 'service_role bypasses row level security', coalesce((select r.rolbypassrls from pg_catalog.pg_roles r where r.rolname = 'service_role'), false) from t
union all
select 'foreign key to purchases cascades',
  exists (select 1 from pg_catalog.pg_constraint con
          where con.conrelid = t.tbl and con.contype = 'f'
            and con.confrelid = 'public.business_os_boost_purchases'::regclass
            and con.confdeltype = 'c') from t
union all
select 'two unique partial indexes and four indexes besides the key',
  coalesce((select count(*) filter (where i.indisunique and i.indpred is not null) = 2
                   and count(*) filter (where not i.indisprimary) = 4
            from pg_catalog.pg_index i where i.indrelid = t.tbl), false) from t
union all
select 'function still security invoker', coalesce((select not p.prosecdef from pg_catalog.pg_proc p where p.oid = t.fn), false) from t
union all
select 'function body is the 20261072 body',
  coalesce((select md5(replace(p.prosrc, chr(13), '')) = '018c4447f2b52dd87e4ae3b229e5b42c' from pg_catalog.pg_proc p where p.oid = t.fn), false) from t
union all
select 'function names the events table six times',
  coalesce((select (length(pg_get_functiondef(t.fn)) - length(replace(pg_get_functiondef(t.fn), 'business_os_boost_reversal_events', '')))
            / length('business_os_boost_reversal_events') = 6), false) from t
union all
select 'anon cannot execute the function', not coalesce(has_function_privilege('anon', t.fn, 'EXECUTE'), true) from t
union all
select 'service_role can execute the function', coalesce(has_function_privilege('service_role', t.fn, 'EXECUTE'), false) from t
union all
select 'cleanup function is the 20261073 version',
  coalesce((select position('f854486b31baf784' in p.prosrc) > 0 from pg_catalog.pg_proc p where p.oid = t.cleanup_fn), false) from t
union all
select 'no refund or dispute recorded without an event',
  not exists (select 1 from public.business_os_boost_purchases b
              where (b.amount_refunded_minor > 0 or b.stripe_dispute_id is not null)
                and not exists (select 1 from public.business_os_boost_reversal_events e where e.purchase_id = b.id))
from t;
