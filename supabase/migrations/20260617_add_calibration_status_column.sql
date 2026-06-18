-- Post-creation background calibration lifecycle (Phase 2).
-- Tracks where an agent sits in the post-creation calibration gate. Distinct from
-- is_calibrated (clean-pass flag) and calibration_prompt_decision (the user's
-- accept/decline choice): this column drives the dashboard badge/tooltip, the
-- card click-target, and the access gate.
--
-- Values:
--   running  - background calibration in progress (agent locked, "Calibrating…")
--   passed   - calibration passed cleanly (0 issues) -> agent unlocked
--   failed   - calibration finished with issues / errors (agent locked -> sandbox)
--   skipped  - user deferred calibration (agent locked -> sandbox)
--   NULL     - legacy / pre-existing / created while the feature was off.
--              Interpreted AT READ-TIME as deferred (gated) only while the
--              post-creation-calibration feature flag is ON; no backfill.

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS calibration_status TEXT DEFAULT NULL
  CHECK (calibration_status IN ('running', 'passed', 'failed', 'skipped'));

-- Index for dashboard listing / gating lookups (partial: NULL is the common
-- legacy case and doesn't need indexing).
CREATE INDEX IF NOT EXISTS idx_agents_calibration_status
ON agents(user_id, calibration_status)
WHERE calibration_status IS NOT NULL;

COMMENT ON COLUMN agents.calibration_status IS
  'Post-creation calibration gate state: running | passed | failed | skipped | NULL (legacy, read-time deferred). Drives dashboard badge/tooltip, click-target, and access gate.';
