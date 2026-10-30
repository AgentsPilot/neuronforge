-- Finance check MK9-C2 (was check 38, rewritten by MK9-R2): trials and their first plan payments, read only, one row.
-- Set livemode in the p block to the mode on the Subscriptions page chip.
-- A first payment is the earliest paid plan invoice above zero in that mode,
-- the same rule as the Converted this month figure on the page. Boosts never count.
-- Trial ends are worked out by the page from the cohort settings, so these are totals
-- over all time: the page figures for any window are at most these.
-- Platform accounts are left out, as on the page: the all-zero id, and the server SYSTEM_ADMIN_USER_ID.
-- Set system_admin_user_id in the p block to that value, or leave it null when it is not set.
-- MK5BFU-FU-2: a free period after a cancelled paid plan (after_plan_moves above 0) is not a trial,
-- as on the page: that owner already paid.
with p as (
  select false as livemode,
         null::uuid as system_admin_user_id
),
t as (
  select r.user_id
  from public.business_os_account_plans r
  cross join p
  where r.cohort = 'trial'
    and r.after_plan_moves = 0
    and r.user_id <> '00000000-0000-0000-0000-000000000000'
    and (p.system_admin_user_id is null or r.user_id <> p.system_admin_user_id)
),
f as (
  select e.user_id, min(e.paid_at) as first_paid
  from public.business_os_billing_events e
  cross join p
  where e.kind = 'invoice_paid'
    and e.amount_minor > 0
    and e.livemode = p.livemode
    and e.paid_at is not null
  group by e.user_id
)
select count(*) as trial_accounts,
       count(f.first_paid) as paid,
       min(f.first_paid) as earliest_first_payment,
       max(f.first_paid) as latest_first_payment
from t
left join f on f.user_id = t.user_id;
