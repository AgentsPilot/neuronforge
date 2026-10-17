-- Finance check 23: run BEFORE applying migrations 20261076 and 20261077, read only.
-- Every row must show ok = true. If one does not, stop and tell the session.
-- The md5 is the body of the transition function as migration 20261031 wrote it.
-- The cleanup rows show data export DE-8a is live: its table exists and the test-account cleanup
-- function is the 20261075 version, which 20261077 replaces and its rollback restores.
select 'reversal events table absent' as item,
  to_regclass('public.business_os_boost_reversal_events') is null as ok,
  null::bigint as found
union all
select 'transition function present with six arguments',
  to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)') is not null,
  null::bigint
union all
select 'transition function is security invoker',
  coalesce(bool_and(not p.prosecdef), false),
  count(*)
from pg_catalog.pg_proc p
where p.oid = to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)')
union all
select 'transition function body is the 20261031 body',
  coalesce(bool_and(md5(replace(p.prosrc, chr(13), '')) = 'b9a5fe318eb25cdc65ba0402b23d7241'), false),
  count(*)
from pg_catalog.pg_proc p
where p.oid = to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)')
union all
select 'service_role bypasses row level security',
  coalesce(bool_and(r.rolbypassrls), false),
  count(*)
from pg_catalog.pg_roles r
where r.rolname = 'service_role'
union all
select 'data exports table present',
  to_regclass('public.business_os_data_exports') is not null,
  null::bigint
union all
select 'cleanup function is the 20261075 version',
  coalesce(bool_and(position('a824848e0a538477' in p.prosrc) > 0), false),
  count(*)
from pg_catalog.pg_proc p
where p.oid = to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)')
union all
select 'no boost purchase with a refund',
  count(*) = 0,
  count(*)
from public.business_os_boost_purchases b
where b.amount_refunded_minor > 0
union all
select 'no boost purchase with a dispute',
  count(*) = 0,
  count(*)
from public.business_os_boost_purchases b
where b.stripe_dispute_id is not null;
