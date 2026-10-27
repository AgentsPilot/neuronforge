/**
 * The AI cost drawers' one read (Money MK-8b; SA-5: `useDrawerResource`, no new
 * shared export). Both drawers, the business and the billing-period one, read
 * the credit report route for ONE business in the dates the page is showing:
 * exactly the request the page sends with that business picked (Pin C row 7),
 * so the drawer's figures equal the picked page's by construction. No new
 * route, no new payload key.
 *
 * It runs only when a drawer opens (the key is null until then), so the page's
 * load requests are unchanged (T-12, Pin C). It never throws: a rejected fetch
 * comes back as the shared network words. Logs carry no account id and no
 * name (SA-WP-MK8B C-4); an aborted read logs nothing.
 */

import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import type { DrawerRead } from '@/app/admin/components/layout/useDrawerResource';
import { COSTS_PLATFORM_ACCOUNT } from '@/app/admin/business-os-llm/costCopy';
import type { CostReportPayload } from '@/app/admin/business-os-llm/costTypes';
import { clientLogger } from '@/lib/logger/client';

import { AI_COST_DRAWER } from './aiCostDrawerCopy';
import { REPORT_URL } from './useCostReport';

const logger = clientLogger.child({ module: 'AdminAiCostDrawers' });

/**
 * The drawer's key: `from=…&to=…&accountId=…`, in `reportSearch`'s order. The
 * dates are the report ON SCREEN (`report.window`), never a fresh clock
 * (SA-WP-MK8B C-3), so the drawer and the strip cover the same days.
 */
export function aiCostDrawerKey(window: { from: string; to: string }, accountId: string): string {
  return new URLSearchParams({ from: window.from, to: window.to, accountId }).toString();
}

/** The credit report for one business. A 409 platform account gets the page's own sentence. */
export async function readAiCostDrawer(key: string, signal: AbortSignal): Promise<DrawerRead<CostReportPayload>> {
  try {
    const response = await fetch(`${REPORT_URL}?${key}`, { method: 'GET', cache: 'no-store', signal });
    const result = await readAdminResponse<CostReportPayload>(response, { what: AI_COST_DRAWER.what, sessionEndedCopy: true });
    if (result.ok) return { ok: true, data: result.data };
    if (result.status === 409 && result.message === 'platform_account') return { ok: false, message: COSTS_PLATFORM_ACCOUNT };
    return { ok: false, message: result.message };
  } catch (err) {
    if (!signal.aborted) logger.warn({ err }, 'AI cost drawer read threw');
    return { ok: false, message: ADMIN_NETWORK_ERROR };
  }
}
