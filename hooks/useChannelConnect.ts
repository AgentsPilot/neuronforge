'use client';

import { useCallback, useRef, useState } from 'react';
import type { ChannelProvider } from '@/lib/business-os/channel-insights/providers';

/**
 * Drives connecting a social or analytics account, end to end.
 *
 * Two round trips look like one action to the user: the plugin OAuth popup, then
 * the server-side account discovery that records the opt-in. Everything that
 * could become a configuration step happens on the server, so the caller only
 * has to render a button and, in the rare multi-account case, a chooser.
 *
 * Lives in a hook because more than one surface offers connecting, and this
 * logic must exist once — a second copy would drift the moment one is fixed.
 */

export type ConnectPhase = 'idle' | 'authorizing' | 'connecting' | 'selecting' | 'connected' | 'error';

export interface DiscoveredAccountChoice {
  id: string;
  name: string;
  picture_url: string | null;
  /** Secondary line in the chooser, e.g. the Page's category. */
  detail: string | null;
  has_secondary: boolean;
}

interface ConnectState {
  phase: ConnectPhase;
  provider: ChannelProvider | null;
  accounts: DiscoveredAccountChoice[];
  /**
   * Why it failed, as a code — 'api_not_enabled', 'no_accounts', 'start_failed'.
   * Never a sentence: the wording is the card's, so it can be translated. Codes
   * the card doesn't recognise fall back to its generic failure line.
   */
  error: string | null;
  /** Non-fatal note, e.g. the Page has no Business Instagram linked. */
  notice: string | null;
}

const INITIAL: ConnectState = {
  phase: 'idle',
  provider: null,
  accounts: [],
  error: null,
  notice: null,
};

const PLUGIN_KEYS: Record<ChannelProvider, string> = {
  meta: 'meta-insights',
  google_analytics: 'google-analytics',
  google_business_profile: 'google-business-profile',
};

export function useChannelConnect(onConnected?: () => void) {
  const [state, setState] = useState<ConnectState>(INITIAL);
  // Held so the chooser's follow-up call knows which provider it belongs to.
  const providerRef = useRef<ChannelProvider | null>(null);

  const reset = useCallback(() => {
    providerRef.current = null;
    setState(INITIAL);
  }, []);

  /** Second half: discover the account server-side and record the opt-in. */
  const finish = useCallback(
    async (provider: ChannelProvider, accountId?: string) => {
      setState(s => ({ ...s, phase: 'connecting', provider, error: null }));

      try {
        const res = await fetch('/api/business-os/channel-insights/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, ...(accountId ? { account_id: accountId } : {}) }),
        });
        const json = await res.json();

        if (!json.success) {
          setState(s => ({
            ...s,
            phase: 'error',
            error: typeof json.error === 'string' ? json.error : 'connect_failed',
          }));
          return;
        }

        if (json.data.needsSelection) {
          setState(s => ({
            ...s,
            phase: 'selecting',
            provider,
            accounts: json.data.accounts,
          }));
          return;
        }

        setState({
          phase: 'connected',
          provider,
          accounts: [],
          error: null,
                notice: json.data.secondary_missing === 'no_business_instagram' ? 'no_business_instagram' : null,
        });
        onConnected?.();
      } catch {
        setState(s => ({ ...s, phase: 'error', error: 'connect_failed' }));
      }
    },
    [onConnected]
  );

  const connect = useCallback(
    async (provider: ChannelProvider) => {
      providerRef.current = provider;
      setState({ ...INITIAL, phase: 'authorizing', provider });

      try {
        const res = await fetch('/api/v2/plugins/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // snake_case: what POST /api/v2/plugins/connect reads off the body.
          body: JSON.stringify({ plugin_key: PLUGIN_KEYS[provider] }),
        });
        const json = await res.json();

        if (!json.success || !json.authUrl) {
          setState(s => ({
            ...s,
            phase: 'error',
            error: 'start_failed',
          }));
          return;
        }

        const popup = window.open(json.authUrl, `${provider}-oauth`, 'width=600,height=760');

        const handleMessage = (event: MessageEvent) => {
          if (
            event.data?.type !== 'plugin-connected' ||
            event.data?.plugin !== PLUGIN_KEYS[provider]
          ) {
            return;
          }
          window.removeEventListener('message', handleMessage);
          clearInterval(closedCheck);

          if (event.data.success) {
            finish(provider);
          } else {
            setState(s => ({
              ...s,
              phase: 'error',
              error: 'not_completed',
            }));
          }
        };
        window.addEventListener('message', handleMessage);

        // A closed popup with no message means the user backed out; without this
        // the caller would sit on "authorizing" forever.
        //
        // Cross-Origin-Opener-Policy blocks reading `popup.closed` for a
        // cross-origin window and logs a warning on every read, so the check is
        // guarded and falls back to a timeout when the browser refuses.
        const startedAt = Date.now();
        const ABANDON_AFTER_MS = 3 * 60 * 1000;

        const closedCheck = setInterval(() => {
          let closed = false;
          try {
            closed = !!popup?.closed;
          } catch {
            // COOP denied the read — rely on the deadline below instead.
          }

          if (closed || Date.now() - startedAt > ABANDON_AFTER_MS) {
            clearInterval(closedCheck);
            window.removeEventListener('message', handleMessage);
            setState(s => (s.phase === 'authorizing' ? INITIAL : s));
          }
        }, 1000);
      } catch {
        setState(s => ({ ...s, phase: 'error', error: 'start_failed' }));
      }
    },
    [finish]
  );

  /** Called from the chooser when the user has more than one account. */
  const selectAccount = useCallback(
    (accountId: string) => {
      const provider = providerRef.current ?? state.provider;
      if (!provider) return;
      finish(provider, accountId);
    },
    [finish, state.provider]
  );

  return {
    ...state,
    connect,
    selectAccount,
    reset,
    isBusy: state.phase === 'authorizing' || state.phase === 'connecting',
  };
}
