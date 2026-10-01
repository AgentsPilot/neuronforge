/**
 * The Business OS test harness's segment layout (server component).
 *
 * Slice 5b (SA R-2; T-13 layer 2): the harness is open to every signed-in
 * account and middleware skips it, and its "Account setup" and module testers
 * drive the full Business OS API in one click. So the payment hold runs here
 * too: a friend who has not paid is sent to the holding screen. Signed out,
 * the page renders exactly as before (its in-app sign-in still works). See
 * `lib/business-os/invites/paymentHoldGate.ts`.
 */

import type { ReactNode } from 'react';

import { redirectIfAwaitingPayment } from '@/lib/business-os/invites/paymentHoldGate';

// SA N-2: the payment hold reads the session on every request, so this segment
// is never prerendered (a static render would skip the gate, or swallow the
// dynamic-usage signal inside the gate's session read).
export const dynamic = 'force-dynamic';

export default async function TestBusinessOsLayout({ children }: { children: ReactNode }) {
  await redirectIfAwaitingPayment();
  return children;
}
