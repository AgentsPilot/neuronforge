BEGIN;
SET LOCAL lock_timeout = '5s';

DO $rollback_guard$
DECLARE
  v_view regclass;
BEGIN
  v_view := to_regclass('public.pilot_cost_savings_summary');
  IF v_view IS NULL OR (SELECT pg_class.relkind FROM pg_class WHERE pg_class.oid = v_view) <> 'v' THEN
    RAISE EXCEPTION 'view pilot_cost_savings_summary is missing or not a plain view  slice two rollback refused';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_depend AS dependency
    WHERE dependency.refclassid = 'pg_class'::regclass
      AND dependency.refobjid = v_view
      AND dependency.deptype = 'n'
      AND NOT (dependency.classid = 'pg_rewrite'::regclass
               AND dependency.objid IN (SELECT pg_rewrite.oid FROM pg_rewrite WHERE pg_rewrite.ev_class = v_view))
  ) THEN
    RAISE EXCEPTION 'another object depends on view pilot_cost_savings_summary  slice two rollback refused';
  END IF;
  IF (SELECT array_agg(pg_attribute.attname::text ORDER BY pg_attribute.attnum)
      FROM pg_attribute
      WHERE pg_attribute.attrelid = v_view AND pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped)
     IS DISTINCT FROM ARRAY['execution_id', 'agent_id', 'total_tokens', 'actual_cost', 'tier3_cost',
                            'cost_saved', 'savings_percentage', 'created_at'] THEN
    RAISE EXCEPTION 'view pilot_cost_savings_summary columns differ from the captured definition  slice two rollback refused';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE pg_trigger.tgrelid = v_view) THEN
    RAISE EXCEPTION 'view pilot_cost_savings_summary has a trigger  slice two rollback refused';
  END IF;
  IF (SELECT count(*) FROM pg_rewrite WHERE pg_rewrite.ev_class = v_view) <> 1 THEN
    RAISE EXCEPTION 'view pilot_cost_savings_summary has a rewrite rule beyond its own  slice two rollback refused';
  END IF;
  RAISE NOTICE 'the view is recreated hardened  security invoker on  anon access is not restored';
  IF EXISTS (SELECT 1 FROM public.ai_model_image_pricing) THEN
    RAISE EXCEPTION 'slice two rollback refused  the image price table has rows';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_model_pricing AS pricing
             WHERE pricing.cached_input_cost_per_token IS NOT NULL
                OR pricing.proposal_id IS NOT NULL
                OR pricing.proposal_line_id IS NOT NULL) THEN
    RAISE EXCEPTION 'slice two rollback refused  a price row carries a cached price or a proposal';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_model_pricing AS pricing
             WHERE pricing.input_cost_per_token <> round(pricing.input_cost_per_token, 8)
                OR pricing.output_cost_per_token <> round(pricing.output_cost_per_token, 8)
                OR abs(pricing.input_cost_per_token) >= 100
                OR abs(pricing.output_cost_per_token) >= 100) THEN
    RAISE EXCEPTION 'slice two rollback refused  a price needs more than eight decimals or two whole digits';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_model_pricing AS pricing
             GROUP BY pricing.provider, pricing.model_name, pricing.effective_date
             HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'slice two rollback refused  provider model and date repeat across all rows';
  END IF;
END
$rollback_guard$;

DROP TABLE public.ai_model_image_pricing;

ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_provider_model_name_effective_date_key
  UNIQUE (provider, model_name, effective_date);
DROP INDEX public.ai_model_pricing_active_model_date_key;

ALTER TABLE public.ai_model_pricing DROP CONSTRAINT ai_model_pricing_provenance_paired;
ALTER TABLE public.ai_model_pricing DROP CONSTRAINT ai_model_pricing_cached_input_valid;
ALTER TABLE public.ai_model_pricing DROP COLUMN proposal_line_id;
ALTER TABLE public.ai_model_pricing DROP COLUMN proposal_id;
ALTER TABLE public.ai_model_pricing DROP COLUMN cached_input_cost_per_token;

DROP VIEW public.pilot_cost_savings_summary;

ALTER TABLE public.ai_model_pricing
  ALTER COLUMN input_cost_per_token TYPE numeric(10,8),
  ALTER COLUMN output_cost_per_token TYPE numeric(10,8);

CREATE VIEW public.pilot_cost_savings_summary WITH (security_invoker = true) AS
 WITH execution_costs AS (
         SELECT psrh.execution_id,
            psrh.agent_id,
            sum(psrh.tokens_used) AS total_tokens,
            sum(psrh.estimated_cost_usd) AS actual_cost,
            sum(psrh.tokens_used)::numeric * (( SELECT (ai_model_pricing.input_cost_per_token + ai_model_pricing.output_cost_per_token) / 2::numeric
                   FROM public.ai_model_pricing
                  WHERE ai_model_pricing.provider::text = 'openai'::text AND ai_model_pricing.model_name::text = 'gpt-4o'::text AND ai_model_pricing.retired_date IS NULL
                  ORDER BY ai_model_pricing.effective_date DESC
                 LIMIT 1)) AS tier3_cost,
            psrh.created_at
           FROM public.pilot_step_routing_history psrh
          WHERE psrh.routing_source = 'pilot_per_step'::text
          GROUP BY psrh.execution_id, psrh.agent_id, psrh.created_at
        )
 SELECT execution_id,
    agent_id,
    total_tokens,
    actual_cost,
    tier3_cost,
    tier3_cost - actual_cost AS cost_saved,
        CASE
            WHEN tier3_cost > 0::numeric THEN (tier3_cost - actual_cost) / tier3_cost * 100::numeric
            ELSE 0::numeric
        END AS savings_percentage,
    created_at
   FROM execution_costs
  WHERE tier3_cost > 0::numeric
  ORDER BY created_at DESC;

ALTER VIEW public.pilot_cost_savings_summary OWNER TO postgres;
REVOKE ALL ON TABLE public.pilot_cost_savings_summary FROM PUBLIC;
REVOKE ALL ON TABLE public.pilot_cost_savings_summary FROM anon;
REVOKE ALL ON TABLE public.pilot_cost_savings_summary FROM authenticated;
REVOKE ALL ON TABLE public.pilot_cost_savings_summary FROM service_role;
GRANT SELECT ON public.pilot_cost_savings_summary TO authenticated, service_role;

COMMIT;
