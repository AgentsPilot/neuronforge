-- Finance check 35: who can read or write the exchange rate tables, read only.
-- Extended by slice 1b (migration 20261082, docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1B_WORKPLAN.md).
-- One row per check: check_name, result PASS or FAIL, detail. The VERDICT row comes first.
-- After 20261082 is applied every row must be PASS. Before it, the FAIL rows are the gaps 1b closes.
-- C rows: the lockdown. No profiles role policy, anon holds nothing, authenticated holds SELECT
-- on exchange_rates only and nothing on exchange_rate_history, the enabled rows read policy is
-- present (the settings currency picker reads exchange_rates from the browser, so that SELECT
-- must stay), the history function search_path is pinned and only postgres and service_role
-- can execute it, the history trigger is present, service_role keeps its grants, and row
-- security is not forced on either table (history has no policy, so forcing it could refuse
-- the history trigger insert, which runs as the table owner, and with it every rate save).
-- D rows: the FF-1a facts per table and browser role, PASS when the role holds no write grant.
-- R rows: the repo record of both tables matches the live columns, constraints and indexes.
-- A FAIL on an R row means the repo record is off, not that the lockdown failed. Send the
-- whole result to the session.
with t as (
  select v.tbl_name, to_regclass('public.' || v.tbl_name) as tbl
  from (values ('exchange_rates'), ('exchange_rate_history')) as v(tbl_name)
),
r as (
  select v.role_name, v.role_name::regrole::oid as role_oid
  from (values ('anon'), ('authenticated')) as v(role_name)
),
fn as (
  select to_regprocedure('public.log_exchange_rate_change()') as fn_oid
),
role_fact as (
  select t.tbl_name,
         r.role_name,
         t.tbl is not null as table_exists,
         coalesce((select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t.tbl), false) as rls_on,
         case when t.tbl is null then null else has_table_privilege(r.role_name, t.tbl, 'SELECT') end as grant_select,
         case when t.tbl is null then null
              else has_table_privilege(r.role_name, t.tbl, 'INSERT') or has_any_column_privilege(r.role_name, t.tbl, 'INSERT') end as grant_insert,
         case when t.tbl is null then null
              else has_table_privilege(r.role_name, t.tbl, 'UPDATE') or has_any_column_privilege(r.role_name, t.tbl, 'UPDATE') end as grant_update,
         case when t.tbl is null then null else has_table_privilege(r.role_name, t.tbl, 'DELETE, TRUNCATE') end as grant_delete,
         case when t.tbl is null then null
              else has_table_privilege(r.role_name, t.tbl, 'REFERENCES, TRIGGER, MAINTAIN')
                or has_any_column_privilege(r.role_name, t.tbl, 'REFERENCES') end as grant_other,
         (select string_agg(p.polname, ' ' order by p.polname)
            from pg_catalog.pg_policy p
           where p.polrelid = t.tbl
             and p.polcmd in ('r', '*')
             and (0::oid = any(p.polroles) or r.role_oid = any(p.polroles))) as select_policies,
         (select string_agg(p.polname, ' ' order by p.polname)
            from pg_catalog.pg_policy p
           where p.polrelid = t.tbl
             and p.polcmd in ('a', 'w', 'd', '*')
             and (0::oid = any(p.polroles) or r.role_oid = any(p.polroles))) as write_policies
  from t
  cross join r
),
expected_column as (
  select v.tbl_name, v.col_name, v.col_type, v.col_notnull, v.col_default
  from (values
    ('exchange_rates', 'id', 'uuid', true, 'gen_random_uuid()'),
    ('exchange_rates', 'currency_code', 'character varying(3)', true, 'none'),
    ('exchange_rates', 'currency_name', 'character varying(100)', true, 'none'),
    ('exchange_rates', 'currency_symbol', 'character varying(10)', true, 'none'),
    ('exchange_rates', 'rate_to_usd', 'numeric(12,6)', true, 'none'),
    ('exchange_rates', 'is_enabled', 'boolean', false, 'true'),
    ('exchange_rates', 'decimal_places', 'smallint', false, '2'),
    ('exchange_rates', 'last_updated_at', 'timestamp with time zone', false, 'now()'),
    ('exchange_rates', 'updated_by', 'uuid', false, 'none'),
    ('exchange_rates', 'created_at', 'timestamp with time zone', false, 'now()'),
    ('exchange_rate_history', 'id', 'uuid', true, 'gen_random_uuid()'),
    ('exchange_rate_history', 'currency_code', 'character varying(3)', true, 'none'),
    ('exchange_rate_history', 'old_rate', 'numeric(12,6)', false, 'none'),
    ('exchange_rate_history', 'new_rate', 'numeric(12,6)', true, 'none'),
    ('exchange_rate_history', 'changed_by', 'uuid', false, 'none'),
    ('exchange_rate_history', 'changed_at', 'timestamp with time zone', false, 'now()'),
    ('exchange_rate_history', 'change_reason', 'text', false, 'none')
  ) as v(tbl_name, col_name, col_type, col_notnull, col_default)
),
live_column as (
  select t.tbl_name,
         a.attname::text as col_name,
         format_type(a.atttypid, a.atttypmod) as col_type,
         a.attnotnull as col_notnull,
         coalesce(pg_get_expr(d.adbin, d.adrelid), 'none') as col_default
  from t
  join pg_catalog.pg_attribute a on a.attrelid = t.tbl and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
),
column_diff as (
  select coalesce(e.tbl_name, l.tbl_name) as tbl_name,
         coalesce(e.col_name, l.col_name)
           || case when e.col_name is null then ' live ' || l.col_type || ' notnull ' || l.col_notnull::text || ' default ' || l.col_default
                   else ' recorded ' || e.col_type || ' notnull ' || e.col_notnull::text || ' default ' || e.col_default end as diff
  from expected_column e
  full join live_column l
    on l.tbl_name = e.tbl_name
   and l.col_name = e.col_name
   and l.col_type = e.col_type
   and l.col_notnull = e.col_notnull
   and l.col_default = e.col_default
  where e.col_name is null or l.col_name is null
),
constraint_shape as (
  select t.tbl_name,
         coalesce((select string_agg(k.contype || '=' || k.n, ' ' order by k.contype)
                     from (select c.contype::text as contype, count(*) as n
                             from pg_catalog.pg_constraint c
                            where c.conrelid = t.tbl and c.contype in ('c', 'f', 'p', 'u')
                            group by c.contype) k), 'none') as shape,
         exists (select 1 from pg_catalog.pg_constraint c
                  where c.conrelid = t.tbl and c.contype = 'f'
                    and c.confrelid = 'auth.users'::regclass
                    and c.conname = case t.tbl_name when 'exchange_rates' then 'exchange_rates_updated_by_fkey'
                                                    else 'exchange_rate_history_changed_by_fkey' end) as fk_named,
         (select count(*) from pg_catalog.pg_index i where i.indrelid = t.tbl) as index_count,
         coalesce((select string_agg(pg_get_indexdef(i.indexrelid), ' | ' order by ic.relname)
                     from pg_catalog.pg_index i
                     join pg_catalog.pg_class ic on ic.oid = i.indexrelid
                    where i.indrelid = t.tbl and not i.indisprimary and not i.indisunique), 'none') as index_defs
  from t
),
exec_grantee as (
  select string_agg(case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee)::text end, ' '
                    order by case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee)::text end) as grantees
  from fn
  join pg_catalog.pg_proc pr on pr.oid = fn.fn_oid
  cross join lateral aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) x
  where x.privilege_type = 'EXECUTE'
),
checks as (
  select 10 + row_number() over (order by t.tbl_name) as sort_order,
         'C1 no profiles role policy on ' || t.tbl_name as check_name,
         case when t.tbl is not null and not exists (
                select 1 from pg_catalog.pg_policy p
                 where p.polrelid = t.tbl
                   and (coalesce(pg_get_expr(p.polqual, p.polrelid), '-') ilike '%profiles%'
                        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') ilike '%profiles%'))
              then 'PASS' else 'FAIL' end as result,
         coalesce((select string_agg(p.polname, ' ' order by p.polname)
                     from pg_catalog.pg_policy p where p.polrelid = t.tbl), 'no policy') as detail
  from t

  union all
  select 20 + row_number() over (order by t.tbl_name),
         'C2 anon holds no privilege on ' || t.tbl_name,
         case when t.tbl is not null
                   and not has_table_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
                   and not has_any_column_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, REFERENCES')
              then 'PASS' else 'FAIL' end,
         case when t.tbl is null then 'table missing' else 'eight table privileges and column grants checked' end
  from t

  union all
  select 31,
         'C3 authenticated holds SELECT only on exchange_rates',
         case when t.tbl is not null
                   and has_table_privilege('authenticated', t.tbl, 'SELECT')
                   and not has_table_privilege('authenticated', t.tbl, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
                   and not has_any_column_privilege('authenticated', t.tbl, 'INSERT, UPDATE, REFERENCES')
              then 'PASS' else 'FAIL' end,
         case when t.tbl is null then 'table missing'
              else 'select ' || has_table_privilege('authenticated', t.tbl, 'SELECT')::text
                || ' other ' || (has_table_privilege('authenticated', t.tbl, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
                                 or has_any_column_privilege('authenticated', t.tbl, 'INSERT, UPDATE, REFERENCES'))::text end
  from t where t.tbl_name = 'exchange_rates'

  union all
  select 32,
         'C4 authenticated holds no privilege on exchange_rate_history',
         case when t.tbl is not null
                   and not has_table_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
                   and not has_any_column_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, REFERENCES')
              then 'PASS' else 'FAIL' end,
         case when t.tbl is null then 'table missing' else 'eight table privileges and column grants checked' end
  from t where t.tbl_name = 'exchange_rate_history'

  union all
  select 41,
         'C5 enabled rows read policy present and exact',
         case when exists (
                select 1 from pg_catalog.pg_policies pp
                 where pp.schemaname = 'public'
                   and pp.tablename = 'exchange_rates'
                   and pp.policyname = 'Users can read enabled exchange rates'
                   and pp.permissive = 'PERMISSIVE'
                   and pp.cmd = 'SELECT'
                   and pp.roles = array['authenticated']::name[]
                   and pp.qual = '(is_enabled = true)'
                   and pp.with_check is null)
              then 'PASS' else 'FAIL' end,
         coalesce((select pp.cmd || ' ' || array_to_string(pp.roles, ' ') || ' ' || coalesce(pp.qual, '-')
                     from pg_catalog.pg_policies pp
                    where pp.schemaname = 'public' and pp.tablename = 'exchange_rates'
                      and pp.policyname = 'Users can read enabled exchange rates'), 'missing')

  union all
  select 42,
         'C6 exactly one policy on exchange_rates and none on exchange_rate_history',
         case when (select count(*) from pg_catalog.pg_policies pp where pp.schemaname = 'public' and pp.tablename = 'exchange_rates') = 1
               and (select count(*) from pg_catalog.pg_policies pp where pp.schemaname = 'public' and pp.tablename = 'exchange_rate_history') = 0
              then 'PASS' else 'FAIL' end,
         'rates ' || (select count(*) from pg_catalog.pg_policies pp where pp.schemaname = 'public' and pp.tablename = 'exchange_rates')
           || ' history ' || (select count(*) from pg_catalog.pg_policies pp where pp.schemaname = 'public' and pp.tablename = 'exchange_rate_history')

  union all
  select 50 + row_number() over (order by t.tbl_name),
         'C7 row level security on ' || t.tbl_name,
         case when coalesce((select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t.tbl), false) then 'PASS' else 'FAIL' end,
         case when t.tbl is null then 'table missing'
              else 'rls ' || (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t.tbl)::text end
  from t

  union all
  select 55,
         'C12 row security not forced on either table',
         case when (select count(*) from pg_catalog.pg_class c join t on t.tbl = c.oid where not c.relforcerowsecurity) = 2
              then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(t.tbl_name || ' forced ' || c.relforcerowsecurity::text, ', ' order by t.tbl_name)
                     from t join pg_catalog.pg_class c on c.oid = t.tbl), 'tables missing')

  union all
  select 60 + row_number() over (order by t.tbl_name),
         'C8 service_role keeps SELECT INSERT UPDATE DELETE on ' || t.tbl_name,
         case when t.tbl is not null
                   and has_table_privilege('service_role', t.tbl, 'SELECT')
                   and has_table_privilege('service_role', t.tbl, 'INSERT')
                   and has_table_privilege('service_role', t.tbl, 'UPDATE')
                   and has_table_privilege('service_role', t.tbl, 'DELETE')
              then 'PASS' else 'FAIL' end,
         case when t.tbl is null then 'table missing' else 'four privileges checked' end
  from t

  union all
  select 71,
         'C9 history function search_path pinned to public, pg_temp',
         case when (select pr.proconfig from pg_catalog.pg_proc pr where pr.oid = fn.fn_oid) = array['search_path=public, pg_temp']::text[]
              then 'PASS' else 'FAIL' end,
         case when fn.fn_oid is null then 'function missing'
              else coalesce((select array_to_string(pr.proconfig, ' ') from pg_catalog.pg_proc pr where pr.oid = fn.fn_oid), 'no config') end
  from fn

  union all
  select 72,
         'C10 history function EXECUTE held by postgres and service_role only',
         case when fn.fn_oid is not null
                   and (select eg.grantees from exec_grantee eg) = 'postgres service_role'
                   and not has_function_privilege('public', fn.fn_oid, 'EXECUTE')
                   and not has_function_privilege('anon', fn.fn_oid, 'EXECUTE')
                   and not has_function_privilege('authenticated', fn.fn_oid, 'EXECUTE')
              then 'PASS' else 'FAIL' end,
         case when fn.fn_oid is null then 'function missing'
              else coalesce((select eg.grantees from exec_grantee eg), 'nobody') end
  from fn

  union all
  select 73,
         'C11 history trigger fires after update on each row and calls the function',
         case when exists (
                select 1 from pg_catalog.pg_trigger tg
                 where tg.tgrelid = to_regclass('public.exchange_rates')
                   and tg.tgname = 'exchange_rate_change_trigger'
                   and tg.tgfoid = fn.fn_oid
                   and tg.tgtype = 17
                   and tg.tgenabled = 'O'
                   and not tg.tgisinternal)
              then 'PASS' else 'FAIL' end,
         coalesce((select tg.tgname::text || ' enabled ' || tg.tgenabled::text || ' type ' || tg.tgtype::text
                     from pg_catalog.pg_trigger tg
                    where tg.tgrelid = to_regclass('public.exchange_rates')
                      and tg.tgname = 'exchange_rate_change_trigger'), 'missing')
  from fn

  union all
  select 100 + row_number() over (order by rf.tbl_name, rf.role_name),
         'D ' || rf.tbl_name || ' ' || rf.role_name || ' holds no write grant',
         case when rf.table_exists and not rf.grant_insert and not rf.grant_update and not rf.grant_delete and not rf.grant_other
              then 'PASS' else 'FAIL' end,
         'table_exists ' || rf.table_exists::text
           || ' rls_on ' || rf.rls_on::text
           || ' grant_select ' || coalesce(rf.grant_select::text, '-')
           || ' grant_insert ' || coalesce(rf.grant_insert::text, '-')
           || ' grant_update ' || coalesce(rf.grant_update::text, '-')
           || ' grant_delete ' || coalesce(rf.grant_delete::text, '-')
           || ' grant_other ' || coalesce(rf.grant_other::text, '-')
           || ' select_policies ' || coalesce(rf.select_policies, '-')
           || ' write_policies ' || coalesce(rf.write_policies, '-')
  from role_fact rf

  union all
  select 200 + row_number() over (order by t.tbl_name),
         'R1 recorded columns match live on ' || t.tbl_name,
         case when t.tbl is not null and not exists (select 1 from column_diff cd where cd.tbl_name = t.tbl_name)
              then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(cd.diff, ', ' order by cd.diff) from column_diff cd where cd.tbl_name = t.tbl_name), 'match')
  from t

  union all
  select 210 + row_number() over (order by cs.tbl_name),
         'R2 recorded constraints and indexes match live on ' || cs.tbl_name,
         case when cs.fk_named
                   and cs.shape = case cs.tbl_name when 'exchange_rates' then 'c=3 f=1 p=1 u=1' else 'f=1 p=1' end
                   and cs.index_count = case cs.tbl_name when 'exchange_rates' then 4 else 3 end
                   and cs.index_defs = case cs.tbl_name
                         when 'exchange_rates' then
                           'CREATE INDEX idx_exchange_rates_currency_code ON public.exchange_rates USING btree (currency_code)'
                           || ' | ' || 'CREATE INDEX idx_exchange_rates_enabled ON public.exchange_rates USING btree (is_enabled)'
                         else
                           'CREATE INDEX idx_exchange_rate_history_changed_at ON public.exchange_rate_history USING btree (changed_at)'
                           || ' | ' || 'CREATE INDEX idx_exchange_rate_history_currency ON public.exchange_rate_history USING btree (currency_code)'
                       end
              then 'PASS' else 'FAIL' end,
         cs.shape || ' fk_named ' || cs.fk_named::text || ' indexes ' || cs.index_count || ' ' || cs.index_defs
  from constraint_shape cs
)
select report.check_name, report.result, report.detail
from (
  select 0 as sort_order,
         'VERDICT' as check_name,
         case when exists (select 1 from checks where checks.result <> 'PASS') then 'FAIL' else 'PASS' end as result,
         (select count(*) from checks where checks.result = 'PASS') || ' pass '
           || (select count(*) from checks where checks.result <> 'PASS') || ' fail' as detail
  union all
  select checks.sort_order, checks.check_name, checks.result, checks.detail from checks
) as report
order by report.sort_order;
