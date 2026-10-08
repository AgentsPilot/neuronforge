/**
 * The horizontal contract for every Business OS screen.
 *
 * The header, the tab bar and the page body are three separate components
 * stacked on top of each other, and their left and right edges have to land on
 * the same line. They did not: the header used `px-3 sm:px-4 lg:px-6`, five of
 * the seven pages used `px-4 sm:px-6`, My Day used the header's, and the tab bar
 * capped at 1400px while every page capped at `max-w-7xl` (1280px) — so the tabs
 * ran wider than the content beneath them, and the gutters stepped in and out at
 * three different breakpoints.
 *
 * One exported string instead, so the next component to join the stack cannot
 * pick a fourth set of numbers. `px-4 sm:px-6` is the gutter the majority of
 * pages already used; `max-w-7xl` is what all of them already used.
 *
 * Vertical padding is deliberately NOT here — it varies by screen (Reports is
 * denser than Settings) and is none of this contract's business.
 */
export const PAGE_CONTAINER = 'max-w-7xl mx-auto px-4 sm:px-6';

/**
 * The grid every client-facing page lays its cards out on.
 *
 * Four tracks on a desktop, two on a tablet, one on a phone. Cards ask for
 * width with `sm:col-span-2` or `col-span-full`; anything that asks for
 * nothing takes a single track.
 *
 * Here for the same reason as `PAGE_CONTAINER` above: the string was declared
 * in three places — the portal shell, the portal index's own tiles, and the
 * `sm:col-span-2` wrappers in `PortalRail` that only make sense against it —
 * with nothing keeping them in step. A rail wrapper written for a four-column
 * grid is silently wrong on a three-column one, and nothing would have caught
 * it.
 *
 * Deliberately NOT including `gap`: the shell sets the gutter, and a card that
 * sets its own would fight it.
 *
 * FOUR TRACKS, and the two-track cards are what make it read as two columns.
 * The appointment, the meeting list and the opening hours each take two, so in
 * Hebrew they stack down the right; the single-track cards pair up on the left
 * as payment plus intake, then the plan across both, then the quote plus the
 * client's details, then contact. That is the arrangement, and the order
 * values below are the only place it is decided.
 *
 * `items-start`, and this is the part that was wrong twice. A grid stretches
 * every item to the height of the tallest in its row, so a payment card of
 * three short lines beside a tall appointment became a huge block of empty
 * brand colour. Aligned bottoms are not worth that: cards take their natural
 * height and the row's bottom edge is uneven, which is what a wall of cards is
 * supposed to look like.
 */
export const PORTAL_GRID = 'grid grid-cols-1 items-start sm:grid-cols-2 lg:grid-cols-4';
