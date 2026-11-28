// lib/business-os/issue-reports/issueReportModel.ts
//
// Issue reporting slice 1.1a (BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md
// §2, §3; requirement BUSINESS_OS_ISSUE_REPORTING_REQUIREMENT.md §5.1, §7):
// the fixed values of a problem report, in one place.
//
// Migration 20261137_issue_reports.sql writes these same values as CHECK
// constraints. supabase/migrations/__tests__/issue-reports.migration.test.ts
// pins the two to each other, so a value changed here without a migration (or
// the reverse) fails CI. Later slices build their Zod schemas (1.2 route, 1.1b
// repository) and the form chips (1.5) from these lists.
//
// PURE on purpose: no imports, nothing at runtime but constants, so a client
// component (the 1.5 form) can read it without pulling server code into the
// browser bundle. The reference generator joins this module in 1.1b and uses
// Web Crypto only (SA RC-7), so the module stays client-safe.
//
// No backslash escape appears in this file: lib/ is scanned by Tailwind, and a
// backslash + hex in a scanned file breaks the build.

/** Every status a report can have, in lifecycle order (requirement §7). */
export const ISSUE_REPORT_STATUSES = ['submitted', 'in_review', 'classified', 'actioned', 'resolved', 'closed'] as const;
export type IssueReportStatus = (typeof ISSUE_REPORT_STATUSES)[number];

/** The status a new report is stored with (the column default). */
export const ISSUE_REPORT_INITIAL_STATUS: IssueReportStatus = 'submitted';

/**
 * The optional category chip the user may pick on the form (requirement §5.1).
 * A hint for triage, never the final category. NULL = no chip picked.
 */
export const ISSUE_REPORT_CATEGORY_HINTS = ['bug', 'support', 'feature'] as const;
export type IssueReportCategoryHint = (typeof ISSUE_REPORT_CATEGORY_HINTS)[number];

/**
 * Why a report was closed (requirement §7). A closed set, so no free teammate
 * text ever sits on a customer row (SA Q7). Set exactly when the status is
 * `closed`. Operator detail: not in the data export.
 */
export const ISSUE_REPORT_CLOSED_REASONS = ['duplicate', 'spam', 'no_response'] as const;
export type IssueReportClosedReason = (typeof ISSUE_REPORT_CLOSED_REASONS)[number];

/**
 * The reference alphabet: Crockford base 32, without I, L, O and U, so a
 * reference read out on the phone cannot be confused (1 / I / L, 0 / O).
 * 32 characters, so a random byte masked to 5 bits maps with no bias (§3).
 */
export const ISSUE_REPORT_REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters after the `R-` prefix. 32 to the 8th is about 1.1 x 10 to the 12th values. */
export const ISSUE_REPORT_REFERENCE_LENGTH = 8;

/** The prefix every reference starts with. */
export const ISSUE_REPORT_REFERENCE_PREFIX = 'R-';

/**
 * A well-formed reference, e.g. `R-7K3M9Q2X`. Its `source` is the migration's
 * CHECK pattern byte for byte (pinned by the text test).
 */
export const ISSUE_REPORT_REFERENCE_PATTERN = /^R-[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * Database backstops (the migration's CHECKs). They are ceilings, not the
 * product rules: the 10-character minimum and the real context shape are the
 * route's Zod rules (1.2, M2), so changing those needs no migration.
 */
export const ISSUE_REPORT_MESSAGE_MAX_LENGTH = 5000;
export const ISSUE_REPORT_PAGE_MAX_LENGTH = 512;
export const ISSUE_REPORT_CONTEXT_MAX_BYTES = 32768;
