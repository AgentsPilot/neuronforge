'use client';

/**
 * What you can do to one meeting in a package, and nothing you cannot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * Every row carried four outlined buttons — held, no-show, cancel, reschedule —
 * laid out inline. Six meetings meant twenty-four controls, and at drawer width
 * each row wrapped, so meeting 2's actions sat directly under meeting 2's date
 * and directly above meeting 3, with nothing to say which owned them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE LINE, AND ONLY WHAT THE ROW CAN ACTUALLY DO
 *
 *   still ahead    ⋯ only — move it, or call it off
 *   passed, open   "סימון כהושלם" in front, the rest behind ⋯
 *   already marked ⋯ only — the outcome is recorded; it can still be moved
 *
 * Two changes, and the second is the one that matters. Recording the outcome is
 * the thing an owner actually does, so it keeps its place in front and the rest
 * go a click away rather than a line away.
 *
 * And an outcome is only offered once there IS one. A block of six biweekly
 * sessions, every one still ahead, used to show "mark done" on all six — a
 * claim about an event that has not happened. On a package billed per session
 * marking a meeting held is what RAISES ITS INVOICE, so a mis-tap on a session
 * three weeks out bills a client for work nobody has done.
 *
 * Cancelling is the exception and stays available throughout: it is the one
 * action that does not depend on the meeting having happened.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from 'react';
import { CalendarClock, CheckCheck, MoreHorizontal, UserX, XCircle } from 'lucide-react';

import { shouldOpenUpward } from './menuPlacement';

import { isMeetingPastDue } from '@/lib/business-os/quoteGate';

interface MeetingRowActionsProps {
  /** `scheduling_bookings.status` for this one meeting. */
  status: string;
  /** The meeting's own start, which decides whether it can have an outcome. */
  startTime: string | null;
  /** Records an outcome. Absent in a read-only drawer. */
  onSetStatus?: (status: 'completed' | 'no_show' | 'cancelled') => void;
  /** Opens the reschedule flow. */
  onReschedule?: () => void;
  t: (key: string) => string;
}

export function MeetingRowActions({
  status,
  startTime,
  onSetStatus,
  onReschedule,
  t,
}: MeetingRowActionsProps) {
  const [open, setOpen] = useState(false);
  /* The last meeting of a block has nothing under it, and the drawer's own edge
     does the cutting long before the window's — see `menuPlacement`. */
  const [up, setUp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // A menu that stays open after you click elsewhere is a menu you dismiss twice.
  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  /** The owner has already said what happened. */
  const settled = status === 'completed' || status === 'cancelled' || status === 'no_show';

  /*
   * Its time has passed and nobody has said what happened — the same rule the
   * badge and the session card use, so a row offering "mark done" and a badge
   * saying "awaiting an outcome" can never disagree about one booking.
   */
  const awaiting = isMeetingPastDue({ status, startTime: startTime ? new Date(startTime) : null });

  type Item = {
    key: string;
    label: string;
    icon: typeof CheckCheck;
    run: () => void;
    danger?: boolean;
  };

  const items: Item[] = [];

  /* Both outcomes travel together, and both wait: a meeting still ahead cannot
     have been missed any more than it can have been held. Gating only the
     visible button would leave the impossible action one click deeper. */
  if (awaiting && onSetStatus) {
    items.push({
      key: 'no_show',
      label: t('crm.booking.status.no_show') || 'No show',
      icon: UserX,
      run: () => onSetStatus('no_show'),
    });
  }

  /* Calling it off stays available while it is open, before or after the fact. */
  if (!settled && onSetStatus) {
    items.push({
      key: 'cancelled',
      label: t('crm.booking.status.cancelled') || 'Cancel',
      icon: XCircle,
      run: () => onSetStatus('cancelled'),
      danger: true,
    });
  }

  /* A meeting can be moved whatever its state — including one already marked,
     which is how a mistaken outcome gets corrected by rebooking. */
  if (onReschedule) {
    items.push({
      key: 'reschedule',
      label: t('crm.booking.reschedule') || 'Reschedule',
      icon: CalendarClock,
      run: onReschedule,
    });
  }

  const showsPrimary = awaiting && Boolean(onSetStatus);

  if (!showsPrimary && items.length === 0) return null;

  return (
    <span className="ms-auto flex shrink-0 items-center gap-1">
      {/* An INSTRUCTION, not a statement of fact.

          It read "הפגישה התקיימה" — the meeting took place — which is what the
          card says AFTER you press it. On the button it describes a state
          rather than asking for one, and sits in a row of controls that all
          name actions. `crm.stage.mark_done` is the imperative the payment
          stages already use for the same gesture. */}
      {showsPrimary && (
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            onSetStatus?.('completed');
          }}
          className="rounded-full px-2 py-0.5 text-[11.5px] font-medium text-green-700 transition-colors hover:bg-green-500/10 dark:text-green-400"
        >
          {t('crm.stage.mark_done') || 'Mark done'}
        </button>
      )}

      {items.length > 0 && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            ref={triggerRef}
            onClick={event => {
              event.stopPropagation();
              if (!open) setUp(shouldOpenUpward(triggerRef.current, items.length));
              setOpen(value => !value);
            }}
            aria-haspopup="menu"
            aria-expanded={open}
            title={t('common.actions') || 'Actions'}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--v2-text-muted)] transition-colors hover:bg-[var(--v2-border)] hover:text-[var(--v2-text-primary)]"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>

            {/*
              `end-0` in BOTH directions, which is not a bug.

              The trigger sits at the row's inline END — the right in English, the
              left in Hebrew. Anchoring the menu's inline-end to the trigger's
              makes it grow INWARD, across the row it belongs to, in either
              script. Flipping to `start-0` for RTL sent it off the card's left
              edge, where the drawer cut it to a strip of icons.
            */}
          {open && (
            <div
              role="menu"
              className={`absolute end-0 z-20 min-w-[160px] overflow-hidden rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] shadow-lg ${
                up ? 'bottom-full mb-1' : 'top-full mt-1'
              }`}
            >
              {items.map(item => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  onClick={event => {
                    event.stopPropagation();
                    setOpen(false);
                    item.run();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] transition-colors hover:bg-[var(--v2-surface-hover)] ${
                    item.danger ? 'text-red-600 dark:text-red-400' : 'text-[var(--v2-text-secondary)]'
                  }`}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
