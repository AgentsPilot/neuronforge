'use client';

/**
 * Call off the appointment, and settle what the client is told.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS ASKS A QUESTION RATHER THAN JUST CONFIRMING
 *
 * Cancelling a meeting on a quoted job leaves something genuinely undecided,
 * and only the owner knows the answer: is the quote still coming?
 *
 * The email cannot work it out. "No proposal exists yet" reads as *not yet
 * written* and as *never going to be* in exactly the same data, and the client
 * receives an opposite message in the two cases — one says a quote is on its
 * way, the other says the business is stepping back. Inferring it would mean
 * guessing which, and sending the guess.
 *
 * So the toggle is the answer, and it defaults to ON: proceeding without
 * meeting is the whole reason this route exists, as opposed to stopping the
 * job, which is a different button.
 *
 * A booking whose meeting IS the thing bought has no such question — there is
 * no quote to continue — so the toggle is simply absent and this is an
 * ordinary confirmation.
 *
 * Modelled on `NoShowConfirmDialog`, down to the knob's signed travel: positive
 * X is rightward whatever the writing direction, so in Hebrew an unsigned
 * transform slides the knob off the end of its own track.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import { Loader2, CalendarX } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface CancelMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The client's name, so the dialog names who this is about. */
  clientName?: string | null;
  /**
   * Is there a quote in play at all?
   *
   * `sale_mode: 'proposal'` and not a package session. False hides the toggle
   * entirely rather than showing a question with no subject.
   */
  isQuoted: boolean;
  /**
   * The replacement this cancellation makes room for, where one is possible.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Present only for a session of a package that can still take another hour —
   * the caller decides that, from the same rule the add-session route enforces:
   * a block never grows past the count it was sold with, but calling one off
   * frees its place.
   *
   * `proposedStart` is shown to the owner BEFORE they agree. A toggle that
   * silently booked an hour would be the one control on this screen whose
   * effect the owner could not see, and the hour it picks is read from the
   * block's rhythm rather than chosen by them.
   *
   * Null hides the toggle entirely, which is every ordinary booking.
   * ───────────────────────────────────────────────────────────────────────────
   */
  replacement?: {
    proposedStart: string;
    /**
     * The proposal and the rhythm's next free beats after it, proposal first.
     *
     * The rhythm can be right about the pattern and wrong about the week: the
     * owner is away, the room is taken by something this app cannot see, or
     * the client simply cannot make that day. With one date the only answer
     * was to decline the replacement and place it by hand, which is the long
     * way round for "not that Tuesday, the one after".
     *
     * Absent or single is the old behaviour exactly: the hint reads as a
     * statement and nothing is choosable.
     */
    options?: string[];
  } | null;
  /** Receives the owner's answer. Resolves when the change has been applied. */
  onConfirm: (options: {
    proposalContinues: boolean;
    addReplacement: boolean;
    /** The hour the owner settled on. The proposal unless they picked another. */
    replacementStart?: string;
  }) => Promise<void>;
}

