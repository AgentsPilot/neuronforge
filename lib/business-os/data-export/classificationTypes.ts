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

/**
 * Every section id of the export file. `sections.ts` re-exports it.
 *
 * DE-4 adds the eight `client_records` sections, one table each. They are
 * plain words because DE-8b names each CSV after its section (`clients.csv`,
 * `bookings.csv`; DE-4 SA-Q3).
 *
 * DE-4 (user 2026-10-15): `plugin_connections` is no longer a section:
 * connected apps left the export (business data only).
 *
 * DE-3 adds four `account` sections after `user_profile`: the person's
 * preferences and notification choices, the business profile and the
 * business's saved addresses (DE-3 workplan §2.3).
 *
 * DE-5 adds the client money: two `account` sections after
 * `business_addresses` (the business's Stripe account and its payment
 * providers, SA-Q1) and eight `client_records` sections after `time_off`
 * (quotes, invoices, payments, refunds, payment plans, the plans clients are
 * on, instalments, saved payment methods; DE-5 workplan §2.3).
 *
 * DE-6 adds ten `client_records` sections after `client_payment_methods`:
 * the intake settings and forms, the email campaigns, sequences, their steps
 * and who is enrolled, the newsletter sign-ups, the consent records, the
 * consent settings and the do-not-email list (DE-6 workplan §2.3).
 *
 * DE-7 adds five `content` sections after `email_unsubscribes`: the website
 * text, the website and landing pages, the blocks on those pages, the smart
 * links and the picture library (`images`, the `user_media` records; the
 * files arrive in DE-8b) (DE-7 workplan §2.3).
 */
export type ExportSectionId =
  | 'account_identity'
  | 'user_profile'
  | 'preferences'
  | 'notification_settings'
  | 'business_profile'
  | 'business_addresses'
  | 'payment_account'
  | 'payment_providers'
  | 'pipeline_stages'
  | 'clients'
  | 'client_activities'
  | 'client_tasks'
  | 'client_documents'
  | 'services'
  | 'bookings'
  | 'time_off'
  | 'quotes'
  | 'invoices'
  | 'payments'
  | 'refunds'
  | 'payment_plans'
  | 'client_payment_plans'
  | 'installments'
  | 'client_payment_methods'
  | 'intake_settings'
  | 'intake_forms'
  | 'email_campaigns'
  | 'email_sequences'
  | 'email_sequence_steps'
  | 'email_sequence_enrollments'
  | 'newsletter_subscribers'
  | 'consent_records'
  | 'consent_settings'
  | 'email_unsubscribes'
  | 'website_content'
  | 'website_pages'
  | 'website_blocks'
  | 'smart_links'
  | 'images';

/**
 * The slices that added a table's section. `planned` is FORBIDDEN on tables
 * since DE-7 (every table is include or exclude; exportClassification.test.ts
 * runs with PLANNED_TABLES_ALLOWED = false). The type stays so the CI rule and
 * its negative controls can still name a planted `planned` row (DE-7 SA-Q9).
 */
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
 * - `planned`: in scope, not built yet; `slice` adds it. Forbidden on tables
 *   since DE-7 (kept for the CI rule and its negative controls, SA-Q9).
 */
export type TableExportClassification =
  | {
      kind: 'include';
      section: ExportSectionId;
      columns: readonly string[];
      excludedColumns?: Readonly<Record<string, string>>;
      /** Rows left out of the section, declaratively (DE-4 §2.4, SA-Q2). */
      rowFilter?: ExportRowFilter;
      /**
       * DE-6 SA-Q1: the table has no `id` and its primary key is `user_id`,
       * so the reader takes its one row with `.eq('user_id').limit(2)` and
       * fails closed on two, instead of keyset paging on `id`. `'user_id'` is
       * the only value. Without it, `columns` must list `id`. Only
       * `marketing_consent_settings` carries it; a second one is an SA item.
       */
      rowKey?: 'user_id';
      /**
       * DE-7 SA-Q1 / SA-Q2: a `via` table (no `user_id` of its own) read
       * through its owner-scoped parent. Must deep-equal the descriptor's
       * purge `scope` `{ parent, fk }` (two-key opt-in: a purge scope changed
       * to `via` without this still fails closed, and this without a matching
       * `via` scope is a CI problem). The parent must be a `user_id`-scoped
       * `include` with `id` in its columns, no `rowKey` and no `rowFilter`
       * (one hop only). Only `website_blocks` carries it; a second one is an
       * SA item.
       */
      viaParent?: { parent: string; fk: string };
    }
  | { kind: 'exclude'; reason: string }
  | { kind: 'planned'; slice: PlannedTableSlice };

/**
 * Rows of an `include` table that stay out of the export: `column NOT IN
 * (notIn)`. The one user is the soft delete of `contact_documents` (SQ-E5,
 * BC-3). A status that is not a delete (archived, cancelled, inactive) is
 * never filtered: "everything we hold" (DX-8).
 *
 * `column` must be one of the table's `columns` and NOT NULL live, because SQL
 * `NOT IN` drops a NULL row without a word (DE-4 SA C-6). `tableExportProblems`
 * checks the shape; `rowFilterNullabilityProblems` checks NOT NULL against the
 * live columns. The purge engine never reads it (it never reads `export`).
 */
export interface ExportRowFilter {
  column: string;
  notIn: readonly string[];
  reason: string;
}

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
