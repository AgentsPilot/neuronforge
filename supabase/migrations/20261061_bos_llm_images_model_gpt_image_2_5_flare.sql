-- 20261061_bos_llm_images_model_gpt_image_2_5_flare.sql
--
-- Moves the Business OS images area row (system_settings_config key
-- bos_llm_area_images) from gpt-image-1 to gpt-image-2.5-flare.
-- OpenAI shuts gpt-image-1 down on 23 Oct 2026 (user decision 2026-10-14,
-- branch fix/gpt-image-1-retirement).
--
-- APPLY BY HAND, ONLY AFTER THE CODE DEPLOY of fix/gpt-image-1-retirement.
-- The old code has no gpt-image-2.5-flare prices in IMAGE_FALLBACK_PRICING, so
-- its image guardrail would reject this row (image_price_missing, logged as an
-- error) and use the old code default, gpt-image-1, instead. Apply it before
-- 23 Oct 2026.
--
-- What it changes: the "model" field of that one row, and updated_at. Nothing
-- else in the row (enabled, provider) and no other row. It only matches a row
-- that still names gpt-image-1, so running it twice, or after someone already
-- moved the row by hand, updates nothing.
--
-- The resolver caches area settings per server instance, so running instances
-- pick the new model up when their cache expires, not at once.
--
-- READ-BACK (run after applying; expect one row, model gpt-image-2.5-flare,
-- enabled true, provider openai, updated_at just now):
--
--   SELECT key,
--          value->>'model'    AS model,
--          value->>'enabled'  AS enabled,
--          value->>'provider' AS provider,
--          updated_at
--   FROM system_settings_config
--   WHERE key = 'bos_llm_area_images';
--
-- ROLLBACK (only if the new model misbehaves and gpt-image-1 is still served):
--
--   UPDATE system_settings_config
--   SET value = jsonb_set(value, '{model}', '"gpt-image-1"'),
--       updated_at = now()
--   WHERE key = 'bos_llm_area_images'
--     AND value->>'model' = 'gpt-image-2.5-flare';

BEGIN;

UPDATE system_settings_config
SET value = jsonb_set(value, '{model}', '"gpt-image-2.5-flare"'),
    updated_at = now()
WHERE key = 'bos_llm_area_images'
  AND value->>'model' = 'gpt-image-1';

COMMIT;
