// lib/business-os/data-export/sections.ts
//
// The export section model (DE-1, BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md §3.1;
// requirement BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.3, §0.4).
//
// Each part of the person's data export is one SECTION: an id, the group it
// belongs to, the GDPR role AgentPilot plays for it, and a reader. The route
// runs the registry in order and writes one section per entry. Later slices
// (DE-3 … DE-7) add sections here; they do not touch the route.
//
// What is in, today: the person's own account details (DX-1a, group
// `account`), and since DE-4 the owner's client records and scheduling (DX-1b,
// group `client_records`: clients, their notes and history, tasks, pipeline
// stages, document details, services, bookings, time off). Since DE-3 the
// account group also holds the person's preferences and notification choices,
// the business profile and the business's saved addresses (DX-1a). What is out:
// agents, agent settings and runs (BQ-SA-1, Business OS only), activity and
// audit history (DX-1d), Pilot-Credit subscription and transactions (DX-1a),
// the synced copy of the owner's outside calendar (user BC-5, 2026-10-15),
// and, since DE-4, the owner's connected apps (`plugin_connections`; user
// 2026-10-15: business data only, lawyer note §0.2 DX-1). Adding a section is
// a privacy decision, not a refactor.
//
// DE-5: the client money (DX-1b): quotes, invoices, payments, refunds, payment
// plans, the plans clients are on, instalments and saved payment methods
// (group `client_records`), and the business's Stripe account and payment
// providers (group `account`, SA-Q1). Money paid to AgentPilot (plans,
// credits, boosts) is never read (DX-1a). Amounts go out exactly as stored,
// next to their own currency column; nothing here converts, sums or
// defaults a currency (CLAUDE.md § Currency & Timezone; user BC-11).
//
// DE-6: intake, email marketing and consent (DX-1b, group `client_records`):
// the intake settings and every version of the intake form, the email
// campaigns, sequences, their steps and who is enrolled, the newsletter
// sign-ups, the consent records and settings, and the do-not-email list.
// Visitor tracking stays out (consent evidence and attribution through
// allow-lists; page URLs without their query string), and so do delivery
// counters and the lead-message queue (TL defaults BC-1…BC-3, 2026-10-16).
//
// DE-7: the business's website and content (DX-1c, group `content`, the
// account holder the controller, AgentPilot the processor; SA-Q3): the
// website text, every website and landing page, the blocks on those pages
// (read through the owner's own pages: the one parent-scoped read), the
// smart links and the picture library records (the files are DE-8b). Smart
// link click, sign-up and revenue counters stay out (TL default BC-1,
// 2026-10-17), and so do our storage key and the picture reuse key.
//
// DE-4: the client-record readers all go through ONE repository method,
// keyed on the section id (never a table name: SA C-4), paged to the end, and
// bounded by the Phase 1 row ceiling (limits.ts). Over the ceiling, reading
// stops and the route refuses: no partial file (§0.4.1 C). DE-3's four
// account sections from tables use the same method and factory.
//
// FR-E12: a section that fails to read is written as `status: 'failed'`, never
// as an empty-looking section. A reader that throws is treated the same way.
// The reason is logged (the repository's own error line, or the `{ err,
// sectionId }` line below) and NEVER put in the file or the audit entry.
//
// Service role only (SA C-2, DE-0b): every reader uses the default repository
// singletons, which are built on `supabaseServer`. The route's cookie-auth
// client is for `getUser()` only and is never passed here.
//
// Server-only: it imports repositories. Never import it from a 'use client' file.

import 'server-only';
import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';
import { businessDataExportRepository } from '@/lib/repositories/BusinessDataExportRepository';
import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';
import { EXPORT_LIMITS } from '@/lib/business-os/data-export/limits';

/** DE-4 adds 'client_records'; DE-7 adds 'content'. */
export type ExportGroupId = 'account' | 'client_records' | 'content';

export type GdprRole = 'controller' | 'processor';

/**
 * Every section id. Defined in the pure classificationTypes.ts (DE-2) so the
 * purge descriptors can name a section without importing this server-only
 * module; DE-2's classification test cross-checks this registry against them.
 */
export type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';

export interface ExportContext {
  /** Always `getUser().id`, never a request value. */
  userId: string;
  authUser: { id: string; email: string | null; created_at: string };
}

export type SectionReadResult<Row> =
  | { ok: true; rows: Row[] }
  // No reason on purpose: it is logged by the repository, never put in the file (C-3).
  // `overCeiling`: the section holds more rows than the budget left (DE-4 §2.6).
  | { ok: false; overCeiling?: true };

