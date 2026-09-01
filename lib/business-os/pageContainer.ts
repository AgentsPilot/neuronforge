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
