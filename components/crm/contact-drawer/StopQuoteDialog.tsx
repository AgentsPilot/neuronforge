'use client';

/**
 * Stop an accepted job part-way through, and say why.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REFUNDING IS NOT HERE. Stopping the job and handing money back are separate
 * decisions, and every other cancellation in the product makes the second one in
 * the standard refund dialog — with its partial amounts, its over-refund guard
 * and its notify-the-client toggle. This dialog briefly grew its own tick-box and
 * amount field, which meant one refund control in the drawer behaved differently
 * from every other. It now hands off exactly as cancelling a booking does: stop
 * first, then the refund dialog opens if money is actually held.
 *
 * ONE PRESS, BOTH HALVES. The server does two things in one call:
 *
 *   1. stops the money   unbilled stages closed, their live invoices voided
 *   2. ends the job      the quote moves `accepted` -> `stopped`
 *
 * They were separable before and that produced the state nobody could read:
 * stages `cancelled` while the quote still said `accepted`, indistinguishable
 * from a job that finished and was paid in full.
 *
 * WHY THE REASON IS A LIST AND NOT A TEXT BOX
 *
 * It is collected to be COUNTED. "How many jobs did we lose part-way, and why"
 * cannot be answered from a column of prose — the same reason arrives as "client
 * stopped", "Client Stopped" and "clint stoped", three rows for one reason. The
 * note is there for the sentence a code cannot carry, never instead of it.
 *
 * The reason is REQUIRED, and nothing is preselected.
 *
 * Both halves matter. Required because the owner is present and knows; nothing
 * preselected because a picker that opens on its first item makes that item the
 * most common reason in the data forever. The public quote page already proves
 * it — its decline picker defaults to `too_expensive`, so every client who
 * declined without touching it recorded "too expensive".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { AlertTriangle, EyeOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/lib/business-os/LanguageContext';
// The control the refund and stop-plan dialogs already use for exactly this
// kind of "one more thing that will happen" choice.
import { SwitchRow } from '@/components/payments/SwitchRow';
/*
 * The vocabulary module, NOT `ProposalRepository`. CLAUDE.md rule 1: a
 * repository must never be imported into a `'use client'` component.
 */
import { STOP_REASONS, cancelReasonKey } from '@/lib/business-os/cancellationReasons';

interface StopQuoteDialogProps {
  /** The accepted quote to stop. Null closes the dialog. */
  proposalId: string | null;
  /** Its title, so the confirmation names the job rather than an id. */
  proposalTitle?: string | null;
  onClose: () => void;
  /**
   * Called after a successful stop, with what is still held.
   *
   * The drawer reloads, and offers the standard refund dialog when there is money
   * — rather than this one growing a refund control of its own.
   */
  onStopped?: (held: { collected: number; currency: string }) => void;
}

export function StopQuoteDialog({
  proposalId,
  proposalTitle,
  onClose,
  onStopped,
}: StopQuoteDialogProps) {
  const { t, language } = useLanguage();
  const isRTL = language === 'he';

  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  /* Whether the note is emailed to the client. Shared by default. */
  const [shareNote, setShareNote] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setReason('');
    setNote('');
    setShareNote(true);
    setError(null);
    setSaving(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    // Belt and braces: the button is disabled without a reason, but a stray
    // call must not post one either.
    if (!proposalId || saving || !reason) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/business-os/proposals/${proposalId}/stop-payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Omitted rather than sent empty: the column means "unknown", and ''
          // is not a reason the API's enum would accept anyway.
          // Required, and the submit button cannot be reached without one.
          reason,
          note: note.trim() || undefined,
          share_note_with_client: shareNote,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.success) {
        setError(payload?.error || t('crm.quote.stop.failed') || 'Could not stop this job.');
        setSaving(false);
        return;
      }

      reset();
      /*
       * What is still held, so the caller can open the refund dialog only when
       * there is something to give back — the same test the booking cancellation
       * makes before offering one.
       */
      onStopped?.({
        collected: Number(payload?.data?.collected) || 0,
        currency: String(payload?.data?.currency || ''),
      });
      onClose();
    } catch {
      setError(t('crm.quote.stop.failed') || 'Could not stop this job.');
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(proposalId)} onOpenChange={open => !open && close()}>
      <DialogContent
        className="max-w-[480px] bg-[var(--v2-surface)] border border-[var(--v2-border)]"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-[var(--v2-text-primary)] rtl:text-right">
            {t('crm.quote.stop.title') || 'Stop this job'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/*
            What this will actually do, in plain words.
            An owner pressing a destructive money button is entitled to know
            which money before they press it — and the two halves are easy to
            confuse with cancelling the whole quote, which this is NOT.
          */}
          <div className="flex gap-2.5 p-3 rounded-lg bg-[var(--v2-surface-raised)] border border-[var(--v2-border)]">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-[#B54708]" />
            <div className="text-[13px] leading-relaxed text-[var(--v2-text-secondary)]">
              {proposalTitle && (
                <div className="font-medium text-[var(--v2-text-primary)] mb-1 truncate">
                  {proposalTitle}
                </div>
              )}
              {t('crm.quote.stop.explain')
                || 'The phases not yet billed will be cancelled and any unpaid invoice for this job will be voided. Payments already made stay exactly as they are.'}
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[var(--v2-text-secondary)] mb-1.5 rtl:text-right">
              {t('crm.quote.stop.reason_label') || 'Why did it stop?'}
              <span className="text-[#B42318]"> *</span>
            </label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)]">
                <SelectValue
                  placeholder={t('cancel.choose_reason') || 'Choose a reason'}
                />
              </SelectTrigger>
              <SelectContent>
                {STOP_REASONS.map(code => (
                  <SelectItem key={code} value={code}>
                    {/*
                      `cancelReasonKey`, the same lookup the refund and plan
                      dialogs use. This had its own `crm.quote.stop.reason.*`
                      namespace, and two of its six keys were left behind when the
                      codes were aligned into one namespace — so "won't pay" and
                      "could not deliver" rendered as raw `client_not_paying` and
                      `owner_cannot_deliver`. One lookup cannot drift from the
                      codes the way a parallel set of keys did.
                    */}
                    {t(cancelReasonKey(code)) || code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[var(--v2-text-secondary)] mb-1.5 rtl:text-right">
              {t('crm.quote.stop.note_label') || 'Anything worth remembering'}
            </label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={t('crm.quote.stop.note_placeholder') || 'Optional'}
              className="bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]"
            />
          </div>

          {/* The note is emailed to the client verbatim unless this is ticked.
              Shown only once something is typed — an empty note has nothing to
              keep private. Either way the client is told the reason, in its
              client-safe phrasing, so the email never goes silent. */}
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

          {error && (
            <div className="text-[13px] text-[#B42318] rtl:text-right">{error}</div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={close}
              disabled={saving}
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors disabled:opacity-50"
            >
              {t('common.cancel') || 'Cancel'}
            </button>
            {/*
              Explicit colours, not the default Button variant: that maps to
              `bg-primary`, which is not a token this app defines, so the default
              variant renders an invisible button. Same trap already fixed on the
              consent panel's Save.
            */}
            <button
              type="button"
              onClick={submit}
              disabled={saving || !reason}
              className="px-3.5 py-2 rounded-lg text-[13px] font-semibold bg-[#B42318] text-white hover:bg-[#912018] transition-colors disabled:opacity-60"
            >
              {saving
                ? t('crm.quote.stop.saving') || 'Stopping…'
                : t('crm.quote.stop.confirm') || 'Stop the job'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
