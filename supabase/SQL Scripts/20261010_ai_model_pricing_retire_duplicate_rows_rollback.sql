BEGIN;
SET LOCAL lock_timeout = '5s';

DO $unretire$
DECLARE
  v_before text;
  v_after text;
  v_restored integer;
BEGIN
  IF (SELECT count(*) FROM public.ai_model_pricing AS pricing
      JOIN (VALUES
        ('909b8936-1c6b-4bc5-887e-7b387f615b4c'::uuid, 'anthropic', 'claude-3-5-sonnet-20241022'),
        ('48e013db-0320-4b54-bd45-261a1f181328'::uuid, 'anthropic', 'claude-3-5-sonnet-20241022'),
        ('1253bb1d-8f50-4d09-9526-858fa77c395e'::uuid, 'anthropic', 'claude-3-5-sonnet-20241022'),
        ('f4d788e3-d028-470d-88e0-bb4b8fc968fb'::uuid, 'anthropic', 'claude-3-haiku-20240307'),
        ('9326b11a-601d-4c5c-a553-409604f98e8a'::uuid, 'anthropic', 'claude-3-haiku-20240307'),
        ('2c06eb3a-4bab-435c-b838-ac3f30897ef7'::uuid, 'anthropic', 'claude-3-haiku-20240307'),
        ('296b4e13-3129-4a69-982c-db42ce345c3d'::uuid, 'openai', 'gpt-4o-mini'),
        ('e4553790-6bcf-4322-977e-e701e9333a17'::uuid, 'openai', 'gpt-4o-mini'),
        ('f56e9b2e-4896-48c2-94de-1b1a44cec53d'::uuid, 'openai', 'gpt-4o-mini'),
        ('9e223fff-fc18-4c2c-b335-72ed7609baa7'::uuid, 'anthropic', 'claude-3-haiku'),
        ('ad3717eb-9024-419e-857c-d2fa3e182588'::uuid, 'anthropic', 'claude-3-opus'),
        ('1a69f840-d5df-4185-b85c-c11fe05bbc6a'::uuid, 'anthropic', 'claude-3-sonnet')
      ) AS approved (row_id, provider_name, model_label)
        ON pricing.id = approved.row_id
       AND pricing.provider = approved.provider_name
       AND pricing.model_name = approved.model_label
      WHERE pricing.retired_date IS NOT NULL) <> 12
     OR (SELECT count(DISTINCT pricing.retired_date) FROM public.ai_model_pricing AS pricing
         WHERE pricing.id IN (SELECT approved_id.row_id FROM (VALUES
        ('909b8936-1c6b-4bc5-887e-7b387f615b4c'::uuid, 'anthropic', 'claude-3-5-sonnet-20241022'),
        ('48e013db-0320-4b54-bd45-261a1f181328'::uuid, 'anthropic', 'claude-3-5-sonnet-20241022'),
        ('1253bb1d-8f50-4d09-9526-858fa77c395e'::uuid, 'anthropic', 'claude-3-5-sonnet-20241022'),
        ('f4d788e3-d028-470d-88e0-bb4b8fc968fb'::uuid, 'anthropic', 'claude-3-haiku-20240307'),
        ('9326b11a-601d-4c5c-a553-409604f98e8a'::uuid, 'anthropic', 'claude-3-haiku-20240307'),
        ('2c06eb3a-4bab-435c-b838-ac3f30897ef7'::uuid, 'anthropic', 'claude-3-haiku-20240307'),
        ('296b4e13-3129-4a69-982c-db42ce345c3d'::uuid, 'openai', 'gpt-4o-mini'),
        ('e4553790-6bcf-4322-977e-e701e9333a17'::uuid, 'openai', 'gpt-4o-mini'),
        ('f56e9b2e-4896-48c2-94de-1b1a44cec53d'::uuid, 'openai', 'gpt-4o-mini'),
        ('9e223fff-fc18-4c2c-b335-72ed7609baa7'::uuid, 'anthropic', 'claude-3-haiku'),
        ('ad3717eb-9024-419e-857c-d2fa3e182588'::uuid, 'anthropic', 'claude-3-opus'),
        ('1a69f840-d5df-4185-b85c-c11fe05bbc6a'::uuid, 'anthropic', 'claude-3-sonnet')
         ) AS approved_id (row_id, provider_name, model_label))) <> 1 THEN
    RAISE EXCEPTION 'the twelve rows are not all retired by one run  nothing was restored';
  END IF;

  v_before := (SELECT md5(string_agg(concat_ws(' ', ranked.provider, ranked.model_name,
                                        round(ranked.input_cost_per_token::numeric, 18)::text,
                                        round(ranked.output_cost_per_token::numeric, 18)::text),
                              ' ' ORDER BY ranked.provider, ranked.model_name))
     FROM (
       SELECT pricing.provider, pricing.model_name, pricing.input_cost_per_token, pricing.output_cost_per_token,
              row_number() OVER (PARTITION BY pricing.provider, pricing.model_name
                                 ORDER BY pricing.effective_date DESC, pricing.created_at DESC) AS position
       FROM public.ai_model_pricing AS pricing
       WHERE pricing.retired_date IS NULL
         AND pricing.effective_date <= (now() AT TIME ZONE 'utc')::date
         AND pricing.model_name NOT IN ('claude-3-haiku', 'claude-3-opus', 'claude-3-sonnet')
     ) AS ranked
     WHERE ranked.position = 1);

  UPDATE public.ai_model_pricing AS pricing
  SET retired_date = NULL
  FROM (VALUES
    ('909b8936-1c6b-4bc5-887e-7b387f615b4c'::uuid, 'anthropic', 'claude-3-5-sonnet-20241022'),
    ('48e013db-0320-4b54-bd45-261a1f181328'::uuid, 'anthropic', 'claude-3-5-sonnet-20241022'),
    ('1253bb1d-8f50-4d09-9526-858fa77c395e'::uuid, 'anthropic', 'claude-3-5-sonnet-20241022'),
    ('f4d788e3-d028-470d-88e0-bb4b8fc968fb'::uuid, 'anthropic', 'claude-3-haiku-20240307'),
    ('9326b11a-601d-4c5c-a553-409604f98e8a'::uuid, 'anthropic', 'claude-3-haiku-20240307'),
    ('2c06eb3a-4bab-435c-b838-ac3f30897ef7'::uuid, 'anthropic', 'claude-3-haiku-20240307'),
    ('296b4e13-3129-4a69-982c-db42ce345c3d'::uuid, 'openai', 'gpt-4o-mini'),
    ('e4553790-6bcf-4322-977e-e701e9333a17'::uuid, 'openai', 'gpt-4o-mini'),
    ('f56e9b2e-4896-48c2-94de-1b1a44cec53d'::uuid, 'openai', 'gpt-4o-mini'),
    ('9e223fff-fc18-4c2c-b335-72ed7609baa7'::uuid, 'anthropic', 'claude-3-haiku'),
    ('ad3717eb-9024-419e-857c-d2fa3e182588'::uuid, 'anthropic', 'claude-3-opus'),
    ('1a69f840-d5df-4185-b85c-c11fe05bbc6a'::uuid, 'anthropic', 'claude-3-sonnet')
  ) AS approved (row_id, provider_name, model_label)
  WHERE pricing.id = approved.row_id
    AND pricing.provider = approved.provider_name
    AND pricing.model_name = approved.model_label
    AND pricing.retired_date IS NOT NULL;
  GET DIAGNOSTICS v_restored = ROW_COUNT;

  IF v_restored <> 12 THEN
    RAISE EXCEPTION 'restored row count is not twelve  nothing was restored';
  END IF;

  v_after := (SELECT md5(string_agg(concat_ws(' ', ranked.provider, ranked.model_name,
                                        round(ranked.input_cost_per_token::numeric, 18)::text,
                                        round(ranked.output_cost_per_token::numeric, 18)::text),
                              ' ' ORDER BY ranked.provider, ranked.model_name))
     FROM (
       SELECT pricing.provider, pricing.model_name, pricing.input_cost_per_token, pricing.output_cost_per_token,
              row_number() OVER (PARTITION BY pricing.provider, pricing.model_name
                                 ORDER BY pricing.effective_date DESC, pricing.created_at DESC) AS position
       FROM public.ai_model_pricing AS pricing
       WHERE pricing.retired_date IS NULL
         AND pricing.effective_date <= (now() AT TIME ZONE 'utc')::date
         AND pricing.model_name NOT IN ('claude-3-haiku', 'claude-3-opus', 'claude-3-sonnet')
     ) AS ranked
     WHERE ranked.position = 1);

  IF v_before IS NULL OR v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'a charged price would change  nothing was restored';
  END IF;
