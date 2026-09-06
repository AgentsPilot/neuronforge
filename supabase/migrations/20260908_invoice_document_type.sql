-- What the business calls the document its clients receive.
--
-- WHY
--
-- Every document this platform issues is headed "INVOICE" / "חשבונית", which is
-- the wrong word for most of the businesses on it: an invoice demands payment,
-- and what they send is confirmation that payment was already taken. In a VAT
-- country the word claims more than that — a *tax invoice* is a document only a
-- registered business may issue.
--
-- WHY A COLUMN RATHER THAN A DERIVATION
--
-- 20260907 added the tax fields, and the title could simply be derived from
-- them. That is nearly right and wrong where it counts: entitlement to issue a
-- tax invoice comes from a registration, not from having typed a rate into a
-- form. The platform derives a default and shows it; this column records the
-- business saying otherwise.
--
-- NULL MEANS "follow the default", and that is the point of allowing it. Storing
-- the derived value would freeze it — a business that registers for VAT later
-- would go on issuing receipts with nothing to explain why.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE BACKFILL, AND WHY IT IS NOT NULL
--
-- Existing businesses have `invoice_prices_include_tax = false`, so the default
-- resolves to 'receipt' for all of them. That is very likely the more accurate
-- word — but applying it here would silently rename the documents every one of
-- them already sends to clients, without anyone asking.
--
-- So existing profiles are pinned to 'invoice', which is exactly what they
-- issue today: the migration changes nothing anybody receives. New profiles get
-- NULL and follow the default, and the settings screen shows every business
-- what its documents are called so the pinned ones can be changed deliberately.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS invoice_document_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_profiles_invoice_document_type_check'
  ) THEN
    ALTER TABLE business_profiles
      ADD CONSTRAINT business_profiles_invoice_document_type_check
      CHECK (invoice_document_type IS NULL
             OR invoice_document_type IN ('receipt', 'invoice', 'tax_invoice'));
  END IF;
END $$;

COMMENT ON COLUMN business_profiles.invoice_document_type IS
  'What the business''s client-facing documents are titled: receipt, invoice or tax_invoice. NULL follows the derived default (tax + tax id => tax_invoice, tax alone => invoice, otherwise receipt). The platform never decides this on the business''s behalf — entitlement to issue a tax invoice comes from a registration, not from a settings flag.';

-- Preserve what existing businesses already send. Only rows that predate this
-- column: a re-run must not overwrite a choice made since.
UPDATE business_profiles
   SET invoice_document_type = 'invoice'
 WHERE invoice_document_type IS NULL;
