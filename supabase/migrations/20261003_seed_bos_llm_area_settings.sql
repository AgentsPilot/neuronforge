-- =============================================================================
-- Business OS LLM Layer 2 — seed the eight area settings rows (FR-16, DEC-6, RC-4)
--
-- WHAT THIS DOES
--   Creates one `bos_llm_area_<area>` row per Business OS area, holding exactly
--   the model, provider and temperature each call uses TODAY. Where a value is
--   already stored in one of the six single-purpose keys (F-3), the STORED value
--   is copied, not the code default — otherwise applying this would quietly
--   replace a production override nobody remembers setting.
--
--   Nothing reads these rows yet. Step 1 ships the resolver but wires no call
--   site; the call sites move in Steps 2 and 3. Applying this file therefore
--   changes no behaviour at all.
--
-- APPLY ORDER (workplan §9 — do not skip a step)
--   1.  Step 0 deployed (the admin routes are gated; anonymous writes stopped).
--   2.  Step 1 merged and deployed (inert).
--   P-1 PRE-CHECK A — no area row exists yet:
--         SELECT key, updated_at FROM system_settings_config
--         WHERE key LIKE 'bos\_llm\_area\_%';
--       MUST return 0 rows. A row here could have been planted through the
--       pre-Step-0 open routes, and `ON CONFLICT DO NOTHING` below would KEEP
--       it. If any row exists: STOP and escalate.
--   P-2 PRE-CHECK B — record the stored legacy values (paste into §10.2):
--         SELECT key, value, jsonb_typeof(value), updated_at
--         FROM system_settings_config
--         WHERE key IN ('bizchat_planner_model','bizchat_analysis_model',
--                       'bizchat_analysis_enabled','lead_reply_recommender_model',
--                       'lead_reply_recommender_enabled','image_generation_model');
--   P-3 PRE-CHECK C — canonical + guardrails:
--         npm run bos:llm-settings -- verify-stored
--       (plain `npx tsx scripts/…` cannot work — it loads no env; see the script header)
--       Any flag or rejection: STOP. The unwrap rules below are only safe for
--       canonical values. Today's readers treat `"no"`, `"0"` or `0` as FALSE,
--       while the rules below map them to NULL → the code default → ON. That
--       would switch a feature that is off today back on.
--   P-3b DRY RUN (D-Q7) — no test can parse this file; only PostgreSQL can:
--         BEGIN;  <the whole migration>  ROLLBACK;
--       Expect 8 inserted rows and no error. Any error -> STOP (nothing is
--       written: the transaction is rolled back).
--   P-4 Apply this file.
--   P-5 POST-CHECK — eight rows, matching §10:
--         SELECT key, value FROM system_settings_config
--         WHERE key LIKE 'bos\_llm\_area\_%' ORDER BY key;
--         npm run bos:llm-settings -- get <area>   (for all eight)
--   P-5b POST-SEED PARITY CHECK (RC-W1b):
--         npm run bos:llm-settings -- verify-equivalence
--       Exit 0 → continue. Any difference → run the ROLLBACK below AT ONCE and
--       escalate. It is safe while no deployed code reads these rows.
--
--   P-5c RE-RUNNABILITY, PROVED: record
--         SELECT key, md5(value::text) FROM system_settings_config
--          WHERE key LIKE 'bos\_llm\_area\_%' ORDER BY key;
--       apply this file a SECOND time, and re-run it: all eight fingerprints
--       must be byte-identical and updated_at must not move.
--
-- ROLLBACK (only while no code that reads the rows is deployed)
--   DELETE FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%';
--   -- the superseded markers are cosmetic; to undo them as well:
--   UPDATE system_settings_config
--      SET description = NULLIF(
--            replace(description, ' — superseded by bos_llm_area_* (Layer 2)', ''), '')
--    WHERE description LIKE '%superseded by bos_llm_area_%';
--   -- NULLIF, not a bare replace (D-Q8): a row whose description was NULL is
--   -- marked as '' || suffix, so stripping the suffix would leave an empty
--   -- string rather than the NULL it started with.
--
-- SAFETY
--   * `ON CONFLICT (key) DO NOTHING` — never overwrites an existing row.
--   * Re-runnable: applying it twice changes nothing.
--   * The old keys are MARKED superseded, never deleted, so a rollback is a
--     code revert only (DEC-6).
-- =============================================================================

