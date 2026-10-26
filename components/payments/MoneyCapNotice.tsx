'use client';

import { AlertTriangle } from 'lucide-react';

/**
 * The amber line that says a money list or export is not the whole story.
 *
 * Used twice by `MoneyList`: under the summary when the route's own read hit
 * its cap (`truncated` — the totals are partial), and after an export whose
 * file holds fewer rows than the filter matched. A silently short money report
 * is a wrong money report, so both are said on screen.
 */
export function MoneyCapNotice({ text, testId }: { text: string; testId?: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="mb-3 flex items-center gap-2 px-3 py-2 text-[11.5px] text-amber-700 bg-amber-50 dark:bg-amber-900/20"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {text}
    </div>
  );
}

/**
 * Did the export response hold fewer rows than the filter matched?
 *
 * Two ways to be short: the route's read of a source hit its cap (`truncated`),
 * or the filter matched more rows than one export may carry (`total` above what
 * came back). Either way the file still downloads — the owner is told, rather
 * than handed a file they have no reason to count.
 */
export function exportWasCut(
  data: { truncated?: boolean | null; total?: number | null },
  written: number
): boolean {
  if (data.truncated) return true;
  return typeof data.total === 'number' && data.total > written;
}
