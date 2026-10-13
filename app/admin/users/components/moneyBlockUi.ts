'use client';

/**
 * Shared parts of the two money blocks of the Businesses drawer (Admin Layout
 * follow-ups LF-4b; BD-5, BD-15). Local to this screen, not a shared export.
 *
 * - `MONEY_ACTION_BAR`: the bordered row that holds a money part's buttons,
 *   apart from its figures (BD-5).
 * - `useReturnFocus`: F-108. The money dialogs are opened by state, with no
 *   Radix trigger, so on close Radix would focus nothing and focus would fall
 *   to `<body>`. The hook remembers the button that opened the dialog and
 *   returns focus to it; when that button has left the document (the lot was
 *   emptied, the limit ended, a re-read is running), focus goes to the money
 *   section's heading instead, never `<body>` (BD-15, SA-C8).
 */

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/** The bordered action row of a money part (BD-5). */
export const MONEY_ACTION_BAR =
  'flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/40 p-2';

/**
 * Focus the heading of the drawer section around `from`: the element that the
 * closest labelled group (`DrawerSection`: `role="group"` with
 * `aria-labelledby`) is named by (SA C4). The heading gets `tabindex="-1"` so
 * it can take focus; React does not manage that attribute on it. With no such
 * group (a block rendered alone), `from` itself is the target.
 */
export function focusSectionHeading(from: HTMLElement | null): void {
  if (!from) return;
  const group = from.closest('[role="group"][aria-labelledby]');
  const labelId = group?.getAttribute('aria-labelledby') ?? null;
  const heading = labelId ? from.ownerDocument.getElementById(labelId) : null;
  const target = heading ?? from;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
}

/** An opener that is gone, or inside a folded (hidden) part a browser will not focus. */
function isGone(element: HTMLElement | null): boolean {
  return !element || !element.isConnected || element.closest('[hidden]') !== null;
}

export interface ReturnFocus {
  /** Called with the button that opens a dialog, just before it opens. */
  remember: (element: HTMLElement | null) => void;
  /** Passed to the dialog's `DialogContent` as `onCloseAutoFocus`. */
  onCloseAutoFocus: (event: Event) => void;
}

/**
 * Why it works (SA C6):
 * (a) The opener can leave the document after the close: the re-read that
 *     follows a success empties a lot or ends a limit. The no-deps layout
 *     effect checks after every commit of the block that uses the hook. For
 *     the top-up's Take back credits, the top-up row loses its button in the
 *     PANEL's commit; `CreditsBlock` re-renders in that same commit only
 *     because it is not memoised. Do not memoise it.
 * (b) Layout effects run inside the commit, before the drawer FocusScope's
 *     MutationObserver (a microtask) would move focus to the drawer itself.
 * T-R3 in `businessDrawer.money.render` fails if either stops being true.
 */
export function useReturnFocus(rootRef: RefObject<HTMLElement | null>): ReturnFocus {
  const opener = useRef<HTMLElement | null>(null);
  /** Armed after focus went back to the opener; disarmed once focus is elsewhere. */
  const guarding = useRef(false);

  const remember = useCallback((element: HTMLElement | null) => {
    opener.current = element;
  }, []);

  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      // Radix's own return would focus the (absent) trigger: F-108.
      event.preventDefault();
      const target = opener.current;
      if (target && !isGone(target)) {
        target.focus();
        guarding.current = true;
      } else {
        guarding.current = false;
        focusSectionHeading(rootRef.current);
      }
    },
    [rootRef]
  );

  useLayoutEffect(() => {
    if (!guarding.current) return;
    const target = opener.current;
    const active = document.activeElement;
    if (target && !isGone(target) && active === target) return;
    guarding.current = false;
    if (isGone(target) && (active === null || active === document.body)) focusSectionHeading(rootRef.current);
  });

  return { remember, onCloseAutoFocus };
}
