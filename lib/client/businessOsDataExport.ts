/**
 * The one browser seam for the owner's data export (data export DE-9; export
 * redesign MX-1b, workplan §8; MX-3.1, workplan §7.3).
 *
 * `oneExportControl.guard.test.ts` check 4 keeps this the ONLY browser file
 * that names an export route. Pure fetch functions that never throw and never
 * take a user id or an email address: the server takes the person from the
 * session. `sentTo` (the owner's own login email, for the confirmation) is
 * never logged.
 *
 * MX-3.1 (user decision 2026-10-27): the ZIP download and the export switch
 * are gone. There is no "off" answer any more: a 404, a non-JSON body or a
 * timeout is simply a failed read (the drawer says the history could not be
 * loaded, with Try again) or a failed start.
 */

import { z } from 'zod';
import { createLogger } from '@/lib/logger';
// Type only: a pure file with no imports, so nothing server-side reaches the bundle.
import type { ExportHistoryRequest } from '@/lib/business-os/data-export/exportHistory';

const logger = createLogger({ module: 'BusinessOsDataExportClient' });

/** Our route's refusal body: a code and, for the daily limit, when it lifts. */
const refusalBody = z.object({
  code: z.string().optional(),
  retryAt: z.string().nullable().optional(),
});

/** The body as JSON, or `undefined` when it is not JSON (a platform error page). */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (err) {
    // A body cut off by our own timer is a timeout, not a non-JSON page.
    if (isAbort(err)) throw err;
    return undefined;
  }
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

export const MODULE_EXPORT_URL = '/api/business-os/export-requests';

/** How long the drawer's history read may take before it shows "could not be loaded". */
export const MODULE_EXPORT_HISTORY_TIMEOUT_MS = 5_000;

export type { ExportHistoryRequest };

export type ModuleExportHistoryVerdict = { kind: 'ok'; requests: ExportHistoryRequest[] } | { kind: 'error' };

export type ModuleExportRefusalCode =
  | 'in_progress'
  | 'daily_limit'
  | 'no_login_email'
  | 'invalid'
  | 'throttled'
  | 'unauthorized'
  | 'network'
  | 'failed';

export type ModuleExportStartVerdict =
  | { kind: 'started'; requestId: string; sentTo: string; requestedEmailSent: boolean }
  | { kind: 'refused'; code: ModuleExportRefusalCode; retryAt?: string };

const HISTORY_STATUSES = ['waiting', 'working', 'sent', 'failed', 'interrupted'] as const;

const historyBody = z.object({
  success: z.literal(true),
  data: z.object({
    requests: z.array(
      z.object({
        requestId: z.string().uuid(),
        requestedAt: z.string().min(1),
        origin: z.enum(['owner', 'admin']),
        modules: z.array(
          z.object({
            module: z.string().min(1),
            status: z.enum(HISTORY_STATUSES),
            sentAt: z.string().min(1).nullable(),
            emailCount: z.number().int().nonnegative(),
          })
        ),
      })
    ),
  }),
});

const startedBody = z.object({
  success: z.literal(true),
  data: z.object({ requestId: z.string().uuid(), sentTo: z.string().min(1), requestedEmailSent: z.boolean() }),
});

/** The drawer's history read: GET, never throws. Anything but a valid 200 is `error`. */
export async function fetchModuleExportHistory(
  options: { timeoutMs?: number } = {}
): Promise<ModuleExportHistoryVerdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? MODULE_EXPORT_HISTORY_TIMEOUT_MS);
  try {
    const response = await fetch(MODULE_EXPORT_URL, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await readJson(response);
    if (body === undefined) {
      logger.warn({ status: response.status }, 'Module export: the history answer was not JSON');
      return { kind: 'error' };
    }
    if (response.ok) {
      const parsed = historyBody.safeParse(body);
      if (parsed.success) return { kind: 'ok', requests: parsed.data.data.requests };
      logger.error({ status: response.status }, 'Module export: the history answer had an unexpected shape');
      return { kind: 'error' };
    }
    logger.warn({ status: response.status }, 'Module export: the history could not be read');
    return { kind: 'error' };
  } catch (err) {
    logger.warn({ timedOut: isAbort(err) }, 'Module export: the history could not be reached');
    return { kind: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Start an export of the ticked modules: POST, never throws. */
export async function startModuleExport(modules: readonly string[]): Promise<ModuleExportStartVerdict> {
  try {
    const response = await fetch(MODULE_EXPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modules }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.status === 401) return { kind: 'refused', code: 'unauthorized' };
    if (response.status === 429) return { kind: 'refused', code: 'throttled' };

    const body = await readJson(response);
    if (body === undefined) {
      logger.warn({ status: response.status }, 'Module export: the start answer was not JSON');
      return { kind: 'refused', code: 'failed' };
    }
    if (response.ok) {
      const parsed = startedBody.safeParse(body);
      if (parsed.success) {
        const { requestId, sentTo, requestedEmailSent } = parsed.data.data;
        return { kind: 'started', requestId, sentTo, requestedEmailSent };
      }
      logger.error({ status: response.status }, 'Module export: the start answer had an unexpected shape');
      return { kind: 'refused', code: 'failed' };
    }

    const refusal = refusalBody.safeParse(body);
    const code = refusal.success ? refusal.data.code : undefined;
    const retryAt = refusal.success ? refusal.data.retryAt ?? undefined : undefined;
    if (response.status === 409 && code === 'export_in_progress') return { kind: 'refused', code: 'in_progress' };
    if (response.status === 409 && code === 'export_daily_limit') {
      // SA CR-2: with no time to show, "already running" would be false; the generic failure is honest.
      if (retryAt) return { kind: 'refused', code: 'daily_limit', retryAt };
      logger.error({ status: 409 }, 'Module export: a daily limit refusal came without a retry time');
      return { kind: 'refused', code: 'failed' };
    }
    if (response.status === 409 && code === 'export_no_login_email') return { kind: 'refused', code: 'no_login_email' };
    if (response.status === 400) {
      // Only our own drawer sends this body: a module switched off since the page loaded, or a bug.
      logger.error({ status: 400 }, 'Module export: the server refused the request as invalid');
      return { kind: 'refused', code: 'invalid' };
    }
    logger.warn({ status: response.status, code: code ?? null }, 'Module export: the server could not start the export');
    return { kind: 'refused', code: 'failed' };
  } catch {
    logger.warn({}, 'Module export: the server could not be reached');
    return { kind: 'refused', code: 'network' };
  }
}
