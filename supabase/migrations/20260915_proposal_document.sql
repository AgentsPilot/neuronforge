-- The proposal document a client reads before deciding.
--
-- A quote in an email body is a number and a paragraph. A five-figure job is
-- usually agreed against a document — scope, exclusions, terms — and that
-- document is what the client forwards to a partner and holds the business to.
--
-- Stored as an ordinary `contact_documents` row so it appears in the client's
-- Files tab like everything else, and referenced here so each VERSION of a
-- quote keeps the document it was sent with. A revision that changes the scope
-- carries a different file, and the old one stays attached to the old version:
-- that is the record of what was actually offered when.
--
-- ON DELETE SET NULL, never CASCADE: deleting a file must not delete the quote
-- that was agreed on it.

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS document_id UUID
  REFERENCES contact_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proposals_document
  ON proposals (document_id)
  WHERE document_id IS NOT NULL;

COMMENT ON COLUMN proposals.document_id IS
  'Optional proposal document, attached to the email and shown to the client before they can accept.';
