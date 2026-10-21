/**
 * The browser side of Apply, Dismiss and the margin review (AI model price
 * review slice 8). The ONLY file on the Model pricing page that sends a write
 * request (SA O-18: `page.tsx` keeps NW-1), and the only file naming these
 * three routes (slice 4 rule: one file per route URL).
 *
 * The reason pre-fill is built HERE, in the page, from the line's own source
 * and date (RR-2, UF-3); the server never makes a reason up. Override reasons
 * are never pre-filled (RR-5).
 *
 * No call throws: a rejected fetch comes back as a failure with the shared
 * network words. The server's message is shown as it wrote it.
 */

import { clientLogger } from '@/lib/logger/client';

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';

const logger = clientLogger.child({ module: 'AdminPriceApply' });

export const PRICE_APPLY_URL = '/api/admin/model-pricing/apply';
export const PRICE_DISMISS_URL = '/api/admin/model-pricing/dismiss';
export const MARGIN_REVIEW_URL_PREFIX = '/api/admin/model-pricing/apply-batches/';

/** Where the margin prompt sends the admin (MP-FR-14): the Costs and credits tab. */
export const CREDIT_PRICING_VIEW_URL = '/admin/business-os-llm?tab=costs';

/** UF-3: "Provider price change — source <url> (checked <date>)". Editable; never sent unless the admin confirms. */
export function prefilledReason(sourceUrl: string, checkedOn: string): string {
  return `Provider price change — source ${sourceUrl} (checked ${checkedOn})`;
}

export interface ApplyRequestLine {
  lineId: string;
  reason: string;
  overrideReason?: string;
}

export interface WriteFailure {
  ok: false;
  status: number;
  message: string;
  code: string | null;
  lineIds: string[];
  problems: string[];
}

export interface ApplySuccess {
  ok: true;
  batchId: string;
  appliedAt: string;
  effective: string;
  marginNeeded: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function post(url: string, body: unknown): Promise<{ status: number; ok: boolean; body: Record<string, unknown> | null }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const parsed = await readJsonBody(response);
  return { status: response.status, ok: response.ok, body: isRecord(parsed) ? parsed : null };
}

function failure(status: number, body: Record<string, unknown> | null, fallback: string): WriteFailure {
  const problems = Array.isArray(body?.problems)
    ? body.problems.flatMap((problem: unknown) =>
        isRecord(problem) && typeof problem.message === 'string' ? [problem.message] : []
      )
    : [];
  return {
    ok: false,
    status,
    message: typeof body?.error === 'string' && body.error.trim() !== '' ? body.error : fallback,
    code: typeof body?.code === 'string' ? body.code : null,
    lineIds: stringList(body?.lineIds),
    problems,
  };
}

const NETWORK_FAILURE: WriteFailure = { ok: false, status: 0, message: ADMIN_NETWORK_ERROR, code: null, lineIds: [], problems: [] };

export async function applyPrices(lines: readonly ApplyRequestLine[]): Promise<ApplySuccess | WriteFailure> {
  try {
    const result = await post(PRICE_APPLY_URL, { lines });
    const data = result.body?.data;
    if (result.ok && result.body?.success === true && isRecord(data) && typeof data.batchId === 'string' && typeof data.appliedAt === 'string') {
      const margin = isRecord(data.marginReview) ? data.marginReview : null;
      return {
        ok: true,
        batchId: data.batchId,
        appliedAt: data.appliedAt,
        effective: typeof data.effective === 'string' ? data.effective : '',
        marginNeeded: margin?.needed === true,
      };
    }
    logger.warn({ status: result.status }, 'Apply refused');
    return failure(result.status, result.body, 'Could not apply the price. Nothing was changed.');
  } catch (err) {
    logger.error({ err }, 'Apply request threw');
    return NETWORK_FAILURE;
  }
}

export async function dismissPrices(lineIds: readonly string[], reason: string): Promise<{ ok: true } | WriteFailure> {
  try {
    const result = await post(PRICE_DISMISS_URL, { lineIds, reason });
    if (result.ok && result.body?.success === true) return { ok: true };
    logger.warn({ status: result.status }, 'Dismiss refused');
    return failure(result.status, result.body, 'Could not dismiss the price. Nothing was changed.');
  } catch (err) {
    logger.error({ err }, 'Dismiss request threw');
    return NETWORK_FAILURE;
  }
}

export async function markMarginReviewDone(batchId: string, note: string): Promise<{ ok: true } | WriteFailure> {
  try {
    const result = await post(`${MARGIN_REVIEW_URL_PREFIX}${encodeURIComponent(batchId)}/margin-review`, { note });
    if (result.ok && result.body?.success === true) return { ok: true };
    logger.warn({ status: result.status }, 'Margin review refused');
    return failure(result.status, result.body, 'Could not save the margin review.');
  } catch (err) {
    logger.error({ err }, 'Margin review request threw');
    return NETWORK_FAILURE;
  }
}
