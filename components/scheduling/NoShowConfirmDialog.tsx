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

import { useState } from 'react';
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
  /** Receives the owner's choice. Resolves when the change has been applied. */
  onConfirm: (options: { notifyClient: boolean; chargeSession: boolean }) => Promise<void>;
}

export function NoShowConfirmDialog({
  open,
  onOpenChange,
  clientName,
  chargeable = false,
  onConfirm,
}: NoShowConfirmDialogProps) {
  const { t, isRTL } = useLanguage();
  const [notifyClient, setNotifyClient] = useState(false);
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
      await onConfirm({ notifyClient, chargeSession });
      onOpenChange(false);
      // Back to the defaults for the next booking: a choice made about one
      // client must never be applied silently to the next. That cuts both
      // ways, so a waiver does not carry over either.
      setNotifyClient(false);
      setChargeSession(true);
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
            onToggle={() => setNotifyClient(v => !v)}
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
