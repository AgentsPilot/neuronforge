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
import { isEarlySessionOutcomeEnabled } from '@/lib/utils/featureFlags';
import { CalendarClock, CheckCheck, MoreHorizontal, RotateCcw, UserX, XCircle } from 'lucide-react';

import { shouldOpenUpward } from './menuPlacement';

import { isMeetingPastDue } from '@/lib/business-os/quoteGate';

interface MeetingRowActionsProps {
  /** `scheduling_bookings.status` for this one meeting. */
  status: string;
  /**
   * `scheduling_bookings.meeting_status` for this one meeting.
   *
   * The three marks live here now. Without it this row kept offering "mark
   * done", "no show" and "cancel" for a meeting the owner had already marked,
   * because `complete()` leaves `status` at `confirmed`.
   */
  meetingStatus?: string | null;
  /**
   * WHO recorded that outcome — and the only reason this component needs it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A meeting the OWNER marked held is settled: they were there, and the row
   * deliberately offers nothing except a way to move it.
   *
   * A meeting the AUTOMATION marked held is a guess. `auto_complete_meetings`
   * closes off a past meeting twelve hours after it was due, and "held" is the
   * only answer it can give — no-show and called-off are judgements about a
   * room it was not in. The date passing is not evidence the meeting happened.
   *
   * So a system-held row keeps all three answers open, and — because the
   * automation deliberately does NOT bill — it also carries the one action
   * that is otherwise unreachable: confirming it, which is what raises the
   * invoice. The owner double-checks, then charges.
   * ───────────────────────────────────────────────────────────────────────────
   */
  outcomeBy?: 'owner' | 'client' | 'system' | null;
  /**
   * Its invoice has already been raised.
   *
   * Only narrows the system-held CONFIRMATION, which is defined as the gesture
   * that raises that invoice — once it exists there is nothing left to
   * confirm, and a button still offering to send it is describing work it
   * cannot do. The Needs-you card can raise it from the other side
   * (`bill_stage`), and `billStage` does not touch the meeting, so this row
   * would otherwise keep asking for a decision the owner already made
   * somewhere else.
   *
   * The corrections stay: discovering afterwards that the hour never happened
   * is exactly when a no-show matters, and the refund path is built for it.
   */
  alreadyBilled?: boolean;
  /** The meeting's own start, which decides whether it can have an outcome. */
  startTime: string | null;
  /** Records an outcome. Absent in a read-only drawer. */
  onSetStatus?: (status: 'completed' | 'no_show' | 'cancelled') => void;
  /** Opens the reschedule flow. */
  onReschedule?: () => void;
  /**
   * The JOB this appointment belongs to has been called off.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Distinct from the row's own state, and it has to be. A missed session is
   * deliberately still movable — somebody did not turn up and the obvious next
   * move is another time — so `no_show` is absent from `calledOff` below, by
   * design.
   *
   * But once the whole package is off, moving one of its hours is offering an
   * appointment that cannot happen. The row still reads לא הגיע, which is true,
   * and only this says the work around it has stopped.
   *
   * Defaults to false, so every caller that does not know stays exactly as it
   * was.
   * ───────────────────────────────────────────────────────────────────────────
   */
  bookingCancelled?: boolean;
  /**
   * Returns the money taken for THIS meeting.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * On a package billed per meeting, marking one held raises its own invoice —
   * so each meeting can hold money of its own, and undoing that was reachable
   * only from the payments list several levels away, where six meetings of the
   * same package look like six near-identical rows.
   *
   * Passed up like every other write in this drawer: the parent owns the refund
   * dialog, and the row only says which money is meant. Absent when there is
   * nothing to return, which is also how the item stays off the menu — see
   * `refundable` below for why that is a prop and not a calculation here.
   * ───────────────────────────────────────────────────────────────────────────
   */
  onRefund?: () => void;
  /**
   * Whether anything is actually left to return.
   *
   * Decided by the caller, which is the only place that holds the payment: this
   * component is given a meeting's STATUS, not its money. A meeting that was
   * paid and then fully refunded must stop offering it, or the owner is invited
   * to return money that has already gone back.
   */
  refundable?: boolean;
  t: (key: string) => string;
}

