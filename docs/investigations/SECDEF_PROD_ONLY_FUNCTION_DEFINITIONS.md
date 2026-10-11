# Production-only SECURITY DEFINER Function Definitions

> **Last Updated**: 2026-10-11

## Overview

Ten SECURITY DEFINER functions, and one trigger, exist in the production database with **no definition anywhere in git** — they were created in the Supabase dashboard. This document records their exact production definitions so the repository is the source of truth again and any later work on them (for example the parked slice 7 of the [SECURITY DEFINER lockdown](/docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md)) starts from a known text.

**This is a reference record, not a migration. Do not run it.** It is Markdown on purpose: a `.sql` file containing these `CREATE FUNCTION ... SECURITY DEFINER` statements without a revoke would (correctly) fail the slice 6 CI guard (`supabase/__tests__/security-definer-surface.guard.test.ts`).

**How it was captured:** 2026-10-11, by the user in the production SQL editor, with a read-only query using `pg_get_functiondef` and `pg_get_triggerdef` on `public` objects. The text below is the output as returned, unedited.

## Table of Contents

- [Current privileges](#current-privileges)
- [Observations](#observations)
- [Definitions](#definitions)
- [Change History](#change-history)

---

## Current privileges

None of these is callable by `anon` or `authenticated` any more. EXECUTE was revoked from `PUBLIC`, `anon` and `authenticated` and kept for `service_role` by the lockdown:

| Object | Closed by | Notes |
|---|---|---|
| `get_last_perfect_calibration`, `get_unviewed_insights_count`, `get_user_credit_balance`, `get_user_subscription_info`, `get_user_usage_summary`, `get_user_workflow_stats`, `has_sufficient_credits`, `is_reward_eligible` | Slice 2, migration `20261048` (PR #277) | No live caller in the code |
| `increment_calibration_count` | Slice 3, migration `20261049` (PR #282) | Called by `ShadowAgent` on a service-key client |
| `log_exchange_rate_change` | Slice 5, migration `20261051` (PR #297) | Trigger function; firing never checks EXECUTE |
| `exchange_rate_change_trigger` | — | Trigger on `public.exchange_rates`, `AFTER UPDATE` |

All ten functions have **no pinned `search_path`**, so they are on the parked slice 7 list.

## Observations

Recorded for whoever picks these up; no action taken.

| Function | Observation |
|---|---|
| `get_user_credit_balance`, `get_user_subscription_info`, `has_sufficient_credits` | Read `public.user_credits` and `public.plans`, tables that belong to the legacy credit model; trust a caller-supplied user id |
| `get_user_usage_summary`, `get_user_workflow_stats`, `get_last_perfect_calibration`, `is_reward_eligible` | Trust a caller-supplied user id (no `auth.uid()` check) — harmless now that only `service_role` can call them |
| `get_unviewed_insights_count` | Scoped by `auth.uid()`, so it would return 0 for `service_role` |
| `has_sufficient_credits` | Calls `get_user_credit_balance` unqualified — a `search_path` pin must keep `public` |
| `log_exchange_rate_change` | Writes `public.exchange_rate_history`; `exchange_rates` and `exchange_rate_history` are also not created by any git migration |

---

## Definitions

### get_last_perfect_calibration(p_agent_id uuid, p_user_id uuid)

```sql
CREATE OR REPLACE FUNCTION public.get_last_perfect_calibration(p_agent_id uuid, p_user_id uuid)
 RETURNS TABLE(calibration_id uuid, quality_score integer, workflow_hash text, input_schema_hash text, created_at timestamp with time zone, production_ready boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    id,
    calibration_quality_score,
    calibration_history.workflow_hash,
    calibration_history.input_schema_hash,
    calibration_history.created_at,
    calibration_history.marked_production_ready
  FROM calibration_history
  WHERE agent_id = p_agent_id
    AND user_id = p_user_id
    AND status = 'success'
    AND calibration_quality_score = 100  -- Only perfect calibrations for fast path
  ORDER BY created_at DESC
  LIMIT 1;
END;
$function$
```

### get_unviewed_insights_count(p_agent_id uuid)

```sql
CREATE OR REPLACE FUNCTION public.get_unviewed_insights_count(p_agent_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM execution_insights
    WHERE agent_id = p_agent_id
      AND status = 'new'
      AND user_id = auth.uid()
  );
END;
$function$
```

### get_user_credit_balance(p_user_id uuid)

```sql
CREATE OR REPLACE FUNCTION public.get_user_credit_balance(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_balance integer;
BEGIN
  SELECT credits INTO v_balance
  FROM public.user_credits
  WHERE user_id = p_user_id;

  RETURN COALESCE(v_balance, 0);
END;
$function$
```

### get_user_subscription_info(p_user_id uuid)

```sql
CREATE OR REPLACE FUNCTION public.get_user_subscription_info(p_user_id uuid)
 RETURNS TABLE(subscription_status character varying, plan_name character varying, credits_available integer, credits_used_this_cycle integer, monthly_credits integer, next_billing_date timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    uc.subscription_status,
    p.plan_name,
    uc.credits,
    uc.credits_used_this_cycle,
    p.monthly_credits,
    uc.next_billing_date
  FROM public.user_credits uc
  LEFT JOIN public.plans p ON uc.plan_id = p.id
  WHERE uc.user_id = p_user_id;
END;
$function$
```

### get_user_usage_summary(target_user_id uuid, days_back integer)

```sql
CREATE OR REPLACE FUNCTION public.get_user_usage_summary(target_user_id uuid, days_back integer DEFAULT 30)
 RETURNS TABLE(total_requests bigint, total_tokens bigint, total_cost numeric, avg_tokens_per_request numeric, most_used_model text, most_used_provider text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as total_requests,
    SUM(tu.total_tokens)::BIGINT as total_tokens,
    SUM(tu.cost_usd)::NUMERIC as total_cost,
    AVG(tu.total_tokens)::NUMERIC as avg_tokens_per_request,
    (
      SELECT model_name 
      FROM public.token_usage 
      WHERE user_id = target_user_id 
        AND created_at >= NOW() - INTERVAL '1 day' * days_back
      GROUP BY model_name 
      ORDER BY COUNT(*) DESC 
      LIMIT 1
    ) as most_used_model,
    (
      SELECT provider 
      FROM public.token_usage 
      WHERE user_id = target_user_id 
        AND created_at >= NOW() - INTERVAL '1 day' * days_back
      GROUP BY provider 
      ORDER BY COUNT(*) DESC 
      LIMIT 1
    ) as most_used_provider
  FROM public.token_usage tu
  WHERE tu.user_id = target_user_id
    AND tu.created_at >= NOW() - INTERVAL '1 day' * days_back;
END;
$function$
```

### get_user_workflow_stats(target_user_id uuid)

```sql
CREATE OR REPLACE FUNCTION public.get_user_workflow_stats(target_user_id uuid)
 RETURNS TABLE(total_drafts bigint, total_workflows bigint, active_workflows bigint, total_executions bigint, successful_executions bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*) FROM workflow_drafts WHERE user_id = target_user_id),
        (SELECT COUNT(*) FROM workflows WHERE user_id = target_user_id),
        (SELECT COUNT(*) FROM workflows WHERE user_id = target_user_id AND status = 'active'),
        (SELECT COUNT(*) FROM workflow_executions WHERE user_id = target_user_id),
        (SELECT COUNT(*) FROM workflow_executions WHERE user_id = target_user_id AND status = 'completed');
END;
$function$
```

### has_sufficient_credits(p_user_id uuid, p_required_credits integer)

```sql
CREATE OR REPLACE FUNCTION public.has_sufficient_credits(p_user_id uuid, p_required_credits integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_balance integer;
BEGIN
  v_balance := get_user_credit_balance(p_user_id);
  RETURN v_balance >= p_required_credits;
END;
$function$
```

### increment_calibration_count(p_agent_id uuid)

```sql
CREATE OR REPLACE FUNCTION public.increment_calibration_count(p_agent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE agents
  SET calibration_run_count = COALESCE(calibration_run_count, 0) + 1
  WHERE id = p_agent_id;
END;
$function$
```

### is_reward_eligible(p_user_id uuid, p_reward_key character varying)

```sql
CREATE OR REPLACE FUNCTION public.is_reward_eligible(p_user_id uuid, p_reward_key character varying)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_config record;
  v_user_reward record;
  v_eligible boolean := false;
BEGIN
  -- Get reward config
  SELECT * INTO v_config
  FROM public.reward_config
  WHERE reward_key = p_reward_key AND is_active = true
  AND (valid_from IS NULL OR valid_from <= now())
  AND (valid_until IS NULL OR valid_until >= now());

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Get user reward history
  SELECT * INTO v_user_reward
  FROM public.user_rewards
  WHERE user_id = p_user_id AND reward_config_id = v_config.id;

  -- Check max per user
  IF v_config.max_per_user IS NOT NULL THEN
    IF v_user_reward.redemption_count >= v_config.max_per_user THEN
      RETURN false;
    END IF;
  END IF;

  -- Check cooldown
  IF v_config.cooldown_hours > 0 AND v_user_reward.last_redeemed_at IS NOT NULL THEN
    IF now() < v_user_reward.last_redeemed_at + (v_config.cooldown_hours || ' hours')::interval THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$function$
```

### log_exchange_rate_change()

```sql
CREATE OR REPLACE FUNCTION public.log_exchange_rate_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.rate_to_usd IS DISTINCT FROM NEW.rate_to_usd THEN
    INSERT INTO public.exchange_rate_history (
      currency_code,
      old_rate,
      new_rate,
      changed_by,
      changed_at
    ) VALUES (
      NEW.currency_code,
      OLD.rate_to_usd,
      NEW.rate_to_usd,
      NEW.updated_by,
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$function$
```

### exchange_rate_change_trigger (on public.exchange_rates)

```sql
CREATE TRIGGER exchange_rate_change_trigger AFTER UPDATE ON public.exchange_rates FOR EACH ROW EXECUTE FUNCTION log_exchange_rate_change()
```

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created (TL) | Captured from production by the user with a read-only `pg_get_functiondef` / `pg_get_triggerdef` query; 10 functions and 1 trigger with no git definition. Satisfies the C-10 prerequisite of the parked slice 7 for prod-only functions |
