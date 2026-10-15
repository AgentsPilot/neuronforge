// lib/business-os/data-export/classificationTypes.ts
//
// DE-2 (BUSINESS_OS_DATA_EXPORT_DE2_WORKPLAN.md §2.1; requirement
// BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.3.6, FR-E17): the export
// classification every purge descriptor carries.
//
// PURE on purpose: types and one constant, no imports. `purge/types.ts` imports
// from here (type-only), so this file must never pull in a repository or a
// `server-only` module, or the purge engine's types would drag the export's
// readers along with them.
//
// Purge level and export classification are independent axes (workplan §1.2):
// `profiles` is never purged and is exported; `onboarding_conversations` is
// reset and is not exported. Nothing derives one from the other, and the purge
// engine never reads `export`.

/** Every section id of the export file. `sections.ts` re-exports it. */
export type ExportSectionId = 'account_identity' | 'user_profile' | 'plugin_connections';

/** The slices that add a table's section. `planned` is allowed until DE-7. */
export type PlannedTableSlice = 'DE-3' | 'DE-4' | 'DE-5' | 'DE-6' | 'DE-7';

/** Files arrive in DE-8b, after DE-7, so buckets have their own expiry. */
export type PlannedFilesSlice = 'DE-8b';

/**
 * Whether a TABLE goes into "Download my data".
 *
 * - `include`: the table is one section of the file, with exactly `columns`
 *   (explicit, never `*`). `excludedColumns` names every other live column with
 *   the reason it stays out; a live column in neither list is reported by
 *   `npm run schema:reconcile` (FR-E19, report-only).
 * - `exclude`: never in the file. `reason` is what a reviewer reads.
 * - `planned`: in scope, not built yet; `slice` adds it.
 */
export type TableExportClassification =
  | {
      kind: 'include';
      section: ExportSectionId;
      columns: readonly string[];
      excludedColumns?: Readonly<Record<string, string>>;
    }
  | { kind: 'exclude'; reason: string }
  | { kind: 'planned'; slice: PlannedTableSlice };

/**
 * Whether a storage BUCKET goes into the file's "Your files". A bucket has no
 * columns and no section, so its shape differs from a table's (SA-Q2).
 */
export type StorageExportClassification =
  | { kind: 'include'; folder: string }
  | { kind: 'exclude'; reason: string }
  | { kind: 'planned'; slice: PlannedFilesSlice };

/**
 * Sections that come from somewhere other than a table, with why. The only
 * exception to "one `include` descriptor per section" (SA-Q8). Lives here, not
 * in `sections.ts`, so the classification check can read it without importing
 * the repositories (SA C-2).
 */
export const NON_TABLE_SECTIONS: Readonly<Partial<Record<ExportSectionId, string>>> = {
  account_identity: 'from the signed-in session (auth user), not a table',
};
