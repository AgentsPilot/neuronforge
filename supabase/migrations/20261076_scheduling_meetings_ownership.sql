/*
 * `scheduling_meetings` joins the business-ownership graph.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CLOSES
 *
 * `businessOwnedTables.test.ts` catches any table created with a `user_id` that
 * nobody has classified, and it caught this one. Its comment names the reason:
 * an unclassified table gets no foreign key, so it survives the deletion of the
 * business that created it and is inherited by the next one — which is how the
 * pipeline stages and the capabilities leaked.
 *
 * `scheduling_meetings` was not actually leaking: `booking_id` is
 * `ON DELETE CASCADE`, so the rows already go when the booking goes, and the
 * booking goes when the business does. This adds the constraint anyway, because
 * relying on the parent means the protection lives somewhere other than the
 * column that needs it. One schema change to `booking_id` and the rows outlive
 * the business with nothing to say so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEPARATE MIGRATION
 *
 * `20260916_business_data_ownership.sql` names the table in its array now, so a
 * FRESH database gets the constraint from there. Its loop is idempotent — it
 * skips absent tables and existing constraints — but an EXISTING database has
 * already run it and will not run it again. This adds the one constraint those
 * databases are missing, using the same name the loop would have used, so
 * whichever runs first the other becomes a no-op.
 *
 * `NOT VALID`, like every constraint that migration creates: it binds all new
 * and changed rows without taking the full-table scan a validation needs, which
 * is what lets this ship against live data.
 * ─────────────────────────────────────────────────────────────────────────────
 */

DO $$
BEGIN
  IF to_regclass('public.scheduling_meetings') IS NULL THEN
    RAISE NOTICE 'scheduling_meetings is not in this database, skipping';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scheduling_meetings_business_fk'
       AND conrelid = 'public.scheduling_meetings'::regclass
  ) THEN
    RAISE NOTICE 'scheduling_meetings_business_fk already exists, skipping';
    RETURN;
  END IF;

  /*
   * An orphan would make this fail even NOT VALID, because the constraint still
   * has to be creatable. A meeting whose owner has no `business_profiles` row
   * cannot exist today — `syncMeeting` copies `user_id` straight off the
   * booking, and bookings already carry this constraint — but reporting beats
   * failing a migration on data nobody knew was there.
   */
  PERFORM 1
     FROM public.scheduling_meetings m
    WHERE NOT EXISTS (
      SELECT 1 FROM public.business_profiles p WHERE p.user_id = m.user_id
    )
    LIMIT 1;

  IF FOUND THEN
    RAISE NOTICE 'scheduling_meetings has rows with no business_profile; constraint added NOT VALID and those rows left as they are';
  END IF;

  ALTER TABLE public.scheduling_meetings
    ADD CONSTRAINT scheduling_meetings_business_fk
    FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id)
    ON DELETE CASCADE NOT VALID;

  RAISE NOTICE 'scheduling_meetings_business_fk added';
END $$;
