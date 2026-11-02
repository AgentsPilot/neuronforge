'use client';

/**
 * Put a lapsed quote back on the table.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A DIALOG AND NOT A BUTTON
 *
 * Every other row on the needs-you card posts and is done. This one cannot:
 * how long to hold a price is a commercial decision, and a one-tap "extend"
 * would be making it for the owner. A fortnight suits a consultancy and is far
 * too long for a venue holding a Saturday.
 *
 * So it asks, the way `RefundModal` asks for an amount — the card's other
 * action that needs an answer a POST cannot invent. The field is pre-filled
 * with two weeks because something has to be in it; that is a starting point,
 * not a recommendation.
 *
 * It deliberately does NOT offer to email the client. Extending is a decision
 * about the offer; telling them is the separate thing the reminder already
 * does. Bundling the two would mean an owner tidying three lapsed rows sends
 * three emails they never asked for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** A fortnight, as a date key in the viewer's own reckoning. */
function twoWeeksOut(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  /* Local parts, not `toISOString`: near midnight UTC that would offer the
     owner a date one day off the one their calendar shows. */
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The earliest date worth offering: tomorrow. Today expires tonight. */
function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface ExtendQuoteDialogProps {
  proposalId: string;
  /** Whose quote, so the dialog names a person rather than an id. */
  contactName: string;
  /** The date it lapsed on, shown so the owner can see what they are moving. */
  lapsedOn?: string | null;
  isRTL?: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Required: this dialog renders no error of its own. */
  onError: (message: string) => void;
  t: (key: string) => string;
}

export function ExtendQuoteDialog({
  proposalId,
  contactName,
  lapsedOn,
  isRTL,
  onClose,
  onSuccess,
  onError,
  t,
}: ExtendQuoteDialogProps) {
  const [validUntil, setValidUntil] = useState(twoWeeksOut);
  const [working, setWorking] = useState(false);

  const submit = async () => {
    if (working) return;
    setWorking(true);

    try {
      const response = await fetch(`/api/business-os/proposals/${proposalId}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valid_until: validUntil }),
      });
      const data = await response.json();

      if (!response.ok || !data?.success) {
        /* The server's own sentence: it knows whether the quote was answered
           while this dialog sat open, which is news rather than a failure. */
        onError(data?.error || t('gaps.refused.generic'));
        return;
      }

      onSuccess();
    } catch {
      onError(t('gaps.refused.generic'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent
        className="max-w-sm border-[var(--v2-border)] bg-[var(--v2-surface)]"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle className="text-base">{t('gaps.extend_quote.title')}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-[var(--v2-text-secondary)]">
          {t('gaps.extend_quote.body').replace('{name}', contactName)}
          {lapsedOn ? ` ${t('gaps.extend_quote.lapsed_on').replace('{date}', lapsedOn)}` : ''}
        </p>

        <label className="mt-2 block text-xs font-medium text-[var(--v2-text-secondary)]">
          {t('gaps.extend_quote.field')}
          <input
            type="date"
            value={validUntil}
            min={tomorrow()}
            onChange={event => setValidUntil(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-sm text-[var(--v2-text-primary)]"
          />
        </label>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="rounded-lg border border-[var(--v2-border)] px-3 py-1.5 text-sm text-[var(--v2-text-secondary)] disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            /* An empty or past date is refused by the server anyway; disabling
               here means the owner is told before the round trip. */
            disabled={working || !validUntil || validUntil < tomorrow()}
            className="rounded-lg bg-[#8B5CF6] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {working ? t('gaps.extend_quote.working') : t('gaps.extend_quote.confirm')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
