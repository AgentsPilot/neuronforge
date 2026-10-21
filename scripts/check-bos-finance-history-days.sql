-- Finance check 33: the last 14 snapshot days, one row per day, read only.
-- Run after the first nightly snapshot, and whenever the History block looks wrong.
-- groups_match_total and taken_after_day_end must be true on every day.
-- A day missing from the list is a missed or late night and shows as a gap on the page.
with s as (
  select f.as_of_date, f.metric, f.value, f.taken_at
  from public.business_os_finance_snapshots f
  where f.as_of_date >= (now() at time zone 'UTC')::date - 14
),
d as (
  select s.as_of_date,
         count(*) as snapshot_rows,
         count(*) filter (where s.metric like 'credit%' or s.metric like 'gifted%' or s.metric like 'bought%') as credit_rows,
         max(s.value) filter (where s.metric = 'accounts_total') as accounts_total,
         sum(s.value) filter (where s.metric = 'accounts_in_group') as accounts_in_groups,
         min(s.taken_at) as first_taken_at
  from s
  group by s.as_of_date
),
r as (
  select (c.started_at at time zone 'UTC')::date - 1 as as_of_date,
         string_agg(distinct c.outcome, ' ') as run_outcomes,
         count(*) as runs
  from public.bos_cron_runs c
  where c.job = 'finance-snapshot'
    and c.started_at >= now() - interval '15 days'
  group by 1
)
select d.as_of_date,
       d.snapshot_rows,
       d.credit_rows,
       d.accounts_total,
       d.accounts_in_groups,
       (d.accounts_total is null or d.accounts_total = d.accounts_in_groups) as groups_match_total,
       (d.first_taken_at >= ((d.as_of_date + 1)::timestamp at time zone 'UTC')) as taken_after_day_end,
       d.first_taken_at,
       r.runs,
       r.run_outcomes
from d
left join r on r.as_of_date = d.as_of_date
order by d.as_of_date desc;
