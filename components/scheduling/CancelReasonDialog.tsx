'use client';

/**
 * Why this booking is being cancelled — asked before it happens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *
 * The reason is mandatory on every cancellation surface, and the calendar and
 * the booking modal were cancelling on ONE CLICK with no body at all. Once the
 * API began requiring a code, those two paths stopped working outright — a
 * regression that made cancelling from the calendar impossible.
 *
 * They could not simply send a code either: nobody but the owner knows why, and
 * a default would put whichever reason it was at the top of the report forever.
 * So they ask, the same way `NoShowConfirmDialog` already asks before recording
 * a judgement about somebody.
 *
 * Shared by BOTH surfaces rather than built twice. The calendar and the modal
 * cancel the same bookings through the same route, and two pickers would drift
 * the moment a reason was added to one of them.
 *
 * WHY CANCELLING NOW CONFIRMS AT ALL
 *
 * It did not before, and that was its own small bug: a mis-click on a calendar
 * cell emailed a client that their appointment was off and freed the slot, with
 * nothing in between. Asking for a reason gives that the pause it always needed.
 *
 * NOTHING IS PRESELECTED and the confirm stays disabled until a reason is
 * chosen. A mandatory picker that opens on its first item makes that item the
 * most common reason in the data permanently — the public quote page already
 * proved it, defaulting to `too_expensive` with no gate.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { Loader2, CalendarX, EyeOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/lib/business-os/LanguageContext';
/*
 * The same control the refund and stop-plan dialogs use. A checkbox here beside
 * a toggle there reads as two unrelated widgets for the same kind of choice.
 */
import { SwitchRow } from '@/components/payments/SwitchRow';
import {
  OWNER_CANCEL_REASONS,
  cancelReasonKey,
  type OwnerCancelReason,
} from '@/lib/business-os/cancellationReasons';

interface CancelReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose booking, so the confirmation names a person rather than an id. */
  clientName?: string | null;
  onConfirm: (input: { reasonCode: OwnerCancelReason; note: string; shareNote: boolean }) => Promise<void> | void;
}

export function CancelReasonDialog({
  open,
  onOpenChange,
  clientName,
  onConfirm,
}: CancelReasonDialogProps) {
  const { t, language } = useLanguage();
  const isRTL = language === 'he';

  const [reasonCode, setReasonCode] = useState<OwnerCancelReason | ''>('');
  const [note, setNote] = useState('');
  /*
   * Whether the note is emailed to the client. Shared by default — that is what
   * this route has always done — and turned off for a note kept for the owner's
   * own records.
   */
  const [shareNote, setShareNote] = useState(true);
  const [working, setWorking] = useState(false);

  const close = () => {
    setReasonCode('');
    setNote('');
    setShareNote(true);
    setWorking(false);
    onOpenChange(false);
  };

  const confirm = async () => {
    // Belt and braces: the button is disabled without a reason, but a stray call
    // must not cancel a booking with no code either.
    if (!reasonCode || working) return;

    setWorking(true);
    try {
      await onConfirm({ reasonCode, note: note.trim(), shareNote });
      setReasonCode('');
      setNote('');
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => !next && close()}>
      <DialogContent
        className="max-w-[440px] bg-[var(--v2-surface)] border border-[var(--v2-border)]"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-[var(--v2-text-primary)] rtl:text-right">
            <CalendarX className="h-4 w-4 text-[#B54708]" />
            {t('crm.booking.cancel_title') || 'Cancel this booking?'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {clientName && (
            <p className="text-[13px] text-[var(--v2-text-secondary)] rtl:text-right">
              {(t('crm.booking.cancel_message') || '{name} will be told the appointment is cancelled and the slot will be freed.').replace('{name}', clientName)}
            </p>
          )}

          <div>
            <label className="block text-[13px] font-medium text-[var(--v2-text-secondary)] mb-1.5 rtl:text-right">
              {t('crm.booking.cancel_reason_label') || 'Why is it being cancelled?'}
              <span className="text-[#B42318]"> *</span>
            </label>
            <Select
              value={reasonCode}
              onValueChange={value => setReasonCode(value as OwnerCancelReason)}
            >
              <SelectTrigger className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)]">
                <SelectValue
                  placeholder={t('cancel.choose_reason') || 'Choose a reason'}
                />
              </SelectTrigger>
              <SelectContent>
                {OWNER_CANCEL_REASONS.map(code => (
                  <SelectItem key={code} value={code}>
                    {t(cancelReasonKey(code)) || code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={1000}
            placeholder={t('crm.booking.cancel_note_placeholder') || 'Anything worth remembering (optional)'}
            className="w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-[13px] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] outline-none"
          />


          {/* Whether the note above reaches the client.
              The note field reads like somewhere to keep an internal remark, and
              it is emailed verbatim — "not paying, avoid in future" is a
              reasonable thing to write down and a terrible thing to send. Turned
              off, the client still gets a neutral phrasing of the reason, so the
              email explains itself rather than going silent. */}
          {note.trim().length > 0 && (
            <div className="rounded-lg border border-[var(--v2-border)]">
              <SwitchRow
                checked={!shareNote}
                onChange={next => setShareNote(!next)}
                isRTL={isRTL}
                icon={<EyeOff className="h-3.5 w-3.5 text-[#B54708]" />}
                label={t('cancel.hide_note_label') || 'Keep this note private, do not email it to the client'}
              />
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={close}
              disabled={working}
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors disabled:opacity-50"
            >
              {/*
                `gaps.action.keep_booking`, which already means exactly this and
                already says 'להשאיר'. A key of my own held the same word in all
                three languages — identical today and free to drift tomorrow,
                which is how the same action ends up reading two ways.
              */}
              {t('gaps.action.keep_booking') || 'Keep it'}
            </button>
            {/*
              Explicit colours, not the default Button variant: that maps to
              `bg-primary`, which this app does not define, so the default variant
              renders an invisible button.
            */}
            <button
              type="button"
              onClick={confirm}
              disabled={working || !reasonCode}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold bg-[#B42318] text-white hover:bg-[#912018] transition-colors disabled:opacity-60"
            >
              {working && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('crm.booking.cancel_confirm') || 'Cancel booking'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
