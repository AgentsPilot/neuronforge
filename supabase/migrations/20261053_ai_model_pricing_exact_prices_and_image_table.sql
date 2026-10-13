BEGIN;
SET LOCAL lock_timeout = '5s';

DO $view_guard$
DECLARE
  v_view regclass;
BEGIN
  v_view := to_regclass('public.pilot_cost_savings_summary');
  IF v_view IS NULL OR (SELECT pg_class.relkind FROM pg_class WHERE pg_class.oid = v_view) <> 'v' THEN
    RAISE EXCEPTION 'view pilot_cost_savings_summary is missing or not a plain view  nothing was applied';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_depend AS dependency
    WHERE dependency.refclassid = 'pg_class'::regclass
      AND dependency.refobjid = v_view
      AND dependency.deptype = 'n'
      AND NOT (dependency.classid = 'pg_rewrite'::regclass
               AND dependency.objid IN (SELECT pg_rewrite.oid FROM pg_rewrite WHERE pg_rewrite.ev_class = v_view))
  ) THEN
    RAISE EXCEPTION 'another object depends on view pilot_cost_savings_summary  nothing was applied';
  END IF;
  IF (SELECT array_agg(pg_attribute.attname::text ORDER BY pg_attribute.attnum)
      FROM pg_attribute
      WHERE pg_attribute.attrelid = v_view AND pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped)
     IS DISTINCT FROM ARRAY['execution_id', 'agent_id', 'total_tokens', 'actual_cost', 'tier3_cost',
                            'cost_saved', 'savings_percentage', 'created_at'] THEN
    RAISE EXCEPTION 'view pilot_cost_savings_summary columns differ from the captured definition  nothing was applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE pg_trigger.tgrelid = v_view) THEN
    RAISE EXCEPTION 'view pilot_cost_savings_summary has a trigger  nothing was applied';
  END IF;
  IF (SELECT count(*) FROM pg_rewrite WHERE pg_rewrite.ev_class = v_view) <> 1 THEN
    RAISE EXCEPTION 'view pilot_cost_savings_summary has a rewrite rule beyond its own  nothing was applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_description WHERE pg_description.objoid = v_view) THEN
    RAISE EXCEPTION 'view pilot_cost_savings_summary or one of its columns has a comment  nothing was applied';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns AS cost_column
      WHERE cost_column.table_schema = 'public' AND cost_column.table_name = 'ai_model_pricing'
        AND cost_column.column_name IN ('input_cost_per_token', 'output_cost_per_token')
        AND cost_column.data_type = 'numeric'
        AND cost_column.numeric_precision = 10 AND cost_column.numeric_scale = 8) <> 2 THEN
    RAISE EXCEPTION 'cost columns are not the captured numeric with precision ten and scale eight  nothing was applied';
  END IF;
END
$view_guard$;

DROP VIEW public.pilot_cost_savings_summary;

ALTER TABLE public.ai_model_pricing
  ALTER COLUMN input_cost_per_token TYPE numeric,
  ALTER COLUMN output_cost_per_token TYPE numeric;

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

ALTER TABLE public.ai_model_pricing ADD COLUMN cached_input_cost_per_token numeric;
ALTER TABLE public.ai_model_pricing ADD COLUMN proposal_id uuid;
ALTER TABLE public.ai_model_pricing ADD COLUMN proposal_line_id uuid;
ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_cached_input_valid
  CHECK (cached_input_cost_per_token IS NULL OR (cached_input_cost_per_token >= 0 AND cached_input_cost_per_token <> 'NaN' AND cached_input_cost_per_token <> 'Infinity'));
ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_provenance_paired
  CHECK ((proposal_id IS NULL) = (proposal_line_id IS NULL));

CREATE UNIQUE INDEX ai_model_pricing_active_model_date_key
  ON public.ai_model_pricing (provider, model_name, effective_date) WHERE retired_date IS NULL;
ALTER TABLE public.ai_model_pricing DROP CONSTRAINT ai_model_pricing_provider_model_name_effective_date_key;

CREATE TABLE public.ai_model_image_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model_name text NOT NULL,
  size text NOT NULL,
  quality text NOT NULL,
  cost_per_image numeric NOT NULL,
  effective_date date NOT NULL,
  retired_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  proposal_id uuid,
  proposal_line_id uuid
);
ALTER TABLE public.ai_model_image_pricing ADD CONSTRAINT ai_model_image_pricing_cost_positive
  CHECK (cost_per_image > 0 AND cost_per_image <> 'NaN' AND cost_per_image <> 'Infinity');
ALTER TABLE public.ai_model_image_pricing ADD CONSTRAINT ai_model_image_pricing_provenance_paired
  CHECK ((proposal_id IS NULL) = (proposal_line_id IS NULL));
CREATE UNIQUE INDEX ai_model_image_pricing_active_key
  ON public.ai_model_image_pricing (provider, model_name, size, quality, effective_date) WHERE retired_date IS NULL;
COMMENT ON TABLE public.ai_model_image_pricing IS 'Price per generated image by provider model size and quality  Empty until the first approved price proposal  Written only by the service role  History is kept with retired_date and rows are never deleted';
ALTER TABLE public.ai_model_image_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_model_image_pricing_admin_select ON public.ai_model_image_pricing
  FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()));
REVOKE ALL ON TABLE public.ai_model_image_pricing FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_model_image_pricing FROM anon;
REVOKE ALL ON TABLE public.ai_model_image_pricing FROM authenticated;
REVOKE ALL ON TABLE public.ai_model_image_pricing FROM service_role;
GRANT SELECT ON TABLE public.ai_model_image_pricing TO authenticated;
GRANT SELECT, INSERT, UPDATE (retired_date) ON TABLE public.ai_model_image_pricing TO service_role;

COMMIT;
