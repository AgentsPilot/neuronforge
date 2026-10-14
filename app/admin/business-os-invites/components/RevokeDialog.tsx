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
 * closed). LF-3a built it screen-local on `ui/dialog` (SA ruling LF3B-F1);
 * LF-7 moved it onto the shared dialog (below), and no file of this screen
 * imports the primitive any more (source guard G-8). The discipline:
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
 *
 * ── The shared dialog since Admin Layout Follow-ups LF-7 ────────────────────
 * The shell and its discipline (send-once, no close in flight, focus by hand)
 * now live in the shared `AdminConfirmDialog`; this file keeps the reason, the
 * request, the code-to-sentence map and the `openKey` remount. The shared
 * dialog is rendered inside the keyed part, never above it (SA C-5), so its
 * in-flight ref and busy state start fresh with the reason. `onConfirm`
 * resolves `false` on both outcomes: the shared dialog then does not call
 * `onClose`, and this file decides (a refusal keeps it open; a success closes
 * it through the page's `onRevoked`, as before).
 */

import { useRef, useState } from 'react';

import { AdminConfirmDialog } from '@/app/admin/components/layout/AdminConfirmDialog';
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
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLInputElement | null>(null);

  const canConfirm = Array.from(reason.trim()).length >= REASON_MIN;

  /** Resolves `false` either way: this file decides whether the dialog closes (SA SQ-4). */
  const revoke = async (): Promise<boolean> => {
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
        return false;
      }
      onRevoked((body.data as { invite: InviteRow }).invite);
    } catch {
      setError(ERROR_TEXT.could_not_revoke_invite);
    }
    return false;
  };

  const reasonId = `revoke-reason-${invite.id}`;

  return (
    <AdminConfirmDialog
      open={open}
      title={`Revoke the invite for ${invite.email}?`}
      cancelLabel="Keep it"
      confirmLabel="Revoke invite"
      tone="danger"
      testId="revoke-dialog"
      initialFocusRef={reasonRef}
      canConfirm={canConfirm}
      onConfirm={revoke}
      onClose={onClose}
      onReturnFocus={onReturnFocus}
    >
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
    </AdminConfirmDialog>
  );
}
