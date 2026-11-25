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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
// Lazy (PERF-1): the dialog's chunk loads after the page paints, not with it.
import { LazyConfigurationDialog } from '@/components/business-os/lazyDialogs';
import { useCapabilities } from '@/components/business-os/CapabilitiesProvider';

type ConfigTab = 'services' | 'availability' | 'intake' | 'payments' | 'business' | 'invoice';

interface OpenConfigurationOptions {
  /**
   * Show ONLY these tabs, hiding the rest of the dialog's bar.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * For a caller that is answering one question. The dashboard's first setup
   * step is "add your business details", and opening a six-tab dialog on the
   * Business tab asks somebody who pressed one button to work out which of six
   * places they are now in, and whether the other five are also theirs to do.
   *
   * The dialog has always supported this — the chat uses it to open the
   * services editor alone — but it was reachable only by the page that mounts
   * its own instance. Every Business OS surface goes through this provider, so
   * the option had to come with it.
   *
   * Absent means the whole bar, which is right for the Business Setup tab in
   * the navigation: that entry IS the dialog, and hiding its tabs would leave
   * no way to reach them.
   * ───────────────────────────────────────────────────────────────────────────
   */
  visibleTabs?: ConfigTab[];
  /**
   * Called once the dialog closes, so the screen that opened it can refresh.
   *
   * The dashboard's own dialog has always refetched on close; this one had no
   * way to. So the two readiness steps routed through here — company details
   * and invoice details — were saved and then still drawn as outstanding, and
   * the only way to see them go green was to reload the page.
   */
  onClose?: () => void;
}

interface ConfigurationDialogContextValue {
  /** Open the configuration dialog, optionally on a specific tab. */
  openConfiguration: (initialTab?: ConfigTab, options?: OpenConfigurationOptions) => void;
  /**
   * Whether this dialog is up — or was, a moment ago.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * For any surface underneath it. Radix treats a click INSIDE this dialog as
   * an interaction outside whatever is beneath, so a modal below dismisses
   * itself while someone is using this one. That is how publishing an intake
   * form from the booking dialog closed the booking AND the contact drawer
   * behind it, losing everything typed into both.
   *
   * Every such surface needs the same answer, so it is given once here rather
   * than inferred separately by each — the drawer could not have known about a
   * dialog its own grandchild opened.
   *
   * IT STAYS TRUE BRIEFLY AFTER THE CLOSE, and that is the subtle part: the
   * closing click is still in flight when `isOpen` flips. Radix delivers it to
   * the surfaces below immediately afterwards, and a flag that had already gone
   * false lets exactly the dismissal this exists to prevent straight through.
   * ───────────────────────────────────────────────────────────────────────────
   */
  isConfigurationOpen: boolean;
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

/**
 * The same thing, for a component that may render OUTSIDE Business OS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `useConfigurationDialog` throwing is right for anything that lives inside
 * Business OS — a Configuration tab that quietly does nothing is worse than a
 * loud failure in development. But some components render in both worlds:
 * `SchedulingBookingModal` is used on `/business-os` AND on the V1
 * `/(protected)/scheduling` page, which has no provider above it.
 *
 * Such a component must not take the whole page down to offer a shortcut. This
 * returns null there, and the caller hides the shortcut — the message it sits
 * beside already names where to go, so nothing is lost but the click.
 *
 * Use the throwing version everywhere else. A component that genuinely belongs
 * to Business OS and reaches for this one is hiding a wiring mistake.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useConfigurationDialogOptional(): ConfigurationDialogContextValue | null {
  return useContext(ConfigurationDialogContext);
}

/**
 * Just the flag, safe to call anywhere — false where there is no provider.
 *
 * For a surface that only needs to know whether to hold its ground.
 */
export function useConfigurationDialogOpen(): boolean {
  return useContext(ConfigurationDialogContext)?.isConfigurationOpen ?? false;
}

export function ConfigurationDialogProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  // Services is where the card has always landed; kept in state so reopening on
  // a different tab actually moves, since the dialog only reads `initialTab`
  // when it opens.
  const [initialTab, setInitialTab] = useState<ConfigTab>('services');
  /* Per-open, and cleared on close: a later open that asks for the whole bar
     must not inherit the last caller's single tab. */
  const [visibleTabs, setVisibleTabs] = useState<ConfigTab[] | undefined>(undefined);

