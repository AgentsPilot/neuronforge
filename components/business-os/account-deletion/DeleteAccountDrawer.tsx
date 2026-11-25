'use client';

/**
 * The deletion REQUEST form (data export DE-10b.2; account deletion lifecycle
 * DL-2a, workplan docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §5.3,
 * §5.4, §8, D-4, D-5, D-8; requirement §3.3; SA V-8, W-5).
 *
 * Rendered INSIDE the Danger Zone surface that is already open: the settings
 * dialog on `/business-os/settings`, the expanded panel on `/v2/settings` and
 * `/settings`. It never opens a second dialog on top (V-8), so focus and
 * Escape stay with the one dialog that owns them.
 *
 * One scrolling form with numbered sections (D-4), in document order:
 *   1. Before you go: the warning, "Export your data first" with the ONE
 *      shared `<DownloadMyDataButton variant="button" />` (S-4, SR-9), the
 *      documents line (BQ-35), the billing-kept and what-we-keep lines
 *   2. Blockers, only when there are any. Then sections 3 and 4 are not
 *      rendered and there is no confirm box (§3.3 step 4)
 *   3. Why are you leaving? The plan cancel's list and words
 *      (`PLAN_LEAVE_REASON_CODES`, `settings.plan_cancel.reason.*`; D-5).
 *      Required, no default: `other` is never sent on the owner's behalf (W-13)
 *   4. Confirm: the statement, the box, the request button
 *   (DL-2b fills a "What happens" section between 1 and 2.)
 *
 * The body is `{ statement, language, reasonCode }`. Nothing is deleted by
 * the request, so there is no sign-out and no redirect (D-8): every answer
 * goes through `requestOutcome()` (deletionAnswers.ts), and a recorded or
 * already-open request is handed to the host, which re-reads the closure and
 * shows the pending view in place.
 *
 * Client-safe (SA W-5): no repository, no deps file, no date helper; the
 * closure modules are reached by type only, through deletionAnswers.ts.
 *
 * @module components/business-os/account-deletion/DeleteAccountDrawer
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { DownloadMyDataButton } from '@/components/business-os/data-export/DownloadMyDataButton';
import { DELETION_STATEMENTS, isStatementLanguage, matchStatement } from '@/lib/business-os/account-deletion/acknowledgement';
import type { BlockerCode, BlockerView } from '@/lib/business-os/account-deletion/blockerCopy';
import { PLAN_LEAVE_REASON_CODES, type PlanLeaveReasonCode } from '@/lib/business-os/billing/planLeaveReasons';
import type { EnabledDeletionCheck } from '@/hooks/useAccountDeletionCheck';
import { line, WithSupport, type CopyFn } from './copyLine';
import { NETWORK_FAILURE, requestOutcome, type RequestMessageKey, type RequestOutcome } from './deletionAnswers';

export { parseBlockers } from './deletionAnswers';
export type { CopyFn } from './copyLine';

export const ACCOUNT_DELETE_URL = '/api/business-os/account/delete';

/** What the host's closure re-read found. */
export type ClosureRereadResult = 'open' | 'none' | 'error';

export interface DeleteAccountDrawerProps {
  check: EnabledDeletionCheck;
  tr: CopyFn;
  /** The UI language. The statement shown follows it; any language's statement is accepted. */
  language: string;
  isRTL: boolean;
  /**
   * A request was recorded, was already open, or may have been: the host
   * re-reads the closure (and swaps to the pending view when one is open).
   * Absent: nothing is re-read (a test rendering the drawer alone).
   */
  onRequestAnswered?: (outcome: RequestOutcome) => Promise<ClosureRereadResult>;
}

/** SA N-3: a counted blocker without a number uses its uncounted copy, never an empty "{n}". */
const COUNTED_CODES: ReadonlySet<BlockerCode> = new Set(['client_plans_running', 'client_payments_pending']);
export function blockerCopyKey(blocker: BlockerView): string {
  // D5 / SX-5 (P-8): G-8's text names the button that clears it, under a new key (translations are add-only, S-7).
  if (blocker.code === 'stripe_connected') return 'settings.account_delete.blocker.stripe_linked';
  const base = `settings.account_delete.blocker.${blocker.code}`;
  return COUNTED_CODES.has(blocker.code) && blocker.count === undefined ? `${base}_uncounted` : base;
}

