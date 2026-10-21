-- Finance check 32: run AFTER applying migration 20261078, read only.
-- Every row must show ok = true. If one does not, run the rollback and tell the session.
with t as (
  select to_regclass('public.business_os_finance_snapshots') as tbl
)
select 'table exists' as item, t.tbl is not null as ok from t
union all
select 'row level security on',
  coalesce((select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t.tbl), false) from t
union all
select 'no policy on the table',
  not exists (select 1 from pg_catalog.pg_policy pol where pol.polrelid = t.tbl) from t
union all
select 'anon has no privilege on the table or any column',
  not coalesce(has_table_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or has_any_column_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, REFERENCES'), true) from t
union all
select 'authenticated has no privilege on the table or any column',
  not coalesce(has_table_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or has_any_column_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, REFERENCES'), true) from t
union all
select 'service_role can select',
  coalesce(has_table_privilege('service_role', t.tbl, 'SELECT'), false) from t
union all
select 'service_role can insert exactly five columns',
  coalesce((select count(*) from pg_catalog.pg_attribute a
            where a.attrelid = t.tbl and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('service_role', t.tbl, a.attnum, 'INSERT')) = 5, false) from t
union all
select 'service_role cannot set id or taken_at',
  not coalesce(has_column_privilege('service_role', t.tbl, 'id', 'INSERT')
    or has_column_privilege('service_role', t.tbl, 'taken_at', 'INSERT'), true) from t
union all
select 'service_role cannot update',
  not coalesce(has_table_privilege('service_role', t.tbl, 'UPDATE')
    or has_any_column_privilege('service_role', t.tbl, 'UPDATE'), true) from t
union all
select 'service_role cannot delete or truncate',
  not coalesce(has_table_privilege('service_role', t.tbl, 'DELETE, TRUNCATE'), true) from t
union all
select 'seven columns and no user_id column',
  coalesce((select count(*) = 7 and bool_and(a.attname <> 'user_id')
            from pg_catalog.pg_attribute a
            where a.attrelid = t.tbl and a.attnum > 0 and not a.attisdropped), false) from t
union all
select 'unique key on day, metric and dimension, not partial',
  exists (select 1 from pg_catalog.pg_index i
          join pg_catalog.pg_class ic on ic.oid = i.indexrelid
          where i.indrelid = t.tbl and i.indisunique and i.indpred is null
            and ic.relname = 'business_os_finance_snapshots_day_metric_key') from t
union all
select 'the six checks are present',
  coalesce((select count(*) from pg_catalog.pg_constraint c
            where c.conrelid = t.tbl and c.contype = 'c'
              and c.conname in ('business_os_finance_snapshots_metric_shape',
                                'business_os_finance_snapshots_dimension_shape',
                                'business_os_finance_snapshots_unit_known',
                                'business_os_finance_snapshots_value_not_negative',
                                'business_os_finance_snapshots_accounts_whole',
                                'business_os_finance_snapshots_day_ended')) = 6, false) from t
union all
select 'dimension check is exactly the E-86 pattern',
  coalesce((select position('^([a-z][a-z0-9_]{0,47}|tier:[a-z0-9_-]{1,40})$' in pg_catalog.pg_get_constraintdef(c.oid)) > 0
            from pg_catalog.pg_constraint c
            where c.conrelid = t.tbl and c.conname = 'business_os_finance_snapshots_dimension_shape'), false) from t
union all
select 'metric check is exactly the shape pattern',
  coalesce((select position('^[a-z][a-z0-9_]{0,47}$' in pg_catalog.pg_get_constraintdef(c.oid)) > 0
            from pg_catalog.pg_constraint c
            where c.conrelid = t.tbl and c.conname = 'business_os_finance_snapshots_metric_shape'), false) from t
union all
select 'no trigger on the table',
  not exists (select 1 from pg_catalog.pg_trigger tg where tg.tgrelid = t.tbl and not tg.tgisinternal) from t
union all
select 'table comment present',
  obj_description(t.tbl, 'pg_class') is not null from t;
