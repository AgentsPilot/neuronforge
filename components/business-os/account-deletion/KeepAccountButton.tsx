'use client';

/**
 * KEEP MY ACCOUNT (account deletion lifecycle DL-2a; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §5.5; user Q-1,
 * 2026-11-06: "Keep my account" in all three languages).
 *
 * Posts `{}` to `POST /api/business-os/account/keep` ONCE per press: an
 * in-flight guard ignores a second press, and the button is `aria-busy`
 * while it waits. The answer goes through `keepOutcome()` and back to the
 * owner of the button, which renders the message and re-reads. Shared with
 * the DL-2c banner.
 *
 * @module components/business-os/account-deletion/KeepAccountButton
 */

import React, { useRef, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import type { CopyFn } from './copyLine';
import { keepOutcome, NETWORK_FAILURE, type KeepOutcome } from './deletionAnswers';

export const ACCOUNT_KEEP_URL = '/api/business-os/account/keep';

export interface KeepAccountButtonProps {
  tr: CopyFn;
  /** The plan end of the row read before the press, formatted, or null (the `_nodate` line). */
  planEnd: string | null;
  onOutcome: (outcome: KeepOutcome) => void;
  /** The id of the message the button refers to, when one is shown. */
  describedBy?: string;
}

export function KeepAccountButton({ tr, planEnd, onOutcome, describedBy }: KeepAccountButtonProps) {
  const [isKeeping, setIsKeeping] = useState(false);
  const inFlight = useRef(false);

  async function onKeep() {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsKeeping(true);
    let outcome: KeepOutcome;
    try {
      const response = await fetch(ACCOUNT_KEEP_URL, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body: unknown = await response.json().catch(() => null);
      outcome = keepOutcome(response.status, body, { planEnd });
    } catch {
      outcome = keepOutcome(NETWORK_FAILURE, null, { planEnd });
    }
    inFlight.current = false;
    setIsKeeping(false);
    onOutcome(outcome);
  }

  return (
    <button
      type="button"
      onClick={() => void onKeep()}
      // SA CR-2: `aria-disabled`, not `disabled`, so the button keeps focus while Keep is in
      // flight; the `inFlight` guard is what stops a second press.
      aria-disabled={isKeeping}
      aria-busy={isKeeping}
      aria-describedby={describedBy}
      data-testid="keep-account-button"
      className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--v2-primary)] text-white text-sm font-semibold aria-disabled:opacity-50 aria-disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-primary)]"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
    >
      {isKeeping ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="w-4 h-4" aria-hidden="true" />}
      {isKeeping ? tr('account_closure.keeping') : tr('account_closure.keep_button')}
    </button>
  );
}

export default KeepAccountButton;
