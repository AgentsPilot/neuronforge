'use client';

/**
 * The button that opens a row in the admin drawer (Admin Layout Standard C-9,
 * §5.8 D-2). It is the keyboard path to open a row (L-1d SA Q-10). A page may
 * add a row click as a mouse extra under D-2, never exposed as a control on
 * the `tr` and never firing on a control inside the row; Businesses and
 * Messages do (user decision D-17, L-4b, L-7).
 *
 * LF-8 (user request 2026-10-15): an icon only, in a narrow last column
 * (`ADMIN_TH_OPEN` / `ADMIN_TD_OPEN`). With no visible word there is no
 * visible label to match (WCAG 2.5.3), so the caller's full label is the
 * accessible name (`aria-label`) and the hover tooltip (`title`). The box is
 * 32 by 32 px so it stays an easy click and touch target. The opener is
 * handed back so the page can return focus to it when the drawer closes (D-6).
 */

import { ChevronRight } from 'lucide-react';

import { ADMIN_TH_OPEN } from './adminTable';

export interface OpenRowButtonProps {
  /** Full accessible name and tooltip: "Open details for …" (D-2). */
  label: string;
  /** Receives the button, so the page can return focus to it (D-6). */
  onOpen: (opener: HTMLButtonElement) => void;
  testId?: string;
}

export function OpenRowButton({ label, onOpen, testId }: OpenRowButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={(event) => onOpen(event.currentTarget)}
      className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-600 text-slate-200 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
    >
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/**
 * The narrow Open column's header (LF-8): no visible word, an sr-only
 * "Details" so the column still has a name. Moved here unchanged from
 * Finance's business drawer (Money MK-8b, SA-Q-MK8B-1), so the Businesses-style
 * Open column is one piece wherever a page uses it.
 */
export function OpenRowHeader() {
  return (
    <th scope="col" className={ADMIN_TH_OPEN}>
      <span className="sr-only">Details</span>
    </th>
  );
}
