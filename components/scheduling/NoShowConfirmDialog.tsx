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
import {
  ArrowLeftRight,
  Banknote,
  CalendarPlus,
  Loader2,
  Mail,
  Minus,
  UserX,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import {
  ChoiceBar,
  DECISION_ACCENT,
  Hint,
  OutcomeLine,
  OutcomePanel,
  StepMark,
} from '@/components/scheduling/decisionDialogParts';




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
  /**
   * The replacement offer has not come back yet.
   *
   * It is fetched when the dialog opens, so for a moment `replacement` is
   * absent for a reason that has nothing to do with whether one is possible.
   * Without this the owner could confirm in that window and call a session
   * off believing no replacement was on offer — the control that would have
   * said otherwise simply had not rendered.
   */
  replacementLoading?: boolean;
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
  replacementLoading = false,
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
  /*
   * ── SO THE SCREEN SAYS IT, RATHER THAN ENFORCING IT BEHIND THE OWNER ─────
   *
   * The rule above was real and invisible: two switches, and pressing one
   * quietly released the other with nothing to explain why. An owner watching
   * a toggle they did not touch flick itself off reads it as a bug, and the
   * money switch sat between the two, changing what both of them meant.
   *
   * They are one question — WHO PICKS THE NEXT HOUR — so they are asked as
   * one, with three answers. Doing nothing is a real answer and comes first:
   * most no-shows are a conversation before they are a booking.
   *
   * Derived from the existing two booleans rather than held as a third piece
   * of state. `onConfirm` is unchanged, and there is no way for a new source
   * of truth to drift from the two the caller actually receives.
   */
  const nextStep: 'nothing' | 'client' | 'owner' = notifyClient
    ? 'client'
    : addReplacement
      ? 'owner'
      : 'nothing';

  const chooseNext = (step: 'nothing' | 'client' | 'owner') => {
    setNotifyClient(step === 'client');
    setAddReplacement(step === 'owner');
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
      {/*
        WIDER, AND ONLY THE MIDDLE SCROLLS.

        At `max-w-md` the two questions, the date picker and the summary ran to
        a column taller than the viewport, so the confirm button sat below the
        fold and the whole thing read as a form rather than a decision. The
        extra width lets the answers sit two and three across, which is what
        actually shortens it; `max-h` plus a scrolling body keeps the title and
        the buttons fixed where they can always be reached.
      */}
      <DialogContent
        /*
         * `flex` opts OUT of the base dialog's own mobile handling — it gives
         * the gutter and the scroll cap only to the non-flex branch, on the
         * reasoning that a flex caller lays itself out. So both are supplied
         * here: a 1rem margin each side on a phone, full width once there is
         * room, and a height cap with the scroll on the BODY so the title and
         * the two buttons stay reachable.
         *
         * The width is an inline style because `cn` is a plain join with no
         * tailwind-merge: a `max-w-…` class would land beside the base's
         * `max-w-lg` at equal specificity and source order would decide.
         */
        className="flex max-h-[86dvh] w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:w-full"
        style={{ maxWidth: '30rem' }}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/*
          PADDING, SECTION BY SECTION.

          The base dialog applies `p-4 sm:p-6` only to its NON-flex branch, on
          the same reasoning as the gutter and the scroll cap: a flex caller is
          laying itself out. Taking that branch without replacing the padding
          left every edge flush against the panel.

          Given per section rather than to the panel, so the body can scroll
          under a header and a footer that stay put — a single `p-6` on the
          shell would scroll the title away with the content.
        */}
        <DialogHeader className="flex-shrink-0 border-b border-[var(--v2-border)] px-5 pb-4 pe-12 pt-4">
          <DialogTitle className="flex items-center gap-2.5">
            {/* The glyph in a tinted tile rather than loose beside the words:
                it is the dialog's subject, and amber says "a decision is
                wanted here" before a single line is read. */}
            <span
              aria-hidden
              className="inline-grid h-8 w-8 flex-shrink-0 place-items-center"
              style={{
                borderRadius: 'var(--v2-radius-button)',
                color: DECISION_ACCENT,
                border: `1px solid color-mix(in srgb, ${DECISION_ACCENT} 40%, transparent)`,
                background: `color-mix(in srgb, ${DECISION_ACCENT} 13%, transparent)`,
              }}
            >
              <UserX className="h-4 w-4" />
            </span>
            {t('scheduling.no_show.title')}
          </DialogTitle>
        </DialogHeader>

        {/*
          ONE COLUMN. The two-column attempt put the summary in a sidebar that
          ran a third of the height and left a void beneath it, and the answers
          in a narrow strip beside it. Everything reads downwards now: what is
          recorded, the two questions, what will happen, the buttons.
        */}
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
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
          {/*
            A STATEMENT, SET APART FROM THE QUESTIONS BELOW IT.

            This is the one thing on the dialog that is not a decision — it is
            what pressing confirm records, whatever else is chosen. As a plain
            paragraph it read like an introduction and was skipped; the amber
            rule and tint give it the weight of a notice, and separate it from
            the two questions that follow.
          */}
          <p
            className="border-s-[3px] p-3 text-sm"
            style={{
              borderInlineStartColor: DECISION_ACCENT,
              background: `color-mix(in srgb, ${DECISION_ACCENT} 11%, transparent)`,
              borderRadius: 'var(--v2-radius-button)',
              color: 'var(--v2-text-secondary)',
            }}
          >
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

          {/*
            ── QUESTION ONE: THE MONEY ───────────────────────────────────────
            Asked on its own, and first, because it is the decision that cannot
            be undone quietly. Shown only where there IS something to charge: a
            package session carrying its own unbilled stage. An ordinary booking
            was invoiced when it was made, so asking here would offer a decision
            already taken.

            Still defaults to charging, for the reason set out above: an
            accidental waiver silently lowers a plan total, while an accidental
            charge is visible to both sides and undone by a refund.
          */}
          {chargeable && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-2 text-xs font-semibold text-[var(--v2-text-secondary)]">
                <StepMark n={1} />
                {t('scheduling.no_show.money_q')}
              </p>
              <ChoiceBar
                label={t('scheduling.no_show.money_q')}
                value={chargeSession ? 'charge' : 'waive'}
                onChoose={next => setChargeSession(next === 'charge')}
                disabled={working}
                options={[
                  { value: 'charge', label: t('scheduling.no_show.money_charge'), tone: 'keep' },
                  { value: 'waive', label: t('scheduling.no_show.money_waive'), tone: 'give' },
                ]}
              />
              <Hint>
                {chargeSession
                  ? t('scheduling.no_show.money_charge_hint')
                  : t('scheduling.no_show.money_waive_hint')}
              </Hint>
            </div>
          )}

          {/*
            A DISABLED BUTTON WITH NO EXPLANATION IS A BUG TO THE OWNER.

            The offer takes a moment to come back. Saying so, where the
            question will appear, is what turns a dead confirm button into
            something obviously temporary — and it holds the space so the
            dialog does not jump when the answer lands.
          */}
          {replacementLoading && (
            <p
              className="flex items-center gap-2 px-3 py-2.5 text-xs text-[var(--v2-text-muted)]"
              style={{
                borderRadius: 'var(--v2-radius-button)',
                border: '1px dashed var(--v2-border)',
              }}
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t('scheduling.no_show.replace_checking')}
            </p>
          )}

          {/*
            ── QUESTION TWO: WHO PICKS THE NEXT HOUR ─────────────────────────
            One question, because that is what it always was — see `chooseNext`.
            "Nothing yet" leads, and is the default: a no-show is usually a
            conversation before it is a booking, and the owner should not have
            to switch two things off to say so.

            The third answer appears only where the block can still take another
            session, so it is never an offer the package cannot honour.
          */}
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 text-xs font-semibold text-[var(--v2-text-secondary)]">
              {/* Numbered only when the money question is above it; on an
                  ordinary booking this is the only question there is. */}
              {chargeable && <StepMark n={2} />}
              {t('scheduling.no_show.next_q')}
            </p>

            <ChoiceBar
              label={t('scheduling.no_show.next_q')}
              value={nextStep}
              onChoose={chooseNext}
              disabled={working}
              /*
               * The third answer only where the block can still take another
               * session, so the bar never offers something the package cannot
               * honour — and is a clean two-up when it cannot.
               */
              options={
                replacement
                  ? [
                      { value: 'nothing', label: t('scheduling.no_show.next_nothing') },
                      { value: 'client', label: t('scheduling.no_show.next_client') },
                      { value: 'owner', label: t('scheduling.no_show.next_owner') },
                    ]
                  : [
                      { value: 'nothing', label: t('scheduling.no_show.next_nothing') },
                      { value: 'client', label: t('scheduling.no_show.next_client') },
                    ]
              }
            />

            <Hint>
              {nextStep === 'nothing' && t('scheduling.no_show.next_nothing_hint')}
              {nextStep === 'client' && t('scheduling.no_show.next_client_hint')}
              {/* The hour itself, because choosing this books it: the owner
                  agrees to something they can see, not to a rule. */}
              {nextStep === 'owner' &&
                replacement &&
                `${t('scheduling.no_show.replace_on_hint') || 'It will be booked for'} ${new Date(
                  chosenStart || replacement.proposedStart
                ).toLocaleString(isRTL ? 'he-IL' : 'en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}`}
            </Hint>
          </div>

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

          {/*
            ──────────────────────────────────────────────────────────────────
            WHAT WILL ACTUALLY HAPPEN, INCLUDING THE PART NOBODY CAN PREDICT.
            ──────────────────────────────────────────────────────────────────
            Each control says what IT does. None of them could say what the
            COMBINATION does, and that is the half the owner cannot work out:
            waiving the hour and booking a make-up on a per-session package
            moves the charge onto the make-up, while charging and booking one
            leaves the make-up free. Same two answers, opposite money.

            That rule already exists — the drawer bills a replacement only when
            the missed hour was waived — and until now it was discoverable only
            by doing it and reading the invoice afterwards.
          */}
          <OutcomePanel title={t('scheduling.no_show.outcome_title')}>
              <OutcomeLine icon={UserX}>{t('scheduling.no_show.outcome_recorded')}</OutcomeLine>

              {chargeable && (
                <OutcomeLine icon={Banknote} tone={chargeSession ? 'keep' : 'give'}>
                  {chargeSession
                    ? t('scheduling.no_show.outcome_charged')
                    : t('scheduling.no_show.outcome_waived')}
                </OutcomeLine>
              )}

              {nextStep === 'client' && (
                <OutcomeLine icon={Mail}>{t('scheduling.no_show.outcome_invited')}</OutcomeLine>
              )}

              {nextStep === 'owner' && (
                <>
                  <OutcomeLine icon={CalendarPlus}>{t('scheduling.no_show.outcome_booked')}</OutcomeLine>
                  {/*
                    Only where there is money in play at all. On an upfront
                    package nothing moves either way, and saying so would
                    invent a decision the owner never made.
                  */}
                  {chargeable && (
                    <OutcomeLine icon={ArrowLeftRight} tone={chargeSession ? undefined : 'keep'}>
                      {chargeSession
                        ? t('scheduling.no_show.outcome_makeup_free')
                        : t('scheduling.no_show.outcome_makeup_carries')}
                    </OutcomeLine>
                  )}
                </>
              )}

              {nextStep === 'nothing' && (
                <OutcomeLine icon={Minus}>{t('scheduling.no_show.outcome_quiet')}</OutcomeLine>
              )}
          </OutcomePanel>
        </div>

        <div
          className={`flex flex-shrink-0 gap-3 border-t border-[var(--v2-border)] bg-[var(--v2-surface)] px-5 py-3.5 ${
            isRTL ? 'flex-row-reverse' : ''
          }`}
        >
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
            /* Held while the replacement offer is in flight: confirming now
               would settle the session without the question having been
               asked — see `replacementLoading`. */
            disabled={working || replacementLoading}
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
