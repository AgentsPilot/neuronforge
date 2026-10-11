'use client';

/**
 * The confirm step before an archive run starts (FR-4, C-15).
 *
 * It shows what will happen, in the admin's terms: the retention chosen, the
 * cutoff, how many rows will move, that archived rows cannot be viewed or
 * restored from the product (K-2), and, at 180 or 90 days, that business owners
 * will see only that much of their own history from now on (K-1, AC-8).
 *
 * The dialog opens even while runs are switched off, so its numbers and wording
 * can be checked in production (SA Q-1). Confirm is then disabled and says why;
 * the server refuses regardless (409 `runs_not_enabled`).
 *
 * The dark palette, the dark colour scheme and a visible corner close come from
 * the shared admin dialog classes (`app/admin/components/layout/adminDialog.ts`,
 * Admin Layout Standard C-10, D-8 (a), F-88), which replace this file's own
 * `!` copy. Confirm keeps its sky fill (Jobs parity) and gains the A-1 ring.
 */

import { useId } from 'react';
import { Archive } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DEFAULT_RETENTION_DAYS,
  RETENTION_DAYS_OPTIONS,
  type RetentionDays,
} from '@/lib/archiving/config';
import type { RetentionOptionCount } from '@/lib/archiving/types';
import {
  ADMIN_DIALOG_CLASS,
  ADMIN_DIALOG_DESCRIPTION_CLASS,
  ADMIN_DIALOG_TITLE_CLASS,
} from '@/app/admin/components/layout/adminDialog';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';

/**
 * Owners keep this much history at most. Anything shorter shortens it (K-1).
 * Compared against the longest option, not the default, so changing the
 * preselected value can never silence the warning (SA L-2).
 */
const LONGEST_RETENTION_DAYS = Math.max(...RETENTION_DAYS_OPTIONS);

interface Props {
  sourceLabel: string;
  option: RetentionOptionCount | undefined;
  runsEnabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy: boolean;
}

export function ArchiveConfirmDialog({
  sourceLabel,
  option,
  runsEnabled,
  open,
  onOpenChange,
  onConfirm,
  busy,
}: Props) {
  const confirmNoteId = useId();
  const retentionDays: RetentionDays = option?.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const shortensOwnerHistory = retentionDays < LONGEST_RETENTION_DAYS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="archive-button"
          className={`inline-flex items-center ${ADMIN_BUTTON}`}
        >
          <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
          Archive
        </button>
      </DialogTrigger>
      <DialogContent data-testid="archive-dialog" className={ADMIN_DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle className={ADMIN_DIALOG_TITLE_CLASS}>Archive old records?</DialogTitle>
          <DialogDescription className={ADMIN_DIALOG_DESCRIPTION_CLASS}>
            {sourceLabel}: records older than the cutoff move out of the live table.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-400">Keep records live for</dt>
          <dd data-testid="dialog-retention">{retentionDays} days</dd>
          <dt className="text-slate-400">Cutoff</dt>
          <dd data-testid="dialog-cutoff">
            {option
              ? `About ${formatUtc(option.cutoff)}; the exact time is fixed when you confirm`
              : 'Not available'}
          </dd>
          <dt className="text-slate-400">Records that will move</dt>
          <dd data-testid="dialog-rows">{option ? formatCount(option.eligibleRows) : 'Not available'}</dd>
        </dl>

        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>Archived records can&apos;t be viewed or restored from the product.</li>
          {shortensOwnerHistory && (
            <li data-testid="owner-history-warning" className="text-amber-300">
              Business owners will see only the last {retentionDays} days of their own activity
              history from now on.
            </li>
          )}
        </ul>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={ADMIN_BUTTON}
          >
            Cancel
          </button>
          <div>
            <button
              type="button"
              data-testid="confirm-archive"
              onClick={onConfirm}
              disabled={!runsEnabled || busy || !option}
              aria-describedby={runsEnabled ? undefined : confirmNoteId}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
            >
              {busy ? 'Archiving…' : 'Confirm'}
            </button>
            {!runsEnabled && (
              <p id={confirmNoteId} className="mt-1 text-xs text-slate-400">
                Not switched on yet
              </p>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
