// lib/business-os/data-export/jobPolicy.ts
//
// DE-8a (BUSINESS_OS_DATA_EXPORT_DE8A_WORKPLAN.md §5.3; requirement
// BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.4.1 A): the Phase 1 rules of an
// export JOB. PURE: constants and one path builder, no imports.
//
// The database is the authority. The start function
// public.business_os_data_export_start (migration 20261074) carries these
// numbers as SQL literals, so no caller can loosen them (SA Q-10). This file
// only mirrors them for the routes that tell the owner "next export possible
// at ...", and supabase/migrations/__tests__/business-os-data-exports.migration.test.ts
// fails CI when the two disagree.
//
// - DAILY_LIMIT / DAILY_WINDOW_HOURS: three counted exports per rolling 24 h.
//   running, ready and expired count; failed never does; admin-started ones do.
// - STALE_RUNNING_SECONDS: a `running` row older than this belongs to a killed
//   function and is turned into failed / timeout by the next start. DE-8b's
//   route must keep maxDuration at 60 s or less, safely below it (SA DE-8a).
// - RETENTION_HOURS: 72. Hours, not days: `timestamptz + interval '3 days'`
//   moves with the session time zone across a DST change, 72 hours does not
//   (SA C-2). markReady adds exactly this many hours to ready_at.
// - BUCKET_FILE_SIZE_LIMIT_BYTES: 50 MB, the bucket's own upload limit
//   (Phase 2 raises it to 250 MB).

export const EXPORT_JOB_POLICY = {
  BUCKET: 'business-data-exports',
  BUCKET_FILE_SIZE_LIMIT_BYTES: 52_428_800,
  BUCKET_MIME_TYPE: 'application/zip',
  DAILY_LIMIT: 3,
  DAILY_WINDOW_HOURS: 24,
  STALE_RUNNING_SECONDS: 90,
  RETENTION_HOURS: 72,
  OWNER_SIGNED_URL_TTL_SECONDS: 120,
  ADMIN_SIGNED_URL_TTL_SECONDS: 60,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The only builder of an export object path: `{user_id}/{job_id}/1.zip`.
 *
 * Both parts must be uuids, so nothing a caller supplies (a `../`, a slash, a
 * business name) can ever reach Storage. The `1` is the part number: Phase 1
 * writes one part, and the path already has the Phase 2 shape.
 */
export function exportObjectPath(userId: string, jobId: string): string {
  if (!UUID.test(userId) || !UUID.test(jobId)) {
    throw new Error('exportObjectPath: user id and job id must be uuids');
  }
  return `${userId.toLowerCase()}/${jobId.toLowerCase()}/1.zip`;
}
