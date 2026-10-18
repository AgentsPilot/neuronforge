-- Finance check 35: who can read or write the exchange rate tables, read only.
-- One row per table and role. The page is read only since FF-1a, but a browser session
-- can still change rates when the role holds a write grant and either row level security
-- is off or a write policy applies to the role. FF-2 revokes writes only:
-- grant_select for authenticated must stay true, because the settings currency picker
-- reads exchange_rates from the browser. Send the result to the session.
with t as (
  select v.tbl_name, to_regclass('public.' || v.tbl_name) as tbl
  from (values ('exchange_rates'), ('exchange_rate_history')) as v(tbl_name)
),
r as (
  select v.role_name, v.role_name::regrole::oid as role_oid
  from (values ('anon'), ('authenticated')) as v(role_name)
)
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
order by t.tbl_name, r.role_name;
