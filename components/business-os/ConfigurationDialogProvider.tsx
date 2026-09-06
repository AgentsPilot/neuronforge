'use client';

/**
 * Lets the Configuration tab open the configuration dialog from any page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PROVIDER AND NOT A ROUTE
 *
 * Configuration is the one entry in the tab bar that is not a page. Services,
 * availability, intake and payments live in `ConfigurationDialog`, a modal the
 * capability card on My Day has always opened — and that is what the tab opens
 * too, so the tab and the card do the same thing rather than two things wearing
 * one name.
 *
 * The dialog's state cannot live in the tab bar: closing it has to survive the
 * bar re-rendering, and it must sit above the page, not inside a sticky header
 * with its own stacking context. So the state and the dialog live here, at the
 * layout, and the bar only asks for it to open.
 *
 * Note what this deliberately does NOT do: it does not take over My Day's own
 * `ConfigurationDialog`. That one is driven by the chat — pre-filled services,
 * a single visible tab, days to pre-add, callbacks that post back into the
 * conversation — and rewiring it through a context would put a tested flow at
 * risk for no gain. Two instances of the component exist; every effect inside it
 * is guarded on `isOpen`, so the closed one fetches nothing and costs nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ConfigurationDialog } from '@/components/business-os/ConfigurationDialog';

type ConfigTab = 'services' | 'availability' | 'intake' | 'payments';

interface ConfigurationDialogContextValue {
  /** Open the configuration dialog, optionally on a specific tab. */
  openConfiguration: (initialTab?: ConfigTab) => void;
}

const ConfigurationDialogContext = createContext<ConfigurationDialogContextValue | null>(null);

/**
 * Throws rather than returning a no-op when used outside the provider: a
 * Configuration tab that silently does nothing when clicked is a worse failure
 * than one that shows up immediately in development.
 */
export function useConfigurationDialog(): ConfigurationDialogContextValue {
  const context = useContext(ConfigurationDialogContext);
  if (!context) {
    throw new Error('useConfigurationDialog must be used inside <ConfigurationDialogProvider>');
  }
  return context;
}

export function ConfigurationDialogProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  // Services is where the card has always landed; kept in state so reopening on
  // a different tab actually moves, since the dialog only reads `initialTab`
  // when it opens.
  const [initialTab, setInitialTab] = useState<ConfigTab>('services');

  const openConfiguration = useCallback((tab: ConfigTab = 'services') => {
    setInitialTab(tab);
    setIsOpen(true);
  }, []);

  const value = useMemo(() => ({ openConfiguration }), [openConfiguration]);

  return (
    <ConfigurationDialogContext.Provider value={value}>
      {children}
      <ConfigurationDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        initialTab={initialTab}
      />
    </ConfigurationDialogContext.Provider>
  );
}