  /*
   * A ref, not state: this is read once on close and must never be a render
   * input. Held per-open and cleared as it fires, so a later open that passes
   * no callback cannot inherit the previous caller's.
   */
  const onCloseRef = useRef<(() => void) | undefined>(undefined);

  /*
   * True from the moment this opens until a beat AFTER it closes.
   *
   * Separate from `isOpen`, which has to go false immediately so the dialog
   * unmounts. The surfaces below need the opposite: the closing click is still
   * being dispatched when that happens, and they are asked "should I dismiss?"
   * a moment later. Answering honestly at that instant — "no dialog is open" —
   * is what let the booking dialog and the contact drawer close themselves.
   */
  const [closingGrace, setClosingGrace] = useState(false);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (graceTimer.current) clearTimeout(graceTimer.current);
  }, []);

  const openConfiguration = useCallback(
    (tab: ConfigTab = 'services', options?: OpenConfigurationOptions) => {
      if (graceTimer.current) {
        clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
      setClosingGrace(false);
      setInitialTab(tab);
      setVisibleTabs(options?.visibleTabs);
      onCloseRef.current = options?.onClose;
      setIsOpen(true);
    },
    []
  );

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * `?configure=<tab>` OPENS THIS DIALOG FROM A LINK.
   *
   * There was no way to reach it by URL, which is fine for everything inside
   * Business OS — those surfaces hold the context and call `openConfiguration`
   * directly — and is not fine for the screens that sit OUTSIDE this provider.
   *
   * The reported case: the onboarding build screen opens the services editor
   * in its own dialog, with no provider above it. That editor warns "card
   * payments need a connected processor" and offers a Connect link, which
   * `useGapFixOptional` withholds there because there is no dialog to open. So
   * an owner who had chosen card payments met the one sentence telling them
   * what was wrong, with nothing to press and no Stripe step anywhere on the
   * screen. A link needs somewhere to go; this is it.
   *
   * Read from `window.location`, not `useSearchParams`: that hook opts the
   * whole subtree into dynamic rendering and needs a Suspense boundary above
   * it, which is a large change to make for one query string. This is a
   * client-only, one-shot read.
   *
   * The param is STRIPPED once used, so a refresh does not reopen the dialog
   * and a copied URL is not a trap. `replaceState` rather than a router push:
   * no navigation, no refetch, nothing else on the page disturbed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const asked = url.searchParams.get('configure');
    if (!asked) return;

    url.searchParams.delete('configure');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);

    const TABS: ConfigTab[] = ['services', 'availability', 'intake', 'payments', 'business', 'invoice'];
    if ((TABS as string[]).includes(asked)) openConfiguration(asked as ConfigTab);
    /* Mount only: a param consumed once, by the page that was linked to. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * What an account HAS follows what it sells, and this dialog is where what it
   * sells is edited. Publishing the first priced service makes `payments` true,
   * which is the Orders tab — so the navigation is re-asked on close rather
   * than showing the answer from before the edit until the next full reload.
   */
  const { refresh: refreshCapabilities } = useCapabilities();

  const handleClose = useCallback(() => {
    setIsOpen(false);
    refreshCapabilities();

    /*
     * Long enough to cover the dismissal and the exit animation. A deliberate
     * click outside a third of a second later closes as it always did.
     */
    setClosingGrace(true);
    if (graceTimer.current) clearTimeout(graceTimer.current);
    graceTimer.current = setTimeout(() => setClosingGrace(false), 350);

    const notify = onCloseRef.current;
    onCloseRef.current = undefined;
    notify?.();
  }, [refreshCapabilities]);

  const value = useMemo(
    () => ({ openConfiguration, isConfigurationOpen: isOpen || closingGrace }),
    [openConfiguration, isOpen, closingGrace]
  );

  return (
    <ConfigurationDialogContext.Provider value={value}>
      {children}
      <LazyConfigurationDialog
        isOpen={isOpen}
        onClose={handleClose}
        initialTab={initialTab}
        visibleTabs={visibleTabs}
      />
    </ConfigurationDialogContext.Provider>
  );
}
