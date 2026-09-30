-- Stopping an accepted quote part-way through, and recording why.
--
-- WHY
--
-- A client accepts a three-phase quote, pays phase one, then stops the work.
-- Until now there was no way to say that anywhere:
--
--   * `withdraw` is conditional on draft | sent | viewed and REFUSES an accepted
--     quote, deliberately — "money has been created against it".
--   * `cancelBooking` withdraws only OPEN_PROPOSAL_STATUSES, the same three.
--   * `markSuperseded` takes sent | viewed | declined.
--
-- So an accepted quote read `accepted` forever, whether the job finished or
-- collapsed after phase one. The only way to tell the two apart was to read the
-- stage rows. That is a reporting hole: "how many jobs did we lose part-way, and
-- why" was unanswerable from the quote table.
--
-- WHY A NEW STATUS AND NOT `withdrawn`
--
-- `withdrawn` means the offer was taken off the table BEFORE anyone agreed to
-- it. Reusing it for a job that was agreed, invoiced and part-paid would make
-- the two indistinguishable in exactly the analytics this exists to feed — and
-- would quietly change what `withdrawn` has meant in every row already stored.
--
-- `stopped` is terminal, like `withdrawn` and `superseded`. It says: this was
-- agreed, work began, and it ended early.
--
-- WHAT IS NOT CHANGED
--
-- Acceptance stays a historical fact. `decided_at`, `accepted_snapshot`, the
-- frozen tax fields and every invoice raised against it are untouched: this
-- records how the job ENDED, never that it was not agreed.

ALTER TABLE proposals
  DROP CONSTRAINT IF EXISTS proposals_status_check;

ALTER TABLE proposals
  ADD CONSTRAINT proposals_status_check
  CHECK (status IN (
    'draft','sent','viewed','accepted','declined','expired','withdrawn','superseded',
    -- Agreed, started, ended early. See the note above.
    'stopped'
  ));

-- Why the job ended, from a fixed list so it can be counted.
--
-- Deliberately parallel to `decline_reason` / `decline_note`, which the public
-- quote page already collects the same way: a code for the analytics and an
-- optional sentence for the humans. NOT a free-text-only field — a column of
-- prose cannot be grouped, and "collect this for future analytics" is the whole
-- point of the request behind this migration.
--
-- The list is enforced in the API's Zod schema and in `STOP_REASONS`, not by a
-- CHECK here: reasons are product vocabulary and will be added to, and a
-- constraint would turn every future addition into a migration. NULL is allowed
-- because a reason can be genuinely unknown, and forcing a guess would poison
-- the data this is for.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS stop_reason TEXT;

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS stop_note TEXT;

-- When it stopped, which is NOT `updated_at`: any later edit moves that.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;

COMMENT ON COLUMN proposals.stop_reason IS
  'Why an accepted job ended early, from STOP_REASONS. Null when unknown. Distinct from decline_reason, which is why a quote was never agreed.';

COMMENT ON COLUMN proposals.stop_note IS
  'The owner''s own sentence about why the job stopped. Optional, and never a substitute for stop_reason.';

COMMENT ON COLUMN proposals.stopped_at IS
  'When the remaining stages were called off. Not updated_at, which any later edit moves.';

-- The analytics query this exists to serve: stopped jobs by reason.
-- Partial, because the overwhelming majority of proposals are not stopped.
CREATE INDEX IF NOT EXISTS idx_proposals_stopped_reason
  ON proposals (user_id, stop_reason, stopped_at)
  WHERE status = 'stopped';
