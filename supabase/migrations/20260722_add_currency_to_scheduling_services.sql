-- Currency on a service.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RESTORED. This file was one byte — the single character `o` — so the column
-- could not be rebuilt from this repository at all. It exists in the deployed
-- database (a later migration seeds into it, and the application reads and
-- writes it everywhere), but its type, default and constraint were unrecoverable
-- from source: a fresh environment built from these migrations would have got a
-- `scheduling_services` table with no `currency` column, and every service
-- insert would have failed.
--
-- Written to match what the application already assumes rather than to impose
-- something new:
--
--   • `ServiceCurrency = 'USD' | 'EUR' | 'ILS' | 'GBP'`
--     (lib/repositories/SchedulingRepository.ts) — the four the service form
--     offers, and the four the checkout schema accepts.
--   • Default 'ILS', matching the application-side fallback at
--     SchedulingRepository.ts:258 (`service.currency ?? 'ILS'`). A default in
--     one place and a different one in the other is how a service ends up
--     priced in a currency nobody chose.
--
-- IF NOT EXISTS throughout, so running this against the deployed database —
-- where the column is already present — changes nothing. The CHECK is added
-- separately and guarded, because an existing row holding some other code would
-- otherwise make this migration fail rather than reveal the problem.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE scheduling_services
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'ILS';

-- Only when every existing row can satisfy it. A migration that fails here
-- would tell you less than a warning that names the offending values.
DO $$
DECLARE
  offending INTEGER;
BEGIN
  SELECT COUNT(*) INTO offending
  FROM scheduling_services
  WHERE currency IS NOT NULL
    AND currency NOT IN ('USD', 'EUR', 'ILS', 'GBP');

  IF offending > 0 THEN
    RAISE WARNING
      'scheduling_services.currency holds % row(s) outside USD/EUR/ILS/GBP — constraint not added. Reconcile those rows, then re-run.',
      offending;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_services_currency_check'
    ) THEN
      ALTER TABLE scheduling_services
        ADD CONSTRAINT scheduling_services_currency_check
        CHECK (currency IN ('USD', 'EUR', 'ILS', 'GBP'));
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN scheduling_services.currency IS
  'The currency this service is priced in. Constrained to the four the service form offers; defaults to ILS, matching the application-side fallback.';