/**
 * An instant, as the value a `datetime-local` input wants.
 *
 * That input speaks wall time with no zone, so it has to be given the owner's
 * local reading of the instant — `toISOString()` would hand it UTC and the
 * field would show an hour nobody chose. The reverse trip is `new Date(value)`,
 * which reads the same wall time back in the same zone.
 */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function CancelMeetingDialog({
  open,
  onOpenChange,
  clientName,
  isQuoted,
  replacement,
  onConfirm,
}: CancelMeetingDialogProps) {
  const { t, isRTL } = useLanguage();
  /* ON by default: see the note above. */
  const [proposalContinues, setProposalContinues] = useState(true);
  /*
   * OFF by default, unlike the toggle above.
   *
   * That one chooses between two messages and something is said either way.
   * This one BOOKS AN HOUR — it puts a real appointment in the diary and tells
   * the client about it. A default that acts is the wrong default for an
   * action the owner may not have come here to take; they tick it when they
   * mean it.
   */
  const [addReplacement, setAddReplacement] = useState(false);
  /*
   * Which hour the replacement takes. The proposal until they say otherwise.
   *
   * Keyed off `proposedStart` so re-opening the dialog for a different session
   * starts from that session's proposal rather than the last one's choice.
   */
  const [chosenStart, setChosenStart] = useState(replacement?.proposedStart ?? '');
  useEffect(() => {
    setChosenStart(replacement?.proposedStart ?? '');
  }, [replacement?.proposedStart]);
  const [working, setWorking] = useState(false);

  const confirm = async () => {
    setWorking(true);
    try {
      await onConfirm({
        proposalContinues: isQuoted ? proposalContinues : true,
        /* Never true without an hour to put it in. */
        addReplacement: Boolean(replacement) && addReplacement,
        replacementStart: chosenStart || replacement?.proposedStart,
      });
      onOpenChange(false);
      /* Back to the defaults for the next booking. An answer given about one
         client must never be applied silently to the next. */
      setProposalContinues(true);
      setAddReplacement(false);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => !working && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarX className="w-5 h-5 text-[var(--v2-text-muted)]" />
            {t('scheduling.cancel_meeting.title') || 'Cancel the meeting'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-3 space-y-4">
          {/* The name in bold, and `bdi` so a Latin name inside a Hebrew
              sentence is not reordered — the same reasoning as the no-show
              dialog, which is where this pattern comes from. */}
          <p className="text-sm text-[var(--v2-text-secondary)]">
            {clientName
              ? (() => {
                  const MARK = '{name}';
                  const [before, after] = (
                    t('scheduling.cancel_meeting.confirm_named', { name: MARK }) || ''
                  ).split(MARK);
                  return after === undefined ? (
                    t('scheduling.cancel_meeting.confirm_named', { name: clientName })
                  ) : (
                    <>
                      {before}
                      <bdi className="font-semibold text-[var(--v2-text-primary)]">{clientName}</bdi>
                      {after}
                    </>
                  );
                })()
              : t('scheduling.cancel_meeting.confirm')}
          </p>

          {/* ── ONLY WHERE THERE IS A QUOTE TO CONTINUE ──────────────────── */}
          {isQuoted && (
            <button
              type="button"
              role="switch"
              aria-checked={proposalContinues}
              onClick={() => setProposalContinues(v => !v)}
              disabled={working}
              className="w-full flex items-start justify-between gap-3 p-3 text-start bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors disabled:opacity-50"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <span className="flex-1">
                <span className="block text-sm font-medium text-[var(--v2-text-primary)]">
                  {/* A QUESTION, not a statement. It reads as a label
                      describing the booking otherwise, and the owner is being
                      asked to decide — the hint below then says what their
                      answer will put in front of the client. */}
                  {t('scheduling.cancel_meeting.proposal_label') ||
                    'Is the quote still going ahead?'}
                </span>
                {/* What the CLIENT will read, not a restatement of the label.
                    The owner is choosing between two messages, so the dialog
                    shows which one they are choosing. */}
                <span className="block text-xs text-[var(--v2-text-muted)] mt-0.5">
                  {proposalContinues
                    ? t('scheduling.cancel_meeting.proposal_on_hint')
                    : t('scheduling.cancel_meeting.proposal_off_hint')}
                </span>
              </span>

              <span
                className={`mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 transition-colors ${
                  proposalContinues ? 'bg-[#14B8A6]' : 'bg-[var(--v2-border)]'
                }`}
                style={{ borderRadius: '9999px' }}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 bg-white transition-transform"
                  style={{
                    borderRadius: '9999px',
                    insetInlineStart: '2px',
                    transform: proposalContinues
                      ? `translateX(${isRTL ? -18 : 18}px)`
                      : 'translateX(0)',
                  }}
                />
              </span>
            </button>
          )}

          {/*
            * ── "NOT THAT DAY" ────────────────────────────────────────────
            *
            * Outside the switch, because a button cannot contain buttons —
            * nesting them is invalid and leaves a screen reader describing a
            * control that contains controls.
            *
            * Shown only once the owner has agreed to a replacement AND there
            * is more than one hour to choose between. A single option is not a
            * choice, and drawing a list of one would imply the others were
            * unavailable rather than absent.
            *
            * These are the rhythm's own next free beats, so every one of them
            * keeps the block's weekday and time of day. The owner is choosing
            * WHICH week, which is the question they actually have.
            */}
          {replacement && addReplacement && (
            <div className="mt-2">
              {/*
                * Suggestions are hidden when there is only one: a list of one is
                * not a choice, and reads as though the others were unavailable
                * rather than absent. The free picker below is always there.
                */}
              {(replacement.options?.length ?? 0) > 1 && (
                <>
                <p className="mb-1.5 text-xs text-[var(--v2-text-muted)]">
                  {t('scheduling.cancel_meeting.replace_pick') || 'Or choose another date'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {replacement.options!.map(iso => {
                    const picked = (chosenStart || replacement.proposedStart) === iso;
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => setChosenStart(iso)}
                        disabled={working}
                        aria-pressed={picked}
                        className="px-2.5 py-1.5 text-xs font-medium border transition-colors disabled:opacity-50"
                        style={{
                          borderRadius: 'var(--v2-radius-button)',
                          borderColor: picked ? 'var(--v2-primary)' : 'var(--v2-border)',
                          background: picked ? 'var(--v2-primary)' : 'var(--v2-bg)',
                          color: picked ? '#fff' : 'var(--v2-text-primary)',
                        }}
                      >
                        <bdi>
                          {new Date(iso).toLocaleString(isRTL ? 'he-IL' : 'en-GB', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </bdi>
                      </button>
                    );
                  })}
                </div>
                </>
              )}

              {/*
                * ── AND ANY OTHER HOUR ──────────────────────────────────────
                *
                * The suggestions are the block's own rhythm stepped forward
                * from its LAST session, which is where a replacement usually
                * belongs and is not where it always can go. A client who can
                * only do a Thursday, a gap mid-block the owner would rather
                * fill, a week that suits both — none of those are beats of the
                * rhythm, and offering only beats made the owner close the
                * dialog and place the session by hand.
                *
                * Nothing here needs guarding that is not already guarded: the
                * add route takes any instant, refuses an overlap on a database
                * constraint (`scheduling_meetings_no_overlap`), refuses a
                * closed day unless told otherwise, and refuses a block that is
                * already complete. The picker widens what can be ASKED for,
                * not what can be written.
                */}
              <label className="mt-2 block">
                <span className="block text-xs text-[var(--v2-text-muted)] mb-1">
                  {t('scheduling.cancel_meeting.replace_any') || 'Or pick any date and time'}
                </span>
                <input
                  type="datetime-local"
                  value={toLocalInput(chosenStart || replacement.proposedStart)}
                  onChange={event => {
                    const next = event.target.value;
                    if (!next) return;
                    const parsed = new Date(next);
                    if (!Number.isNaN(parsed.getTime())) setChosenStart(parsed.toISOString());
                  }}
                  disabled={working}
                  className="w-full px-2.5 py-1.5 text-xs border bg-[var(--v2-bg)] text-[var(--v2-text-primary)] disabled:opacity-50"
                  style={{
                    borderRadius: 'var(--v2-radius-button)',
                    borderColor: 'var(--v2-border)',
                  }}
                />
              </label>
            </div>
          )}

          {/* ── A REPLACEMENT FOR THE HOUR BEING GIVEN BACK ───────────────────
              Only where the block can still take one. The date is on the face
              of the control, because ticking it books that hour and tells the
              client — the owner must be agreeing to something they can see.
          */}
          {replacement && (
            <button
              type="button"
              role="switch"
              aria-checked={addReplacement}
              onClick={() => setAddReplacement(v => !v)}
              disabled={working}
              className="w-full flex items-start justify-between gap-3 p-3 text-start bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors disabled:opacity-50"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <span className="flex-1">
                <span className="block text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('scheduling.cancel_meeting.replace_label') ||
                    'Add a replacement session?'}
                </span>
                <span className="block text-xs text-[var(--v2-text-muted)] mt-0.5">
                  {addReplacement
                    ? /* The hour it will book, spelled out. `bdi` because a
                         date sits inside right-to-left copy. */
                      (t('scheduling.cancel_meeting.replace_on_hint') ||
                        'It will be booked for')
                    : t('scheduling.cancel_meeting.replace_off_hint') ||
                      'The block keeps its remaining sessions only.'}
                  {addReplacement && (
                    <>
                      {' '}
                      <bdi className="font-medium text-[var(--v2-text-primary)]">
                        {new Date(chosenStart || replacement.proposedStart).toLocaleString(
                          isRTL ? 'he-IL' : 'en-GB',
                          {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          }
                        )}
                      </bdi>
                    </>
                  )}
                </span>
              </span>

              <span
                className={`mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 transition-colors ${
                  addReplacement ? 'bg-[#14B8A6]' : 'bg-[var(--v2-border)]'
                }`}
                style={{ borderRadius: '9999px' }}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 bg-white transition-transform"
                  style={{
                    borderRadius: '9999px',
                    insetInlineStart: '2px',
                    transform: addReplacement
                      ? `translateX(${isRTL ? -18 : 18}px)`
                      : 'translateX(0)',
                  }}
                />
              </span>
            </button>
          )}
        </div>

        <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={working}
            className="px-5 py-2.5 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {/* NOT `common.cancel`. Beside a confirm button reading "Cancel
                the meeting", a dismiss button reading "Cancel" is two cancels
                that mean opposite things — in Hebrew both rendered as ביטול.
                This one goes back; the other one acts. */}
            {t('scheduling.cancel_meeting.dismiss') || 'Go back'}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={working}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[var(--v2-primary)] hover:opacity-90 transition-all disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {working ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CalendarX className="w-4 h-4" />
            )}
            {t('scheduling.cancel_meeting.confirm_action') || 'Cancel the meeting'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
