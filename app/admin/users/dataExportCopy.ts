/**
 * Words of the admin "Data export" box of the Businesses drawer (data export
 * DE-10a, workplan §7.2). English only, like the rest of the admin console.
 * Pure: no React, no I/O.
 *
 * The owner's own control keeps its three-language copy and owner tone
 * (`components/business-os/data-export/`); none of it is reused here.
 */

import { formatUtc } from '@/app/admin/components/layout/adminFormat';

/** The prepare and download reason limits, as the routes' Zod schemas. */
export const EXPORT_REASON_MIN = 5;
export const EXPORT_REASON_MAX = 500;

/** Above the prepare route's 60 s maxDuration, so it fires only on a hung connection (DE-9 C-5). */
export const PREPARE_TIMEOUT_MS = 75_000;

export const DATA_EXPORT_COPY = {
  loading: 'Reading the exports…',
  readError: 'The exports could not be read.',
  retry: 'Try again',
  empty: 'No exports yet.',
  prepareButton: 'Prepare export',
  downloadButton: 'Download (audited)…',
  ownAccount: 'Use Download my data in your own settings.',
  ownerNotDownloaded:
    'The owner has not downloaded an export. Deleting now deletes any export. Download it now if you need to hand it over.',
  limitNote: (limit: number) => `Up to ${limit} exports per 24 hours for this account, the owner's and admins' together.`,
  dismiss: 'Dismiss',

  prepareTitle: 'Prepare an export of this account',
  prepareDescription: "Why are you preparing this account's export? The reason is recorded with your name. The owner is not notified.",
  prepareSend: 'Prepare',
  preparing: 'Preparing… this can take up to a minute.',
  downloadTitle: 'Download this export',
  downloadDescription: 'This download is recorded with your name and this reason. The owner is not notified.',
  downloadSend: 'Download',
  downloading: 'Recording the download…',
  reasonLabel: (min: number, max: number) => `Reason (${min} to ${max} characters)`,
  close: 'Close',

  prepared: (expiresAt: string | null) => `Export prepared. Ready until ${formatUtc(expiresAt)}. Download it below.`,
  downloadStarted: 'Download started. The link works for one minute.',
  clientTimeout: 'Still preparing or failed. Refresh the list in a minute.',
  unsafeLink: 'The download link was not a secure link, so it was not opened. Try again.',
  network: 'Could not reach the server. Check your connection and try again.',
  session: 'Your admin session has ended. Sign in again.',
  fallback: 'The request failed. Try again.',
} as const;

/** One admin sentence per refusal `code` (§7.2). `retryAt` is shown in UTC. */
export function dataExportRefusal(code: string | null, status: number, retryAt: string | null): string {
  switch (code) {
    case 'export_in_progress':
      return 'An export of this account is already being prepared. Wait a minute and try again.';
    case 'export_daily_limit':
      return `This account has used its exports of the last 24 hours (the owner's and admins' together). Next one possible at ${formatUtc(retryAt)}.`;
    case 'export_expired':
      return 'This export is no longer available. Prepare a new one.';
    case 'export_too_large':
      return 'This account holds more than Phase 1 can package (over 40 MB of files or 150 files). Nothing was prepared.';
    case 'export_timeout':
      return 'The export could not be prepared in time. Try again.';
    case 'export_failed':
      return 'The export could not be prepared. Try again.';
    case 'audit_unavailable':
      return 'The download could not be recorded, so it was not started. Try again.';
    case 'own_account':
      return 'Use Download my data in your own settings for your own account.';
    default:
      break;
  }
  if (status === 401 || status === 403) return DATA_EXPORT_COPY.session;
  if (status === 404) return 'This export or account was not found. Read the list again.';
  if (status === 429) return 'Too many requests. Wait a few minutes and try again.';
  return DATA_EXPORT_COPY.fallback;
}

/** "3 files, 1.2 MB": sizes as the list shows them; null parts are left out. */
export function exportSizeLine(fileCount: number | null, bytes: number | null): string | null {
  const parts: string[] = [];
  if (typeof fileCount === 'number') parts.push(`${fileCount} ${fileCount === 1 ? 'file' : 'files'}`);
  if (typeof bytes === 'number') parts.push(`${(bytes / 1_048_576).toFixed(1)} MB`);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** The failure reason in words. */
export function failureWord(reason: string | null): string {
  if (reason === 'over_ceiling') return 'Failed — too large';
  if (reason === 'timeout') return 'Failed — timed out';
  return 'Failed — error';
}
