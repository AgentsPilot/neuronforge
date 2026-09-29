BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.business_os_credit_charges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  action_id uuid,
  adjusts_action_id uuid,
  reason_code text,
  user_id uuid,
  period_start timestamptz NOT NULL,
  group_id uuid,
  credits numeric(18,6) NOT NULL,
  cost_usd numeric(16,10) NOT NULL,
  credit_value_version integer NOT NULL,
  is_fallback_priced boolean NOT NULL DEFAULT false,
  service text,
  action_type text,
  triggered_by text,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_credit_charges_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_action_id_key UNIQUE (action_id);

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_adjusts_action_id_fkey FOREIGN KEY (adjusts_action_id) REFERENCES public.business_os_credit_charges (action_id);

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_kind_known CHECK (kind IN ('charge', 'adjustment'));

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_charge_shape CHECK (kind <> 'charge' OR (action_id IS NOT NULL AND group_id IS NOT NULL AND service IS NOT NULL AND action_type IS NOT NULL AND triggered_by IS NOT NULL AND outcome IS NOT NULL AND adjusts_action_id IS NULL AND reason_code IS NULL AND credits >= 0 AND cost_usd >= 0));

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_adjustment_shape CHECK (kind <> 'adjustment' OR (action_id IS NULL AND adjusts_action_id IS NOT NULL AND reason_code IS NOT NULL AND service IS NULL AND action_type IS NULL AND triggered_by IS NULL AND outcome IS NULL AND is_fallback_priced IS FALSE));

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_triggered_by_known CHECK (triggered_by IS NULL OR triggered_by IN ('owner', 'scheduled', 'external'));

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_outcome_known CHECK (outcome IS NULL OR outcome IN ('succeeded', 'failed'));

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_service_format CHECK (service IS NULL OR (char_length(service) BETWEEN 1 AND 64 AND position(left(service, 1) IN 'abcdefghijklmnopqrstuvwxyz') > 0 AND translate(service, 'abcdefghijklmnopqrstuvwxyz0123456789_', '') = ''));

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_action_type_format CHECK (action_type IS NULL OR (char_length(action_type) BETWEEN 1 AND 64 AND position(left(action_type, 1) IN 'abcdefghijklmnopqrstuvwxyz') > 0 AND translate(action_type, 'abcdefghijklmnopqrstuvwxyz0123456789_', '') = ''));

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_reason_code_format CHECK (reason_code IS NULL OR (char_length(reason_code) BETWEEN 1 AND 64 AND position(left(reason_code, 1) IN 'abcdefghijklmnopqrstuvwxyz') > 0 AND translate(reason_code, 'abcdefghijklmnopqrstuvwxyz0123456789_', '') = ''));

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_amounts_are_numbers CHECK (credits <> 'NaN' AND cost_usd <> 'NaN');

ALTER TABLE public.business_os_credit_charges ADD CONSTRAINT business_os_credit_charges_version_not_negative CHECK (credit_value_version >= 0);

CREATE INDEX business_os_credit_charges_user_period_idx ON public.business_os_credit_charges (user_id, period_start, created_at DESC);

CREATE INDEX business_os_credit_charges_group_idx ON public.business_os_credit_charges (group_id);

CREATE TABLE public.business_os_credit_totals (
  user_id uuid NOT NULL,
  period_start timestamptz NOT NULL,
  credits_total numeric(20,6) NOT NULL DEFAULT 0,
  credits_owner numeric(20,6) NOT NULL DEFAULT 0,
  credits_scheduled numeric(20,6) NOT NULL DEFAULT 0,
  credits_external numeric(20,6) NOT NULL DEFAULT 0,
  credits_adjustment numeric(20,6) NOT NULL DEFAULT 0,
  cost_usd_total numeric(20,10) NOT NULL DEFAULT 0,
  charge_count integer NOT NULL DEFAULT 0,
  fallback_priced_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_credit_totals_pkey PRIMARY KEY (user_id, period_start)
);

ALTER TABLE public.business_os_credit_totals ADD CONSTRAINT business_os_credit_totals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE public.business_os_credit_totals ADD CONSTRAINT business_os_credit_totals_credits_add_up CHECK (credits_total = credits_owner + credits_scheduled + credits_external + credits_adjustment);

ALTER TABLE public.business_os_credit_totals ADD CONSTRAINT business_os_credit_totals_trigger_credits_not_negative CHECK (credits_owner >= 0 AND credits_scheduled >= 0 AND credits_external >= 0);

ALTER TABLE public.business_os_credit_totals ADD CONSTRAINT business_os_credit_totals_counts_consistent CHECK (charge_count >= 0 AND fallback_priced_count >= 0 AND fallback_priced_count <= charge_count);

