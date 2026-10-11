'use client';

/**
 * Shared loading and error states (Admin Layout Standard C-3, §5.10).
 *
 * L-1a shipped `AdminLoading` and `AdminError`; L-1c adds `AdminEmpty` (Audit
 * trail's empty list). `AdminNotice` arrives with its first consumer. No part here
 * renders a `<section>` or a region: `role="status"` and `role="alert"` are
 * live regions, not landmarks (A-9), so a page's region count is unchanged.
 */

import { AlertCircle, RefreshCw } from 'lucide-react';

export interface AdminLoadingProps {
  /** Noun phrase: the state reads "Reading {what}…". */
  what: string;
}

export function AdminLoading({ what }: AdminLoadingProps) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-slate-300">
      <RefreshCw className="h-5 w-5 animate-spin text-purple-500" aria-hidden="true" />
      <span>Reading {what}…</span>
    </div>
  );
}

export interface AdminErrorProps {
  message: string;
  /** RC-3: placed on the message element itself, so its textContent is exactly `message`. */
  testId?: string;
  /** When set, a "Try again" button follows the message (outside the testid element). */
  onRetry?: () => void;
}

export function AdminError({ message, testId, onRetry }: AdminErrorProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
    >
      <AlertCircle className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <p data-testid={testId} className="flex-1">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export interface AdminEmptyProps {
  /** One sentence saying what is empty, e.g. "No audit events match these filters." */
  message: string;
  /** Optional second line: what to try. */
  hint?: string;
  /** When set, a "Clear filters" button follows (pages pass it only while a filter is on). */
  onClear?: () => void;
  testId?: string;
}

export function AdminEmpty({ message, hint, onClear, testId }: AdminEmptyProps) {
  return (
    <div data-testid={testId} className="rounded-xl border border-slate-700 bg-slate-800/40 p-8 text-center">
      <p className="text-sm text-slate-200">{message}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-4 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
