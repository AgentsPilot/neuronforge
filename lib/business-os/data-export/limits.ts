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
// MX-3.1 (2026-10-30; SA Q-3): the ZIP's ceilings (file bytes and count, zip
// bytes, build time, the near-ceiling ratio, the file walk budget, download
// concurrency, file rows) left with the ZIP builder.
//
// Read these at call time (`EXPORT_LIMITS.X`), never destructured at module
// load, so a test can lower one.

export const EXPORT_LIMITS = {
  ROW_CEILING: 100_000,
  PAGE_SIZE: 1_000,
  VIA_PARENT_CHUNK: 100,
} as const;

export type ExportLimits = { readonly [K in keyof typeof EXPORT_LIMITS]: number };
