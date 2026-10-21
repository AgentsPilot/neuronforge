-- Finance check 31: run BEFORE applying migration 20261078, read only.
-- Every row must show ok = true. If one does not, stop and tell the session.
select 'snapshots table absent' as item,
  to_regclass('public.business_os_finance_snapshots') is null as ok
union all
select 'snapshot key index name free',
  to_regclass('public.business_os_finance_snapshots_day_metric_key') is null
union all
select 'no constraint already uses the snapshot table name',
  not exists (select 1 from pg_catalog.pg_constraint c
              where c.conname like 'business_os_finance_snapshots%')
union all
select 'service_role exists and bypasses row level security',
  coalesce((select r.rolbypassrls from pg_catalog.pg_roles r where r.rolname = 'service_role'), false)
union all
select 'gen_random_uuid is available',
  exists (select 1 from pg_catalog.pg_proc p where p.proname = 'gen_random_uuid')
union all
select 'cron run record installed',
  to_regclass('public.bos_cron_runs') is not null;
