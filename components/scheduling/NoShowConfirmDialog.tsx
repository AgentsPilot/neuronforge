'use client';

/**
 * Confirming that a client did not attend — and deciding whether to say so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A DIALOG AND NOT A BUTTON
 *
 * Marking a no-show is not a status change like "completed". It is a JUDGEMENT
 * recorded against a person, it lands on their CRM timeline, and it feeds the
 * no-show-rate insight. A mis-click writes a small accusation into a client's
 * history, so it is worth one deliberate confirmation.
 *
 * WHY THE EMAIL TOGGLE STARTS OFF
 *
 * The owner knows what this system never will: whether the client rang ahead,
 * is in hospital, went to the wrong address, or actually did turn up and the
 * status is a slip. An email sent automatically spends that knowledge before
 * anyone is asked for it.
 *
 * The two mistakes are also not equally bad. Not sending costs one rebooking,
 * and the owner can still pick up the phone. Sending wrongly tells somebody who
 * was at a funeral that they failed to turn up — and for a therapist or a
 * clinic, that is not a bad email, it is a lost client.
 *
 * So: off by default, ticked knowingly, per booking.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import { Loader2, UserX } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/business-os/LanguageContext';

/**
 * One switch, in a dialog that now asks two questions.
 *
 * Extracted rather than copied because the knob's placement carries a fix for
 * a real bug (below), and two copies of it are two things to get right the
 * next time either is touched.
 */
function OutcomeSwitch({
  checked,
  onToggle,
  disabled,
  label,
  description,
  isRTL,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
  label: string;
  description: string;
  isRTL: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      disabled={disabled}
      className="w-full flex items-start justify-between gap-3 p-3 text-start bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors disabled:opacity-50"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
    >
      <span className="flex-1">
        <span className="block text-sm font-medium text-[var(--v2-text-primary)]">{label}</span>
        <span className="block text-xs text-[var(--v2-text-muted)] mt-0.5">{description}</span>
      </span>

      <span
        className={`mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 transition-colors ${
          checked ? 'bg-[#14B8A6]' : 'bg-[var(--v2-border)]'
        }`}
        style={{ borderRadius: '9999px' }}
      >
        {/* ── THE KNOB, IN BOTH DIRECTIONS ────────────────────────────
            It was `absolute` with no inset, sliding by
            `translate-x-[18px]`. Positive X is RIGHTWARD whatever the
            writing direction, so in Hebrew the knob started at the right
            edge and slid further right, off the end of its own track —
            leaving a toggle that could not be read as on or off.

            `insetInlineStart` places it at the start edge in either
            direction, and the travel is signed by `isRTL`, which this
            component already has for the dialog's own `dir`. Written
            inline rather than as an `rtl:` utility so it cannot depend
            on which Tailwind variants this project has enabled. */}
        <span
          className="absolute top-0.5 h-4 w-4 bg-white transition-transform"
          style={{
            borderRadius: '9999px',
            insetInlineStart: '2px',
            transform: checked ? `translateX(${isRTL ? -18 : 18}px)` : 'translateX(0)',
          }}
        />
      </span>
    </button>
  );
}

