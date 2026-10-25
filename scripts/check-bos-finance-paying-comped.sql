-- Finance check MK9-C1 (was check 37): paying and comped, read only, one row per plan tier.
-- Set livemode in the p block to the mode on the Subscriptions page chip.
-- A tier counts as in force here when it has no end or ends after now.
-- Grace after the end is not modelled, so the page may show a few more comped accounts.
-- Platform accounts are counted here, as in Plan mix on the page (Comped there includes them).
-- assigned_no_subscription plus subscription_ended_or_not_paying is the comped count per tier.
with p as (
  select false as livemode
),
plans as (
  select r.user_id, r.tier
  from public.business_os_account_plans r
  where r.tier is not null
    and (r.tier_expires_at is null or r.tier_expires_at > now())
),
joined as (
  select pl.tier,
         a.subscription_status,
         (a.subscription_status in ('active', 'past_due') and a.ended_at is null) as paying
  from plans pl
  cross join p
  left join public.business_os_billing_accounts a
    on a.user_id = pl.user_id
   and a.livemode = p.livemode
)
select j.tier,
       count(*) as tier_in_force,
       count(*) filter (where j.paying) as paying,
       count(*) filter (where j.subscription_status is null) as assigned_no_subscription,
       count(*) filter (where j.subscription_status is not null and not j.paying) as subscription_ended_or_not_paying
from joined j
group by j.tier
order by j.tier;
