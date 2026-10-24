'use client';

/**
 * Opens the plan comparison window from any Business OS page (upgrade modal
 * UM-2, workplan §4; C-4 / UM-SA5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONTRACT
 *
 * `useUpgradeModal().openUpgradeModal(context)`, where `context` is the
 * three-member `UpgradeModalContext` union and nothing else: no name, price,
 * offer or callback, no URL parameter, no window event. The window reads the
 * plan itself, once per open, and runs its own flow (`StandaloneUpgradeModal`).
 *
 * The shape is `ConfigurationDialogProvider`'s: state and opener in context,
 * the window rendered closed after `{children}` through the PERF-1 loader, so
 * nothing runs at page load except the chunk warm-up.
 *
 * NEVER OVER THE SETTINGS DRAWER (UM-SA2). `PlanSection` mounts only while the
 * plan drawer is open, and it hosts its own window. It registers itself with
 * `useUpgradeModalInlineHost()`; while any host is registered,
 * `openUpgradeModal` refuses (a `debug` line, nothing portals), so two Stripe
 * Embedded Checkouts can never share a page (C-12). The count is a ref, not
 * state (X-4): registering must not re-render the layout subtree.
 *
 * A second `openUpgradeModal` while the window is open is ignored (SA Q-5):
 * nothing on screen changes under the owner.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// Lazy (PERF-1): the window's chunk loads after the page paints, not with it.
import { LazyUpgradeModal } from '@/components/business-os/lazyDialogs';
import { createLogger } from '@/lib/logger';

import { SETTINGS_CONTEXT, type UpgradeModalContext } from './upgradeModalContext';

const logger = createLogger({ module: 'BusinessOsUpgradeModal' });

/** The closing grace, as `isConfigurationOpen` has it: the closing click is still in flight when the window goes. */
const CLOSING_GRACE_MS = 350;

export interface UpgradeModalContextValue {
  /** Open the plan comparison window for this reason. Refused while the Settings plan drawer hosts its own. */
  openUpgradeModal: (context: UpgradeModalContext) => void;
  /** True while open, and for a moment after it closes (see `useUpgradeModalOpen`). */
  isUpgradeModalOpen: boolean;
}

const UpgradeModalReactContext = createContext<UpgradeModalContextValue | null>(null);
/** Stable for the provider's life: registering a host never re-renders a consumer. */
const InlineHostContext = createContext<(() => () => void) | null>(null);

/**
 * Throws outside the provider, as `useConfigurationDialog` does: a locked
 * action whose upgrade link silently does nothing is the worse failure.
 */
export function useUpgradeModal(): UpgradeModalContextValue {
  const value = useContext(UpgradeModalReactContext);
  if (!value) {
    throw new Error('useUpgradeModal must be used inside <UpgradeModalProvider>');
  }
  return value;
}

/**
 * Just the flag, `false` where there is no provider.
 *
 * WHY IT EXISTS (SA Q-6, workplan R-2): a future caller inside a Radix sheet (a
 * contact drawer, say) has the problem `isConfigurationOpen` answers. Radix
 * treats a click inside this window as an interaction outside the sheet, so the
 * sheet would dismiss itself while the owner is choosing a plan. The flag stays
 * true for a moment after the close for the same reason: the closing click is
 * delivered to the sheet just after the window has gone.
 */
export function useUpgradeModalOpen(): boolean {
  return useContext(UpgradeModalReactContext)?.isUpgradeModalOpen ?? false;
}

/**
 * Called by `PlanSection` (UM-SA2): while it is mounted, the provider refuses to
 * open its own window. A no-op without a provider (the section's suites render
 * without one).
 */
export function useUpgradeModalInlineHost(): void {
  const register = useContext(InlineHostContext);
  useEffect(() => (register ? register() : undefined), [register]);
}

export function UpgradeModalProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<UpgradeModalContext | null>(null);
  /** X-4: a ref, never a render input. */
  const inlineHosts = useRef(0);
  const [closingGrace, setClosingGrace] = useState(false);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (graceTimer.current) clearTimeout(graceTimer.current);
    },
    []
  );

  const openUpgradeModal = useCallback((next: UpgradeModalContext) => {
    if (inlineHosts.current > 0) {
      logger.debug({ contextKind: next.kind }, 'Upgrade modal open refused: the Settings plan drawer hosts its own');
      return;
    }
    if (graceTimer.current) {
      clearTimeout(graceTimer.current);
      graceTimer.current = null;
    }
    setClosingGrace(false);
    // SA Q-5: an open window keeps its context.
    setContext((current) => current ?? next);
  }, []);

  const close = useCallback(() => {
    setContext(null);
    setClosingGrace(true);
    if (graceTimer.current) clearTimeout(graceTimer.current);
    graceTimer.current = setTimeout(() => setClosingGrace(false), CLOSING_GRACE_MS);
  }, []);

  const registerInlineHost = useCallback(() => {
    inlineHosts.current += 1;
    return () => {
      inlineHosts.current -= 1;
    };
  }, []);

  const value = useMemo(
    () => ({ openUpgradeModal, isUpgradeModalOpen: context !== null || closingGrace }),
    [openUpgradeModal, context, closingGrace]
  );

  return (
    <UpgradeModalReactContext.Provider value={value}>
      <InlineHostContext.Provider value={registerInlineHost}>
        {children}
        <LazyUpgradeModal isOpen={context !== null} onClose={close} context={context ?? SETTINGS_CONTEXT} />
      </InlineHostContext.Provider>
    </UpgradeModalReactContext.Provider>
  );
}
