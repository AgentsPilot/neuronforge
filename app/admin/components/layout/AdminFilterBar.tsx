'use client';

/**
 * The admin filter bar (Admin Layout Standard C-8, §5.5).
 *
 * L-1a built the Refresh part only. L-1c adds the full form, in the fixed §5.5
 * order: the Window control (presets and Custom) → the business slot → the
 * page's own filters → Clear → "Read at HH:mm UTC" and Refresh; and a second
 * line of active chips. The bar takes `role="search"` (named "Filters") only
 * when it holds controls; with only the L-1a props it is the exact L-1a plain
 * `<div>` (Health and Jobs show a server "As of" instead, §5.5 part 6, and
 * their DOM is unchanged). Never a `region` (SA-R-13).
 *
 * No shared part fetches: Refresh calls the page's own read.
 *
 * L-4a (user request 2026-10-11, §5.5 Layout): the controls row is
 * top-aligned (`items-start`); every field is a label row then a control, and
 * Clear and the Read at + Refresh group sit under `AdminFieldSpacer`, so all
 * controls share one row whatever grows under a field (SA Q-4). A standing
 * note about one control is the bar's `help` line, the last line inside the
 * bar, linked to that control by `aria-describedby`; never a note inside the
 * field column. Refresh takes `ADMIN_BUTTON` (SA Q-7, M-2); Clear keeps its own
 * quieter style. The no-controls branch is untouched.
 */

import type { ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';

import { AdminFieldSpacer, DatePresets } from './DatePresets';
import { linkedWindowLabel, type AdminWindowExtra, type AdminWindowValue } from './adminWindow';
import { formatUtcTime } from './adminFormat';
import { ADMIN_BUTTON } from './adminTable';

// The field classes live beside the Window control (which uses them too) so the
// two files do not import each other; pages import them from the bar.
export { ADMIN_FIELD_CONTROL, ADMIN_FIELD_LABEL, AdminFieldSpacer } from './DatePresets';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

export interface AdminActiveChip {
  key: string;
  /** Visible text, e.g. "Account Acme Dental" or "Linked window … UTC". */
  label: string;
  /** Optional hover text on the label (e.g. the full id). */
  title?: string;
  testId?: string;
  /** "Remove {filter}" (§5.5 part 7); a page may keep an existing pinned label. */
  removeLabel: string;
  onRemove: () => void;
}

export interface AdminFilterBarProps {
  /** Re-runs the page's current read unchanged (§5.5). */
  onRefresh: () => void;
  /** A read is in flight: icon spins, aria-busy, button disabled. */
  busy: boolean;
  /** Noun phrase; the button's accessible name is "Refresh {what}". */
  what: string;
  /** ISO time of the last successful read: "Read at HH:mm UTC" (§5.5 part 6). Omit beside a server "As of". */
  readAt?: string | null;
  /** Parts 1 and 2. Time-windowed pages only. */
  windowControl?: {
    value: AdminWindowValue;
    defaultValue: AdminWindowValue;
    onChange: (next: AdminWindowValue) => void;
    /** The page's own extra windows (D-2 (b), L-2a). Default none. */
    extras?: readonly AdminWindowExtra[];
    /** Apply needs both dates (L-2a). Default false. */
    requireBothDates?: boolean;
  };
  /** Part 3: the business picker. */
  business?: ReactNode;
  /** Part 4: the page's own labelled native controls. */
  children?: ReactNode;
  /** Part 5: Clear is rendered when set; disabled when `canClear` is false. */
  onClear?: () => void;
  canClear?: boolean;
  /** Part 7: chips for what the controls cannot show at a glance. */
  chips?: readonly AdminActiveChip[];
  /**
   * A standing note about one control, as the bar's last line (§5.5 Layout).
   * The page owns `id` and passes the same id to the control's
   * `aria-describedby` (for the picker, its `describedBy` prop). Default none.
   */
  help?: { id: string; text: string; testId?: string };
}

function RefreshButton({ onRefresh, busy, what }: Pick<AdminFilterBarProps, 'onRefresh' | 'busy' | 'what'>) {
  // The accessible name starts with the visible text "Refresh" (WCAG 2.5.3).
  return (
    <button
      type="button"
      onClick={onRefresh}
      aria-label={`Refresh ${what}`}
      aria-busy={busy}
      disabled={busy}
      className={`flex items-center gap-2 transition-colors ${ADMIN_BUTTON}`}
    >
      <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
      Refresh
    </button>
  );
}

function ReadAt({ readAt }: { readAt?: string | null }) {
  if (!readAt) return null;
  return <span className="text-xs text-slate-400">Read at {formatUtcTime(readAt)}</span>;
}

function Chip({ chip }: { chip: AdminActiveChip }) {
  return (
    <span
      data-testid={chip.testId}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200"
    >
      <span className="max-w-[18rem] truncate" title={chip.title}>
        {chip.label}
      </span>
      {/* A 20 px target inside a text-xs chip. */}
      <button
        type="button"
        aria-label={chip.removeLabel}
        onClick={chip.onRemove}
        className={`flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:text-white ${FOCUS_RING}`}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

export function AdminFilterBar({
  onRefresh,
  busy,
  what,
  readAt,
  windowControl,
  business,
  children,
  onClear,
  canClear,
  chips,
  help,
}: AdminFilterBarProps) {
  const hasControls =
    windowControl !== undefined || business !== undefined || children !== undefined || onClear !== undefined;

  if (!hasControls) {
    // The exact L-1a markup (plus "Read at" when a page asks for it).
    return (
      <div className="flex flex-wrap items-end gap-3">
        <div className="ml-auto flex items-center gap-3">
          <ReadAt readAt={readAt} />
          <RefreshButton onRefresh={onRefresh} busy={busy} what={what} />
        </div>
      </div>
    );
  }

  // U-7: a linked window shows as a chip; its X goes back to the page default.
  const allChips: AdminActiveChip[] = [];
  if (windowControl && windowControl.value.kind === 'linked') {
    allChips.push({
      key: 'linked-window',
      label: linkedWindowLabel(windowControl.value),
      testId: 'linked-window-chip',
      removeLabel: 'Remove linked window',
      onRemove: () => windowControl.onChange(windowControl.defaultValue),
    });
  }
  allChips.push(...(chips ?? []));

  return (
    <div role="search" aria-label="Filters" className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/40 p-3">
      <div className="flex flex-wrap items-start gap-3">
        {windowControl && (
          <DatePresets
            value={windowControl.value}
            defaultValue={windowControl.defaultValue}
            onChange={windowControl.onChange}
            extras={windowControl.extras}
            requireBothDates={windowControl.requireBothDates}
          />
        )}
        {business}
        {children}
        {onClear && (
          <div>
            <AdminFieldSpacer />
            <button
              type="button"
              onClick={onClear}
              disabled={canClear === false}
              className={`rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-60 ${FOCUS_RING}`}
            >
              Clear
            </button>
          </div>
        )}
        <div className="ml-auto">
          <AdminFieldSpacer />
          <div className="flex items-center gap-3">
            <ReadAt readAt={readAt} />
            <RefreshButton onRefresh={onRefresh} busy={busy} what={what} />
          </div>
        </div>
      </div>
      {allChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {allChips.map((chip) => (
            <Chip key={chip.key} chip={chip} />
          ))}
        </div>
      )}
      {help && (
        <p id={help.id} data-testid={help.testId} className="text-xs text-slate-400">
          {help.text}
        </p>
      )}
    </div>
  );
}
