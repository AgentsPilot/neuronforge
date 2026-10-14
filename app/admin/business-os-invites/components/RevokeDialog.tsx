'use client';

/**
 * FR-6: revoke one invite, with a reason of at least 3 characters.
 *
 * The server decides whether the invite can still be revoked (409 when it was
 * accepted or already revoked). The reply is read through the shared
 * `readJsonBody` (L-6, C-4), so a non-JSON reply falls to this form's own
 * sentence. The request and the code-to-sentence map are unchanged since L-6
 * and pinned by `__tests__/invites.requestPins.render.test.tsx`.
 *
 * ── A real dialog since Admin Layout Follow-ups LF-3a (OR-3, SA-C10) ────────
 * Until LF-3a this was an inline form under its row, named a dialog (F-41, now
 * closed). It is a modal `ui/dialog` with the shared admin dialog classes, the
 * one file of this screen allowed to import the primitive (source guard G-8).
 * It is screen-local on purpose (SA ruling LF3B-F1): no shared confirm dialog
 * exists, and the Messages one does not fit (no reason field). It copies that
 * dialog's discipline:
 *
 * - Initial focus is the reason field, so typing starts at once; Enter on an
 *   empty or short reason sends nothing (the confirm stays disabled).
 * - One send per confirmation: a ref is checked first and set before any await,
 *   so a second submit in the same tick returns at once.
 * - While the request is in flight it cannot be dismissed (Escape, an outside
 *   click, the corner close or "Keep it").
 * - On a refusal it stays open with the sentence and the reason, so the admin
 *   can fix the reason and try again (today's behaviour, SA SQ-H).
 * - It opens from a row button, not a Radix trigger, so focus goes back by hand
 *   through `onReturnFocus`; the page picks the opener or its content area.
 *
 * The page owns it, one instance, so it outlives its opener, which always
 * leaves when the row becomes Revoked (SA SQ-G). The page keeps the last invite
 * after closing, so the closing frame still has its title (SA C5 b), and bumps
 * `openKey` on every open: the inner part remounts, so the reason, the error and
 * the in-flight ref start fresh, even on reopening the same row (SA C5 c).
 */

import { useRef, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ADMIN_DIALOG_CLASS, ADMIN_DIALOG_TITLE_CLASS } from '@/app/admin/components/layout/adminDialog';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';

import type { InviteRow } from '../types';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

export interface RevokeDialogProps {
  open: boolean;
  /** The invite asked about; kept by the page after closing, never null. */
  invite: InviteRow;
  /** Bumped by the page on every open, so each open starts fresh. */
  openKey: number;
  onRevoked: (invite: InviteRow) => void;
  /** Keep it, Escape, an outside click or the corner close, never while in flight. */
  onClose: () => void;
  /** Called once the dialog has closed. */
  onReturnFocus: () => void;
}

const REASON_MIN = 3;

const ERROR_TEXT: Record<string, string> = {
  invalid_input: 'Give a reason of at least 3 characters.',
  invite_not_found: 'This invite no longer exists. Refresh the list.',
  invite_not_revocable: 'This invite cannot be revoked: it was accepted or already revoked.',
  could_not_revoke_invite: 'The invite could not be revoked. Try again.',
};

export function RevokeDialog({ openKey, ...rest }: RevokeDialogProps) {
  return <RevokeDialogOpenOnce key={openKey} {...rest} />;
}

function RevokeDialogOpenOnce({ open, invite, onRevoked, onClose, onReturnFocus }: Omit<RevokeDialogProps, 'openKey'>) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set synchronously on the first submit: the guard a same-tick second submit cannot pass. */
  const isSending = useRef(false);
  const reasonRef = useRef<HTMLInputElement | null>(null);

  const canSubmit = !submitting && Array.from(reason.trim()).length >= REASON_MIN;

  const onOpenChange = (next: boolean) => {
    if (next || isSending.current) return;
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSending.current) return;
    if (!canSubmit) return;
    isSending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/business-os/invites/${encodeURIComponent(invite.id)}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await readJsonBody(response);
      if (!response.ok || !body || !body.success) {
        const code = typeof body?.error === 'string' ? body.error : 'could_not_revoke_invite';
        setError(ERROR_TEXT[code] ?? ERROR_TEXT.could_not_revoke_invite);
        return;
      }
      onRevoked((body.data as { invite: InviteRow }).invite);
    } catch {
      setError(ERROR_TEXT.could_not_revoke_invite);
    } finally {
      isSending.current = false;
      setSubmitting(false);
    }
  };

  const reasonId = `revoke-reason-${invite.id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="revoke-dialog"
        className={ADMIN_DIALOG_CLASS}
        aria-describedby={undefined}
        aria-busy={submitting}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          reasonRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
        onEscapeKeyDown={(event) => {
          if (isSending.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isSending.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className={ADMIN_DIALOG_TITLE_CLASS}>Revoke the invite for {invite.email}?</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <label htmlFor={reasonId} className="block text-xs font-medium text-slate-300">
            Why are you revoking the invite for {invite.email}? (at least {REASON_MIN} characters)
          </label>
          <input
            ref={reasonRef}
            id={reasonId}
            type="text"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={`w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-white ${FOCUS_RING}`}
          />
          {error && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} disabled={submitting} className={ADMIN_BUTTON}>
              Keep it
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              aria-busy={submitting}
              className={`flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-40 ${FOCUS_RING}`}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Revoke invite
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
