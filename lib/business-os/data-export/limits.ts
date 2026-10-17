// lib/business-os/data-export/limits.ts
//
// DE-4 (BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md §2.6; requirement
// BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.4.1 C): the Phase 1 limits of
// "Download my data". PURE: one constant, no imports.
//
// - ROW_CEILING: the shared §0.4.1 C ceiling. Over it, the export refuses with
//   a clear message and sends no file, never a partial one. DE-8b's pre-flight
//   counts reuse this same constant.
// - PAGE_SIZE: rows per keyset page. PostgREST cuts an unbounded select at its
//   `max-rows` without saying so (F-3), so every DE-4+ section is read page by
//   page to the end. The reader ends on an EMPTY page, so a project `max-rows`
//   below this value still yields every row.
// - (JSON_BODY_MAX_BYTES, the 4 MB cap of the direct JSON response, is gone:
//   DE-9 retired the JSON route with it. The browser receives only a signed
//   Storage URL, so the 4.5 MB function response cap no longer applies;
//   requirement §0.7 C-11, DE-8b SA Q-1.)
// - VIA_PARENT_CHUNK (DE-7 SA-Q10): owner-scoped parent ids per child query
//   of the parent-scoped read (`website_blocks` by `.in('page_id', chunk)`).
//   100 canonical uuids are about 3.7 kB of URL, well inside the PostgREST
//   and gateway limits.
//
// DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §10; requirement §0.4.1 C):
// the zip's Phase 1 ceilings. Constants, never env-tunable.
//
// - FILE_BYTES_CEILING / FILE_COUNT_CEILING: "Your files", 40 MiB and 150
//   files. Checked on the listing BEFORE any download (pre-flight, metadata
//   sizes) and again on the real bytes while downloading (a backstop for a
//   wrong `metadata.size`).
// - ZIP_BYTES_CEILING: the finished zip, 45 MiB, under the bucket's own 50 MB
//   upload limit (EXPORT_JOB_POLICY). Checked after the zip is built and
//   BEFORE the upload.
// - BUILD_MS_CEILING: 40 s from the start of the request. Checked before the
//   downloads, before each new download (SA C-9), before the zip and before
//   the upload. Over it is `timeout` (ours), not `over_ceiling` (SA Q-5).
// - NEAR_CEILING_RATIO: 60%, the success log and the cron's size watch.
// - FILE_WALK_MAX_MS / FILE_WALK_MAX_CALLS: the storage listing budget shared
//   by both buckets of one export. Hitting it fails the export (SA Q-16).
// - FILE_DOWNLOAD_CONCURRENCY: downloads in flight at once.
// - FILE_ROWS_MAX: the contact_documents / user_media rows read to match
//   files against (keyset pages of PAGE_SIZE). More is an error, never a
//   silently partial match.
//
// Read these at call time (`EXPORT_LIMITS.X`), never destructured at module
// load, so a test can lower one.

export const EXPORT_LIMITS = {
  ROW_CEILING: 100_000,
  PAGE_SIZE: 1_000,
  VIA_PARENT_CHUNK: 100,
  FILE_BYTES_CEILING: 41_943_040,
  FILE_COUNT_CEILING: 150,
  ZIP_BYTES_CEILING: 47_185_920,
  BUILD_MS_CEILING: 40_000,
  NEAR_CEILING_RATIO: 0.6,
  FILE_WALK_MAX_MS: 15_000,
  FILE_WALK_MAX_CALLS: 300,
  FILE_DOWNLOAD_CONCURRENCY: 4,
  FILE_ROWS_MAX: 20_000,
} as const;

export type ExportLimits = { readonly [K in keyof typeof EXPORT_LIMITS]: number };
