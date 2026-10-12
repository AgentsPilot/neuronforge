BEGIN;
SET LOCAL lock_timeout = '5s';

DO $baseline$
BEGIN
  IF to_regclass('public.ai_model_pricing') IS NULL THEN
    CREATE TABLE public.ai_model_pricing (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      provider character varying(50) NOT NULL,
      model_name character varying(100) NOT NULL,
      input_cost_per_token numeric(10,8) NOT NULL,
      output_cost_per_token numeric(10,8) NOT NULL,
      effective_date date NOT NULL,
      retired_date date,
      created_at timestamp with time zone DEFAULT now(),
      CONSTRAINT ai_model_pricing_pkey PRIMARY KEY (id),
      CONSTRAINT ai_model_pricing_provider_model_name_effective_date_key UNIQUE (provider, model_name, effective_date)
    );
    COMMENT ON TABLE public.ai_model_pricing IS 'Per-token model pricing; every credit charge is computed from it. Written only by the service role through /api/admin/system-config/pricing (admin-gated). RLS: admin_users-backed read + write for authenticated sessions; anon has no privileges beyond SELECT, which RLS then denies.';
    ALTER TABLE public.ai_model_pricing ENABLE ROW LEVEL SECURITY;
    CREATE POLICY ai_model_pricing_admin_select ON public.ai_model_pricing
      FOR SELECT TO authenticated
      USING (public.is_platform_admin());
    CREATE POLICY ai_model_pricing_admin_write ON public.ai_model_pricing
      FOR ALL TO authenticated
      USING (public.is_platform_admin())
      WITH CHECK (public.is_platform_admin());
    REVOKE ALL ON TABLE public.ai_model_pricing FROM PUBLIC;
    REVOKE ALL ON TABLE public.ai_model_pricing FROM anon;
    REVOKE ALL ON TABLE public.ai_model_pricing FROM authenticated;
    REVOKE ALL ON TABLE public.ai_model_pricing FROM service_role;
    GRANT SELECT ON TABLE public.ai_model_pricing TO anon;
    GRANT SELECT ON TABLE public.ai_model_pricing TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ai_model_pricing TO service_role;
  END IF;
END
$baseline$;

COMMIT;
