/**
 * The whole-row click of an admin list (user decision D-17, 2026-10-11; SA
 * Q-1), shared by the Businesses page and Finance (Money MK-10, SA-Q-MK10-1
 * option A) so the two can never drift.
 *
 * A click anywhere on a row opens it, as a MOUSE EXTRA only:
 *   - never a click on a control inside the row (rule 2): the Open button is a
 *     control too, so a click on it opens once, through the button only;
 *   - never while the admin is selecting text inside the row (rule 3);
 *   - the opener is always the row's Open button (rule 4), never the row, so
 *     focus returns to that button on close (D-6), whichever path opened it.
 * The row itself gets no `tabIndex`, role, key handler or ARIA: the Open button
 * is the keyboard path.
 *
 * Pure: no state, no fetch, no hook. A page calls `rowOpenTarget(event)` from
 * the row's `onClick` and opens with the button it returns (or does nothing on
 * null), through the SAME function its Open button calls.
 */

/** Rule 2: the controls whose clicks are their own, never a row open. Exact text kept from D-17. */
export const ROW_CONTROL_SELECTOR =
  'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]';

/** The row's Open button (rule 4): `OpenRowButton` with this test id. */
export const ROW_OPEN_TEST_ID = 'row-open';

/** Rule 3: the admin is selecting text inside this row, so a click is not an "open". */
export function isSelectingIn(row: HTMLElement): boolean {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const { anchorNode, focusNode } = selection;
  return Boolean((anchorNode && row.contains(anchorNode)) || (focusNode && row.contains(focusNode)));
}

/**
 * The row's Open button to open with, or null when this click is not an open:
 * a click on a control inside the row, a click while selecting text in it, or
 * a row with no Open button.
 */
export function rowOpenTarget(event: { currentTarget: HTMLElement; target: EventTarget | null }): HTMLButtonElement | null {
  const row = event.currentTarget;
  const target = event.target;
  if (target instanceof Element) {
    const control = target.closest(ROW_CONTROL_SELECTOR);
    if (control && row.contains(control)) return null;
  }
  if (isSelectingIn(row)) return null;
  return row.querySelector<HTMLButtonElement>(`[data-testid="${ROW_OPEN_TEST_ID}"]`);
}
