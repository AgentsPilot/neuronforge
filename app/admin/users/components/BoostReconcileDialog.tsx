'use client';

/**
 * "Run billing reconcile now (all accounts)" (credits boost slice 6b; SA C-6,
 * Q-5; workplan §3.4).
 *
 * POSTs an EMPTY body to the 4b.2 admin route
 * (`/api/admin/business-os/credits/boost/reconcile`): the run covers every
 * business, and no account id is ever sent (C-6). A confirm step says so first.
 * One run at a time: Run is disabled while one is in flight and the dialog
 * cannot be closed until it answers. The counts are shown in words.
 */

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { BOOST_ACTION_COPY, reconcileOutcome } from '../boostCopy';

const DARK_DIALOG = '!border-slate-700 !bg-slate-900 !text-slate-100';

export const RECONCILE_URL = '/api/admin/business-os/credits/boost/reconcile';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the result sentences after a run that answered. */
  onFinished: (lines: string[]) => void;
}

export function BoostReconcileDialog({ open, onOpenChange, onFinished }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next && inFlight.current) return;
    onOpenChange(next);
  }

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let lines: string[] | null = null;
    try {
      const response = await fetch(RECONCILE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => null)) as { success?: unknown; data?: unknown } | null;
      // QA6b-M1: a 200 whose pass failed, or without the boost counts, is a failure.
      if (response.ok && body?.success === true) lines = reconcileOutcome(body.data);
    } catch {
      lines = null;
    }
    inFlight.current = false;
    setBusy(false);
    if (lines === null) {
      setError(BOOST_ACTION_COPY.reconcileFailed);
      return;
    }
    onFinished(lines);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="boost-reconcile-dialog" className={DARK_DIALOG}>
        <DialogHeader>
          <DialogTitle className="!text-white">{BOOST_ACTION_COPY.reconcileTitle}</DialogTitle>
          <DialogDescription data-testid="boost-reconcile-description" className="!text-slate-300">
            {BOOST_ACTION_COPY.reconcileDescription}
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
            {busy ? BOOST_ACTION_COPY.reconcileRunning : BOOST_ACTION_COPY.reconcileRun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
