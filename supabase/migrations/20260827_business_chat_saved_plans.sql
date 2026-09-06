-- Business OS chat — saved plans
--
-- WHY
--
-- A saved plan is the first half of a standing automation, without the clock.
-- The user does a piece of work in the chat ("email everyone who never filled in
-- the intake form"), and saves it so they can do it again next month without
-- re-describing it.
--
-- It exists on its own because it is worth having on its own, and because it
-- proves the whole chain a scheduled automation needs — store a plan, re-resolve
-- it against current data, re-validate it against the current catalog, preview,
-- approve, execute, stay idempotent — with no cron, no proposals and no races to
-- debug at the same time. The clock is added on top once this is solid.
--
-- WHAT IS STORED, AND WHAT IS DELIBERATELY NOT
--
-- `steps` holds the plan as the planner emitted it: UNRESOLVED. It says "contacts
-- who never completed intake", not "these 3 contacts". That is the entire point —
-- running it again next month must find next month's people.
--
-- Frozen rows are therefore NOT stored here. They are resolved per run, shown to
-- the user, and approved. Freezing at save time would mean re-running the plan in
-- March emails the people who matched in January.
--
-- `catalog_version` records the shape the plan was authored against. It is a
-- WEAK signal on purpose: the version hash covers risk, confirmation and bulk
-- flags but NOT maxFanout or requiredFields, so a match does not prove the plan
-- is still safe. Every run re-validates against the live catalog regardless; this
-- column exists to explain to the user WHY a plan stopped working, not to decide
-- whether it may run.

CREATE TABLE IF NOT EXISTS business_chat_saved_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What the user called it. Defaults to their own words, which are almost
  -- always a better name than anything generated.
  name TEXT NOT NULL,
  -- The original request, kept verbatim for display and audit. Also what a
  -- future scheduled version would re-plan from if the catalog ever moved too
  -- far for the stored steps to survive.
  utterance TEXT NOT NULL,

  -- The unresolved plan steps, exactly as emitted and validated.
  steps JSONB NOT NULL,
  -- The sentence the planner wrote for the answer, so a re-run reads like the
  -- original turn rather than a bare row count.
  answer_text TEXT,

  catalog_version TEXT,

  -- Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Set when a re-validation fails, so the user is told the plan is stale
  -- instead of it silently doing nothing.
  disabled_reason TEXT,

  -- Stats
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_run_summary TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bcsp_user
  ON business_chat_saved_plans (user_id, is_active, created_at DESC);

-- One saved plan per name per user: saving the same thing twice is a rename, not
-- a second row. Enforced in the database because the application would race with
-- itself on a double-tap.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bcsp_user_name
  ON business_chat_saved_plans (user_id, lower(name));

ALTER TABLE business_chat_saved_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own saved plans" ON business_chat_saved_plans;
CREATE POLICY "own saved plans"
  ON business_chat_saved_plans FOR SELECT
  USING (user_id = auth.uid());

COMMENT ON TABLE business_chat_saved_plans IS
  'A piece of chat work the user can run again. Stores the UNRESOLVED plan: re-running finds current data, previews it, and asks before writing.';
COMMENT ON COLUMN business_chat_saved_plans.steps IS
  'Unresolved plan steps. Never store resolved rows here — a re-run must find todays people, not the ones who matched when it was saved.';
COMMENT ON COLUMN business_chat_saved_plans.catalog_version IS
  'Catalog shape at authoring time. Explains why a plan went stale; does NOT authorise a run. Every run re-validates against the live catalog.';
