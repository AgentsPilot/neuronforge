-- The tax a business tells its clients is already in the price.
--
-- WHY
--
-- A VAT-registered business shows a gross price with the tax noted — "€100,
-- includes 19% VAT" — and this platform's documents said "€100" and nothing
-- else. Their client cannot see what they were told they paid, which in most of
-- the EU is what a B2C price is required to show.
--
-- WHAT THIS IS NOT
--
-- Not tax calculation. The platform does not decide whether tax applies, look up
-- a rate, validate a registration, or handle cross-border supply — that is the
-- business's affair and their accountant's. These three columns hold what the
-- business typed, so a document can repeat it.
--
-- INCLUSIVE ONLY, and deliberately so: the price a business set is the price a
-- client pays. A setting that quietly added tax on top would change what people
-- are charged, which no display preference should ever do.
--
-- All three are optional and default to off. A business that never touches them
-- sees no change anywhere — which is most of them.

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS invoice_prices_include_tax BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS invoice_tax_rate NUMERIC(5,2);

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS invoice_tax_label TEXT;

-- A rate outside this range is a typo, not an instruction. 100 is excluded
-- because the tax cannot be the whole of an inclusive price.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_profiles_invoice_tax_rate_check') THEN
    ALTER TABLE business_profiles
      ADD CONSTRAINT business_profiles_invoice_tax_rate_check
      CHECK (invoice_tax_rate IS NULL OR (invoice_tax_rate > 0 AND invoice_tax_rate < 100));
  END IF;
END $$;

COMMENT ON COLUMN business_profiles.invoice_prices_include_tax IS
  'The business states its prices already contain tax. Display only — the platform never adds tax to a price.';

COMMENT ON COLUMN business_profiles.invoice_tax_rate IS
  'Percent, as the business typed it (19, 17, 21). Used only to carve the tax out of an inclusive price for display.';

COMMENT ON COLUMN business_profiles.invoice_tax_label IS
  'What the business calls it — VAT, מע״מ, IVA, MwSt. Free text.';
