-- Rollback of 20261026_business_os_credit_charges_activity_indexes.sql
-- (Admin AI Activity view, slice B0-prime).
--
-- Dropping an index loses no data. The Activity view keeps working without
-- these indexes; it is only slower at volume.
--
-- DROP INDEX takes an ACCESS EXCLUSIVE lock on the table, which blocks every
-- charge INSERT and every read while it waits (SA-B1-3). lock_timeout is 1s,
-- below the 1.5 s budget of the charge writer, so a rollback that has to queue
-- fails fast instead of stalling charge writes. If it times out, nothing was
-- dropped: run it again at a quieter moment.

BEGIN;

SET LOCAL lock_timeout = '1s';

DROP INDEX IF EXISTS public.business_os_credit_charges_kind_created_idx;

DROP INDEX IF EXISTS public.business_os_credit_charges_adjusts_action_idx;

COMMIT;
