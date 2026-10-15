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
// - JSON_BODY_MAX_BYTES: only while the export is a direct JSON response.
//   Vercel refuses a function response over 4.5 MB with a platform crash, not
//   a message (F-4); we refuse first, at 4 MB of the exact bytes sent. DE-8b's
//   signed-URL zip removes this cap (requirement §0.7, SA C-11).
//
// Read these at call time (`EXPORT_LIMITS.X`), never destructured at module
// load, so a test can lower one.

export const EXPORT_LIMITS = {
  ROW_CEILING: 100_000,
  PAGE_SIZE: 1_000,
  JSON_BODY_MAX_BYTES: 4_000_000,
} as const;

export type ExportLimits = { readonly [K in keyof typeof EXPORT_LIMITS]: number };
