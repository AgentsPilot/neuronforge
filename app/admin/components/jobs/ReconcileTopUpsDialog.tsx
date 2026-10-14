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
 * Opened by its own `DialogTrigger`, like Drain now, so focus returns to the
 * button on close. Pinned by `app/admin/__tests__/jobsQueues.source.guard.test.ts`
 * (one POST, the literal URL, the literal body) and
 * `jobsQueues.reconcile.render.test.tsx` (REC-1 to REC-3, moved from the
 * drawer pins). A money file: the body is read with `.json(` as before, not
 * through `readJsonBody` (L-4b SA Q-5 precedent).
 */

import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { clientLogger } from '@/lib/logger/client';
import { ADMIN_DIALOG_CLASS, ADMIN_DIALOG_TITLE_CLASS } from '@/app/admin/components/layout/adminDialog';
import { RECONCILE_COPY, reconcileOutcome } from './reconcileCopy';

const logger = clientLogger.child({ module: 'AdminReconcileTopUpsDialog' });

export function ReconcileTopUpsDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last run's sentences, shown under the button once the dialog closes.
  const [notice, setNotice] = useState<string[] | null>(null);
  const inFlight = useRef(false);

  function handleOpenChange(next: boolean) {
    if (!next && inFlight.current) return;
    if (next) {
      setError(null);
      setNotice(null);
    }
    setOpen(next);
  }

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
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
    inFlight.current = false;
    setBusy(false);
    if (lines === null) {
      setError(RECONCILE_COPY.failed);
      return;
    }
    setNotice(lines);
    setOpen(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <button
            type="button"
            data-testid="boost-reconcile"
            className="whitespace-nowrap rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700/50"
          >
            {RECONCILE_COPY.button}
          </button>
        </DialogTrigger>
        <DialogContent data-testid="boost-reconcile-dialog" className={ADMIN_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle className={ADMIN_DIALOG_TITLE_CLASS}>{RECONCILE_COPY.title}</DialogTitle>
            <DialogDescription data-testid="boost-reconcile-description" className="!text-slate-300">
              {RECONCILE_COPY.description}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p data-testid="boost-reconcile-error" role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" data-testid="boost-reconcile-close" disabled={busy} onClick={() => handleOpenChange(false)}>
              Close
            </Button>
            <Button type="button" data-testid="boost-reconcile-run" disabled={busy} onClick={() => void run()}>
              {busy ? RECONCILE_COPY.running : RECONCILE_COPY.run}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