END
$unretire$;

COMMIT;

SELECT (SELECT md5(string_agg(concat_ws(' ', ranked.provider, ranked.model_name,
                                        round(ranked.input_cost_per_token::numeric, 18)::text,
                                        round(ranked.output_cost_per_token::numeric, 18)::text),
                              ' ' ORDER BY ranked.provider, ranked.model_name))
     FROM (
       SELECT pricing.provider, pricing.model_name, pricing.input_cost_per_token, pricing.output_cost_per_token,
              row_number() OVER (PARTITION BY pricing.provider, pricing.model_name
                                 ORDER BY pricing.effective_date DESC, pricing.created_at DESC) AS position
       FROM public.ai_model_pricing AS pricing
       WHERE pricing.retired_date IS NULL
         AND pricing.effective_date <= (now() AT TIME ZONE 'utc')::date
         AND pricing.model_name NOT IN ('claude-3-haiku', 'claude-3-opus', 'claude-3-sonnet')
     ) AS ranked
     WHERE ranked.position = 1) AS price_fingerprint,
       (SELECT count(*) FROM public.ai_model_pricing AS pricing WHERE pricing.retired_date IS NULL) AS active_rows,
       (SELECT count(*) FROM public.ai_model_pricing AS pricing WHERE pricing.retired_date IS NOT NULL) AS retired_rows;
