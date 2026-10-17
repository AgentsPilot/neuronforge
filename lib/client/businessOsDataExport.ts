/**
 * The one browser seam for "Download my data" (data export DE-9, workplan
 * §3.2 / §4; SA DE-9 Q5, Q9, C-5, C-6). Replaces `downloadUserDataExport.ts`
 * and the JSON route it called.
 *
 * Pure fetch functions. Each returns a VERDICT and never throws, so the one
 * control (`components/business-os/data-export/`) maps every outcome to copy.
 * No function takes a user id: the server takes the person from the session.
 *
 * Refusals are read from the body's `code`, never from the status alone (the
 * DE-4 rule for `too_large`), except 401 and 429, which mean the same thing
 * whatever the body says. A body that is not JSON (a platform 502 / 504 when
 * the function is killed at 60 s) is a `timeout`.
 *
 * The zip never passes through our function, only a 120 s signed Storage URL,
 * so the 4.5 MB response cap does not apply. Saving is ONE mode (SA Q9): the
 * page navigates to the URL and Storage answers `Content-Disposition:
 * attachment`, so the page stays put and the browser saves the file.
 *
 * The signed URL carries a token and the business name: it is never logged.
 */

import { z } from 'zod';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BusinessOsDataExportClient' });

export const DATA_EXPORTS_URL = '/api/business-os/data-exports';

/**
 * SA Q5 / C-5: above the route's `maxDuration = 60`, so it fires only on a
 * hung connection. AbortController + setTimeout, not AbortSignal.timeout,
 * because Jest's fake timers drive setTimeout and not the latter.
 */
export const START_TIMEOUT_MS = 75_000;

export type DataExportRefusalCode =
  | 'in_progress'
  | 'daily_limit'
  | 'too_large'
  | 'timeout'
  | 'client_timeout'
  | 'ready_sign_failed'
  | 'expired'
  | 'not_found'
  | 'throttled'
  | 'unauthorized'
  | 'network'
  | 'failed';

export interface DataExportReady {
  kind: 'ready';
  downloadUrl: string;
  fileName: string;
  asciiFileName: string;
  expiresAt: string;
  /** Some sections or files could not be included (the README lists them). */
  partial: boolean;
}

export interface DataExportRefused {
  kind: 'refused';
  code: DataExportRefusalCode;
  /** `daily_limit` / `in_progress`: when the refusal stops applying. */
  retryAt?: string;
  /** `ready_sign_failed`: the export that is ready for "Download again". */
  jobId?: string;
}

export type DataExportVerdict = DataExportReady | DataExportRefused;

export interface LastDataExport {
  createdAt: string;
  downloadable: { jobId: string; expiresAt: string } | null;
}

export type LastDataExportVerdict = { kind: 'ok'; lastExport: LastDataExport | null } | { kind: 'unavailable' };

const readyBody = z.object({
  success: z.literal(true),
  data: z.object({
    downloadUrl: z.string().min(1),
    fileName: z.string().min(1),
    asciiFileName: z.string().min(1),
    expiresAt: z.string().min(1),
    failedSections: z.array(z.string()).optional(),
    missingFiles: z.number().int().nonnegative().optional(),
  }),
});

const statusBody = z.object({
  success: z.literal(true),
  data: z.object({
    lastExport: z
      .object({
        createdAt: z.string().min(1),
        downloadable: z.object({ jobId: z.string().uuid(), expiresAt: z.string().min(1) }).nullable(),
      })
      .nullable(),
  }),
});

const refusalBody = z.object({
  code: z.string().optional(),
  retryAt: z.string().nullable().optional(),
  jobId: z.string().optional(),
});

const UUID = z.string().uuid();

