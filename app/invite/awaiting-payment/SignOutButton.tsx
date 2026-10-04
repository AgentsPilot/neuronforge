'use client';

/**
 * The holding screen's one control (Slice 5b, FR-35): sign out, then go to the
 * normal sign-in page. Signing back in returns the friend to the same screen,
 * because the layouts' payment hold sends them here again.
 */

import { useState } from 'react';

import { signOutUser } from '@/lib/client/auth-actions';

import { INVITE_SECONDARY_BUTTON } from '../InviteShell';

export function SignOutButton({
  label,
  busyLabel,
  failedLabel,
  signInUrl,
}: {
  label: string;
  busyLabel: string;
  failedLabel: string;
  signInUrl: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onClick() {
    setBusy(true);
    setFailed(false);
    const result = await signOutUser({ scope: 'local', method: 'awaiting-payment' });
    if (!result.ok) {
      // Local state is cleared either way (auth-actions); say so and let them retry.
      setFailed(true);
      setBusy(false);
      return;
    }
    window.location.assign(signInUrl);
  }

  return (
    <div>
      <button
        type="button"
        data-testid="awaiting-payment-sign-out"
        onClick={onClick}
        disabled={busy}
        className={INVITE_SECONDARY_BUTTON}
      >
        {busy ? busyLabel : label}
      </button>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {failedLabel}
        </p>
      ) : null}
    </div>
  );
}
