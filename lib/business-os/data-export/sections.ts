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
// stages, document details, services, bookings, time off). What is out:
// agents, agent settings and runs (BQ-SA-1, Business OS only), activity and
// audit history (DX-1d), Pilot-Credit subscription and transactions (DX-1a),
// the synced copy of the owner's outside calendar (user BC-5, 2026-10-15),
// and, since DE-4, the owner's connected apps (`plugin_connections`; user
// 2026-10-15: business data only, lawyer note §0.2 DX-1). Adding a section is
// a privacy decision, not a refactor.
//
// DE-4: the client-record readers all go through ONE repository method,
// keyed on the section id (never a table name: SA C-4), paged to the end, and
// bounded by the Phase 1 row ceiling (limits.ts). Over the ceiling, reading
// stops and the route refuses: no partial file (§0.4.1 C).
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
export type ExportGroupId = 'account' | 'client_records';

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
 * A `client_records` row (DE-4): the descriptor's columns, as the database
 * holds them, in descriptor order. One flat object per row, so DE-8b writes
 * the same rows as one CSV per section (§2.5). The one reshaped cell is
 * `clients.source_metadata` (allow-listed, SOURCE_METADATA_KEYS).
 */
export type ClientRecordRow = Record<string, unknown>;

export type ExportRow = AccountIdentityRow | UserProfileRow | ClientRecordRow;

export type AnyExportSectionDefinition =
  | ExportSectionDefinition<AccountIdentityRow>
  | ExportSectionDefinition<UserProfileRow>
  | ExportSectionDefinition<ClientRecordRow>;

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

/** The allow-listed string values of a raw `source_metadata`; anything else is dropped. */
export function sourceMetadata(value: unknown): Record<string, string> {
  const kept: Record<string, string> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return kept;
  const source = value as Record<string, unknown>;
  for (const key of SOURCE_METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const item = source[key];
    if (typeof item === 'string') kept[key] = item;
  }
  return kept;
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
 * A `client_records` section (DE-4): one descriptor-driven read through
 * `BusinessDataExportRepository`, keyed on the session's id and on the section
 * id. AgentPilot is the processor of these records; the account holder is
 * the controller. `mapRow` is for the one reshaped cell (source_metadata).
 */
function clientRecordsSection(
  id: ExportSectionId,
  mapRow?: (row: ClientRecordRow) => ClientRecordRow
): ExportSectionDefinition<ClientRecordRow> {
  return {
    id,
    group: 'client_records',
    gdprRole: 'processor',
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

/** `clients`: the raw `source_metadata` never reaches the file, only its BC-4 keys. Key order is kept. */
const clientRow = (row: ClientRecordRow): ClientRecordRow => ({ ...row, source_metadata: sourceMetadata(row.source_metadata) });

/**
 * The registry, in file order. DE-4's eight sections follow the account group (§2.3).
 * DE-4 (user 2026-10-15): the `plugin_connections` section is gone, with its
 * reader and its `profile_data` allow-list: connected apps are not exported.
 */
export const EXPORT_SECTIONS: readonly AnyExportSectionDefinition[] = [
  accountIdentitySection,
  userProfileSection,
  clientRecordsSection('pipeline_stages'),
  clientRecordsSection('clients', clientRow),
  clientRecordsSection('client_activities'),
  clientRecordsSection('client_tasks'),
  // Deleted documents are left out by the descriptor's rowFilter (BC-3).
  clientRecordsSection('client_documents'),
  clientRecordsSection('services'),
  clientRecordsSection('bookings'),
  clientRecordsSection('time_off'),
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