COMMENT ON TABLE public.business_os_credit_charges IS 'Business OS credit ledger for every chargeable action of any service with one row of kind charge per charged action and later one row of kind adjustment per correction  One credit pool per account  Rows are never updated in place  Charges are written only through business_os_record_credit_charge  No tokens or models or call names or owner text';

COMMENT ON COLUMN public.business_os_credit_charges.service IS 'Which service charged the action such as ai  An identifier checked by format and not a closed list so a new chargeable service needs no schema change  Required on charge rows  NULL on adjustment rows which inherit the service of the charge they adjust';

COMMENT ON COLUMN public.business_os_credit_charges.group_id IS 'Groups the actions of one user visible unit of work for any service  Required on every charge row even for a group of one';

COMMENT ON COLUMN public.business_os_credit_charges.is_fallback_priced IS 'True when the cost was priced from a fallback rate rather than the measured one  AI sets it when a model is missing from the price table  another service sets it only if it defines its own documented fallback and otherwise records false  False on adjustment rows  Hidden from owners';

COMMENT ON TABLE public.business_os_credit_totals IS 'Running totals of business_os_credit_charges per account and billing period across every service as one credit pool  Derived data that can be rebuilt by summing the ledger rows of the same user_id and period_start  Written only through business_os_record_credit_charge';

COMMENT ON COLUMN public.business_os_credit_totals.credits_total IS 'Sum of credits over ALL ledger rows of the account and period including adjustments  Always equals credits_owner plus credits_scheduled plus credits_external plus credits_adjustment';

COMMENT ON COLUMN public.business_os_credit_totals.credits_owner IS 'Sum of credits over charge rows with triggered_by owner but not adjustment rows';

COMMENT ON COLUMN public.business_os_credit_totals.credits_scheduled IS 'Sum of credits over charge rows with triggered_by scheduled but not adjustment rows';

COMMENT ON COLUMN public.business_os_credit_totals.credits_external IS 'Sum of credits over charge rows with triggered_by external but not adjustment rows';

COMMENT ON COLUMN public.business_os_credit_totals.credits_adjustment IS 'Sum of credits over adjustment rows which are signed  Zero until adjustments are written';

COMMENT ON COLUMN public.business_os_credit_totals.cost_usd_total IS 'Sum of cost_usd over ALL ledger rows of the account and period including adjustments  Hidden from owners';

COMMENT ON COLUMN public.business_os_credit_totals.charge_count IS 'Number of charge rows  Adjustment rows are not counted';

COMMENT ON COLUMN public.business_os_credit_totals.fallback_priced_count IS 'Number of charge rows with is_fallback_priced true  Hidden from owners';

ALTER TABLE public.business_os_credit_charges ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.business_os_credit_totals ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_os_credit_charges_owner_select ON public.business_os_credit_charges FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY business_os_credit_totals_owner_select ON public.business_os_credit_totals FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.business_os_credit_charges FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_credit_charges FROM anon;

REVOKE ALL ON TABLE public.business_os_credit_charges FROM authenticated;

REVOKE ALL ON TABLE public.business_os_credit_charges FROM service_role;

REVOKE ALL ON TABLE public.business_os_credit_totals FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_credit_totals FROM anon;

REVOKE ALL ON TABLE public.business_os_credit_totals FROM authenticated;

REVOKE ALL ON TABLE public.business_os_credit_totals FROM service_role;

GRANT SELECT (id, kind, action_id, adjusts_action_id, reason_code, user_id, period_start, group_id, credits, credit_value_version, service, action_type, triggered_by, outcome, created_at) ON TABLE public.business_os_credit_charges TO authenticated;

GRANT SELECT (user_id, period_start, credits_total, credits_owner, credits_scheduled, credits_external, credits_adjustment, charge_count, created_at, updated_at) ON TABLE public.business_os_credit_totals TO authenticated;

GRANT SELECT, INSERT ON TABLE public.business_os_credit_charges TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.business_os_credit_totals TO service_role;

