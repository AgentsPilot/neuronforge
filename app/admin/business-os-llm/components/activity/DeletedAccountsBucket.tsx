/**
 * The deleted-account bucket (FR-B8): charges whose account was deleted after
 * they ran, as ONE line, never merged into a row and never called audit loss.
 * All-accounts mode only.
 *
 * "At least" qualifies the USD and credit SUMS only, and only when more rows
 * matched than the read's ceiling (SA-CR-2, QA E-1). The COUNT is the exact
 * database count whatever the ceiling, so it is never qualified.
 */

import { Archive } from 'lucide-react';

import { formatCount, formatCredits, formatUsd } from '../../costFormat';
import {
  DELETED_BUCKET_AT_LEAST,
  DELETED_BUCKET_FAILED,
  DELETED_BUCKET_LABEL,
  DELETED_BUCKET_NOTE,
} from '../../activityCopy';
import type { ActivityDeletedBucket } from '../../activityTypes';

export function DeletedAccountsBucket({ bucket }: { bucket: ActivityDeletedBucket }) {
  if (bucket.status === 'failed') {
    return (
      <p data-testid="activity-deleted-bucket" className="text-xs text-amber-300">
        {DELETED_BUCKET_FAILED}
      </p>
    );
  }
  const prefix = bucket.atLeast ? `${DELETED_BUCKET_AT_LEAST} ` : '';
  return (
    <p data-testid="activity-deleted-bucket" className="flex items-start gap-2 text-xs text-slate-400">
      <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-medium text-slate-300">{DELETED_BUCKET_LABEL}</span>
        {' — '}
        {formatCount(bucket.count)} actions, {prefix}
        {formatUsd(bucket.costUsd)}, {prefix}
        {formatCredits(bucket.credits)} credits <span className="text-slate-500">({DELETED_BUCKET_NOTE})</span>
      </span>
    </p>
  );
}