type Failure = RequestMessageKey | 'settings.account_delete.unconfirmed' | null;

const MUTED = 'text-xs text-[var(--v2-text-secondary)]';
const SECTION_HEADING = 'text-xs font-semibold text-[var(--v2-text-primary)]';

export function DeleteAccountDrawer({ check, tr, language, isRTL, onRequestAnswered }: DeleteAccountDrawerProps) {
  const inputId = useId();
  const errorId = useId();
  const exportHeadingId = useId();
  const reasonGroupName = useId();
  const reasonRequiredId = useId();
  const statementLanguage = isStatementLanguage(language) ? language : 'en';
  const statement = DELETION_STATEMENTS[statementLanguage];

  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState<PlanLeaveReasonCode | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [serverBlockers, setServerBlockers] = useState<BlockerView[] | null>(null);

  const blockers = serverBlockers ?? check.blockers;
  const isMatched = matchStatement(typed) !== null;
  const canSubmit = isMatched && reason !== null && !isRequesting;

  // SA CR-2: while a request is in flight the control that held focus is disabled (or, for
  // `blocked`, removed), so the browser drops focus to <body>. After an answer that leaves the
  // owner here, focus moves to the line that explains it.
  const failureRef = useRef<HTMLParagraphElement>(null);
  const blockersHeadingRef = useRef<HTMLParagraphElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: 'failure' | 'blockers'; nonce: number } | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    (focusRequest.target === 'failure' ? failureRef : blockersHeadingRef).current?.focus();
  }, [focusRequest]);
  const focusOn = (target: 'failure' | 'blockers') => setFocusRequest((previous) => ({ target, nonce: (previous?.nonce ?? 0) + 1 }));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // W-13: never without a reason, never a default one.
    if (!canSubmit || reason === null) return;
    setIsRequesting(true);
    setFailure(null);
    let outcome: RequestOutcome;
    try {
      const response = await fetch(ACCOUNT_DELETE_URL, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statement: typed, language: statementLanguage, reasonCode: reason }),
      });
      const body: unknown = await response.json().catch(() => null);
      outcome = requestOutcome(response.status, body);
    } catch {
      outcome = requestOutcome(NETWORK_FAILURE, null);
    }

    if (outcome.kind === 'blocked') {
      setServerBlockers(outcome.blockers);
      focusOn('blockers');
    } else if (outcome.kind === 'message') {
      setFailure(outcome.key);
      focusOn('failure');
    } else {
      // recorded / already / unconfirmed: say what we know, then let the host re-read.
      if (outcome.kind === 'unconfirmed') setFailure('settings.account_delete.unconfirmed');
      const reread: ClosureRereadResult = onRequestAnswered ? await onRequestAnswered(outcome) : 'error';
      // 'open' unmounts this form (the host shows the pending view and focuses it). Otherwise say what we know.
      if (reread !== 'open') {
        if (outcome.kind === 'already') setFailure('settings.account_delete.already_requested');
        else if (outcome.kind === 'recorded') setFailure('settings.account_delete.unconfirmed');
        focusOn('failure');
      }
    }
    setIsRequesting(false);
  }

  const describedBy = [reason === null ? reasonRequiredId : null, failure ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'} data-testid="delete-account-drawer">
      {/* 1. Before you go */}
      <section className="space-y-2" aria-labelledby={exportHeadingId}>
        <div
          className="flex gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <p className="text-xs text-red-700 dark:text-red-300">{tr('settings.account_delete.warning')}</p>
        </div>
        <p id={exportHeadingId} className={SECTION_HEADING}>
          {tr('settings.account_delete.export_first.heading')}
        </p>
        {/* S-4 / SA C-8: the one shared control, on its own line, no flex-row-reverse wrapper. */}
        <DownloadMyDataButton variant="button" />
        <p className={MUTED}>{tr('settings.account_delete.export_first.documents')}</p>
        {check.available && check.willKeepBilling && <p className={MUTED}>{tr('settings.account_delete.billing_kept')}</p>}
        {check.available && <p className={MUTED}>{tr('settings.account_delete.what_we_keep')}</p>}
      </section>

      {!check.available ? (
        <p className={MUTED} role="status">
          <WithSupport text={line(tr, 'settings.account_delete.not_available')} />
        </p>
      ) : blockers.length > 0 ? (
        /* 2. Blockers: no reason, no confirm box. */
        <section className="space-y-2" data-testid="delete-account-blockers">
          <p ref={blockersHeadingRef} tabIndex={-1} className={`${SECTION_HEADING} focus:outline-none`} data-testid="delete-account-blockers-title">
            {tr('settings.account_delete.blockers_title')}
          </p>
          <ul className="list-disc ps-5 space-y-1">
            {blockers.map((blocker) => (
              <li key={blocker.code} className={MUTED}>
                <WithSupport text={line(tr, blockerCopyKey(blocker), blocker.count === undefined ? undefined : { n: blocker.count })} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {/* 3. Why are you leaving? Native radios: one Tab stop, arrows move (§8). */}
          <fieldset className="space-y-2" disabled={isRequesting}>
            <legend className={`${SECTION_HEADING} mb-1`}>{tr('settings.plan_cancel.reason.heading')}</legend>
            <p className={MUTED}>{tr('settings.plan_cancel.reason.hint')}</p>
            {PLAN_LEAVE_REASON_CODES.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm text-[var(--v2-text-primary)]">
                <input
                  type="radio"
                  name={reasonGroupName}
                  value={code}
                  checked={reason === code}
                  onChange={() => setReason(code)}
                  className="accent-red-600"
                  data-testid={`delete-account-reason-${code}`}
                />
                <span>{tr(`settings.plan_cancel.reason.${code}`)}</span>
              </label>
            ))}
            {reason === null && (
              <p id={reasonRequiredId} className={MUTED} data-testid="delete-account-reason-required">
                {tr('settings.plan_cancel.reason.required')}
              </p>
            )}
          </fieldset>

          {/* 4. Confirm */}
          <div className="space-y-2">
            <p className={MUTED}>{tr('settings.account_delete.statement_intro')}</p>
            <p
              className="text-sm font-medium text-[var(--v2-text-primary)] p-2 border border-[var(--v2-border)] select-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              dir={statementLanguage === 'he' ? 'rtl' : 'ltr'}
              lang={statementLanguage}
              data-testid="delete-account-statement"
            >
              {statement}
            </p>
            <label htmlFor={inputId} className="block text-xs font-medium text-[var(--v2-text-primary)]">
              {tr('settings.account_delete.statement_label')}
            </label>
            <textarea
              id={inputId}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
                if (failure === 'settings.account_delete.mismatch') setFailure(null);
              }}
              onKeyDown={(event) => {
                // Enter submits, as in a one-line field; it does nothing until the button is enabled.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={500}
              dir={statementLanguage === 'he' ? 'rtl' : 'ltr'}
              lang={statementLanguage}
              autoComplete="off"
              spellCheck={false}
              disabled={isRequesting}
              aria-invalid={failure === 'settings.account_delete.mismatch'}
              aria-describedby={failure ? errorId : undefined}
              className="w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
            {failure && (
              <p ref={failureRef} id={errorId} role="alert" tabIndex={-1} className="text-xs text-red-600 dark:text-red-400 focus:outline-none">
                <WithSupport text={line(tr, failure)} />
              </p>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              aria-busy={isRequesting}
              aria-describedby={describedBy || undefined}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {isRequesting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
              {isRequesting ? tr('settings.account_delete.requesting') : tr('settings.account_delete.request_button')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default DeleteAccountDrawer;