CREATE FUNCTION public.business_os_credit_period_start(p_anchor timestamptz, p_at timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $period$
DECLARE
  v_anchor_utc timestamp;
  v_at_utc timestamp;
  v_months integer;
  v_candidate_utc timestamp;
BEGIN
  IF p_anchor IS NULL OR p_at IS NULL THEN
    RETURN NULL;
  END IF;

  v_anchor_utc := p_anchor AT TIME ZONE 'UTC';
  v_at_utc := p_at AT TIME ZONE 'UTC';

  v_months := (extract(year FROM v_at_utc)::integer - extract(year FROM v_anchor_utc)::integer) * 12
            + (extract(month FROM v_at_utc)::integer - extract(month FROM v_anchor_utc)::integer);

  v_candidate_utc := v_anchor_utc + make_interval(months => v_months);

  IF v_candidate_utc > v_at_utc THEN
    v_months := v_months - 1;
    v_candidate_utc := v_anchor_utc + make_interval(months => v_months);
  END IF;

  RETURN v_candidate_utc AT TIME ZONE 'UTC';
END;
$period$;

CREATE FUNCTION public.business_os_record_credit_charge(
  p_action_id uuid,
  p_user_id uuid,
  p_group_id uuid,
  p_service text,
  p_action_type text,
  p_triggered_by text,
  p_outcome text,
  p_credits numeric,
  p_cost_usd numeric,
  p_credit_value_version integer,
  p_is_fallback_priced boolean
)
RETURNS TABLE (out_recorded boolean, out_period_start timestamptz, out_anchor_source text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $record$
DECLARE
  v_now timestamptz := now();
  v_anchor timestamptz;
  v_period timestamptz;
  v_source text;
  v_credits numeric(18,6);
  v_cost_usd numeric(16,10);
  v_inserted_id uuid;
BEGIN
  IF p_action_id IS NULL OR p_user_id IS NULL OR p_group_id IS NULL OR p_service IS NULL THEN
    RAISE EXCEPTION 'business_os_record_credit_charge needs an action id a user id a group id and a service' USING ERRCODE = '22004';
  END IF;

  v_credits := round(p_credits, 6);
  v_cost_usd := round(p_cost_usd, 10);

  SELECT account_plan.period_anchor INTO v_anchor
  FROM public.business_os_account_plans AS account_plan
  WHERE account_plan.user_id = p_user_id;

  IF v_anchor IS NOT NULL THEN
    v_period := public.business_os_credit_period_start(v_anchor, v_now);
    v_source := 'plan';
  ELSE
    v_period := date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_source := 'calendar_month';
  END IF;

  INSERT INTO public.business_os_credit_charges AS charge_row (
    kind, action_id, user_id, period_start, group_id, credits, cost_usd,
    credit_value_version, is_fallback_priced, service, action_type, triggered_by, outcome
  )
  VALUES (
    'charge', p_action_id, p_user_id, v_period, p_group_id, v_credits, v_cost_usd,
    p_credit_value_version, p_is_fallback_priced, p_service, p_action_type, p_triggered_by, p_outcome
  )
  ON CONFLICT (action_id) DO NOTHING
  RETURNING charge_row.id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    INSERT INTO public.business_os_credit_totals AS totals_row (
      user_id, period_start, credits_total, credits_owner, credits_scheduled, credits_external,
      credits_adjustment, cost_usd_total, charge_count, fallback_priced_count, created_at, updated_at
    )
    VALUES (
      p_user_id,
      v_period,
      v_credits,
      CASE WHEN p_triggered_by = 'owner' THEN v_credits ELSE 0 END,
      CASE WHEN p_triggered_by = 'scheduled' THEN v_credits ELSE 0 END,
      CASE WHEN p_triggered_by = 'external' THEN v_credits ELSE 0 END,
      0,
      v_cost_usd,
      1,
      CASE WHEN p_is_fallback_priced THEN 1 ELSE 0 END,
      v_now,
      v_now
    )
    ON CONFLICT (user_id, period_start) DO UPDATE SET
      credits_total = totals_row.credits_total + EXCLUDED.credits_total,
      credits_owner = totals_row.credits_owner + EXCLUDED.credits_owner,
      credits_scheduled = totals_row.credits_scheduled + EXCLUDED.credits_scheduled,
      credits_external = totals_row.credits_external + EXCLUDED.credits_external,
      cost_usd_total = totals_row.cost_usd_total + EXCLUDED.cost_usd_total,
      charge_count = totals_row.charge_count + EXCLUDED.charge_count,
      fallback_priced_count = totals_row.fallback_priced_count + EXCLUDED.fallback_priced_count,
      updated_at = EXCLUDED.updated_at;
  END IF;

  out_recorded := v_inserted_id IS NOT NULL;
  out_period_start := v_period;
  out_anchor_source := v_source;
  RETURN NEXT;
END;
$record$;

REVOKE ALL ON FUNCTION public.business_os_credit_period_start(timestamptz, timestamptz) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_credit_period_start(timestamptz, timestamptz) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_credit_period_start(timestamptz, timestamptz) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_credit_period_start(timestamptz, timestamptz) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_credit_period_start(timestamptz, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.business_os_record_credit_charge(uuid, uuid, uuid, text, text, text, text, numeric, numeric, integer, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_record_credit_charge(uuid, uuid, uuid, text, text, text, text, numeric, numeric, integer, boolean) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_record_credit_charge(uuid, uuid, uuid, text, text, text, text, numeric, numeric, integer, boolean) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_record_credit_charge(uuid, uuid, uuid, text, text, text, text, numeric, numeric, integer, boolean) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_record_credit_charge(uuid, uuid, uuid, text, text, text, text, numeric, numeric, integer, boolean) TO service_role;

COMMIT;
