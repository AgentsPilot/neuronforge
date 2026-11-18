/*
 * Rollback for 20261128_how_a_client_has_behaved_over_time.sql
 *
 * Additive and DDL-only: the migration creates one table and nothing else reads
 * or writes it until the job that fills it ships. Dropping it takes the
 * snapshots with it, which is the intended undo — they are derived, and the
 * next run of the job rebuilds today's picture from the source rows.
 *
 * What a rollback CANNOT restore is the history itself: a snapshot of what a
 * client's record looked like last Tuesday cannot be recomputed from rows that
 * have moved on. Run this in the same sitting as the apply, before any job has
 * written to it, or accept that loss knowingly.
 */

BEGIN;

DROP TABLE IF EXISTS public.crm_client_standing;

COMMIT;
