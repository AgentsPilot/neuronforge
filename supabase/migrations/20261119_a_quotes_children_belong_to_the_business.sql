/*
 * `proposal_attachments` and `proposal_signatures` belong to the business.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SECOND CONSTRAINT WHEN THE PARENT ALREADY CASCADES
 *
 * Both tables cascade from `proposals`, so deleting a quote already takes its
 * files and its signature with it. That is not the case this guards.
 *
 * The case is deleting the BUSINESS. `20260916_business_data_ownership.sql`
 * gives every table carrying a `user_id` a foreign key to
 * `business_profiles(user_id)`, so removing the business row removes its data.
 * A table left out of that list keeps its rows: they survive the deletion and
 * are inherited by whoever next holds that `user_id`. That is how the pipeline
 * stages and the capabilities leaked, and it is what
 * `businessOwnedTables.test.ts` fails on when a new table with a `user_id`
 * appears unclassified.
 *
 * A client's signature is the worst row to leave behind — it is evidence about
 * a person, attached to a business that no longer exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HERE AND IN 20260916 BOTH
 *
 * The two names are also added to the array in 20260916, which is what makes a
 * FRESH install correct — that migration's loop creates the constraint for
 * every table it lists. An existing database has already run it, so the loop
 * will never see the new names; this migration is what reaches those.
 *
 * The same split `scheduling_meetings` made in 20261076, and the comment there
 * says so for the same reason.
 *
 * `NOT VALID` matches the loop: it checks new and changed rows without taking
 * the time to re-read every existing one. Any row that is already there was
 * written against a live business.
 */

DO $$
DECLARE
  target text;
  constraint_name text;
BEGIN
  FOREACH target IN ARRAY ARRAY['proposal_attachments', 'proposal_signatures'] LOOP
    constraint_name := target || '_business_fk';

    /* Reported, not fatal — environments are not identical, and a migration
       that stops halfway leaves a schema nobody intended. */
    IF to_regclass('public.' || quote_ident(target)) IS NULL THEN
      RAISE NOTICE 'business ownership: % is not in this database, skipping', target;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = constraint_name
        AND conrelid = ('public.' || quote_ident(target))::regclass
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I '
      'FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id) '
      'ON DELETE CASCADE NOT VALID',
      target, constraint_name
    );
  END LOOP;
END $$;
