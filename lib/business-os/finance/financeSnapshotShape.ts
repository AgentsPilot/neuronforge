/**
 * The shapes a finance history snapshot row may take (slice 8.1, §11M.6,
 * E-86, E-90). ONE definition: migration 20261078's two CHECKs are pinned to
 * these patterns' `.source` by its migration test, and slice 8.2's builder
 * checks every row against them before the insert, so a row the database
 * would refuse skips its family instead of failing the night's batch.
 *
 * A dimension is `all`, a group key or a lifecycle state, or a tier group key
 * (`tier:` + a config tier id, the same shape Finance's `FINANCE_GROUP_SHAPE`
 * admits). A hyphen is allowed only after `tier:`, so a uuid can never be a
 * dimension: no row can carry an account id (HS-W-8).
 *
 * Pure: no import, no clock, no tier literal.
 *
 * @module lib/business-os/finance/financeSnapshotShape
 */

/** `metric`: lower case, digits and underscores, starting with a letter, at most 48 characters. */
export const SNAPSHOT_METRIC_SHAPE = /^[a-z][a-z0-9_]{0,47}$/;

/** `dimension`: a plain key as `metric`, or a tier group key. */
export const SNAPSHOT_DIMENSION_SHAPE = /^([a-z][a-z0-9_]{0,47}|tier:[a-z0-9_-]{1,40})$/;
