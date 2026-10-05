/**
 * "The owner's credit usage may have changed" — one typed browser signal
 * (credit deduction slice 6a, FR-39 trigger (a), SA SQ-24; new pattern
 * approved by SA, CLAUDE.md rule 7).
 *
 * An owner AI action (a chat answer, a briefing load, an intake generation, a
 * generated image) finishes in one component; the credits card lives in
 * another. The action raises this once it has finished — success or failure —
 * and the card re-reads. Nothing else.
 *
 * Deliberately small:
 *   - a `window` event with NO payload: it carries no figures, so no component
 *     can show a number that did not come from the server;
 *   - no context provider, no cross-tab channel, no timer of any kind;
 *   - SSR-safe: without `window` both functions do nothing;
 *   - raising with no card mounted is a no-op.
 *
 * @module lib/business-os/client/creditUsageSignal
 */

/** The event name. The one constant both sides share. */
export const CREDIT_USAGE_CHANGED_EVENT = 'business-os:credit-usage-changed';

/** Raise after an owner AI action has finished (success or failure). */
export function notifyCreditUsageChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CREDIT_USAGE_CHANGED_EVENT));
}

/** Listen for the signal. Returns the unsubscribe function. */
export function onCreditUsageChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  // The handler receives nothing: the event has no payload to pass on.
  const listener = () => handler();
  window.addEventListener(CREDIT_USAGE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(CREDIT_USAGE_CHANGED_EVENT, listener);
}
