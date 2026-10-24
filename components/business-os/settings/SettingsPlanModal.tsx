'use client';

/**
 * "Your plan" as the comparison pop-up, opened straight from the Settings row
 * when the server offers something (upgrade modal UM-D3; SA R-2, R-5 to R-7,
 * R-10, R-11; conditions D3-2, D3-5, D3-7, D3-10, D3-11).
 *
 * A Settings-owned instance, NOT the layout provider's: the provider's contract
 * is the three-member context only (C-4), and this surface needs the URL
 * checkout marker, the page's first read and focus return to the row, none of
 * which may enter that context. It mounts the same `UpgradeSession` the
 * standalone window does (one session component, one `usePlanFlow` per open,
 * UM-SA1), with:
 *   - the page's first read (R-8) and the checkout marker (R-7);
 *   - the "Your plan" strip: badge + name for every account, the failed-renewal
 *     lines, a collapsed "What your plan includes" (R-5, R-6);
 *   - `afterCheckout: 'stay'`: a checkout or an upgrade completed here keeps the
 *     window open, with its status in the body (R-7);
 *   - focus back to the "Your plan" row.
 *
 * Closed, it renders nothing. While open it registers as the inline host, so
 * the layout's `openUpgradeModal` refuses (R-10, C-12: never two Stripe
 * checkouts on one page). The page never mounts it together with the drawer
 * (R-3).
 */

import type { RefObject } from 'react';

import type { PlanRead } from './planDrawerReads';
import { useUpgradeModalInlineHost } from './UpgradeModalProvider';
import { SETTINGS_CONTEXT } from './upgradeModalContext';
import { UpgradeSession } from './UpgradeSession';

export function SettingsPlanModal({
  open,
  onClose,
  firstRead,
  checkoutMarker,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  firstRead: Promise<PlanRead> | null;
  checkoutMarker: string | null;
  returnFocusRef: RefObject<HTMLElement>;
}) {
  if (!open) return null;
  return <SettingsPlanSession onClose={onClose} firstRead={firstRead} checkoutMarker={checkoutMarker} returnFocusRef={returnFocusRef} />;
}

function SettingsPlanSession({
  onClose,
  firstRead,
  checkoutMarker,
  returnFocusRef,
}: {
  onClose: () => void;
  firstRead: Promise<PlanRead> | null;
  checkoutMarker: string | null;
  returnFocusRef: RefObject<HTMLElement>;
}) {
  // R-10: mounted only while open, so the provider refuses only while it shows.
  useUpgradeModalInlineHost();
  return (
    <UpgradeSession
      onClose={onClose}
      context={SETTINGS_CONTEXT}
      firstRead={firstRead}
      checkoutMarker={checkoutMarker}
      afterCheckout="stay"
      strip="your_plan"
      returnFocusRef={returnFocusRef}
    />
  );
}
