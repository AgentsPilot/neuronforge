'use client';

/**
 * The button that opens a row in the admin drawer (Admin Layout Standard C-9,
 * §5.8 D-2). It sits in a table's first cell and is the keyboard path to open
 * a row (L-1d SA Q-10). A page may add a row click as a mouse extra under D-2,
 * never exposed as a control on the `tr` and never firing on a control inside
 * the row; Businesses does (user decision D-17, L-4b).
 *
 * The visible word is "Open"; the accessible name is the caller's full label,
 * which must start with that word ("Open details for …", WCAG 2.5.3 label in
 * name). The opener is handed back so the page can return focus to it when
 * the drawer closes (D-6).
 */

import { PanelRightOpen } from 'lucide-react';

export interface OpenRowButtonProps {
  /** Full accessible name, starting with the visible word: "Open details for …" (D-2, WCAG 2.5.3). */
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
      onClick={(event) => onOpen(event.currentTarget)}
      className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
    >
      <PanelRightOpen className="h-3 w-3" aria-hidden="true" />
      Open
    </button>
  );
}
