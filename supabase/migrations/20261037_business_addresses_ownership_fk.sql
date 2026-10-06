-- The address book belongs to the business, and leaves with it
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A SECOND FILE
--
-- `20261036_business_addresses_book.sql` created the table without this
-- constraint, and that migration has already been applied — so the fix cannot
-- go in it. Editing an applied migration leaves the file describing a database
-- that does not exist.
--
-- WHAT WAS MISSING
--
-- Every Business OS table scoped by `user_id` is classified as belonging either
-- to the BUSINESS or to the PERSON, and the business-owned ones carry a foreign
-- key to `business_profiles(user_id)` with `ON DELETE CASCADE`. That is what
-- makes "delete this business" actually remove its data — the schema cannot
-- infer the distinction, so it is declared.
--
-- `business_addresses` is business data: these are the addresses printed on its
-- invoices and shown on its public booking and contact pages. A new business
-- must no more inherit the last one's address than its company name. Without
-- the cascade the rows would outlive the profile they describe, orphaned and
-- invisible, and a reset would leave an old address behind to be offered again.
--
-- `businessOwnedTables.test.ts` caught this: it reads every migration for a
-- table carrying `user_id` and fails on one that no registry classifies.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- `NOT VALID`, as every other table in this family does it
--
-- The constraint applies to everything written from here on; it does not
-- re-check the rows already there. That is deliberate and matches
-- `20260931_business_subscribers.sql`: validation would take an ACCESS
-- EXCLUSIVE lock on a table the settings dialog reads on every open, to prove
-- something the backfill already guarantees — every row it wrote came from a
-- `business_profiles` row that still exists.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.business_addresses') IS NOT NULL
     AND to_regclass('public.business_profiles') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'business_addresses_business_fk'
         AND conrelid = 'public.business_addresses'::regclass
     )
  THEN
    ALTER TABLE public.business_addresses
      ADD CONSTRAINT business_addresses_business_fk
      FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

COMMIT;
