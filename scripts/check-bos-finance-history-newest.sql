-- Finance check 34: the newest snapshot against the lots and plan rows, one row, read only.
-- Gifted and bought outstanding are rebuilt from the lots and draws as they stood at taken_at,
-- for lots that still have an account. A difference is expected only when an account was
-- deleted after taken_at (its lots lose their account) or a lot was written in the same second.
-- plan_rows_then counts plan rows created by taken_at. It can be lower than the snapshot
-- only when an account was deleted since.
with newest as (
  select max(g.as_of_date) as as_of_date from public.business_os_finance_snapshots g
),
snap as (
  select f.metric, f.value, f.taken_at
  from public.business_os_finance_snapshots f
  join newest n on n.as_of_date = f.as_of_date
  where f.dimension = 'all'
),
at_time as (
  select (select n.as_of_date from newest n) as as_of_date,
         (select min(snap.taken_at) from snap) as taken_at
),
lots as (
  select l.source,
         greatest(l.credits_granted - coalesce((
           select sum(dr.credits)
           from public.business_os_credit_lot_draws dr
           where dr.lot_id = l.id and dr.created_at <= a.taken_at), 0), 0) as remaining
  from public.business_os_credit_lots l
  cross join at_time a
  where l.user_id is not null
    and l.created_at <= a.taken_at
    and (l.expires_at is null or l.expires_at > a.taken_at)
)
select a.as_of_date,
       a.taken_at,
       (select snap.value from snap where snap.metric = 'gifted_outstanding') as snapshot_gifted,
       coalesce((select sum(lots.remaining) from lots where lots.source = 'admin_grant'), 0) as rebuilt_gifted,
       (select snap.value from snap where snap.metric = 'bought_outstanding') as snapshot_bought,
       coalesce((select sum(lots.remaining) from lots where lots.source = 'boost_purchase'), 0) as rebuilt_bought,
       (select snap.value from snap where snap.metric = 'accounts_total') as snapshot_accounts,
       (select count(*) from public.business_os_account_plans p where p.created_at <= a.taken_at) as plan_rows_then
from at_time a;