/** The body as JSON, or `undefined` when it is not JSON (a platform error page). */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (err) {
    // A body cut off by our own timer is a client timeout, not a non-JSON page.
    if (isAbort(err)) throw err;
    return undefined;
  }
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** One server answer → one verdict (workplan §4). */
async function toVerdict(response: Response, action: 'start' | 'again'): Promise<DataExportVerdict> {
  if (response.status === 401) return { kind: 'refused', code: 'unauthorized' };
  if (response.status === 429) return { kind: 'refused', code: 'throttled' };

  const body = await readJson(response);
  if (body === undefined) return { kind: 'refused', code: 'timeout' };

  if (response.ok) {
    const parsed = readyBody.safeParse(body);
    if (!parsed.success) {
      logger.error({ action, status: response.status }, 'Data export: the 200 answer had an unexpected shape');
      return { kind: 'refused', code: 'failed' };
    }
    const { downloadUrl, fileName, asciiFileName, expiresAt, failedSections, missingFiles } = parsed.data.data;
    return {
      kind: 'ready',
      downloadUrl,
      fileName,
      asciiFileName,
      expiresAt,
      partial: (failedSections?.length ?? 0) > 0 || (missingFiles ?? 0) > 0,
    };
  }

  const refusal = refusalBody.safeParse(body);
  const code = refusal.success ? refusal.data.code : undefined;
  const retryAt = refusal.success ? refusal.data.retryAt ?? undefined : undefined;

  if (response.status === 409 && code === 'export_in_progress') return { kind: 'refused', code: 'in_progress', retryAt };
  if (response.status === 409 && code === 'export_daily_limit') {
    logger.info({ action, retryAt }, 'Data export: refused by the daily limit');
    return { kind: 'refused', code: 'daily_limit', retryAt };
  }
  if (response.status === 413 && code === 'export_too_large') return { kind: 'refused', code: 'too_large' };
  if (code === 'export_timeout' || response.status === 502 || response.status === 504) return { kind: 'refused', code: 'timeout' };
  if (code === 'export_ready_sign_failed') {
    const jobId = refusal.success ? refusal.data.jobId : undefined;
    return { kind: 'refused', code: 'ready_sign_failed', ...(jobId && UUID.safeParse(jobId).success ? { jobId } : {}) };
  }
  if (response.status === 410 && code === 'export_expired') return { kind: 'refused', code: 'expired' };
  if (response.status === 404) return { kind: 'refused', code: 'not_found' };

  if (response.status === 400) {
    // Only our own client can send a bad request: a bug, not the owner's fault.
    logger.error({ action, status: 400 }, 'Data export: the server refused the request as invalid');
  } else {
    logger.warn({ action, status: response.status, code: code ?? null }, 'Data export: the server could not prepare the export');
  }
  return { kind: 'refused', code: 'failed' };
}

/** POST with the 75 s client timer (C-5): cleared in `finally`, never left running. */
async function postWithTimeout(url: string, action: 'start' | 'again'): Promise<DataExportVerdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), START_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    return await toVerdict(response, action);
  } catch (err) {
    if (isAbort(err)) {
      logger.warn({ action, timeoutMs: START_TIMEOUT_MS }, 'Data export: the request took too long and was abandoned');
      return { kind: 'refused', code: 'client_timeout' };
    }
    logger.warn({ action }, 'Data export: the server could not be reached');
    return { kind: 'refused', code: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** "Download my data": prepare a fresh export (BC-4). */
export function startDataExport(): Promise<DataExportVerdict> {
  return postWithTimeout(DATA_EXPORTS_URL, 'start');
}

/**
 * "Download again": a new link for an export that is still ready. `jobId`
 * comes only from `fetchLastDataExport` (or the sign-failed refusal), never
 * from the URL or user input; it is still checked before it is sent.
 */
export async function downloadDataExportAgain(jobId: string): Promise<DataExportVerdict> {
  if (!UUID.safeParse(jobId).success) {
    logger.error({ action: 'again' }, 'Data export: download again without a valid job id');
    return { kind: 'refused', code: 'failed' };
  }
  return postWithTimeout(`${DATA_EXPORTS_URL}/${encodeURIComponent(jobId)}/parts/1/download`, 'again');
}

/** "Last export …". Any failure is `unavailable`: the control then shows no line. */
export async function fetchLastDataExport(): Promise<LastDataExportVerdict> {
  try {
    const response = await fetch(DATA_EXPORTS_URL, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Data export: the last export could not be read');
      return { kind: 'unavailable' };
    }
    const parsed = statusBody.safeParse(await readJson(response));
    if (!parsed.success) {
      logger.warn({ status: response.status }, 'Data export: the last export answer had an unexpected shape');
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', lastExport: parsed.data.data.lastExport };
  } catch {
    logger.warn({}, 'Data export: the last export could not be read (network)');
    return { kind: 'unavailable' };
  }
}

/**
 * The navigation seam: one line, so a jsdom test can assert what the page
 * would open without jsdom trying (and failing) to navigate.
 */
export const browserNavigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

/**
 * C-6: only a Storage URL we would expect is followed. `https:` always;
 * `http:` only for localhost in development. A `javascript:`, `data:` or
 * relative value never reaches `location.assign`.
 */
export function isSafeDownloadUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return url.protocol === 'http:' && isLocalHost && process.env.NODE_ENV === 'development';
}

/**
 * Hands the browser the file. Returns false (and never navigates) when the URL
 * is not one we trust; the control then shows the generic failure.
 */
export function saveSignedDownload(verdict: DataExportReady): boolean {
  if (!isSafeDownloadUrl(verdict.downloadUrl)) {
    logger.error({}, 'Data export: refused to open a download link that is not https');
    return false;
  }
  browserNavigation.assign(verdict.downloadUrl);
  return true;
}
