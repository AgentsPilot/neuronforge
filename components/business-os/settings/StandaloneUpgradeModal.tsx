'use client';

/**
 * The plan comparison window opened from anywhere in Business OS (upgrade modal
 * UM-2, workplan §5.1; UM-SA1, UM-SA5, UM-SA8, UM-SA10).
 *
 * Rendered by `UpgradeModalProvider` through `LazyUpgradeModal` (PERF-1: the
 * third `createLazyDialog`), so its chunk loads after the page paints. The
 * props are the loader's contract (`isOpen`, `onClose`) plus the caller's
 * context, and nothing else.
 *
 * ── ONE SESSION PER OPEN ────────────────────────────────────────────────────
 * Closed, it renders nothing, so the layout's closed instance reads nothing and
 * costs nothing (the `ConfigurationDialog` precedent). Open, it mounts a fresh
 * `UpgradeSession`: ONE `readMyPlan()` started in a ref-guarded mount effect
 * (StrictMode's second run starts nothing; no prefetch, nothing at page load,
 * UM-SA8), its OWN `usePlanFlow` instance (UM-SA1), and the same
 * `UpgradeModal` Settings uses. Closing unmounts the session, so no read, no
 * "Upgrading…" and no flow state carries over to the next open.
 *
 * ── AFTER A PURCHASE ────────────────────────────────────────────────────────
 * An upgrade stays in the window (`afterUpgrade="stay"`): "Upgrading…", then
 * "You're on {plan}" once the bounded re-read says so. A checkout always hands
 * off: `PlanPurchase` closes the window and returns to Settings → Plan with the
 * marker (UM-SA10), where the Settings pop-up reads fresh (UM-D3). No URL marker is read here
 * (`checkoutMarker: null`, C-4).
 *
 * UM-D3: the session moved to `UpgradeSession.tsx`, unchanged in behaviour for
 * this window, so the Settings pop-up can mount it statically (this file is
 * loaded lazily and may not be imported statically: `lazyDialogs.guard`). The
 * footer now reads "Close" (UM-3 §5.5): there is no plan view behind it.
 */

import { UpgradeSession } from './UpgradeSession';
import type { UpgradeModalContext } from './upgradeModalContext';

export interface StandaloneUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: UpgradeModalContext;
}

export function StandaloneUpgradeModal({ isOpen, onClose, context }: StandaloneUpgradeModalProps) {
  if (!isOpen) return null;
  return <UpgradeSession onClose={onClose} context={context} />;
}