WITH legacy AS (
  SELECT
    key,
    -- A stored string may be bare ('gpt-4o-mini') or JSON-encoded ('"gpt-4o-mini"').
    -- Anything that is not a JSON string becomes NULL → the code default.
    CASE
      WHEN jsonb_typeof(value) = 'string' THEN
        NULLIF(btrim(btrim(value #>> '{}'), '"'), '')
      ELSE NULL
    END AS text_value,
    -- A stored boolean may be a JSON boolean or the strings 'true'/'false'
    -- (any case). Anything else becomes NULL → the code default. P-3 refuses
    -- to let a non-canonical value reach this point.
    CASE
      WHEN jsonb_typeof(value) = 'boolean' THEN (value #>> '{}')::boolean
      WHEN jsonb_typeof(value) = 'string' AND lower(btrim(value #>> '{}')) IN ('true', 'false')
        THEN lower(btrim(value #>> '{}'))::boolean
      ELSE NULL
    END AS bool_value
  FROM system_settings_config
  WHERE key IN (
    'bizchat_planner_model',
    'bizchat_analysis_model',
    'bizchat_analysis_enabled',
    'lead_reply_recommender_model',
    'lead_reply_recommender_enabled',
    'image_generation_model'
  )
),
stored AS (
  SELECT
    COALESCE((SELECT text_value FROM legacy WHERE key = 'bizchat_planner_model'),          'gpt-4o-mini') AS planner_model,
    COALESCE((SELECT text_value FROM legacy WHERE key = 'bizchat_analysis_model'),         'gpt-4o-mini') AS analysis_model,
    COALESCE((SELECT bool_value FROM legacy WHERE key = 'bizchat_analysis_enabled'),       true)          AS analysis_enabled,
    COALESCE((SELECT text_value FROM legacy WHERE key = 'lead_reply_recommender_model'),   'gpt-4o-mini') AS leads_model,
    COALESCE((SELECT bool_value FROM legacy WHERE key = 'lead_reply_recommender_enabled'), true)          AS leads_enabled,
    COALESCE((SELECT text_value FROM legacy WHERE key = 'image_generation_model'),         'gpt-image-1') AS image_model
)
INSERT INTO system_settings_config (key, value, category, description)
SELECT row_values.key, row_values.value, 'business_os_llm', row_values.description
FROM stored,
LATERAL (
  VALUES
    (
      'bos_llm_area_chat',
      jsonb_build_object(
        'enabled', true,
        'provider', 'openai',
        'model', 'gpt-4o-mini',
        'temperature', 0,
        'calls', jsonb_build_object(
          -- The planner's temperature is locked at 0 in code (DEC-5) and is
          -- deliberately NOT written here.
          'planner',  jsonb_build_object('model', stored.planner_model),
          'analysis', jsonb_build_object('model', stored.analysis_model, 'enabled', stored.analysis_enabled)
        )
      ),
      'Business OS LLM model settings for the chat area (Layer 2). Embeddings are excluded (helpbot_embedding_model).'
    ),
    (
      'bos_llm_area_insights',
      jsonb_build_object(
        'enabled', true,
        'provider', 'openai',
        'model', 'gpt-4o-mini',
        'temperature', 0.3,
        'calls', jsonb_build_object(
          'correlated_insight', jsonb_build_object('temperature', 0.4),
          'health_summary',     jsonb_build_object('temperature', 0.5)
        )
      ),
      'Business OS LLM model settings for the insights area (Layer 2).'
    ),
    (
      'bos_llm_area_briefing',
      jsonb_build_object(
        'enabled', true,
        'provider', 'openai',
        'model', 'gpt-4o-mini',
        'temperature', 0.3
      ),
      'Business OS LLM model settings for the briefing area (Layer 2).'
    ),
    (
      'bos_llm_area_website',
      jsonb_build_object(
        'enabled', true,
        'provider', 'openai',
        'model', 'gpt-4o-mini',
        'temperature', 0.7,
        'calls', jsonb_build_object(
          'full_site',           jsonb_build_object('model', 'gpt-4o'),
          'landing_page',        jsonb_build_object('model', 'gpt-4o'),
          'testimonial_enhance', jsonb_build_object('temperature', 0.5)
        )
      ),
      'Business OS LLM model settings for the website area (Layer 2).'
    ),
    (
      'bos_llm_area_intake',
      jsonb_build_object(
        'enabled', true,
        'provider', 'openai',
        'model', 'gpt-4o',
        'temperature', 0.3,
        'calls', jsonb_build_object(
          'question_inference', jsonb_build_object('model', 'gpt-4o-mini', 'temperature', 0.2)
        )
      ),
      'Business OS LLM model settings for the intake area (Layer 2).'
    ),
    (
      'bos_llm_area_leads',
      jsonb_build_object(
        'enabled', stored.leads_enabled,
        'provider', 'openai',
        'model', stored.leads_model,
        'temperature', 0.2
      ),
      'Business OS LLM model settings for the leads area (Layer 2).'
    ),
    (
      'bos_llm_area_onboarding',
      -- `temperature: null` means SEND NO TEMPERATURE. All four extractors send
      -- none today, so the provider default applies (F-7). A number here would
      -- change behaviour. Onboarding can never be switched off (DEC-5), so a
      -- later `enabled: false` in this row would be ignored with a warning.
      jsonb_build_object(
        'enabled', true,
        'provider', 'openai',
        'model', 'gpt-4o',
        'temperature', NULL
      ),
      'Business OS LLM model settings for the onboarding area (Layer 2). Cannot be switched off.'
    ),
    (
      'bos_llm_area_images',
      -- No temperature key: image generation does not take one.
      jsonb_build_object(
        'enabled', true,
        'provider', 'openai',
        'model', stored.image_model
      ),
      'Business OS LLM model settings for the images area (Layer 2). Sizes, quality and prices stay in their own keys.'
    )
) AS row_values(key, value, description)
ON CONFLICT (key) DO NOTHING;

-- Mark the superseded single-purpose keys. They keep working until Steps 2 and
-- 3 stop reading them, and are deleted in a later clean-up (DEC-6). The guard
-- makes this re-runnable.
UPDATE system_settings_config
   -- COALESCE to '' rather than to the key (S1-12): the documented rollback
   -- only strips the suffix, so a row that had no description must end up
   -- with no description again, not with its own key as one.
   SET description = COALESCE(description, '') || ' — superseded by bos_llm_area_* (Layer 2)'
 WHERE key IN (
   'bizchat_planner_model',
   'bizchat_analysis_model',
   'bizchat_analysis_enabled',
   'lead_reply_recommender_model',
   'lead_reply_recommender_enabled',
   'image_generation_model'
 )
   AND COALESCE(description, '') NOT LIKE '%superseded%';