/** What a reader may still return before the export is over its ceiling. */
export interface SectionReadBudget {
  maxRows: number;
}

export interface ExportSectionDefinition<Row> {
  id: ExportSectionId;
  group: ExportGroupId;
  gdprRole: GdprRole;
  read: (ctx: ExportContext, budget: SectionReadBudget) => Promise<SectionReadResult<Row>>;
}

export type ExportedSection<Row> =
  | { id: ExportSectionId; group: ExportGroupId; gdpr_role: GdprRole; status: 'ok'; row_count: number; rows: Row[] }
  | { id: ExportSectionId; group: ExportGroupId; gdpr_role: GdprRole; status: 'failed'; row_count: 0; rows: [] };

/** `account_identity`: from the session, so it cannot fail once past the 401. */
export interface AccountIdentityRow {
  id: string;
  email: string | null;
  created_at: string;
}

/**
 * `user_profile`: the `profiles` row as PostgREST returns it, named columns
 * only (the `profiles` descriptor's `export.columns`, DE-2).
 */
export type UserProfileRow = Record<string, unknown>;

/**
 * A row of any descriptor-driven section (DE-4, DE-3): the descriptor's
 * columns, as the database holds them, in descriptor order. One flat object
 * per row, so DE-8b writes the same rows as one CSV per section (§2.5). Used
 * by the `client_records` sections and by DE-3's four `account` sections, so
 * it is not named after either (DE-3 SA C-8).
 */
export type OwnedRow = Record<string, unknown>;

/**
 * A `client_records` row (DE-4). An alias of `OwnedRow`; the reshaped cells
 * are `clients.source_metadata` (allow-listed, SOURCE_METADATA_KEYS) and,
 * since DE-5, `payments.metadata` (PAYMENT_METADATA_KEYS); since DE-6,
 * `newsletter_subscribers.attribution` (SOURCE_METADATA_KEYS),
 * `consent_records.evidence` (CONSENT_EVIDENCE_KEYS) and
 * `consent_records.source_page_url` (query string cut).
 */
export type ClientRecordRow = OwnedRow;

export type ExportRow = AccountIdentityRow | UserProfileRow | OwnedRow;

export type AnyExportSectionDefinition =
  | ExportSectionDefinition<AccountIdentityRow>
  | ExportSectionDefinition<UserProfileRow>
  | ExportSectionDefinition<OwnedRow>;

export type AnyExportedSection = ExportedSection<ExportRow>;

/**
 * The readable parts of `crm_contacts.source_metadata`: how a client found the
 * business (user decision BC-4, 2026-10-15; DE-4 SA C-3). An ALLOW-list, named
 * one by one: no prefix match, so the list cannot grow by pattern. Left out on
 * purpose: `ip_hash` (a day-salted hash of the visitor's IP, which can be
 * turned back into the address), `user_agent` (a browser signature),
 * `session_id` and `smart_link_id` (our tracking ids), and every key not
 * named here (`page_type`, `smart_link_code`, `smart_link_name` are not on the
 * user's list). Changing this changes what the export holds: a privacy
 * decision.
 */
export const SOURCE_METADATA_KEYS: readonly string[] = [
  'capture_page_url', 'referrer_url', 'referrer_domain', 'capture_channel', 'device_type', 'capture_timestamp',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
];

/**
 * The string values of `value` under exactly `keys`, in `keys` order; anything
 * else is dropped (DE-5 SA-Q3, generalised from DE-4's `sourceMetadata`). Own
 * properties only, strings only, each key named: no prefix or pattern match,
 * so an allow-list cannot grow by itself. Not an object (NULL, an array, a
 * string) gives `{}`.
 */
export function pickStringKeys(value: unknown, keys: readonly string[]): Record<string, string> {
  const kept: Record<string, string> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return kept;
  const source = value as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const item = source[key];
    if (typeof item === 'string') kept[key] = item;
  }
  return kept;
}

/**
 * DE-6 SA-Q7: a page URL without its query string and fragment. A string is
 * cut at the first `?` or `#`, whichever comes first; scheme, host and path
 * are kept exactly as stored. Plain string slicing, not `new URL()`, so a
 * relative or malformed value never throws and is never rewritten. Anything
 * that is not a string (NULL included) passes through unchanged.
 *
 * Why: the public forms record the page the visitor was on, query string
 * and all, and live rows carry token-like parameters there (`token=`,
 * `sid=`, `code=`; DE-6 workplan §11.1, §11.2). No query parameter on such
 * a page is something the owner entered; the campaign tags a reader needs
 * are already their own `utm_*` keys.
 */