export function MeetingRowActions({
  status,
  meetingStatus,
  outcomeBy,
  alreadyBilled,
  startTime,
  onSetStatus,
  onReschedule,
  bookingCancelled = false,
  onRefund,
  refundable,
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
  const settled =
    meetingStatus != null ||
    status === 'completed' ||
    status === 'cancelled' ||
    status === 'no_show';

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * SETTLED BY A CLOCK, WHICH IS NOT THE SAME AS SETTLED.
   *
   * `auto_complete_meetings` marks a past meeting held once it is overdue. It
   * has to pick something, and "held" is the only answer available to it:
   * no-show and called-off are judgements about a room it was not in. So
   * `settled` is true here on the strength of the date having passed — and the
   * date passing is not evidence the meeting happened.
   *
   * That is why the Needs-you card flags these rows, and this is where the
   * owner answers it. Everything the automation closed stays open to them:
   * both outcomes it could not choose between, and the one the owner alone can
   * give, which is confirming it — because the automation deliberately does
   * NOT bill, so a system-held session has never been invoiced. The money is
   * waiting on a person saying the hour was real.
   *
   * `outcome_by` is how the row knows. It has carried the actor since
   * migration 20261078; `complete()` writes `'system'` on this path and the
   * owner's own route writes `'owner'` — so confirming here flips it, and the
   * row stops offering a correction it no longer needs.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const systemHeld =
    outcomeBy === 'system' && (meetingStatus === 'held' || status === 'completed');

  /*
   * Its time has passed and nobody has said what happened — the same rule the
   * badge and the session card use, so a row offering "mark done" and a badge
   * saying "awaiting an outcome" can never disagree about one booking.
   */
  const awaiting =
    isMeetingPastDue({
      status,
      meetingStatus,
      startTime: startTime ? new Date(startTime) : null,
    }) ||
    /*
     * TEMPORARY, FOR TESTING — `NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME`.
     *
     * Marking a session held is what raises and emails its invoice, and the
     * refund it then allows is the next link in the same chain. Neither can be
     * exercised until a session's hour has passed, which on a six-week package
     * is weeks away — so the money path could not be walked at all.
     *
     * It opens the control and nothing else: the server never checked the
     * clock, so everything downstream is the real path. Off in production, for
     * the reason the gate exists — a stray tap on a session three weeks out
     * bills a client for work nobody has done.
     */
    (isEarlySessionOutcomeEnabled() && meetingStatus == null && !settled) ||
    /* Marked by a clock, not by a person — still an open question. */
    systemHeld;

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

  /* Calling it off stays available while it is open, before or after the fact —
     and on a row the automation closed, which is open in everything but name. */
  if ((!settled || systemHeld) && onSetStatus) {
    items.push({
      key: 'cancelled',
      /*
       * The ACTION, not the state. `status.cancelled` is "בוטלה" — the word a
       * row carries once it HAS been called off — and a menu item reading it
       * says the thing has already happened rather than offering to do it.
       */
      label: t('crm.booking.action.cancel_meeting') || 'Cancel meeting',
      icon: XCircle,
      run: () => onSetStatus('cancelled'),
      danger: true,
    });
  }

  /*
   * Only while something is left to return, which is the same rule the payment
   * stages use — a fully refunded meeting stops offering it, and the row's own
   * amount already says the money went back.
   *
   * Placed before "reschedule" and after the outcomes on purpose: it belongs
   * with the things that undo, and it must not sit next to the trigger where
   * `no_show` and `cancelled` live, because those three are a mis-tap away from
   * each other and only one of them moves real money.
   */
  if (refundable && onRefund) {
    items.push({
      key: 'refund',
      label: t('payments.refund') || 'Refund',
      icon: RotateCcw,
      run: onRefund,
    });
  }

  /*
   * A meeting can be moved until it has HAPPENED or been CALLED OFF.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * It used to be offered whatever the state, on the reasoning that rebooking
   * is how a mistaken outcome gets corrected. That was narrowed once, to
   * exclude a meeting already held, and again to exclude one called off.
   *
   * The two settled outcomes are not the same thing, and the owner's decision
   * is what separates them:
   *
   *   · MISSED — the client did not turn up, nobody decided anything, and the
   *     ordinary next move is another attempt at that session. Still movable.
   *
   *   · CALLED OFF — the owner decided this hour is not happening. Offering to
   *     move it invites undoing a decision through a control that says
   *     something else, and the row has just told the client it is off. A
   *     session that should come back is a new one, deliberately.
   *
   * On a package billed per meeting, marking one held is what RAISES AND EMAILS
   * ITS INVOICE. Moving the date afterwards leaves the booking and the invoice
   * the client is holding on two different days, and the invoice is the
   * document that settles it.
   *
   * Nor did it achieve what it was there for: nothing in this menu undoes
   * "held", so changing the date never un-held anything. A make-up session is
   * what that need actually wants, and the package adds one of those.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const held = status === 'completed' || meetingStatus === 'held';
  const calledOff =
    status === 'cancelled' || meetingStatus === 'cancelled' || bookingCancelled;

  if (onReschedule && !held && !calledOff) {
    items.push({
      key: 'reschedule',
      label: t('crm.booking.reschedule') || 'Reschedule',
      icon: CalendarClock,
      run: onReschedule,
    });
  }

  const showsPrimary =
    awaiting && Boolean(onSetStatus) && !(systemHeld && alreadyBilled);

  const primaryLabel = systemHeld
    ? t('crm.booking.action.confirm_held') || 'Confirm it was held and bill'
    : t('crm.stage.mark_done') || 'Mark done';

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
        /*
         * ───────────────────────────────────────────────────────────────────
         * AN ICON, BECAUSE IT SHARES A ROW WITH A TABLE'S COLUMNS.
         *
         * The words were "סימון כהושלם", and a label that long in the actions
         * cell pushed the column wide on the rows that had one and left it
         * narrow on the rows that did not — so the table's right edge stepped
         * in and out down the list and the rows that could be marked were
         * visibly taller than the rest.
         *
         * The same square as the ⋯ beside it, so every row is one height and
         * the column is one width whatever a row can do. The words move to
         * the tooltip and the accessible name, which is where a control with
         * an obvious icon keeps them.
         * ───────────────────────────────────────────────────────────────────
         */
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            onSetStatus?.('completed');
          }}
          /* On a row the automation closed, this button is not "mark done" —
             the row ALREADY says held. It is the owner agreeing with it, and
             agreeing is what raises the invoice the automation withheld. The
             accessible name has to say that, or the one control that moves
             money announces itself as a status change. */
          title={primaryLabel}
          aria-label={primaryLabel}
          className="flex h-6 w-6 items-center justify-center rounded text-green-700 transition-colors hover:bg-green-500/10 dark:text-green-400"
        >
          <CheckCheck className="h-3.5 w-3.5" />
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
