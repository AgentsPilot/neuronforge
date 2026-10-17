/**
 * The ONE clock of the nightly finance history snapshot (slice 8.2, E-97,
 * 8.2-R4). The route reads the run's start from here and hands it to the job,
 * which reads no clock of its own, so a test (the route's, and the cron
 * run-record adoption test) can fix the hour the late gate sees.
 *
 * @module lib/business-os/finance/financeSnapshotClock
 */

export const financeSnapshotClock = {
  now: (): Date => new Date(),
};