export function withoutQueryOrFragment(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

/**
 * DE-6 (F-DE6-1): the keys of SOURCE_METADATA_KEYS that hold a page URL, cut
 * by `withoutQueryOrFragment`. The one deliberate change DE-6 makes to DE-4
 * output (TL decision 2026-10-16: 4 live contacts carry token-like referrer
 * parameters).
 */
export const SOURCE_METADATA_URL_KEYS: readonly string[] = ['capture_page_url', 'referrer_url'];

/**
 * The allow-listed string values of a raw `source_metadata`; anything else is
 * dropped. Also used for `business_subscribers.attribution` (DE-6), which the
 * same builder writes.
 */
export function sourceMetadata(value: unknown): Record<string, string> {
  const kept = pickStringKeys(value, SOURCE_METADATA_KEYS);
  // DE-6 (F-DE6-1): the page URLs lose their query string and fragment. Key order is kept.
  for (const key of SOURCE_METADATA_URL_KEYS) {
    if (key in kept) kept[key] = withoutQueryOrFragment(kept[key]) as string;
  }
  return kept;
}

/**
 * The readable parts of `payment_transactions.metadata` (DE-5 SA-Q3; user
 * BC-7, 2026-10-16): `notes`, the text the owner typed when recording a cash
 * or bank payment (stored nowhere else), and `source`, how the payment was
 * recorded (`manual_mark_paid`, `website_booking`, ...). Every other key is
 * out: `checkout_session_id`, `connect_account_id`, `subscription_id`,
 * `stripe_invoice_id` (processor plumbing), `booking_id`, `service_id`,
 * `invoice_number`, `installment_count`, `installment_number` (copies of
 * columns already in the section), and any key not named here. Changing this
 * changes what the export holds: a privacy decision.
 */
export const PAYMENT_METADATA_KEYS: readonly string[] = ['notes', 'source'];

/** The allow-listed string values of a raw `payment_transactions.metadata`. */
export function paymentMetadata(value: unknown): Record<string, string> {
  return pickStringKeys(value, PAYMENT_METADATA_KEYS);
}

/**
 * The readable parts of `marketing_consent_events.evidence` (DE-6 SA-Q4): the
 * three keys the code writes. `client_statement` is the sentence the
 * visitor's page showed, `confirmed_via` how a double opt-in was confirmed
 * (`email_link` / `confirm_button`), `note` what the owner typed when
 * entering consent by hand. Strings only; any other key is dropped. Changing
 * this changes what the export holds: a privacy decision.
 */
export const CONSENT_EVIDENCE_KEYS: readonly string[] = ['client_statement', 'confirmed_via', 'note'];

/** The allow-listed string values of a raw consent `evidence`. */
export function consentEvidence(value: unknown): Record<string, string> {
  return pickStringKeys(value, CONSENT_EVIDENCE_KEYS);
}

const accountIdentitySection: ExportSectionDefinition<AccountIdentityRow> = {
  id: 'account_identity',
  group: 'account',
  gdprRole: 'controller',
  read: async (ctx) => ({
    ok: true,
    rows: [{ id: ctx.authUser.id, email: ctx.authUser.email, created_at: ctx.authUser.created_at }],
  }),
};

const userProfileSection: ExportSectionDefinition<UserProfileRow> = {
  id: 'user_profile',
  group: 'account',
  gdprRole: 'controller',
  read: async (ctx) => {
    const { data, error } = await userProfileRepository.findForUserDataExport(ctx.userId);
    if (error) return { ok: false };
    // No row is not a failure (SA Q-4): an `ok` section with 0 rows.
    return { ok: true, rows: data ? [data] : [] };
  },
};

/**
 * A descriptor-driven section (DE-4; generalised in DE-3, SA C-2): one read
 * through `BusinessDataExportRepository`, keyed on the session's id and on the
 * section id, bounded by the budget. `mapRow` is for a reshaped cell
 * (source_metadata).
 */
function ownedRowsSection(
  id: ExportSectionId,
  group: ExportGroupId,
  gdprRole: GdprRole,
  mapRow?: (row: OwnedRow) => OwnedRow
): ExportSectionDefinition<OwnedRow> {
  return {
    id,
    group,
    gdprRole,
    read: async (ctx, budget) => {
      const { data, error } = await businessDataExportRepository.listOwnedRowsForExport(id, ctx.userId, {
        maxRows: budget.maxRows,
      });
      if (error || !data) return { ok: false };
      if (data.overCeiling) return { ok: false, overCeiling: true };
      return { ok: true, rows: mapRow ? data.rows.map(mapRow) : data.rows };
    },
  };
}

/**
 * A `client_records` section (DE-4). AgentPilot is the processor of these
 * records; the account holder is the controller.
 */
function clientRecordsSection(
  id: ExportSectionId,
  mapRow?: (row: ClientRecordRow) => ClientRecordRow
): ExportSectionDefinition<ClientRecordRow> {
  return ownedRowsSection(id, 'client_records', 'processor', mapRow);
}

/**
 * An `account` section read from a table (DE-3): the account holder's own
 * details, given to us to run their account. AgentPilot is the controller
 * (§0.4.1 E; DE-3 SA-Q2).
 */
function accountTableSection(id: ExportSectionId): ExportSectionDefinition<OwnedRow> {
  return ownedRowsSection(id, 'account', 'controller');
}

/**
 * A `content` section (DE-7, SA-Q3): the business's website and content.
 * AgentPilot hosts it on the account holder's behalf, so it is the processor;
 * the account holder is the controller (as `client_records`). No row mapper:
 * every cell goes out as held (SA-Q7, SA-Q8).
 */
function contentSection(id: ExportSectionId): ExportSectionDefinition<OwnedRow> {
  return ownedRowsSection(id, 'content', 'processor');
}

/**
 * `clients`: the raw `source_metadata` never reaches the file, only its BC-4 keys. Key order is kept.
 * DE-6 (F-DE6-1): `sourceMetadata` now also cuts the two page URLs at their query string.
 */
const clientRow = (row: ClientRecordRow): ClientRecordRow => ({ ...row, source_metadata: sourceMetadata(row.source_metadata) });

/** `payments` (DE-5): the raw `metadata` never reaches the file, only `notes` and `source`. Key order is kept. */
const paymentRow = (row: ClientRecordRow): ClientRecordRow => ({ ...row, metadata: paymentMetadata(row.metadata) });

/**
 * `newsletter_subscribers` (DE-6): the raw `attribution` never reaches the
 * file, only the SOURCE_METADATA_KEYS (same builder as `source_metadata`),
 * with the page URLs cut at the query string (SA-Q7 C-2). Key order is kept.
 */
const subscriberRow = (row: ClientRecordRow): ClientRecordRow => ({ ...row, attribution: sourceMetadata(row.attribution) });

/**
 * `consent_records` (DE-6): the raw `evidence` never reaches the file, only
 * CONSENT_EVIDENCE_KEYS (SA-Q4); `source_page_url` loses its query string and
 * fragment (SA-Q7). `privacy_policy_url` is kept as held (0 live URLs with a
 * query string, §11.2 C-3). Key order is kept.
 */
const consentEventRow = (row: ClientRecordRow): ClientRecordRow => ({
  ...row,
  source_page_url: withoutQueryOrFragment(row.source_page_url),
  evidence: consentEvidence(row.evidence),
});

/**
 * The registry, in file order. DE-4's eight sections follow the account group (§2.3).
 * DE-3: the four account sections from tables follow `user_profile`; they
 * draw on the same row ceiling, before the client records (DE-3 SA C-3).
 * DE-4 (user 2026-10-15): the `plugin_connections` section is gone, with its
 * reader and its `profile_data` allow-list: connected apps are not exported.
 * DE-5: the Stripe account and payment providers follow `business_addresses`
 * (account, SA-Q1); the eight client-money sections follow `time_off`. All
 * draw on the same row ceiling.
 * DE-7: the five `content` sections follow `email_unsubscribes`, on the same
 * row ceiling.
 */
export const EXPORT_SECTIONS: readonly AnyExportSectionDefinition[] = [
  accountIdentitySection,
  userProfileSection,
  accountTableSection('preferences'),
  accountTableSection('notification_settings'),
  accountTableSection('business_profile'),
  accountTableSection('business_addresses'),
  // DE-5 (SA-Q1): facts about the business itself, AgentPilot the controller.
  accountTableSection('payment_account'),
  accountTableSection('payment_providers'),
  clientRecordsSection('pipeline_stages'),
  clientRecordsSection('clients', clientRow),
  clientRecordsSection('client_activities'),
  clientRecordsSection('client_tasks'),
  // Deleted documents are left out by the descriptor's rowFilter (BC-3).
  clientRecordsSection('client_documents'),
  clientRecordsSection('services'),
  clientRecordsSection('bookings'),
  clientRecordsSection('time_off'),
  // DE-5: the client money, every status in (user BC-2).
  clientRecordsSection('quotes'),
  clientRecordsSection('invoices'),
  clientRecordsSection('payments', paymentRow),
  clientRecordsSection('refunds'),
  clientRecordsSection('payment_plans'),
  clientRecordsSection('client_payment_plans'),
  clientRecordsSection('installments'),
  clientRecordsSection('client_payment_methods'),
  // DE-6: intake, email marketing and consent, every status in (SA-Q2, §2.3).
  clientRecordsSection('intake_settings'),
  clientRecordsSection('intake_forms'),
  clientRecordsSection('email_campaigns'),
  clientRecordsSection('email_sequences'),
  clientRecordsSection('email_sequence_steps'),
  clientRecordsSection('email_sequence_enrollments'),
  clientRecordsSection('newsletter_subscribers', subscriberRow),
  clientRecordsSection('consent_records', consentEventRow),
  // One row, read by user_id (no id column; SA-Q1).
  clientRecordsSection('consent_settings'),
  clientRecordsSection('email_unsubscribes'),
  // DE-7: website and content, every status and on/off state in (SA-Q4, §2.3).
  contentSection('website_content'),
  contentSection('website_pages'),
  // After its parent: read through the owner's own pages (viaParent, SA-Q1).
  contentSection('website_blocks'),
  contentSection('smart_links'),
  // The user_media records; the picture files arrive in DE-8b.
  contentSection('images'),
];

/** Only the level this module uses, typed structurally so a Pino child logger satisfies it. */
export interface SectionRunLogger {
  error: (context: Record<string, unknown>, message: string) => void;
}

/** What `runExportSections` returns. Over the ceiling, the route sends no file (§0.4.1 C). */
export type ExportRunResult =
  | { overCeiling: false; sections: AnyExportedSection[] }
  | {
      overCeiling: true;
      /** The sections read before the ceiling was passed; never written to a file. */
      sections: AnyExportedSection[];
      /** The section during which the ceiling was passed. */
      atSection: ExportSectionId;
    };

async function readOne(
  ctx: ExportContext,
  section: AnyExportSectionDefinition,
  budget: SectionReadBudget,
  logger: SectionRunLogger
): Promise<SectionReadResult<ExportRow>> {
  try {
    return await section.read(ctx, budget);
  } catch (err) {
    // FR-E12 holds even for a reader that forgets to catch. The error stays in the log.
    logger.error({ err, sectionId: section.id }, 'Data export section read threw');
    return { ok: false };
  }
}

/**
 * Read every section, sequentially and in registry order (as the route always
 * has; parallel reads are a later optimisation). Never throws for a reader.
 *
 * DE-4 (§2.6): every reader is handed the rows still left under the ceiling.
 * Rows of every section count, the account sections included. The moment the
 * total passes the ceiling, reading stops (later sections are not read) and
 * the result is `overCeiling`. Exactly at the ceiling is exported.
 */
export async function runExportSections(
  ctx: ExportContext,
  sections: readonly AnyExportSectionDefinition[],
  logger: SectionRunLogger,
  opts: { rowCeiling?: number } = {}
): Promise<ExportRunResult> {
  const rowCeiling = opts.rowCeiling ?? EXPORT_LIMITS.ROW_CEILING;
  const out: AnyExportedSection[] = [];
  let total = 0;
  for (const section of sections) {
    const head = { id: section.id, group: section.group, gdpr_role: section.gdprRole };
    const result = await readOne(ctx, section, { maxRows: Math.max(0, rowCeiling - total) }, logger);
    if (!result.ok) {
      if (result.overCeiling) return { overCeiling: true, sections: out, atSection: section.id };
      out.push({ ...head, status: 'failed', row_count: 0, rows: [] });
      continue;
    }
    total += result.rows.length;
    // A reader that ignores its budget (the account sections) still counts.
    if (total > rowCeiling) return { overCeiling: true, sections: out, atSection: section.id };
    out.push({ ...head, status: 'ok', row_count: result.rows.length, rows: result.rows });
  }
  return { overCeiling: false, sections: out };
}
