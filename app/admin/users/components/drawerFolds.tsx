'use client';

/**
 * The Businesses drawer's folds (Admin Layout follow-ups, BD-8): outside the
 * money blocks since LF-4a.2 (failures, All products, Cost by Model), and
 * inside them since LF-4b (credit lots, top-ups). Local to this screen, not a
 * shared export.
 *
 * Both hide with the `hidden` attribute and never unmount (the
 * `BusinessAuditSection` precedent, L-4b SA M-2): a folded child that owns a
 * read must not read again when unfolded, and folding sends nothing.
 */

import { useId, useState, type ReactNode } from 'react';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';

/** How many entries a long list shows before "Show N more" (BD-8). */
export const FOLD_VISIBLE = 3;

interface ShowMoreListProps {
  /** Keyed `li` elements, in the order to show them. */
  items: ReactNode[];
  listClassName?: string;
  /** Test id of the toggle; the hidden list gets `${testId}-rest`. */
  testId: string;
}

/** The first three entries, then the rest in a hidden list behind "Show N more". */
export function ShowMoreList({ items, listClassName, testId }: ShowMoreListProps) {
  const [expanded, setExpanded] = useState(false);
  const restId = useId();
  const first = items.slice(0, FOLD_VISIBLE);
  const rest = items.slice(FOLD_VISIBLE);

  return (
    <>
      <ul className={listClassName}>{first}</ul>
      {rest.length > 0 && (
        <>
          <ul id={restId} hidden={!expanded} data-testid={`${testId}-rest`} className={listClassName}>
            {rest}
          </ul>
          <button
            type="button"
            data-testid={testId}
            aria-expanded={expanded}
            aria-controls={restId}
            onClick={() => setExpanded((open) => !open)}
            className={ADMIN_BUTTON}
          >
            {expanded ? 'Show fewer' : `Show ${rest.length} more`}
          </button>
        </>
      )}
    </>
  );
}

interface FoldProps {
  /** The toggle's words when closed and when open. */
  showLabel: string;
  hideLabel: string;
  testId: string;
  children: ReactNode;
}

/** A closed-by-default region behind one toggle; its children stay mounted. */
export function Fold({ showLabel, hideLabel, testId, children }: FoldProps) {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();

  return (
    <>
      <button
        type="button"
        data-testid={`${testId}-toggle`}
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((open) => !open)}
        className={ADMIN_BUTTON}
      >
        {expanded ? hideLabel : showLabel}
      </button>
      <div id={regionId} hidden={!expanded} data-testid={`${testId}-fold`} className="space-y-3 pt-1">
        {children}
      </div>
    </>
  );
}
