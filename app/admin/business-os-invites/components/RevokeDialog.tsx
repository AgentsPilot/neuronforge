'use client';

/**
 * FR-6: revoke one invite, with a reason of at least 3 characters.
 *
 * Inline rather than modal: it sits under the row it acts on, so there is no
 * doubt which invite is being withdrawn. The server decides whether the invite
 * can still be revoked (409 when it was accepted or already revoked).
 */

import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import type { InviteRow } from '../types';

interface Props {
  invite: InviteRow;
  onRevoked: (invite: InviteRow) => void;
  onCancel: () => void;
}

const REASON_MIN = 3;

const ERROR_TEXT: Record<string, string> = {
  invalid_input: 'Give a reason of at least 3 characters.',
  invite_not_found: 'This invite no longer exists. Refresh the list.',
  invite_not_revocable: 'This invite cannot be revoked: it was accepted or already revoked.',
  could_not_revoke_invite: 'The invite could not be revoked. Try again.',
};

export function RevokeDialog({ invite, onRevoked, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !submitting && Array.from(reason.trim()).length >= REASON_MIN;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/business-os/invites/${encodeURIComponent(invite.id)}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        const code = typeof body?.error === 'string' ? body.error : 'could_not_revoke_invite';
        setError(ERROR_TEXT[code] ?? ERROR_TEXT.could_not_revoke_invite);
        return;
      }
      onRevoked(body.data.invite as InviteRow);
    } catch {
      setError(ERROR_TEXT.could_not_revoke_invite);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      data-testid="revoke-dialog"
      onSubmit={(event) => void submit(event)}
      className="space-y-2 rounded border border-rose-500/40 bg-rose-500/10 p-3"
    >
      <label htmlFor={`revoke-reason-${invite.id}`} className="block text-xs font-medium text-rose-100">
        Why are you revoking the invite for {invite.email}? (at least {REASON_MIN} characters)
      </label>
      <input
        id={`revoke-reason-${invite.id}`}
        type="text"
        maxLength={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="w-full rounded border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-white"
      />
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex items-center gap-2 rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-40"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Revoke invite
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700/50">
          Keep it
        </button>
      </div>
    </form>
  );
}
