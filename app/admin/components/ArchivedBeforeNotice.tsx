'use client';

/**
 * "Entries before <date> are archived." One line on the admin audit screens
 * (`/admin/audit-trail` and the per-user audit panel on `/admin/users`), so an
 * admin does not read "no results" as "nothing happened" (FR-12, AC-16).
 *
 * Renders nothing until a run has succeeded, and nothing if the read fails.
 * Admin screens only: owner screens get no notice in v1 (BQ-6, K-1).
 */

import { Archive } from 'lucide-react';

import { useLatestArchiveCutoff } from '@/hooks/useLatestArchiveCutoff';

/** The UTC calendar date of a cutoff: a cutoff is a UTC instant (FR-3). */
export function cutoffDate(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

interface Props {
  /** Spacing from the host screen; the notice adds none of its own outside. */
  className?: string;
}

export function ArchivedBeforeNotice({ className = '' }: Props) {
  const cutoff = useLatestArchiveCutoff();
  const date = cutoff ? cutoffDate(cutoff) : null;
  if (!date) return null;

  return (
    <p
      role="note"
      className={`flex items-center gap-2 text-sm text-slate-300 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 ${className}`}
    >
      <Archive className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
      <span>
        Entries before {date} are archived.
      </span>
    </p>
  );
}
