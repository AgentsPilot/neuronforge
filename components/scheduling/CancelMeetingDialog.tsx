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

import { useState } from 'react';
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
  /** Receives the owner's answer. Resolves when the change has been applied. */
  onConfirm: (options: { proposalContinues: boolean }) => Promise<void>;
}

export function CancelMeetingDialog({
  open,
  onOpenChange,
  clientName,
  isQuoted,
  onConfirm,
}: CancelMeetingDialogProps) {
  const { t, isRTL } = useLanguage();
  /* ON by default: see the note above. */
  const [proposalContinues, setProposalContinues] = useState(true);
  const [working, setWorking] = useState(false);

  const confirm = async () => {
    setWorking(true);
    try {
      await onConfirm({ proposalContinues: isQuoted ? proposalContinues : true });
      onOpenChange(false);
      /* Back to the default for the next booking. An answer given about one
         client must never be applied silently to the next. */
      setProposalContinues(true);
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
