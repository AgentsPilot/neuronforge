-- S-6 free-tier abuse check — READ-ONLY
-- Last Updated: 2026-09-19
--
-- Purpose: look for signs that POST /api/onboarding/allocate-free-tier (no auth, userId from
-- the body, credits added on every call, account_frozen reset to false) was abused.
-- Every statement is a SELECT. Nothing here writes, locks, or calls a function with side effects.
-- Run each query on its own in the Supabase SQL Editor (production) and send back the output.
--
-- Background the queries rely on:
--   * The free-tier grant writes NO credit_transactions row. Every other credit source does
--     (trial, allocation, boost_pack_purchase, reward_credit, welcome_bonus). So credits that no
--     ledger row explains are the fingerprint of extra free-tier grants.
--   * Each call overwrites free_tier_granted_at, so a late granted_at means a call long after signup.
--   * The expiry cron freezes an account and sets free_tier_expires_at = NULL. A later grant sets
--     account_frozen = false and a fresh free_tier_expires_at.
--   * The route's audit call never reached the app, so audit_trail is expected to hold nothing.

-- Q1. Scale: how many subscriptions carry a free-tier grant, and how many are frozen.
select count(*)                                              as rows_total,
       count(*) filter (where free_tier_granted_at is not null) as with_grant,
       count(*) filter (where account_frozen)                 as frozen_now,
       min(free_tier_initial_amount)                          as min_grant_tokens,
       max(free_tier_initial_amount)                          as max_grant_tokens
from user_subscriptions;

-- Q2. Subscriptions for ids that are not real users (the body userId was never checked).
select s.user_id, s.balance, s.free_tier_granted_at, s.created_at
from user_subscriptions s
left join auth.users u on u.id = s.user_id
where u.id is null
order by s.created_at desc;

-- Q3. Unexplained credits: balance + everything spent, minus every ledger credit and one grant.
--     extra_grants_est ≈ how many additional free-tier grants would explain the gap.
--     NOTE: valid as-is only for data written BEFORE the S-6 fix deployed. After deploy, grants also
--     write a credit_transactions row (activity_type 'free_tier_grant'); if you rerun Q3 later, add
--     `where activity_type is distinct from 'free_tier_grant'` inside the ledger CTE to avoid double-counting.
with ledger as (
  select user_id,
         coalesce(sum(credits_delta) filter (where credits_delta > 0), 0)      as ledger_in,
         coalesce(sum(-credits_delta) filter (where credits_delta < 0), 0)     as ledger_out
  from credit_transactions
  group by user_id
)
select s.user_id,
       u.email,
       s.balance,
       coalesce(l.ledger_in, 0)  as ledger_in,
       coalesce(l.ledger_out, 0) as ledger_out,
       s.free_tier_initial_amount,
       (s.balance + coalesce(l.ledger_out, 0))
         - coalesce(l.ledger_in, 0) - coalesce(s.free_tier_initial_amount, 0) as unexplained,
       round(((s.balance + coalesce(l.ledger_out, 0))
         - coalesce(l.ledger_in, 0) - coalesce(s.free_tier_initial_amount, 0))
         / nullif(s.free_tier_initial_amount, 0), 1)                           as extra_grants_est,
       s.account_frozen,
       s.free_tier_granted_at,
       s.created_at
from user_subscriptions s
left join ledger l on l.user_id = s.user_id
left join auth.users u on u.id = s.user_id
where s.free_tier_initial_amount > 0
  and (s.balance + coalesce(l.ledger_out, 0))
      - coalesce(l.ledger_in, 0) - s.free_tier_initial_amount > s.free_tier_initial_amount * 0.5
order by unexplained desc
limit 100;

-- Q4. Grants made long after the account was created (re-grants, or grants to old accounts).
select s.user_id, u.email, u.created_at as user_created_at, s.created_at as sub_created_at,
       s.free_tier_granted_at,
       s.free_tier_granted_at - greatest(u.created_at, s.created_at) as granted_after,
       s.account_frozen, s.balance
from user_subscriptions s
left join auth.users u on u.id = s.user_id
where s.free_tier_granted_at > greatest(u.created_at, s.created_at) + interval '1 day'
order by granted_after desc
limit 100;

-- Q5. Likely unfreezes: not frozen now, but the grant came after the first free tier would have
--     expired (created + 30 days), i.e. the account was probably frozen by the cron and then re-granted.
select s.user_id, u.email, s.created_at, s.free_tier_granted_at, s.free_tier_expires_at,
       s.account_frozen, s.balance, s.stripe_subscription_id
from user_subscriptions s
left join auth.users u on u.id = s.user_id
where s.account_frozen = false
  and s.free_tier_granted_at > s.created_at + interval '30 days'
order by s.free_tier_granted_at desc
limit 100;

-- Q6. Bursts: several grants landing in the same minute (scripted calls).
select date_trunc('minute', free_tier_granted_at) as minute, count(*) as grants
from user_subscriptions
where free_tier_granted_at is not null
group by 1
having count(*) >= 3
order by grants desc, minute desc
limit 50;

-- Q7. Confirm the route's audit logging never landed (expected: 0 rows).
select count(*) as free_tier_audit_rows, max(created_at) as latest
from audit_trail
where action = 'FREE_TIER_ALLOCATED';

-- ---------------------------------------------------------------------------
-- Schema checks the fix depends on (workplan checks C1–C3). Also read-only.
-- ---------------------------------------------------------------------------

-- C1. Is user_subscriptions.user_id unique? (The one-grant insert path relies on it.)
select conname, contype, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.user_subscriptions'::regclass;
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'user_subscriptions';

-- C2. Which transaction_type / activity_type values does credit_transactions allow?
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.credit_transactions'::regclass and contype = 'c';

-- C3. Can a signed-in user write their own user_subscriptions row from the browser? (possible P0)
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c where c.oid = 'public.user_subscriptions'::regclass;
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'user_subscriptions';
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'user_subscriptions'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;
-- C3 (cont.) Any non-internal trigger on user_subscriptions? (tenant-guard "unscoped trigger" check)
select tgname, pg_get_triggerdef(oid) as def
from pg_trigger
where tgrelid = 'public.user_subscriptions'::regclass and not tgisinternal;
