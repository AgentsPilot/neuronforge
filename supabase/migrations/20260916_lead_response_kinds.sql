-- Chases for things that are not the lead.
--
-- ---------------------------------------------------------------------------
-- WHY THE NATURAL KEY HAS TO CHANGE
--
-- `lead_responses` was built for one conversation: invite this person, then
-- chase them once. `UNIQUE (contact_id, kind)` was exactly right for that —
-- one invitation and one reminder per person, enforced by the database.
--
-- An invoice chase is not about a person, it is about an INVOICE, and one
-- client can easily have two outstanding. Under the old key the second invoice
-- would silently never be chased, because a row already existed for that
-- contact and that kind. The same is true of two upcoming appointments with
-- unreturned intake forms.
--
-- So the key becomes (kind, contact_id, entity_id), and `entity_id` is NOT NULL
-- with the CALLER supplying the contact for kinds that are one-per-person.
--
-- Filled in by the writer rather than left nullable, deliberately. A NULL in a
-- plain UNIQUE is distinct from every other NULL, which would quietly allow the
-- duplicate invitations this exists to prevent; and an expression index over
-- COALESCE cannot be named as an ON CONFLICT target, so every upsert against it
-- fails outright. Making the column carry a real value keeps the constraint
-- ordinary and the conflict target nameable.
-- ---------------------------------------------------------------------------

ALTER TABLE lead_responses
  ADD COLUMN IF NOT EXISTS entity_id UUID;

-- Anything already queued is a lead kind, where the contact IS the entity.
UPDATE lead_responses SET entity_id = contact_id WHERE entity_id IS NULL;

ALTER TABLE lead_responses
  ALTER COLUMN entity_id SET NOT NULL;

COMMENT ON COLUMN lead_responses.entity_id IS
  'The invoice or booking this is about. Equal to contact_id for kinds that are one-per-person, so the unique key below stays a plain column tuple.';

-- Kinds are no longer only about the lead.
ALTER TABLE lead_responses
  DROP CONSTRAINT IF EXISTS lead_responses_kind_check;

ALTER TABLE lead_responses
  ADD CONSTRAINT lead_responses_kind_check
  CHECK (kind IN ('invite', 'chase', 'invoice_chase', 'intake_chase'));

-- Widen the key to include the thing being chased.
ALTER TABLE lead_responses
  DROP CONSTRAINT IF EXISTS lead_responses_contact_id_kind_key;

ALTER TABLE lead_responses
  ADD CONSTRAINT lead_responses_one_per_thing
  UNIQUE (kind, contact_id, entity_id);