interface NoShowConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The client's name, so the dialog names who this is about. */
  clientName?: string | null;
  /**
   * Whether this session has money of its own still to decide.
   *
   * True for a package session carrying an unbilled stage, where the missed
   * hour either bills or is waived. False for an ordinary booking, which was
   * invoiced when it was made: there the question is already answered and the
   * toggle is not shown.
   */
  chargeable?: boolean;
  /**
   * The make-up session this no-show makes room for, where one is possible.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Same shape and same rule as the cancellation dialog's, with one difference
   * that matters to the money rather than to this control: a cancelled session
   * hands its portion of the payment to whatever replaces it, while a no-show
   * KEEPS its portion — the hour was held and the owner waited. So a make-up
   * offered here is free, and is the owner's to give.
   *
   * `proposedStart` is shown before they agree, because ticking it books that
   * hour and tells the client. Null hides the toggle.
   * ───────────────────────────────────────────────────────────────────────────
   */
  replacement?: {
    proposedStart: string;
    /**
     * The proposal and the rhythm's next free beats after it, proposal first.
     *
     * The rhythm can be right about the pattern and wrong about the week. With
     * one date the owner's only answer to "not that day" was to decline the
     * make-up and place it by hand.
     */
    options?: string[];
  } | null;
  /** Receives the owner's choice. Resolves when the change has been applied. */
  onConfirm: (options: {
    notifyClient: boolean;
    chargeSession: boolean;
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

export function NoShowConfirmDialog({
  open,
  onOpenChange,
  clientName,
  chargeable = false,
  replacement,
  onConfirm,
}: NoShowConfirmDialogProps) {
  const { t, isRTL } = useLanguage();
  const [notifyClient, setNotifyClient] = useState(false);
  /* OFF by default: this one books a real hour, so the owner opts in. The
     same reasoning as the cancellation dialog's replacement toggle. */
  const [addReplacement, setAddReplacement] = useState(false);
  /* The proposal until they say otherwise; re-seeded per session. */
  const [chosenStart, setChosenStart] = useState(replacement?.proposedStart ?? '');
  useEffect(() => {
    setChosenStart(replacement?.proposedStart ?? '');
  }, [replacement?.proposedStart]);

  /*
   * ── THE TWO OFFERS ARE ALTERNATIVES, NOT A PAIR ─────────────────────────
   *
   * "Invite them to rebook" asks the CLIENT to pick an hour. "Add a make-up"
   * books one FOR them. Both on, the client receives a session already in
   * their calendar and, in the same breath, a link inviting them to choose a
   * different time — two hours arranged for one missed session.
   *
   * So taking either offer puts the other down. The owner can still turn the
   * first back on, which turns this one off; they are a choice, and the dialog
   * says so by only ever holding one of them.
   */
  const chooseReplacement = (next: boolean) => {
    setAddReplacement(next);
    if (next) setNotifyClient(false);
  };

  const chooseInvite = (next: boolean) => {
    setNotifyClient(next);
    if (next) setAddReplacement(false);
  };
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * CHARGING STARTS ON, WHICH IS THE OPPOSITE OF THE EMAIL ABOVE IT.
   *
   * The two defaults are not inconsistent, they follow the same rule: default
   * to the answer that is right more often and whose error is cheaper.
   *
   * For the email, sending wrongly can cost a client, so it starts off. For the
   * money, the hour WAS held and nobody came, which is chargeable in almost
   * every service business. And the two failures are nothing alike: a waiver
   * taken by accident is a stage voided and a plan total lowered, silently, for
   * work the owner intended to be paid for — and the only trace is a figure
   * that quietly got smaller. Billing by accident is visible immediately, to
   * both sides, and is undone by a refund.
   *
   * Doing nothing therefore bills. One tap waives it, in front of the owner,
   * every time — rather than a toggle they have to remember to find.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [chargeSession, setChargeSession] = useState(true);
  const [working, setWorking] = useState(false);

  const confirm = async () => {
    setWorking(true);
    try {
      await onConfirm({
        notifyClient,
        chargeSession,
        /* Never true without an hour to put it in. */
        addReplacement: Boolean(replacement) && addReplacement,
        replacementStart: chosenStart || replacement?.proposedStart,
      });
      onOpenChange(false);
      // Back to the defaults for the next booking: a choice made about one
      // client must never be applied silently to the next. That cuts both
      // ways, so a waiver does not carry over either.
      setNotifyClient(false);
      setChargeSession(true);
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
            <UserX className="w-5 h-5 text-[var(--v2-text-muted)]" />
            {t('scheduling.no_show.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="py-3 space-y-4">
          {/* ── THE NAME IN BOLD ────────────────────────────────────────────
              This records that a named person did not turn up, it goes on
              their timeline, and it counts against their no-show rate. The
              sentence runs it together with the rest of the prose, so the one
              fact worth checking before confirming — WHO — reads at the same
              weight as the explanation around it.

              Split on the placeholder rather than interpolated, so the name is
              its own element and can carry weight. `bdi` because a Latin name
              inside a Hebrew sentence is reordered without it, which on a
              confirmation naming a client is the worst place for it.

              Falls back to the plain sentence when there is no name, exactly
              as before. */}
          <p className="text-sm text-[var(--v2-text-secondary)]">
            {clientName
              ? (() => {
                  /* Split on the PLACEHOLDER rather than a sentinel. Feeding
                     `{name}` back in leaves it in the string, so the split
                     lands exactly where the name belongs — with no control
                     character in the source, and no chance of a space-like
                     mark shattering the sentence into every word. */
                  const MARK = '{name}';
                  const [before, after] = t('scheduling.no_show.confirm_named', { name: MARK })
                    .split(MARK);
                  // A translation that dropped the placeholder leaves one part;
                  // show it as written rather than losing the name entirely.
                  return after === undefined ? (
                    t('scheduling.no_show.confirm_named', { name: clientName })
                  ) : (
                    <>
                      {before}
                      <bdi className="font-semibold text-[var(--v2-text-primary)]">{clientName}</bdi>
                      {after}
                    </>
                  );
                })()
              : t('scheduling.no_show.confirm')}
          </p>

          {/* Each toggle says what it will actually do, beside itself. */}
          <OutcomeSwitch
            checked={notifyClient}
            onToggle={() => chooseInvite(!notifyClient)}
            disabled={working}
            label={t('scheduling.no_show.notify_label')}
            description={t('scheduling.no_show.notify_description')}
            isRTL={isRTL}
          />

          {/*
            ── CHARGING FOR THE HOUR NOBODY CAME TO ──────────────────────────
            Shown only where there is something to charge: a package session
            carrying its own unbilled stage. An ordinary booking was invoiced
            when it was made, so a toggle here would promise a decision that
            has already been taken.
          */}
          {chargeable && (
            <OutcomeSwitch
              checked={chargeSession}
              onToggle={() => setChargeSession(v => !v)}
              disabled={working}
              label={t('scheduling.no_show.charge_label')}
              description={t('scheduling.no_show.charge_description')}
              isRTL={isRTL}
            />
          )}

          {/*
            ── A MAKE-UP FOR THE HOUR NOBODY CAME TO ─────────────────────────
            Offered only where the block can still take another session. The
            date is in the description, because ticking this books that hour
            and tells the client: the owner is agreeing to something they can
            see rather than to a rule they have to remember.

            A make-up after a no-show is FREE, and deliberately so. The missed
            session keeps its portion of the payment — the hour was held and
            nobody came — so the replacement carries none. That is the owner's
            to give, which is exactly why it is a toggle and not automatic.
          */}
          {replacement && (
            <OutcomeSwitch
              checked={addReplacement}
              onToggle={() => chooseReplacement(!addReplacement)}
              disabled={working}
              label={t('scheduling.no_show.replace_label') || 'Add a make-up session?'}
              description={
                addReplacement
                  ? `${t('scheduling.no_show.replace_on_hint') || 'It will be booked for'} ${new Date(
                      chosenStart || replacement.proposedStart
                    ).toLocaleString(isRTL ? 'he-IL' : 'en-GB', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : t('scheduling.no_show.replace_off_hint') ||
                    'The missed session is not made up.'
              }
              isRTL={isRTL}
            />
          )}

          {/*
            * "Not that day." The rhythm's next free beats, same weekday and
            * hour, so the owner is choosing WHICH WEEK — the question they
            * actually have. Only once a make-up is agreed and only when there
            * is more than one to choose between: a list of one implies the
            * others were unavailable rather than absent.
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
                  {t('scheduling.no_show.replace_pick') || 'Or choose another date'}
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
                  {t('scheduling.no_show.replace_any') || 'Or pick any date and time'}
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
        </div>

        <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={working}
            className="px-5 py-2.5 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {t('common.cancel') || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={working}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[var(--v2-primary)] hover:opacity-90 transition-all disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
            {t('scheduling.no_show.confirm_action')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
