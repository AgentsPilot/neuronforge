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

interface NoShowConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The client's name, so the dialog names who this is about. */
  clientName?: string | null;
  /** Receives the owner's choice. Resolves when the change has been applied. */
  onConfirm: (options: { notifyClient: boolean }) => Promise<void>;
}

export function NoShowConfirmDialog({
  open,
  onOpenChange,
  clientName,
  onConfirm,
}: NoShowConfirmDialogProps) {
  const { t, isRTL } = useLanguage();
  const [notifyClient, setNotifyClient] = useState(false);
  const [working, setWorking] = useState(false);

  const confirm = async () => {
    setWorking(true);
    try {
      await onConfirm({ notifyClient });
      onOpenChange(false);
      // Back to off for the next booking: a choice made about one client must
      // never be applied silently to the next.
      setNotifyClient(false);
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
          <p className="text-sm text-[var(--v2-text-secondary)]">
            {clientName
              ? t('scheduling.no_show.confirm_named', { name: clientName })
              : t('scheduling.no_show.confirm')}
          </p>

          {/* The toggle, with what it will actually do written beside it. */}
          <button
            type="button"
            role="switch"
            aria-checked={notifyClient}
            onClick={() => setNotifyClient(v => !v)}
            disabled={working}
            className="w-full flex items-start justify-between gap-3 p-3 text-start bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <span className="flex-1">
              <span className="block text-sm font-medium text-[var(--v2-text-primary)]">
                {t('scheduling.no_show.notify_label')}
              </span>
              <span className="block text-xs text-[var(--v2-text-muted)] mt-0.5">
                {t('scheduling.no_show.notify_description')}
              </span>
            </span>

            <span
              className={`mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 transition-colors ${
                notifyClient ? 'bg-[#14B8A6]' : 'bg-[var(--v2-border)]'
              }`}
              style={{ borderRadius: '9999px' }}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 bg-white transition-transform ${
                  notifyClient ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
                style={{ borderRadius: '9999px' }}
              />
            </span>
          </button>
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
