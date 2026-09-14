-- How long a client has to pay.
--
-- Every invoice raised without a human present used a hardcoded 14 days, which
-- matched nothing: not the `net_30` default the manual invoice dialog offers,
-- and not the business's own printed instructions. A business whose invoice
-- footer promised 60 days had its clients marked overdue on day 15 and chased
-- from day 11 — because `due_date` drives overdue status and every reminder.
--
-- Stored as DAYS rather than a preset name so it is one number that arithmetic
-- can use. The dialog's presets (net_7, net_30 …) become labels over it.

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS invoice_payment_terms_days INTEGER NOT NULL DEFAULT 30
  CHECK (invoice_payment_terms_days >= 0 AND invoice_payment_terms_days <= 365);

COMMENT ON COLUMN business_profiles.invoice_payment_terms_days IS
  'Default days to pay for invoices this business raises automatically. 0 = due on receipt.';

-- Per-quote override.
--
-- A contractor gives 60 days on a renovation and 7 on a callout, and the terms
-- are part of what the CLIENT agreed to — so they belong on the quote, not only
-- on the business. Null means "use the business default", which is what every
-- existing quote means.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER NULL
  CHECK (payment_terms_days IS NULL OR (payment_terms_days >= 0 AND payment_terms_days <= 365));

COMMENT ON COLUMN proposals.payment_terms_days IS
  'Days to pay, agreed on this quote. Null inherits business_profiles.invoice_payment_terms_days.';
