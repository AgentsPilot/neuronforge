/**
 * The Business OS test harness's segment layout (server component).
 *
 * Slice 5b (SA R-2; T-13 layer 2): the harness is open to every signed-in
 * account and middleware skips it, and its "Account setup" and module testers
 * drive the full Business OS API in one click. So the payment hold runs here
 * too: a friend who has not paid is sent to the holding screen. Signed out,
 * the page renders exactly as before (its in-app sign-in still works). See
 * `lib/business-os/invites/paymentHoldGate.ts`.
 *
 * PROD-1c A-1: in production the test-surface gate runs before the payment
 * hold, so a non-admin (signed out included) gets the not-found screen with a
 * `noindex` tag and no harness content, at HTTP 200, not 404 (the `next/dynamic`
 * `PlatformShell` boundary catches the `notFound()`; F-10, SA B-3 option (c)).
 * The in-app sign-in is therefore not reachable there; an admin signs in
 * through the app first. Off production nothing changes.
 */

import type { ReactNode } from 'react';

import { redirectIfAwaitingPayment } from '@/lib/business-os/invites/paymentHoldGate';
import { testSurfacePageGate } from '@/lib/security/testSurfaceGate';

// SA N-2: the payment hold reads the session on every request, so this segment
// is never prerendered (a static render would skip the gate, or swallow the
// dynamic-usage signal inside the gate's session read).
export const dynamic = 'force-dynamic';

export default async function TestBusinessOsLayout({ children }: { children: ReactNode }) {
  // PROD-1c A-1: first. In production this harness renders for admins only;
  // everyone else gets the not-found screen (HTTP 200, no content, noindex).
  // The API routes are the boundary, this is defence in depth
  // (lib/security/testSurfaceGate.ts).
  await testSurfacePageGate();
  await redirectIfAwaitingPayment();
  return children;
}
