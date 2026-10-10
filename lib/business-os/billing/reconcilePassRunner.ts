/**
 * The billing reconcile passes: their contract and the runner (credits boost
 * slice 4b.2; plan payments SA-P4 / PF-5: ONE `bos-billing-reconcile` cron with
 * pluggable passes, created by whichever of P-8b and boost 4b landed first).
 *
 * A pass is a named function that re-reads Stripe for rows a webhook may have
 * missed and converges them through idempotent, row-locked SQL. Passes never
 * share rows. The list of passes lives in `reconcilePasses.ts` (the seam: P-8b
 * appends its plan pass there; the cron route needs no change).
 *
 * This module is pure (no I/O, no server-only import), so the runner and the
 * counter flattening are tested without a database or Stripe.
 *
 * @module lib/business-os/billing/reconcilePassRunner
 */

export interface ReconcileLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ReconcilePassContext {
  /** Epoch ms after which no pass may still be working (the route's 45 s budget). */
  deadlineAt: number;
  /** The run's "now", fixed once so every read of one run uses the same cut-offs. */
  now: Date;
  log: ReconcileLogger;
  trigger: 'nightly' | 'admin';
}

/** Counts only: whole numbers, never money (the run record keeps them, SC-11). */
export type ReconcilePassCounts = Readonly<Record<string, number>>;

export interface ReconcilePass {
  /** Lower-case letters only; it prefixes the pass's counters in the run record. */
  name: string;
  /** Never throws for one row; a throw here is a defect and is counted as a failed pass. */
  run(context: ReconcilePassContext): Promise<ReconcilePassCounts>;
}

export interface ReconcileRunResult {
  passesRun: number;
  passesFailed: number;
  /** Each pass's counters, flattened as `<pass><Key>` (e.g. `boostCredited`). */
  counts: Record<string, number>;
}

const PASS_NAME = /^[a-z]{1,16}$/;
const COUNT_KEY = /^[a-z][a-zA-Z0-9]{0,22}$/;

/** `boost` + `stillProcessing` → `boostStillProcessing`. */
export function flattenedCountKey(passName: string, key: string): string {
  return `${passName}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/**
 * Run the passes in order, sharing one deadline: a later pass gets what the
 * earlier ones left. A pass that throws is logged with an alert, counted in
 * `passesFailed`, and the next pass still runs.
 */
export async function runReconcilePasses(passes: readonly ReconcilePass[], context: ReconcilePassContext): Promise<ReconcileRunResult> {
  const counts: Record<string, number> = {};
  let passesRun = 0;
  let passesFailed = 0;

  for (const pass of passes) {
    if (!PASS_NAME.test(pass.name)) {
      // A wiring defect: the run record could not hold its counters.
      context.log.error({ alert: true, pass: pass.name }, 'bos_billing_reconcile_pass_misnamed');
      passesFailed += 1;
      continue;
    }
    passesRun += 1;
    try {
      const passCounts = await pass.run(context);
      for (const [key, value] of Object.entries(passCounts)) {
        if (!COUNT_KEY.test(key) || !Number.isSafeInteger(value)) {
          context.log.warn({ pass: pass.name, key }, 'bos_billing_reconcile_count_dropped');
          continue;
        }
        counts[flattenedCountKey(pass.name, key)] = value;
      }
    } catch (error) {
      passesFailed += 1;
      context.log.error(
        { alert: true, pass: pass.name, errorName: error instanceof Error ? error.name : typeof error },
        'bos_billing_reconcile_pass_failed'
      );
    }
  }

  return { passesRun, passesFailed, counts };
}
