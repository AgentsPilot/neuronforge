/**
 * The Finance drawers' reads (Money MK-8), for `useDrawerResource` (SA-5: reuse
 * it, no new shared export). Each runs ONLY when its drawer opens, so the page
 * still sends exactly one request on load (AC-173).
 *
 * - The business drawer reads the finance page's OWN route with `accountId`
 *   and the page's window (today's picked-business payload, through the page's
 *   own serialiser): no new route, no new payload key (AC-145 holds).
 * - The plan drawer reads `GET /api/admin/business-os/billing/plans/[planId]`.
 *
 * Neither throws: a rejected fetch comes back as the shared network words (the
 * hook ignores whatever an aborted read answers). Logs never carry an id.
 */

import type { DrawerRead } from '@/app/admin/components/layout/useDrawerResource';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import type { SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';
import type { FinancePayload } from '@/lib/business-os/finance/financeTypes';
import { clientLogger } from '@/lib/logger/client';

import { BUSINESS_DRAWER, PLAN_DRAWER } from './financeCopy';
import { DEFAULT_FINANCE_QUERY, serialiseFinanceUrl, type FinanceQuery } from './financeUrl';
import { FINANCE_API_PATH } from './useFinanceData';

const logger = clientLogger.child({ module: 'AdminFinanceDrawers' });

export const PLAN_DRAWER_API_PATH = '/api/admin/business-os/billing/plans';

/** The window part of a finance query: the page's own choice, never a business. */
export type DrawerWindow = Pick<FinanceQuery, 'preset' | 'from' | 'to'>;

/**
 * The business drawer's key: the finance query string for that business in the
 * page's window. A window change while the drawer is open reads again.
 */
export function businessDrawerKey(accountId: string, window: DrawerWindow): string {
  return serialiseFinanceUrl({ ...DEFAULT_FINANCE_QUERY, preset: window.preset, from: window.from, to: window.to, accountId });
}

async function readJson<T>(url: string, what: string, signal: AbortSignal): Promise<DrawerRead<T>> {
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', signal });
    const result = await readAdminResponse<T>(response, { what, sessionEndedCopy: true });
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, data: result.data };
  } catch (err) {
    if (!signal.aborted) logger.warn({ err, what }, 'Finance drawer read threw');
    return { ok: false, message: ADMIN_NETWORK_ERROR };
  }
}

/** The business drawer's read: the finance route with this business picked. */
export function readBusinessDrawer(key: string, signal: AbortSignal): Promise<DrawerRead<FinancePayload>> {
  return readJson<FinancePayload>(`${FINANCE_API_PATH}?${key}`, BUSINESS_DRAWER.what, signal);
}

/** The plan drawer's read: one plan's accounts, statuses and MRR. The key is the plan id. */
export function readPlanDrawer(planId: string, signal: AbortSignal): Promise<DrawerRead<SubscriptionsPayload>> {
  return readJson<SubscriptionsPayload>(`${PLAN_DRAWER_API_PATH}/${encodeURIComponent(planId)}`, PLAN_DRAWER.what, signal);
}
