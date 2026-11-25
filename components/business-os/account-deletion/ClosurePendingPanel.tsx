'use client';

/**
 * The open deletion request, in the Danger Zone (account deletion lifecycle
 * DL-2a; workplan docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §5.5,
 * §8; SA W-4 d, W-10, W-12).
 *
 *   pending     the plan end, the 14 days, the (projected) lock date; or the
 *               `_nodate` line when the server sent no date        + Keep
 *   grace       the lock date                                       + Keep
 *   requesting  "still setting up" with the support address (W-10)   no Keep
 *   locked      "closed, contact us"                                no Keep
 *
 * Every date is the server's instant formatted on the server's zone
 * (`timezone` in the wire, D-6), never the browser's clock, and never
 * adjusted here (W-12).
 *
 * Keep's answer: a message that must outlive the re-read (the account is
 * kept, or there was nothing to keep) goes to the host through `onNotice`,
 * which shows it in place of this panel until the dialog closes. A refusal
 * stays here, in `role="alert"`, and the Keep button points at it.
 *
 * Client-safe (SA W-5): no repository, no deps file, no closure date helper.
 * `formatAccountDay` is PLAN PAYMENTS' client-safe formatter (import only).
 *
 * @module components/business-os/account-deletion/ClosurePendingPanel
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { formatAccountDay } from '@/components/business-os/settings/planUpgradeCopy';
import type { ClosureStatusView } from '@/lib/business-os/account-deletion/schemas';
import { line, WithSupport, type CopyFn } from './copyLine';
import { KeepAccountButton } from './KeepAccountButton';
import type { KeepOutcome } from './deletionAnswers';

export interface ClosureNotice {
  key: string;
  vars?: Record<string, string>;
  /** `status` for a kept account; `alert` otherwise. */
  tone: 'status' | 'alert';
}

export interface ClosurePendingPanelProps {
  closure: ClosureStatusView;
  tr: CopyFn;
  language: string;
  isRTL: boolean;
  /** Move focus to the first line on mount (after a request was just recorded, §8). */
  focusOnMount?: boolean;
  /** Re-read the closure (the host's state); may resolve once the read is in. */
  onReread: () => Promise<unknown> | void;
  /** Show a message in place of the panel, for good (until the dialog closes). */
  onNotice: (notice: ClosureNotice) => void;
  /** The account is kept: refresh the host page. */
  onKept: () => void;
}

/** The view's dates, formatted on its own zone; both null when either is missing (W-4 d). */
export function closureDates(closure: ClosureStatusView, language: string): { planEnd: string | null; lockDate: string | null } {
  const lockDate = closure.lockAt ? formatAccountDay(closure.lockAt, language, closure.timezone) : null;
  const planEnd = closure.planEndsAt ? formatAccountDay(closure.planEndsAt, language, closure.timezone) : null;
  if (closure.status === 'pending' && (lockDate === null || planEnd === null)) return { planEnd: null, lockDate: null };
  return { planEnd, lockDate };
}

/** The body line of each state, as a copy key and its values. */
export function closureBodyLine(closure: ClosureStatusView, language: string): { key: string; vars: Record<string, string | number> } {
  const { planEnd, lockDate } = closureDates(closure, language);
  const days = closure.graceDays;
  switch (closure.status) {
    case 'pending':
      return planEnd && lockDate
        ? { key: 'account_closure.pending_body', vars: { planEnd, days, lockDate } }
        : { key: 'account_closure.pending_body_nodate', vars: { days } };
    case 'grace':
      return lockDate ? { key: 'account_closure.grace_body', vars: { lockDate } } : { key: 'account_closure.grace_body_nodate', vars: {} };
    case 'requesting':
      return { key: 'account_closure.requesting_body', vars: {} };
    case 'locked':
      return { key: 'account_closure.locked_body', vars: {} };
  }
}

export function ClosurePendingPanel({ closure, tr, language, isRTL, focusOnMount = false, onReread, onNotice, onKept }: ClosurePendingPanelProps) {
  const messageId = useId();
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const refusalRef = useRef<HTMLParagraphElement>(null);
  const [refusal, setRefusal] = useState<{ key: string } | null>(null);
  // SA CR-2: after an answer that leaves the owner on this panel, focus moves to the line that
  // explains it: the refusal line, or the body after a re-read showed a new state.
  const [focusRequest, setFocusRequest] = useState<{ target: 'refusal' | 'body'; nonce: number } | null>(null);
  const focusOn = (target: 'refusal' | 'body') => setFocusRequest((previous) => ({ target, nonce: (previous?.nonce ?? 0) + 1 }));

  useEffect(() => {
    if (focusOnMount) bodyRef.current?.focus();
  }, [focusOnMount]);

  useEffect(() => {
    if (!focusRequest) return;
    (focusRequest.target === 'refusal' ? refusalRef : bodyRef).current?.focus();
  }, [focusRequest]);

  const body = closureBodyLine(closure, language);
  const canKeep = closure.status === 'pending' || closure.status === 'grace';
  const { planEnd } = closureDates(closure, language);

  function onOutcome(outcome: KeepOutcome) {
    if (outcome.kept) {
      if (outcome.message) onNotice({ ...outcome.message, tone: 'status' });
      onKept();
      onReread();
      return;
    }
    if (outcome.message && outcome.reread) {
      // Nothing to keep: the re-read empties the panel, so the line must outlive it.
      onNotice({ ...outcome.message, tone: 'alert' });
      onReread();
      return;
    }
    if (outcome.message) {
      setRefusal({ key: outcome.message.key });
      focusOn('refusal');
      if (outcome.reread) void onReread();
      return;
    }
    // `state_changed` to another open state: re-read, then point at the new body line.
    setRefusal(null);
    if (outcome.reread) {
      void Promise.resolve(onReread()).then(() => focusOn('body'));
    }
  }

  return (
    <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'} data-testid="closure-pending-panel" data-status={closure.status}>
      <div
        className="flex gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        <CalendarClock className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <p ref={bodyRef} tabIndex={-1} className="text-xs text-[var(--v2-text-primary)] focus:outline-none" data-testid="closure-pending-body">
          <WithSupport text={line(tr, body.key, body.vars)} />
        </p>
      </div>

      {refusal && (
        <p ref={refusalRef} id={messageId} role="alert" tabIndex={-1} className="text-xs text-red-600 dark:text-red-400 focus:outline-none" data-testid="closure-keep-refusal">
          <WithSupport text={line(tr, refusal.key)} />
        </p>
      )}

      {canKeep && <KeepAccountButton tr={tr} planEnd={planEnd} onOutcome={onOutcome} describedBy={refusal ? messageId : undefined} />}
    </div>
  );
}

/** A message that replaced the panel (kept, or nothing to keep). Focused on mount (§8). */
export function ClosureNoticeLine({ notice, tr, isRTL }: { notice: ClosureNotice; tr: CopyFn; isRTL: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role={notice.tone}
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`text-xs focus:outline-none ${notice.tone === 'alert' ? 'text-[var(--v2-text-primary)]' : 'text-green-700 dark:text-green-400'}`}
      data-testid="closure-notice"
    >
      <WithSupport text={line(tr, notice.key, notice.vars)} />
    </p>
  );
}

export default ClosurePendingPanel;
