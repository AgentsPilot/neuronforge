/**
 * Which way a row's ⋯ menu should open.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THING THAT IS EASY TO GET WRONG
 *
 * The first version measured against the VIEWPORT, and the menu kept opening
 * downward off the bottom of the card. The viewport had plenty of room — the
 * page continued well below — so nothing ever triggered a flip.
 *
 * What actually clips these menus is the DRAWER: a scrolling panel whose bottom
 * edge is nowhere near the window's. So the question is not "does this fit on
 * screen" but "does this fit inside the box that will cut it off", and the only
 * way to answer that is to find the box.
 *
 * Walks up to the nearest ancestor that scrolls, and falls back to the viewport
 * when there is none — a menu in an ordinary page is bounded by the window and
 * nothing else.
 *
 * @module components/crm/contact-drawer/menuPlacement
 */

/** About one menu item, including its padding. */
const ITEM_HEIGHT = 34;

/** The panel's own border, rounding and offset from the trigger. */
const PANEL_CHROME = 16;

/**
 * The nearest ancestor that will clip an absolutely positioned child.
 *
 * `overflow: visible` cannot clip, so it is skipped; anything else — auto,
 * scroll, hidden, clip — bounds the menu whether or not it happens to be
 * scrollable right now.
 */
function clippingAncestor(from: Element): Element | null {
  let node = from.parentElement;

  while (node && node !== document.body) {
    const { overflowY, overflow } = getComputedStyle(node);

    if (overflowY !== 'visible' || overflow !== 'visible') return node;
    node = node.parentElement;
  }

  return null;
}

/**
 * Should the menu open above its trigger?
 *
 * @param trigger the button the menu hangs from
 * @param itemCount how many rows the menu will have
 *
 * Only true when the other side genuinely has more room, so a cramped panel
 * does not trade one clipped edge for the other.
 */
export function shouldOpenUpward(trigger: Element | null, itemCount: number): boolean {
  if (!trigger || typeof window === 'undefined') return false;

  const rect = trigger.getBoundingClientRect();
  const needed = itemCount * ITEM_HEIGHT + PANEL_CHROME;

  const bounds = clippingAncestor(trigger)?.getBoundingClientRect();
  const floor = bounds ? Math.min(bounds.bottom, window.innerHeight) : window.innerHeight;
  const ceiling = bounds ? Math.max(bounds.top, 0) : 0;

  const below = floor - rect.bottom;
  const above = rect.top - ceiling;

  return below < needed && above > below;
}
