'use client';

/**
 * FR-3: the invite link, shown ONCE, with a copy button.
 *
 * The link exists only in this component's props, which come from the create
 * response held in page state. It is never written to storage or the URL, so a
 * reload loses it for good: the database holds only the hash (§8.1). A lost
 * link means a new invite (resend arrives in Slice 2).
 *
 * The panel claims nothing about delivery: the admin sends the link by hand.
 */

import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

interface Props {
  link: string;
  email: string;
  onDismiss: () => void;
}

export function CreatedLinkPanel({ link, email, onDismiss }: Props) {
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
