/**
 * How long a screen waits for a plan payment to land after Stripe's checkout
 * completes (plan payments P-4.2, M-6; moved here from
 * `app/invite/awaiting-payment/PaymentProcessingRefresher.tsx`).
 *
 * Shared by the holding screen and Settings → Plan, so the two cannot drift:
 * every 4 s, at most 15 times (about one minute), each one a server re-read.
 * After the last one, both say "This is taking longer than usual". Neither ever
 * claims success from the browser: only the server re-read can.
 *
 * Plain constants, no import: safe in any client bundle.
 */

export const PROCESSING_REFRESH_INTERVAL_MS = 4000;
export const PROCESSING_REFRESH_LIMIT = 15;
