-- Let an insight stop being true.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM
--
-- An insight is written once and never closes. The only status the repository
-- ever writes is 'new', the only way out is a person pressing dismiss, and the
-- detection cron has no resolution step at all — it finds things and records
-- them, and nothing ever asks whether they are still so.
--
-- On the account this was written from, the advisor showed:
--
--   "Pending $500 Invoice Needs Attention"
--
-- The invoice was raised at 03:10 and the insight written at 03:30, when it was
-- genuinely unpaid. It was paid at 03:56. The card stayed, because nothing
-- re-checked. The detector was right; the RECORD went stale twenty-six minutes
-- later and had no way to say so.
--
-- The same gap keeps a deleted detector's insights on the dashboard: the code
-- goes, the rows remain, and they go on offering an automation for something
-- that no longer exists.
--
-- WHY A NEW STATUS RATHER THAN 'dismissed'
--
-- 'dismissed' means a person looked at this and chose to close it. Reusing it
-- for "the world moved on" would make the two indistinguishable, and the
-- question worth answering — how much of what we surface sorts itself out
-- without the owner doing anything — would become unanswerable. That number is
-- the honest measure of whether an advisor is advising or just describing.
-- ---------------------------------------------------------------------------

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. The status.
--
--    CHECK constraints cannot be extended in place, so the old one is dropped
--    and rewritten with the full set. Existing rows are unaffected: every value
--    they hold is still permitted.
-- ----------------------------------------------------------------------------
ALTER TABLE insights DROP CONSTRAINT IF EXISTS insights_status_check;

ALTER TABLE insights
  ADD CONSTRAINT insights_status_check
  CHECK (status IN ('new', 'viewed', 'snoozed', 'dismissed', 'acted', 'automated', 'resolved'));

-- ----------------------------------------------------------------------------
-- 2. When it stopped being true.
--
--    Separate from `updated_at`, which moves for any write. The card shows a
--    resolved insight briefly and then stops, and "briefly" has to be measured
--    from the moment it resolved rather than from the last time anything on the
--    row changed.
-- ----------------------------------------------------------------------------
ALTER TABLE insights
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

COMMENT ON COLUMN insights.resolved_at IS
  'When the condition stopped holding, set by the detection sweep rather than by a person. NULL for every other status.';

-- The sweep asks for open insights per user on every run, and the dashboard
-- asks for recently-resolved ones on every load.
CREATE INDEX IF NOT EXISTS idx_insights_open_by_user
  ON insights (user_id, detector_id)
  WHERE status IN ('new', 'viewed', 'snoozed');

CREATE INDEX IF NOT EXISTS idx_insights_recently_resolved
  ON insights (user_id, resolved_at DESC)
  WHERE status = 'resolved';

COMMIT;
