'use client';

/**
 * Session panel for the Business OS test harness.
 *
 * Everything on /test-business-os runs as the logged-in session user, and the
 * sign-in form belongs to the marketing site on another origin — so switching
 * persona used to mean leaving the harness, signing in over there, and being
 * handed back. This panel does the same auth calls in place, through
 * `lib/client/auth-actions`, which is the single implementation shared with the
 * product: same methods (password, Google, reset), same audit events, same
 * person-scoped storage clearing on the way out.
 *
 * No redirect after signing in — you stay on the harness, and `UserProvider`
 * picks the new session up through `onAuthStateChange`.
 */

import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  signInWithPassword,
  signInWithGoogle,
  sendPasswordResetEmail,
  signOutUser,
} from '@/lib/client/auth-actions';

interface Props {
  user: User | null;
  authLoading: boolean;
  /** Mirrors what happened into the harness's shared debug-log panel. */
  onLog: (type: 'info' | 'error' | 'success', message: string) => void;
  panelStyle: React.CSSProperties;
}

export function TestAuthPanel({ user, authLoading, onLog, panelStyle }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** 'local' keeps your other devices signed in — the usual choice when testing. */
  const [signOutScope, setSignOutScope] = useState<'local' | 'global'>('local');

  const report = (kind: 'ok' | 'err', text: string) => {
    setMessage({ kind, text });
    onLog(kind === 'ok' ? 'success' : 'error', text);
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    onLog('info', `Signing in as ${email}…`);
    const result = await signInWithPassword(email.trim(), password);
    if (result.ok) {
      setPassword('');
      report('ok', `Signed in as ${result.user?.email} (${result.user?.id})`);
    } else {
      report('err', `Sign-in failed: ${result.error}`);
    }
    setBusy(false);
  };

  const handleGoogleLogin = async () => {
    setBusy(true);
    setMessage(null);
    onLog('info', 'Starting Google sign-in…');
    // Through /auth/callback, exactly as the product does: it ensures the
    // profile row and writes the USER_LOGIN audit entry. It lands on
    // /business-os or /onboarding-chat afterwards — come back here from there.
    const result = await signInWithGoogle();
    if (!result.ok) {
      report('err', `Google sign-in failed to start: ${result.error}`);
      setBusy(false);
    }
    // On success the browser is already navigating away.
  };

  const handleResetEmail = async () => {
    const target = email.trim();
    if (!target) {
      report('err', 'Enter an email address first.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await sendPasswordResetEmail(target);
    report(
      result.ok ? 'ok' : 'err',
      result.ok ? `Password reset email sent to ${target}` : `Reset failed: ${result.error}`
    );
    setBusy(false);
  };

  const handleSignOut = async () => {
    setBusy(true);
    setMessage(null);
    onLog('info', `Signing out (${signOutScope})…`);
    const result = await signOutUser({ scope: signOutScope, user });
    report(
      result.ok ? 'ok' : 'err',
      result.ok ? `Signed out (${signOutScope}).` : `Sign-out reported: ${result.error}`
    );
    setBusy(false);
  };

  const inputStyle: React.CSSProperties = {
    padding: '8px',
    fontSize: '14px',
    fontFamily: 'monospace',
    border: '1px solid #ccc',
    borderRadius: '4px',
    minWidth: '220px',
  };

  const buttonStyle = (bg: string): React.CSSProperties => ({
    padding: '8px 16px',
    fontSize: '14px',
    backgroundColor: busy ? '#9aa0a6' : bg,
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: busy ? 'not-allowed' : 'pointer',
  });

  return (
    <div style={panelStyle}>
      <h2 style={{ marginTop: 0 }}>Session</h2>

      {authLoading ? (
        <div style={{ color: '#666' }}>Loading session…</div>
      ) : user ? (
        <>
          <div style={{ fontSize: '14px', marginBottom: '12px' }}>
            <div>
              <span style={{ color: '#666' }}>User ID:</span> <strong>{user.id}</strong>
            </div>
            <div>
              <span style={{ color: '#666' }}>Email:</span>{' '}
              <strong>{user.email || '(none)'}</strong>
            </div>
            <div>
              <span style={{ color: '#666' }}>Provider:</span>{' '}
              <strong>{(user.app_metadata?.provider as string) || 'unknown'}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={handleSignOut} disabled={busy} style={buttonStyle('#dc3545')}>
              Sign out
            </button>
            <label style={{ fontSize: '13px', color: '#666' }}>
              scope:{' '}
              <select
                value={signOutScope}
                onChange={(e) => setSignOutScope(e.target.value as 'local' | 'global')}
                style={{ padding: '6px', fontSize: '13px' }}
              >
                <option value="local">local (this browser)</option>
                <option value="global">global (all devices)</option>
              </select>
            </label>
          </div>
        </>
      ) : (
        <>
          <p style={{ color: '#666', fontSize: '14px', marginTop: 0 }}>
            Not signed in. Sign in here — same auth the product uses, no trip to the
            marketing site. Business OS APIs read this session.
          </p>
          <form
            onSubmit={handlePasswordLogin}
            style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <div>
              <label htmlFor="testAuthEmail" style={{ display: 'block', marginBottom: '5px' }}>
                Email:
              </label>
              <input
                id="testAuthEmail"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="testAuthPassword" style={{ display: 'block', marginBottom: '5px' }}>
                Password:
              </label>
              <input
                id="testAuthPassword"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
            <button type="submit" disabled={busy} style={buttonStyle('#007bff')}>
              Sign in
            </button>
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={busy}
              style={buttonStyle('#444')}
            >
              Sign in with Google
            </button>
            <button
              type="button"
              onClick={handleResetEmail}
              disabled={busy}
              style={{
                ...buttonStyle('transparent'),
                color: '#007bff',
                textDecoration: 'underline',
                padding: '8px 4px',
              }}
            >
              Send reset email
            </button>
          </form>
        </>
      )}

      {message && (
        <div
          style={{
            marginTop: '12px',
            fontSize: '13px',
            color: message.kind === 'ok' ? '#198754' : '#dc3545',
          }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
