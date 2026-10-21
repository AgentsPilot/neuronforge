'use client';

/**
 * "Reconcile top-ups now (all accounts)" in the Billing reconcile job's row on
 * the Scheduled jobs & queues page (Admin Layout follow-ups LF-4c; BD-6,
 * SA-C2, SA-C3). Moved from the Businesses drawer (credits boost slice 6b,
 * `BoostReconcileDialog`), with its request, confirm step and in-flight rules
 * unchanged.
 *
 * POSTs an EMPTY body to the 4b.2 admin route: the run covers every business,
 * and no account id is ever sent (SA C-6). It is not a "Run now" for the
 * nightly job (SA SQ-1): the route runs the top-ups pass only and records no
 * run of the job, so the row's last run does not change and the page does not
 * re-read. One run at a time: Run and Close are disabled while one is in
 * flight, and the dialog cannot be dismissed until it answers. The counts are
 * shown in words under the button.
 *
 * The confirm step is the shared `AdminConfirmDialog` (follow-ups LF-9): it
 * carries the send-once ref, the in-flight lock and the busy words, and this
 * file keeps the request. The opener is a plain button, so focus goes back to
 * it by hand through `onReturnFocus` (it never unmounts while the dialog is
 * open: the page does not re-read after a run). Pinned by
 * `app/admin/__tests__/jobsQueues.source.guard.test.ts` (one POST, the literal
 * URL, the literal body) and `jobsQueues.reconcile.render.test.tsx` (REC-1 to
 * REC-3, moved from the drawer pins). A money file: the body is read with
 * `.json(` as before, not through `readJsonBody` (L-4b SA Q-5 precedent).
 */

import { useRef, useState } from 'react';

import { clientLogger } from '@/lib/logger/client';
import { AdminConfirmDialog } from '@/app/admin/components/layout/AdminConfirmDialog';
import { RECONCILE_COPY, reconcileOutcome } from './reconcileCopy';

const logger = clientLogger.child({ module: 'AdminReconcileTopUpsDialog' });

export function ReconcileTopUpsDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last run's sentences, shown under the button once the dialog closes.
  const [notice, setNotice] = useState<string[] | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Resolves `false` on a failure, so the dialog stays open with the error
   * line; void after a success, so the shared dialog closes it. Never rejects:
   * everything that can throw is inside the try.
   */
  async function run(): Promise<boolean | void> {
    setError(null);
    let lines: string[] | null = null;
    try {
      const response = await fetch('/api/admin/business-os/credits/boost/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => null)) as { success?: unknown; data?: unknown } | null;
      // QA6b-M1: a 200 whose pass failed, or without the boost counts, is a failure.
      if (response.ok && body?.success === true) lines = reconcileOutcome(body.data);
      if (lines === null) {
        const data = body?.data as { passesFailed?: unknown } | undefined;
        const passesFailed = typeof data?.passesFailed === 'number' ? data.passesFailed : undefined;
        logger.warn({ status: response.status, passesFailed }, 'Reconcile top-ups did not complete');
      }
    } catch (err) {
      logger.error({ err }, 'Reconcile top-ups request failed');
      lines = null;
    }
    if (lines === null) {
      setError(RECONCILE_COPY.failed);
      return false;
    }
    setNotice(lines);
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        data-testid="boost-reconcile"
        onClick={() => {
          setError(null);
          setNotice(null);
          setOpen(true);
        }}
        className="whitespace-nowrap rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700/50"
      >
        {RECONCILE_COPY.button}
      </button>
      <AdminConfirmDialog
        open={open}
        title={RECONCILE_COPY.title}
        description={<span data-testid="boost-reconcile-description">{RECONCILE_COPY.description}</span>}
        cancelLabel="Close"
        confirmLabel={RECONCILE_COPY.run}
        busyLabel={RECONCILE_COPY.running}
        tone="primary"
        testId="boost-reconcile-dialog"
        confirmTestId="boost-reconcile-run"
        cancelTestId="boost-reconcile-close"
        onConfirm={run}
        onClose={() => setOpen(false)}
        onReturnFocus={() => openerRef.current?.focus()}
      >
        {error && (
          <p data-testid="boost-reconcile-error" role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </AdminConfirmDialog>
      {notice && (
        <div data-testid="reconcile-notice" role="status" className="mt-1 space-y-0.5 text-xs text-slate-200">
          {notice.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </>
  );
}
