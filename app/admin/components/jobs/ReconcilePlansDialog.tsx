'use client';

/**
 * "Reconcile plan payments now" in the Billing reconcile job's row on the
 * Scheduled jobs & queues page (plan payments P-8b.3c; workplan D3-5; SA
 * P3-SA-2 items 4 and 8, P3-SA-8, P3-SA-9). The `ReconcileTopUpsDialog` shape.
 *
 * POSTs an EMPTY body to the plan reconcile route: the run covers every
 * business, and no account id is ever sent. It is not a "Run now" for the
 * nightly job: the route runs the plan pass only and records no run of the
 * job, so the row's last run does not change and the jobs are not read again
 * (SQ-1). One run at a time: Run and Close are disabled while one is in
 * flight, and the dialog cannot be dismissed until it answers. The counts are
 * shown in words under the button.
 *
 * After every press that reached the route, `onFinished` is called, so the
 * view bumps the webhook events block's key and only that block reads again
 * (Q-P3-4): a replay that failed leaves its event failed there, and a lost or
 * unsettled claim leaves it in progress, so the block shows it at once.
 *
 * QA6b-M1 (P3-SA-8): a 200 whose pass failed (`passesFailed` > 0), or whose
 * counts carry no `planEventsSeen`, is shown as the failure line, never as a
 * run that found nothing. It never renders server text. Its logger calls
 * carry only status, passesFailed and err. A money dialog: the body is read
 * with `.json(` as the top-ups dialog does (L-4b SA Q-5 precedent). Pinned by
 * `app/admin/__tests__/jobsQueues.source.guard.test.ts` and
 * `jobsQueues.reconcilePlans.render.test.tsx`.
 */

import { useRef, useState } from 'react';

import { clientLogger } from '@/lib/logger/client';
import { AdminConfirmDialog } from '@/app/admin/components/layout/AdminConfirmDialog';
import { PLAN_RECONCILE_COPY, planReconcileOutcome } from './reconcileCopy';

const logger = clientLogger.child({ module: 'AdminReconcilePlansDialog' });

export function ReconcilePlansDialog({ onFinished }: { onFinished: () => void }) {
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
    let reached = false;
    try {
      const response = await fetch('/api/admin/business-os/billing/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        cache: 'no-store',
      });
      reached = true;
      const body = (await response.json().catch(() => null)) as { success?: unknown; data?: unknown } | null;
      // QA6b-M1: a 200 whose pass failed, or without the plan counts, is a failure.
      if (response.ok && body?.success === true) lines = planReconcileOutcome(body.data);
      if (lines === null) {
        const data = body?.data as { passesFailed?: unknown } | undefined;
        const passesFailed = typeof data?.passesFailed === 'number' ? data.passesFailed : undefined;
        logger.warn({ status: response.status, passesFailed }, 'Reconcile plan payments did not complete');
      }
    } catch (err) {
      logger.error({ err }, 'Reconcile plan payments request failed');
      lines = null;
    }
    // A pass that failed part-way may still have replayed or failed events.
    if (reached) onFinished();
    if (lines === null) {
      setError(PLAN_RECONCILE_COPY.failed);
      return false;
    }
    setNotice(lines);
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        data-testid="plan-reconcile"
        onClick={() => {
          setError(null);
          setNotice(null);
          setOpen(true);
        }}
        className="whitespace-nowrap rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700/50"
      >
        {PLAN_RECONCILE_COPY.button}
      </button>
      <AdminConfirmDialog
        open={open}
        title={PLAN_RECONCILE_COPY.title}
        description={<span data-testid="plan-reconcile-description">{PLAN_RECONCILE_COPY.description}</span>}
        cancelLabel="Close"
        confirmLabel={PLAN_RECONCILE_COPY.run}
        busyLabel={PLAN_RECONCILE_COPY.running}
        tone="primary"
        testId="plan-reconcile-dialog"
        confirmTestId="plan-reconcile-run"
        cancelTestId="plan-reconcile-close"
        onConfirm={run}
        onClose={() => setOpen(false)}
        onReturnFocus={() => openerRef.current?.focus()}
      >
        {error && (
          <p data-testid="plan-reconcile-error" role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </AdminConfirmDialog>
      {notice && (
        <div data-testid="plan-reconcile-notice" role="status" className="mt-1 space-y-0.5 text-xs text-slate-200">
          {notice.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </>
  );
}
