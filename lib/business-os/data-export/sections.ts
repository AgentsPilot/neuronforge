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
// What is in, today (DX-1a): the person's own account details. What is out:
// agents, agent settings and runs (BQ-SA-1, Business OS only), activity and
// audit history (DX-1d), Pilot-Credit subscription and transactions (DX-1a).
// Adding a section is a privacy decision, not a refactor.
//
// FR-E12: a section that fails to read is written as `status: 'failed'`, never
// as an empty-looking section. A reader that throws is treated the same way.
// The reason is logged (the repository's own error line, or the `{ err,
// sectionId }` line below) and NEVER put in the file or the audit entry.
//
// Service role only (SA C-2, DE-0b): every reader uses the default repository
// singletons, which are built on `supabaseServer`. The route's cookie-auth
// client is for `getUser()` only and is never passed here: under DE-0b the
// `authenticated` role cannot read `plugin_connections.profile_data`.
//
// Server-only: it imports repositories. Never import it from a 'use client' file.

import 'server-only';
import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';
import { pluginConnectionRepository } from '@/lib/repositories/PluginConnectionRepository';
import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';

/** DE-4+ add 'client_records' and 'content'. */
export type ExportGroupId = 'account';

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
  | { ok: false };

export interface ExportSectionDefinition<Row> {
  id: ExportSectionId;
  group: ExportGroupId;
  gdprRole: GdprRole;
  read: (ctx: ExportContext) => Promise<SectionReadResult<Row>>;
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

/** `plugin_connections`: one connected account, credentials never included. */
export interface PluginConnectionExportItem {
  plugin_key: string;
  plugin_name: string | null;
  account_username: string | null;
  account_email: string | null;
  account_profile: Record<string, string | string[]>;
  scope: string | null;
  status: string | null;
  connected_at: string | null;
  last_updated: string | null;
  last_used: string | null;
  disconnected_at: string | null;
}

export type ExportRow = AccountIdentityRow | UserProfileRow | PluginConnectionExportItem;

export type AnyExportSectionDefinition =
  | ExportSectionDefinition<AccountIdentityRow>
  | ExportSectionDefinition<UserProfileRow>
  | ExportSectionDefinition<PluginConnectionExportItem>;

export type AnyExportedSection = ExportedSection<ExportRow>;

/**
 * The provider profile fields a person gets back in their export (SA C-1,
 * DATA_EXPORT_FOLLOWUPS_WORKPLAN.md). An ALLOW-list on purpose: some providers
 * store an access token inside `profile_data`, under names nobody can predict,
 * so stripping known secret keys would fail open. Only these top-level keys,
 * and only when the value is a string or an array of strings. Never an id /
 * `sub`, never a token key, never a nested object. Changing this changes what
 * the export holds: a privacy decision.
 *
 * Moved verbatim from app/api/user/data-export/route.ts (DE-1).
 */
export const ACCOUNT_PROFILE_KEYS: readonly string[] = [
  'name', 'given_name', 'family_name', 'email', 'mail', 'picture', 'avatar_url', 'locale',
  'language', 'country', 'displayName', 'givenName', 'surname', 'jobTitle', 'mobilePhone',
  'businessPhones', 'officeLocation', 'preferredLanguage', 'userPrincipalName', 'nickname',
  'preferred_username',
];

/** The allow-listed part of a raw `profile_data` value; anything else is dropped. */
export function accountProfile(profileData: unknown): Record<string, string | string[]> {
  const profile: Record<string, string | string[]> = {};
  if (typeof profileData !== 'object' || profileData === null || Array.isArray(profileData)) return profile;
  const source = profileData as Record<string, unknown>;
  for (const key of ACCOUNT_PROFILE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (typeof value === 'string') {
      profile[key] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      profile[key] = [...(value as string[])];
    }
  }
  return profile;
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

const pluginConnectionsSection: ExportSectionDefinition<PluginConnectionExportItem> = {
  id: 'plugin_connections',
  group: 'account',
  gdprRole: 'controller',
  read: async (ctx) => {
    const { data, error } = await pluginConnectionRepository.listForUserDataExport(ctx.userId);
    if (error) return { ok: false };
    // Disconnected connections are kept: a status, not a soft delete (SA Q-7).
    // The raw `profile_data` never reaches the file: only its allow-listed fields.
    return {
      ok: true,
      rows: (data ?? []).map((conn) => ({
        plugin_key: conn.plugin_key,
        plugin_name: conn.plugin_name,
        account_username: conn.username,
        account_email: conn.email,
        account_profile: accountProfile(conn.profile_data),
        scope: conn.scope,
        status: conn.status,
        connected_at: conn.connected_at ?? conn.created_at,
        last_updated: conn.updated_at,
        last_used: conn.last_used,
        disconnected_at: conn.disconnected_at,
      })),
    };
  },
};

/** The registry, in file order. */
export const EXPORT_SECTIONS: readonly AnyExportSectionDefinition[] = [
  accountIdentitySection,
  userProfileSection,
  pluginConnectionsSection,
];

/** Only the level this module uses, typed structurally so a Pino child logger satisfies it. */
export interface SectionRunLogger {
  error: (context: Record<string, unknown>, message: string) => void;
}

async function runOne(ctx: ExportContext, section: AnyExportSectionDefinition, logger: SectionRunLogger): Promise<AnyExportedSection> {
  const head = { id: section.id, group: section.group, gdpr_role: section.gdprRole };
  let result: SectionReadResult<ExportRow>;
  try {
    result = await section.read(ctx);
  } catch (err) {
    // FR-E12 holds even for a reader that forgets to catch. The error stays in the log.
    logger.error({ err, sectionId: section.id }, 'Data export section read threw');
    result = { ok: false };
  }
  if (!result.ok) return { ...head, status: 'failed', row_count: 0, rows: [] };
  return { ...head, status: 'ok', row_count: result.rows.length, rows: result.rows };
}

/**
 * Read every section, sequentially and in registry order (as the route always
 * has; parallel reads are a later optimisation). Never throws for a reader.
 */
export async function runExportSections(
  ctx: ExportContext,
  sections: readonly AnyExportSectionDefinition[],
  logger: SectionRunLogger
): Promise<AnyExportedSection[]> {
  const out: AnyExportedSection[] = [];
  for (const section of sections) {
    out.push(await runOne(ctx, section, logger));
  }
  return out;
}
