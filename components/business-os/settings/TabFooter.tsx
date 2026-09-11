'use client';

/**
 * The action bar at the bottom of a configuration tab — frozen, not scrolling.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS FROZEN
 *
 * These tabs scroll: the invoice form runs well past a screen, and so does the
 * business profile once the onboarding facts are showing. With Save at the end
 * of the document, saving meant scrolling to the bottom first, and the
 * confirmation that followed rendered in the one place the reader had just
 * left. An owner who corrected the company name at the top of the form had no
 * way to tell whether it had taken.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PORTAL AND NOT `position: sticky`
 *
 * Sticky would keep the bar in the scrolling content: it still occupies space
 * at the end of the document, it can only stick within its own parent's box,
 * and any ancestor that sets `overflow` silently switches it off — which is
 * exactly the shape of the tab bodies here. The bar is rendered into a slot the
 * dialog owns *outside* its scroll container instead, so it is a sibling of the
 * scrolling area and simply never moves.
 *
 * The slot host is empty until a tab fills it, and `empty:hidden` keeps its
 * border from drawing on tabs that have no actions — a portal's children make
 * the host non-empty, so the CSS follows the content by itself.
 *
 * Outside the dialog (the onboarding build screen mounts the invoice section
 * too) there is no slot, and the bar renders inline where it always did.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

/**
 * The element a tab's action bar is rendered into.
 *
 * Held as state rather than a ref by the dialog: a ref would still be null on
 * the render that mounts the tab, and the bar would never appear.
 */
const TabFooterSlotContext = createContext<HTMLElement | null>(null);

export const TabFooterSlotProvider = TabFooterSlotContext.Provider;

/** The host element for the frozen bar. Renders nothing until a tab fills it. */
export function TabFooterSlot({ hostRef }: { hostRef: (node: HTMLElement | null) => void }) {
  return (
    <div
      ref={hostRef}
      className="shrink-0 border-t border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-3 empty:hidden sm:px-4 md:px-6"
    />
  );
}

interface TabFooterProps {
  /**
   * Status shown beside the actions — a save confirmation, an error, a note
   * about what is not published yet. Takes the reading side so the buttons stay
   * where the eye already looks for them.
   */
  message?: React.ReactNode;
  /** The buttons. */
  children: React.ReactNode;
}

export function TabFooter({ message, children }: TabFooterProps) {
  const slot = useContext(TabFooterSlotContext);

  const row = (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-end gap-3">
      {/* min-w-0 so a long error wraps inside the bar instead of pushing the
          buttons off the end of it. */}
      {message ? <div className="min-w-0 flex-1">{message}</div> : <div className="flex-1" />}
      {children}
    </div>
  );

  if (!slot) {
    return (
      <div className="mt-6 border-t border-[var(--v2-border)] pt-4">{row}</div>
    );
  }

  return createPortal(row, slot);
}
