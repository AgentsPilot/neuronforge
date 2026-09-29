'use client';

/**
 * Is the person looking at the invite page already signed in? (Invite-only
 * signup, Slice 1a; requirement §4.3 "Signed-in visitor", L-8.)
 *
 * An invite must never attach to whoever happens to be signed in, and the page
 * must never look like it is about to. So a signed-in visitor is told who they
 * are signed in as and asked to sign out before accepting.
 *
 * This reads the session the browser already holds (`getSession`, no network
 * call). It is a display decision only: nothing here authorises anything, and
 * the Slice 1b signup routes refuse a request that carries a session on the
 * server as well.
 *
 * Sign out goes through the audited `signOutUser`, scoped to this browser.
 */

import { useCallback, useEffect, useState } from 'react';

import { signOutUser } from '@/lib/client/auth-actions';
import { supabase } from '@/lib/supabaseClient';

export type SignedInVisitor =
  | { status: 'checking' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; email: string | null; userId: string };

export interface UseSignedInVisitor {
  visitor: SignedInVisitor;
  /** Signs out of this browser only. Resolves once the visitor is signed out. */
  signOut: () => Promise<void>;
  signingOut: boolean;
}

export function useSignedInVisitor(): UseSignedInVisitor {
  const [visitor, setVisitor] = useState<SignedInVisitor>({ status: 'checking' });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        const user = data.session?.user;
        setVisitor(user ? { status: 'signed_in', email: user.email ?? null, userId: user.id } : { status: 'signed_out' });
      })
      .catch(() => {
        // An unreadable session is treated as signed out for DISPLAY only:
        // the worst case is that the page offers what it would offer anyone,
        // and the signup routes still refuse a session on the server.
        if (active) setVisitor({ status: 'signed_out' });
      });
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    if (visitor.status !== 'signed_in') return;
    setSigningOut(true);
    try {
      await signOutUser({
        scope: 'local',
        user: { id: visitor.userId, email: visitor.email },
        method: 'invite-page',
      });
    } finally {
      // `signOutUser` clears this browser's session even when the server call
      // fails, so the visitor is signed out here either way.
      setSigningOut(false);
      setVisitor({ status: 'signed_out' });
    }
  }, [visitor]);

  return { visitor, signOut, signingOut };
}
