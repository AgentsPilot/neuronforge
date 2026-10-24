/**
 * Upgrade modal demo (TEST ONLY, upgrade modal UM-2, workplan §7, SA X-1 / X-2).
 *
 * Opens the real plan comparison window through the real
 * `useUpgradeModal().openUpgradeModal(...)`, inside the real Business OS layout
 * (provider, stacking, PERF-1 loader, payment hold), which is what go-live row
 * 20 (c) has to see. No production screen calls the contract yet (UM-F2).
 *
 * A server component: the switch is read here, first, and `notFound()` is
 * returned before anything renders. Only then is the client child rendered,
 * so the client bundle carries no switch logic.
 *
 * NOT ADMIN-GATED, deliberately: the trial and Founding Partner test accounts
 * the end-of-stream run needs are not admins, and this page can do nothing
 * that Settings → Plan cannot already do for the same signed-in account. The
 * middleware sign-in and the layout's payment hold apply as on every page in
 * the segment. Linked from no product navigation; the harness tab only links
 * here.
 *
 * TEST ONLY: remove with the demo, at the latest when UM-F2 wires a real caller.
 */

import { notFound } from 'next/navigation';

import { isUpgradeModalDemoEnabled } from '@/lib/business-os/upgradeModalDemoFlag';

import { UpgradeModalDemo } from './UpgradeModalDemo';

// Read the switch on every request; never prerendered.
export const dynamic = 'force-dynamic';

export default function UpgradeModalDemoPage() {
  if (!isUpgradeModalDemoEnabled()) notFound();
  return <UpgradeModalDemo />;
}
