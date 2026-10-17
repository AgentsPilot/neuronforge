// lib/business-os/data-export/downloadName.ts
//
// DE-10a (workplan §6.4; SA-6): the ONE rule for the file name of an export
// download, shared by the owner "download again" route and the admin audited
// download route, so the same export has the same name whoever fetches it
// (DX-10). A pure move of the owner route's local `businessName()` and its
// three-line caller (DE-8b SA C-8): the name is re-derived on every download
// from the job's created_at, the account's timezone and its business name,
// all read again and never stored.
//
// A failed read never fails a download: the timezone falls back to UTC
// inside ownerTimezone, and an unreadable business name gives the fallback
// name with one `warn` (ids only).
//
// The name and the business name are NEVER logged or audited (DE-8b C-3).
//
// Server-only.

import 'server-only';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { exportZipFileNames } from '@/lib/business-os/data-export/fileName';
import { ownerTimezone } from '@/lib/business-os/data-export/ownerClock';
import { cleanBusinessName } from '@/lib/business-os/data-export/readme';

export interface DownloadNameLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
}

/** The business name, read again (C-8). A failed read is the fallback name, never a failed download. */
async function businessName(userId: string, log: DownloadNameLogger): Promise<string | null> {
  try {
    const { data, error } = await businessProfileRepository.findCompanyName(userId);
    if (error) {
      log.warn({ userId }, 'Data export download: business name unreadable, fallback file name');
      return null;
    }
    return cleanBusinessName(data);
  } catch (err) {
    log.warn({ err, userId }, 'Data export download: business name unreadable, fallback file name');
    return null;
  }
}

/**
 * The download names of one export of `userId` (the ACCOUNT the export is of,
 * never the caller), stamped from the job's `created_at`.
 */
export async function exportDownloadNames(
  userId: string,
  createdAt: string,
  log: DownloadNameLogger
): Promise<{ fileName: string; asciiFileName: string }> {
  const [timezone, name] = await Promise.all([ownerTimezone(userId, log), businessName(userId, log)]);
  return exportZipFileNames(new Date(createdAt), timezone, name);
}
