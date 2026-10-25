'use client';

/**
 * One step of the booking dialog: answered, open, or still to come.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * `SchedulingBookingModal` renders every section open, always — service,
 * client, date, availability, time, notes, intake — in one vertical scroll of
 * 3,130 lines. The client block alone is nearly five hundred of them, carrying
 * a search, a new-client form, a source picker, tags and notes, all permanently
 * expanded whether or not anybody is choosing a client.
 *
 * So the dialog is tall, and nothing in it says where you are or what is left.
 *
 * Here a step collapses to a single line once it is answered — "ייעוץ אישי ·
 * 60 דק׳ · ₪400" — and only the open one takes room. The decisions already
 * made stay visible as a summary rather than as a form you have to scroll past.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURE CHROME, ON PURPOSE
 *
 * This component knows nothing about services, clients or hours. It takes a
 * summary line and children, and draws the frame. The sections inside keep
 * their own markup untouched — each one carries its own history of fixes, and
 * rewriting them to fit a layout is how those get quietly undone.
 */

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

export type BookingStepState = 'done' | 'open' | 'pending';

interface BookingStepProps {
  /** Its position in the sequence, shown while open or still to come. */
  index: number;
  /** What this step asks: "שירות", "לקוח", "מתי", "פרטים". */
  label: string;
  state: BookingStepState;
  /**
   * The answer, once there is one.
   *
   * Shown on the collapsed row INSTEAD of the form. A step with no summary
   * stays open even when marked done, because a collapsed row saying nothing
   * is worse than the form it replaced.
   */
  summary?: ReactNode;
  /** Offered beside a done step. Absent for one that cannot be reopened. */
  onEdit?: () => void;
  editLabel?: string;
  /** Sits at the end of the open step's heading — the business's clock, say. */
  note?: ReactNode;
  children?: ReactNode;
}

const ACCENT = '#14B8A6';

export function BookingStep({
  index,
  label,
  state,
  summary,
  onEdit,
  editLabel,
  note,
  children,
}: BookingStepProps) {
  /*
   * A step is only collapsible once it has something to say. Marked done with
   * no summary, it stays open: a row reading "שירות ✓" and nothing else tells
   * the owner less than the picker did.
   */
  const collapsed = state === 'done' && Boolean(summary);

  if (collapsed) {
    return (
      <div className="border-b border-[var(--v2-border)] px-5 py-3">
        <div className="flex items-center gap-3 text-sm">
          <span
            className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full"
            style={{ background: ACCENT }}
          >
            <Check className="h-3 w-3" style={{ color: '#04201D' }} strokeWidth={3} />
          </span>

          <span className="text-[var(--v2-text-muted)]">{label}</span>
          <span className="min-w-0 truncate font-semibold text-[var(--v2-text-primary)]">
            {summary}
          </span>

          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              /*
               * "Change" alone is four identical buttons down the dialog, and
               * a screen reader reads them as four identical buttons. The
               * step's own label names which fact each one reopens.
               */
              aria-label={editLabel ? `${editLabel} · ${label}` : undefined}
              className="ms-auto shrink-0 text-[13px] font-semibold"
              style={{ color: ACCENT }}
            >
              {editLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (state === 'pending') {
    return (
      <div className="border-b border-[var(--v2-border)] px-5 py-3 opacity-50">
        <div className="flex items-center gap-3 text-sm">
          <span
            className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border text-[11px] font-bold tabular-nums"
            style={{ borderColor: 'var(--v2-text-muted)', color: 'var(--v2-text-muted)' }}
          >
            {index}
          </span>
          <span className="text-[var(--v2-text-muted)]">{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--v2-border)]">
      <div className="bg-[var(--v2-surface-hover)] px-5 pb-5 pt-4">
        <div className="mb-4 flex items-center gap-3">
          <span
            className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11px] font-bold tabular-nums"
            style={{ borderColor: ACCENT, color: ACCENT }}
          >
            {index}
          </span>
          <span className="text-[14.5px] font-bold text-[var(--v2-text-primary)]">{label}</span>

          {note && (
            <span className="ms-auto text-[12px] text-[var(--v2-text-muted)]">{note}</span>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}
