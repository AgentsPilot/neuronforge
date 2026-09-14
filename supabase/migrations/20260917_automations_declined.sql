-- Remembering a no.
--
-- ---------------------------------------------------------------------------
-- WHY A BOOLEAN WAS NOT ENOUGH
--
-- `chase_invoices_enabled` and its siblings hold two states, and the advisor
-- needs three:
--
--   approved      the platform may do this
--   declined      the owner was asked and said no
--   not yet asked nobody has put the question
--
-- A single boolean cannot tell the last two apart, so "no thanks" looked
-- identical to "never offered" and the card asked again on the next render —
-- which is not a decision being remembered, it is a decision being ignored.
--
-- WHY A LIST AND NOT A COLUMN PER AUTOMATION
--
-- The registry in `lib/business-os/gaps/automations.ts` is meant to grow by an
-- entry. A declined-column per automation would make every new one a migration,
-- which is exactly the coupling the registry exists to avoid. The approvals
-- stay as columns because the queue drain filters on them and wants an index;
-- nothing filters on declines, they are only ever read for one business at a
-- time.
-- ---------------------------------------------------------------------------

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS automations_declined TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN business_profiles.automations_declined IS
  'Operational automation ids the owner has explicitly said no to. Keeps the advisor from asking again, and is distinct from simply not being approved yet. Approving one removes it from here.';
