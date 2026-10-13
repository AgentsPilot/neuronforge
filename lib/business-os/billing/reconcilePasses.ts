import 'server-only';

/**
 * The passes of the `bos-billing-reconcile` cron, in the order they run
 * (credits boost slice 4b.2; plan payments SA-P4 / PF-5).
 *
 * THE SEAM: plan payments P-8b appends `planReconcilePass` here; the cron route
 * needs no change. Passes never share rows, and they share the run's deadline
 * in order (`runReconcilePasses`). A new pass's counters must also be added to
 * the job's `counts` in `lib/cron/bosCronJobs.ts`, or the run record drops them.
 *
 * @module lib/business-os/billing/reconcilePasses
 */

import type { ReconcilePass } from '@/lib/business-os/billing/reconcilePassRunner';
import { boostReconcilePass } from '@/lib/business-os/boost/boostReconcileDeps';

export const RECONCILE_PASSES: readonly ReconcilePass[] = [boostReconcilePass];

/** The route's budget: passes stop starting work after this (maxDuration is 60 s). */
export const RECONCILE_RUN_DEADLINE_MS = 45 * 1000;
