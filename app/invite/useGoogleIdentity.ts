'use client';

/**
 * Google Identity Services (GIS) for "Continue with Google" on a champion
 * invite (invite-only signup, Slice 3b; D-1, D-6, D-10, SA Q-1).
 *
 * What it does, and nothing more:
 *   1. makes a fresh RAW nonce (32 random bytes, base64url) and its SHA-256 in
 *      lowercase hex. Google is given the HASH, so the ID token carries the
 *      hash; the raw value stays in this page's memory and is sent only in the
 *      signup POST body and to Supabase's `signInWithIdToken` (D-6). A token
 *      minted anywhere else cannot be replayed here without it;
 *   2. once Google's script is ready, initialises GIS in POPUP mode with no One
 *      Tap and no auto-select, and renders Google's own button into a
 *      container (D-10). Nobody is signed up by a prompt they did not click;
 *   3. hands each credential Google returns to `onCredential`, with the raw
 *      nonce. A popup the person closes calls nothing, so nothing happens.
 *
 * The script is loaded by the component with `next/script`, only when the
 * button is shown. If it fails (blocked, offline), the button area stays empty
 * and the code form still works.
 *
 * The `google.accounts.id` surface is typed here minimally (no `any`), read
 * off `window` without declaring a global.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Google's GIS client script. Any future CSP must allow it (see `layout.tsx`). */
export const GOOGLE_IDENTITY_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce: string;
  ux_mode: 'popup';
  auto_select: false;
  cancel_on_tap_outside: boolean;
}

interface GoogleButtonConfiguration {
  type: 'standard';
  theme: 'outline';
  size: 'large';
  text: 'continue_with';
  shape: 'rectangular';
  logo_alignment: 'left';
  locale: string;
  width: number;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfiguration) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonConfiguration) => void;
}

/** `window.google.accounts.id`, or null while the script has not run. */
export function googleAccountsId(): GoogleAccountsId | null {
  const google = (window as unknown as { google?: { accounts?: { id?: GoogleAccountsId } } }).google;
  return google?.accounts?.id ?? null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** D-6: a raw nonce (43 base64url characters) and the SHA-256 hex Google is given. */
export async function makeGoogleNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = base64Url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return { raw, hashed: hex(digest) };
}

export interface GoogleCredential {
  idToken: string;
  rawNonce: string;
}

export interface UseGoogleIdentity {
  /** Where Google draws its button. */
  containerRef: RefObject<HTMLDivElement>;
  /** Pass to `<Script onReady>`. */
  onScriptReady: () => void;
  /** Pass to `<Script onError>`. */
  onScriptError: () => void;
  /** True once Google's button has been drawn. */
  rendered: boolean;
  /** True if the script failed to load or GIS could not start. */
  failed: boolean;
}

/** Google's button width in px (it accepts 200 to 400). */
const BUTTON_WIDTH = 320;

export function useGoogleIdentity(options: {
  clientId: string;
  locale: string;
  onCredential: (credential: GoogleCredential) => void;
}): UseGoogleIdentity {
  const { clientId, locale } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);
  // The latest handler, so GIS (initialised once) always calls the current one.
  const onCredentialRef = useRef(options.onCredential);
  useEffect(() => {
    onCredentialRef.current = options.onCredential;
  }, [options.onCredential]);

  const onScriptReady = useCallback(() => setScriptReady(true), []);
  const onScriptError = useCallback(() => setFailed(true), []);

  useEffect(() => {
    if (!scriptReady) return;
    let cancelled = false;

    void (async () => {
      const gis = googleAccountsId();
      const container = containerRef.current;
      if (!gis || !container) {
        if (!cancelled) setFailed(true);
        return;
      }
      try {
        const nonce = await makeGoogleNonce();
        if (cancelled) return;
        gis.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (response) => {
            // Only a real credential goes on; anything else is ignored.
            if (typeof response.credential === 'string' && response.credential.length > 0) {
              onCredentialRef.current({ idToken: response.credential, rawNonce: nonce.raw });
            }
          },
        });
        gis.renderButton(container, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          locale,
          width: BUTTON_WIDTH,
        });
        setRendered(true);
      } catch {
        // No Web Crypto (an old browser) or GIS refused to start: the code form remains.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scriptReady, clientId, locale]);

  return { containerRef, onScriptReady, onScriptError, rendered, failed };
}
