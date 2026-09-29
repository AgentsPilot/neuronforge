'use client';

/**
 * FR-3: the invite link, shown ONCE, with a copy button.
 *
 * The link exists only in this component's props, which come from the create
 * response held in page state. It is never written to storage or the URL, so a
 * reload loses it for good: the database holds only the hash (§8.1). A lost
 * link means a new invite until resend arrives (Slice 2b).
 *
 * Slice 2a (FR-16): the panel says what happened to the invitation email, from
 * the server's status word only. "Emailed" means the provider accepted it, not
 * that it was delivered. When it was not sent, or the result is unknown, the
 * panel says so plainly and the link is right here to copy. With no email
 * requested it says nothing about delivery: the admin sends the link by hand.
 */

import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

import type { InviteEmailStatus } from '../types';

interface Props {
  link: string;
  email: string;
  /** Slice 2a: from the create response. Absent (older server) reads as "not emailed". */
  emailStatus?: InviteEmailStatus;
  onDismiss: () => void;
}

/** The line under the heading for each email status. */
function emailLine(status: InviteEmailStatus | undefined, email: string): { text: string; className: string } | null {
  switch (status) {
    case 'sent':
    case 'sent_untracked':
      return { text: `The invitation was emailed to ${email}.`, className: 'text-emerald-100' };
    case 'not_sent':
      return { text: 'The email was not sent. Copy the link below and send it yourself.', className: 'text-rose-200' };
    case 'unknown':
      return {
        text: 'We could not confirm the email went out. Copy the link below and send it yourself to be sure.',
        className: 'text-amber-200',
      };
    default:
      return null;
  }
}

export function CreatedLinkPanel({ link, email, emailStatus, onDismiss }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // Some browsers refuse clipboard access; the link is still selectable.
      setCopyFailed(true);
    }
  };

  return (
    <section data-testid="created-link-panel" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="text-sm font-semibold text-emerald-100">Invite created for {email}</h2>
          {(() => {
            const line = emailLine(emailStatus, email);
            return line ? (
              <p data-testid="created-email-status" className={`text-sm ${line.className}`}>
                {line.text}
              </p>
            ) : null;
          })()}
          <p className="text-sm font-medium text-amber-200">
            This link is shown once. Copy it now: it cannot be shown again after you leave or reload this page.
          </p>
          <div className="flex items-center gap-2">
            <code
              data-testid="created-link"
              className="block min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded bg-slate-900/70 px-2 py-1 font-mono text-xs text-slate-100"
            >
              {link}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              className="flex shrink-0 items-center gap-1 rounded border border-emerald-500/50 px-3 py-1 text-sm text-emerald-100 hover:bg-emerald-500/20"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {copyFailed && <p className="text-xs text-rose-300">Could not copy automatically. Select the link and copy it.</p>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          className="rounded p-1 text-emerald-200 hover:bg-emerald-500/20"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
