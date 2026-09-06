'use client';

/**
 * Which capabilities this account has switched on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT LIVES IN THE LAYOUT
 *
 * The capability cards on My Day have always been gated on this — a business
 * with no website never saw an Online presence card. The tab bar was not, so it
 * offered all six to everyone and sent people to pages their account has nothing
 * behind.
 *
 * The bar renders from the layout, so the answer has to be available there. And
 * because App Router keeps a layout mounted across navigations within it, this
 * fetches once per full page load rather than once per tab click — moving
 * between tabs does not re-ask, and the bar does not re-flicker.
 *
 * My Day consumes this too, instead of its own copy of the same request.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createLogger } from '@/lib/logger';
import type { CapabilitiesStatus } from '@/lib/business-os/tabVisibility';

const logger = createLogger({ module: 'CapabilitiesProvider' });

/**
 * `loading` — asked, no answer yet.
 * `ready`   — the answer is in `capabilities`.
 * `error`   — the request failed, so `capabilities` is empty but MEANINGLESS.
 *
 * Defined alongside the visibility rule that consumes it, in
 * `lib/business-os/tabVisibility`, so the two cannot drift.
 */
export type { CapabilitiesStatus };

interface CapabilitiesContextValue {
  capabilities: Set<string>;
  status: CapabilitiesStatus;
}

const CapabilitiesContext = createContext<CapabilitiesContextValue | null>(null);

/**
 * Returns an empty, `error`-marked result outside a provider rather than
 * throwing: this gates what a reader can see, and a hard crash of the whole
 * Business OS is a worse outcome than a bar that falls back to showing
 * everything.
 */
export function useCapabilities(): CapabilitiesContextValue {
  return useContext(CapabilitiesContext) ?? { capabilities: new Set<string>(), status: 'error' };
}

export function CapabilitiesProvider({ children }: { children: React.ReactNode }) {
  const [capabilities, setCapabilities] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<CapabilitiesStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/capabilities', { cache: 'no-store' });
        if (!response.ok) throw new Error(`/api/capabilities responded ${response.status}`);

        const data = await response.json();
        if (cancelled) return;

        // A 200 whose body says otherwise is still a failure — treating it as
        // "no capabilities" would silently strip the bar down to two tabs.
        if (!data?.success || !Array.isArray(data.enabledKeys)) {
          throw new Error('/api/capabilities returned no enabledKeys');
        }

        setCapabilities(new Set<string>(data.enabledKeys));
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        logger.error({ err }, 'Failed to load capabilities');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ capabilities, status }), [capabilities, status]);

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}
