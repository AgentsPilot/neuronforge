-- =============================================================================
-- Business OS LLM Layer 2 — the ninth area row: `payments`
--
-- WHAT THIS DOES
--   Adds one `bos_llm_area_payments` row, holding exactly the model, provider
--   and temperature its only call uses TODAY (`payments.refund_decline_draft`,
--   see lib/business-os/llm/modelSettingsPolicy.ts). Applying it changes no
--   behaviour: the resolver already degrades to those same code defaults when
--   no row exists, so the feature works identically before and after. What the
--   row buys is the operator screen — without it the area cannot be switched
--   off or repointed without a deploy.
--
-- WHY A SEPARATE FILE
--   20261003 seeded the eight areas that existed then and has long been
--   applied. An applied migration is never edited, so the ninth area arrives
--   in its own file, in the same shape.
--
-- WHAT THE CALL IS
--   The note a client receives when the owner declines their refund request.
--   Drafted by the model, edited by the owner, sent only when they press send.
--   Temperature 0.6 — warmer than the reporting calls, because 0.3 writes a
--   refusal like a receipt, and well short of invention because every fact in
--   it comes from the prompt.
--
-- SWITCHING IT OFF IS SAFE, AND MEANS SILENCE
--   `payments` is switchable (BOS_LLM_AREA_LOCKS). With `enabled` false the
--   decline button still works, no model is called, nothing is charged, and
--   the client is told nothing — which is exactly what declining did before
--   this feature existed. There is no template standing behind it on purpose:
--   a form letter telling somebody no about their own money is the thing the
--   draft exists to avoid.
--
-- APPLY ORDER
--   P-1 PRE-CHECK — the row must not exist yet:
--         SELECT key, value, updated_at FROM system_settings_config
--          WHERE key = 'bos_llm_area_payments';
--       MUST return 0 rows. If one exists, STOP: `ON CONFLICT DO NOTHING`
--       below would keep it, and somebody set it deliberately.
--   P-2 DRY RUN — only PostgreSQL can parse this; no test can:
--         BEGIN;  <the whole migration>  ROLLBACK;
--       Expect 1 inserted row and no error.
--   P-3 APPLY, then CHECK:
--         SELECT key, value FROM system_settings_config
--          WHERE key = 'bos_llm_area_payments';
--       Expect enabled=true, provider=openai, model=gpt-4o-mini,
--       temperature=0.6.
--
-- ROLLBACK
--   DELETE FROM system_settings_config WHERE key = 'bos_llm_area_payments';
--   The resolver returns to the code defaults, which are the same values.
-- =============================================================================

INSERT INTO system_settings_config (key, value, category, description)
SELECT
  row_values.key,
  row_values.value,
  'business_os_llm',
  row_values.description
FROM (
  VALUES
    (
      'bos_llm_area_payments',
      jsonb_build_object(
        'enabled', true,
        'provider', 'openai',
        'model', 'gpt-4o-mini',
        'temperature', 0.6
      ),
      'Business OS LLM model settings for the payments area (Layer 2). Today: the note a client gets when a refund request is declined. Off means the client is told nothing.'
    )
) AS row_values(key, value, description)
ON CONFLICT (key) DO NOTHING;
