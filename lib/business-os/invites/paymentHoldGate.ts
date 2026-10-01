import 'server-only';

/**
 * The payment-hold GATE (invite-only signup Slice 5b; T-13 layer 2, F5b-4;
 * workplan D-8, SA R-1 to R-4).
 *
 * Production wiring over `paymentHold.ts`, for server components only:
 *
 *   redirectIfAwaitingPayment()  the first statement of four layouts:
 *                                `/onboarding-chat`, `/onboarding-build` (R-1),
 *                                `/business-os` and `/test-business-os` (R-2).
 *                                A held account is sent to the holding screen.
 *   readHoldForSession()         the holding screen's own read (R-4).
 *
 * ── Why these four layouts, and not middleware ─────────────────────────────
 * Middleware sends every account without a completed business profile (a held
 * friend has none) to `/onboarding-chat`, and skips `/onboarding*` and
 * `/test-business-os` altogether. So the page paths into the product are
 * exactly these four segments. `/onboarding-build` matters most: its page
 * writes a COMPLETED profile, after which middleware would let the account
 * into every other signed-in page (SA R-1). Middleware itself runs on every
 * request, and reaches Supabase directly already; this keeps new reads out of
 * it. The API routes are NOT covered: that is the accepted F5b-5 residual,
 * closed at `enforce`.
 *
 * ── Mode-independent, and fail-open only on an unreadable lineage ──────────
 * It reads lineage (and, for 5c's admin Paid invites, the invite) through
 * `readPaymentHold`, never `EntitlementService`, `check()`, the mode or a plan
 * row. From the entitlements module it takes `resolveAccountId` only, as the
 * account seam. No session, a failed session read, or a failed hold read all
 * fall through open, logged (SA Q-2); T-13 layer 1 still stops a trial.
 *
 * `redirect()` throws by design, so it is called OUTSIDE every try/catch.
 */

import { redirect } from 'next/navigation';

import { getUser } from '@/lib/auth';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { defaultLocale, isValidLocale } from '@/lib/i18n/config';
import { createLogger } from '@/lib/logger';
import { businessOsAccountLineageRepository } from '@/lib/repositories/BusinessOsAccountLineageRepository';
import { businessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';

import { AWAITING_PAYMENT_PATH, readPaymentHold, type PaymentHold, type PaymentHoldReaders } from './paymentHold';

const logger = createLogger({ module: 'BusinessOsPaymentHoldGate' });

const READERS: PaymentHoldReaders = {
  lineage: businessOsAccountLineageRepository,
  invites: businessOsInviteRepository,
};

type SessionHold = { signedIn: false } | { signedIn: true; accountId: string; hold: PaymentHold };

async function readSessionHold(): Promise<SessionHold> {
  let user: Awaited<ReturnType<typeof getUser>> = null;
  try {
    user = await getUser();
  } catch (error) {
    logger.warn({ err: error }, 'Session read failed; the payment hold treats the visitor as signed out');
    return { signedIn: false };
  }
  if (!user) return { signedIn: false };

  const accountId = resolveAccountId(user.id);
  try {
    return { signedIn: true, accountId, hold: await readPaymentHold(accountId, READERS) };
  } catch (error) {
    logger.error({ err: error, accountId }, 'Payment hold read threw');
    return { signedIn: true, accountId, hold: { ok: false } };
  }
}

/**
 * The layouts' gate (T-13 layer 2). Redirects a held account to the holding
 * screen; returns for everyone else, including when the hold cannot be read
 * (fail open, SA Q-2).
 */
export async function redirectIfAwaitingPayment(): Promise<void> {
  const session = await readSessionHold();
  if (!session.signedIn) return;
  if (!session.hold.ok) {
    logger.error({ accountId: session.accountId }, 'Payment hold unreadable; failing open (SA Q-2)');
    return;
  }
  if (session.hold.held) {
    logger.info({ accountId: session.accountId }, 'Account awaiting payment; sent to the holding screen');
    // Outside any try/catch: `redirect` throws NEXT_REDIRECT on purpose.
    redirect(AWAITING_PAYMENT_PATH);
  }
}

/**
 * What the holding screen shows (SA R-4). `error` never becomes "not held":
 * one failed read on the screen must not release a friend the layout just held.
 * `language` is the invite's own (the champion's explicit choice for this
 * friend, C-8), falling back to the default; a failed language read does not
 * change the state.
 */
export type HoldingScreenState =
  | { state: 'signed_out' }
  | { state: 'not_held' }
  | { state: 'error' }
  | { state: 'held'; language: string };

export async function readHoldForSession(): Promise<HoldingScreenState> {
  const session = await readSessionHold();
  if (!session.signedIn) return { state: 'signed_out' };
  if (!session.hold.ok) {
    logger.error({ accountId: session.accountId }, 'Payment hold unreadable on the holding screen');
    return { state: 'error' };
  }
  if (!session.hold.held) return { state: 'not_held' };

  let language = defaultLocale as string;
  if (session.hold.inviteId) {
    const invite = await businessOsInviteRepository.findHoldFactsById(session.hold.inviteId);
    if (invite.data && isValidLocale(invite.data.language)) language = invite.data.language;
  }
  return { state: 'held', language };
}
