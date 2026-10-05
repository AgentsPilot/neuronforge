// lib/business-os/purge/AdminDeletionPreview.ts
//
// Admin delete AD-1b (T10): the READ-ONLY deletion preview of ONE business,
// chosen by an admin on /admin/users (requirement D13, §6.1, §6.3; SA SC-2,
// SC-3, SC-9, SC-10).
//
// ── Order (SC-3) ────────────────────────────────────────────────────────────
//   1. the target's identity (`AuthAccountRepository.findUserIdentity`):
//      404 → not_found; any other failure → identity_error (the route answers
//      500, never 404 and never "not an admin", SA D-1);
//   2. R-1 (self) and R-2 (`checkAdminStatus`, tri-state, read-only, SA D-3).
//      If either refuses — including R-2 unverified — NOTHING is counted;
//   3. otherwise the existing `buildPurgePreview`, UNCHANGED (SA D-2), at a
//      FIXED level and option set (SC-2), then the reconciler (R-8), both
//      `livemode` billing rows (R-3), Connect (R-5) and the local blocking
//      state (R-6), sequentially (each is cheap);
//   4. `evaluateAdminDeletionRefusals` returns every refusal (SC-4).
//
// ── What this file never does ───────────────────────────────────────────────
//   * delete, snapshot, read whole rows, mint a token or take the advisory
//     lock. Its only purge-engine entry points are the preview service, the
//     reconciler and two read methods of `BusinessPurgeRepository`. The one
//     RPC on the path is the preview's existing null-id existence probe, which
//     SA D-2 permits (SC-9 = no DESTRUCTIVE RPC). A Jest test spies on every
//     destructive method and asserts none is reached;
//   * import a Supabase client or name a table in a query position (B-1, B-2):
//     every read is a repository (service role, documented at each
//     repository) or `AdminAccessService`;
//   * log an email or a business name (SC-10). They go in the result only,
//     for the admin's dialog (FR-A2).
//
// The target id is the route path's, validated as a UUID before this runs.
// Every count stays equality-scoped to it by the repository (SC-10).

import { createLogger } from '@/lib/logger';
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { businessOsBillingAccountRepository } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { businessPurgeRepository, type TableCount } from '@/lib/repositories/BusinessPurgeRepository';
import { buildPurgePreview } from './PreviewService';
import { runSchemaReconciler, type SchemaReconcileStatus } from './SchemaReconciler';
import { decideLocalPrecondition, type LocalPreconditionResult } from './localPrecondition';
import { PURGE_DESCRIPTORS } from './descriptors';
import {
  blockingRefusals,
  evaluateAdminDeletionRefusals,
  type AdminDeletionLaterFacts,
  type AdminDeletionRefusal,
  type PlanBillingFact,
} from './adminDeletionRefusals';
import type { PurgeArea, PurgeDescriptor, PurgeOptions } from './types';

const logger = createLogger({ module: 'AdminDeletionPreview' });

/** SC-2: the admin surface previews Purge, always. The caller chooses nothing. */
export const ADMIN_DELETION_LEVEL = 'purge' as const;

/**
 * SC-2 / D15 / UD-7: integrations disconnected and AgentsPilot agents deleted;
 * activity history kept (its name is removed when the login closes, AD-3).
 */
export const ADMIN_DELETION_OPTIONS: Readonly<PurgeOptions> = Object.freeze({
  integrations: true,
  agents: true,
  activityHistory: false,
});

/** Why the confirm control is disabled when no refusal applies. */
export const PLATFORM_UNAVAILABLE_REASON =
  'deleting a business ships in a later release (the Purge level and the key rotation are not done)';

export interface AdminDeletionArea {
  /** `unassigned` only if a deletable descriptor lacks an area (the invariant suite forbids it). */
  area: PurgeArea | 'unassigned';
  /** Rows counted. Unknown tables add nothing; see `tablesUnknown`. */
  rows: number;
  tablesUnknown: number;
  tables: TableCount[];
}

export interface AdminDeletionKeptTable {
  table: string;
  notes: string | null;
}

export interface AdminDeletionPreview {
  target: {
    userId: string;
    /** For the admin's dialog only (FR-A2). Never logged. */
    email: string | null;
    /** `business_profiles.company_name`; null when there is no business or it could not be read. */
    businessName: string | null;
    joinedAt: string | null;
  };
  /** False when R-1 or R-2 refused and nothing was counted (SC-3). */
  counted: boolean;
  level: typeof ADMIN_DELETION_LEVEL;
  options: PurgeOptions;
  areas: AdminDeletionArea[];
  storage: TableCount[];
  totals: { rows: number; tablesWithRows: number; tablesUnknown: number } | null;
  /** Tables that hold this account's rows and are never deleted (`never`, user-scoped). */
  keptTables: AdminDeletionKeptTable[];
  refusals: AdminDeletionRefusal[];
  schema: {
    status: SchemaReconcileStatus;
    unclassified: string[];
    missingDeletable: string[];
    missingNever: string[];
    fingerprint: string | null;
  } | null;
  /** The preview's own probe: is the destructive database function installed? `null` = unknown or not asked. */
  resetLive: boolean | null;
  limitations: string[];
  /** Always false in AD-1. */
  deletionAvailable: false;
  /** Shown as "Deletion not yet available: <reason>". */
  deletionUnavailableReason: string;
  correlationId: string;
  generatedAt: string;
}

export type AdminDeletionPreviewOutcome =
  | { kind: 'ok'; preview: AdminDeletionPreview }
  | { kind: 'not_found' }
  /** The identity read failed: the route answers 500 (SA D-1). */
  | { kind: 'identity_error' };

/** `never` descriptors that hold this account's rows: what stays, and why. */
function keptTables(): AdminDeletionKeptTable[] {
  return PURGE_DESCRIPTORS.filter((d) => d.level === 'never' && d.scope.kind !== 'global')
    .map((d) => ({ table: d.table, notes: d.notes ?? null }))
    .sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0));
}

/** Group the preview's per-table counts by descriptor area (D-5). */
function groupByArea(tables: readonly TableCount[]): AdminDeletionArea[] {
  const byTable = new Map<string, PurgeDescriptor>(PURGE_DESCRIPTORS.map((d) => [d.table, d]));
  const groups = new Map<AdminDeletionArea['area'], AdminDeletionArea>();
  for (const t of tables) {
    const area = byTable.get(t.table)?.area ?? 'unassigned';
    const group = groups.get(area) ?? { area, rows: 0, tablesUnknown: 0, tables: [] };
    group.tables.push(t);
    if (t.count === null) group.tablesUnknown += 1;
    else group.rows += t.count;
    groups.set(area, group);
  }
  return [...groups.values()].sort((a, b) => (a.area < b.area ? -1 : a.area > b.area ? 1 : 0));
}

/** One `livemode` row of the plan billing account, reduced to R-3's facts. */
async function readPlanBilling(targetId: string, livemode: boolean): Promise<PlanBillingFact> {
  try {
    const { data, error } = await businessOsBillingAccountRepository.findByUser(targetId, livemode);
    if (error) return 'unreadable';
    if (!data) return { row: null };
    return {
      row: { status: data.subscriptionStatus, stripeSubscriptionId: data.stripeSubscriptionId, endedAt: data.endedAt },
    };
  } catch {
    // The repository never throws; if it ever does, a failed read is a refusal.
    return 'unreadable';
  }
}

async function readConnectAccountCount(targetId: string): Promise<number | 'unreadable'> {
  try {
    const accounts = await businessPurgeRepository.resolveConnectAccounts(targetId);
    return accounts.length;
  } catch {
    // The resolver throws on a failed read so that `[]` always means "none".
    return 'unreadable';
  }
}

async function readLocalBlocking(targetId: string): Promise<LocalPreconditionResult> {
  try {
    return decideLocalPrecondition(await businessPurgeRepository.countLocalBlockingState(targetId));
  } catch (err) {
    return { outcome: 'refused', reason: err instanceof Error ? err.message : 'the read threw' };
  }
}

/** The business name for the dialog header. A failed read is not a refusal: it is display only. */
async function readBusinessName(targetId: string): Promise<{ name: string | null; unreadable: boolean }> {
  try {
    const { data, error } = await businessProfileRepository.findByUserId(targetId);
    if (error) return { name: null, unreadable: true };
    return { name: data?.company_name ?? null, unreadable: false };
  } catch {
    return { name: null, unreadable: true };
  }
}

/**
 * Build the admin deletion preview for `targetId`. Read-only end to end.
 *
 * Throws only if the purge preview itself throws (the route answers 500);
 * every other failed read becomes a refusal or a limitation.
 */
export async function buildAdminDeletionPreview(params: {
  adminId: string;
  targetId: string;
  correlationId: string;
}): Promise<AdminDeletionPreviewOutcome> {
  const { adminId, targetId, correlationId } = params;
  const log = logger.child({ correlationId });

  // 1. The target's identity.
  const identity = await authAccountRepository.findUserIdentity(targetId);
  if (identity.error) {
    log.error({ adminId, targetId }, 'Admin deletion preview: target identity read failed');
    return { kind: 'identity_error' };
  }
  if (!identity.data) {
    log.info({ adminId, targetId }, 'Admin deletion preview: target not found');
    return { kind: 'not_found' };
  }

  // 2. R-1 / R-2. The email may be null; the bound-id source still decides.
  const targetIsAdmin = await AdminAccessService.getInstance().checkAdminStatus({
    id: targetId,
    email: identity.data.email,
  });
  const identityOnly = evaluateAdminDeletionRefusals({ adminId, targetId, targetIsAdmin });

  const business = await readBusinessName(targetId);
  const limitations: string[] = [];
  if (business.unreadable) {
    limitations.push('The business name could not be read. The account is identified by its email and id.');
  }

  const base = {
    target: {
      userId: targetId,
      email: identity.data.email,
      businessName: business.name,
      joinedAt: identity.data.createdAt,
    },
    level: ADMIN_DELETION_LEVEL,
    options: { ...ADMIN_DELETION_OPTIONS },
    keptTables: keptTables(),
    deletionAvailable: false as const,
    correlationId,
  };

  if (identityOnly.identityRefused) {
    const first = blockingRefusals(identityOnly.refusals)[0];
    log.info(
      {
        adminId,
        targetId,
        counted: false,
        refusals: identityOnly.refusals.map((r) => `${r.id}:${r.status}`),
      },
      'Admin deletion preview refused before counting (R-1 / R-2)'
    );
    limitations.push('Nothing was counted, because this account is refused above.');
    return {
      kind: 'ok',
      preview: {
        ...base,
        counted: false,
        areas: [],
        storage: [],
        totals: null,
        refusals: identityOnly.refusals,
        schema: null,
        resetLive: null,
        limitations,
        deletionUnavailableReason: first.message,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  // 3. The existing preview, unchanged, at the fixed level and options.
  const preview = await buildPurgePreview({
    userId: targetId,
    level: ADMIN_DELETION_LEVEL,
    options: { ...ADMIN_DELETION_OPTIONS },
    correlationId,
  });

  // Never throws: an unreadable schema is R-8 `unverified`, and the counts and
  // the other refusals still render (SA further condition 3).
  const schema = await runSchemaReconciler({ correlationId });
  const billing = {
    test: await readPlanBilling(targetId, false),
    live: await readPlanBilling(targetId, true),
  };
  const connectAccounts = await readConnectAccountCount(targetId);
  const localBlocking = await readLocalBlocking(targetId);

  const later: AdminDeletionLaterFacts = {
    billing,
    connectAccounts,
    localBlocking,
    schema: { status: schema.status, unclassified: schema.unclassified, missingDeletable: schema.missingDeletable },
  };
  const { refusals } = evaluateAdminDeletionRefusals({ adminId, targetId, targetIsAdmin, later });

  // 4. Limitations: what this preview could not verify, stated, not implied.
  if (preview.totals.tablesUnknown > 0) {
    limitations.push(
      `${preview.totals.tablesUnknown} table(s) could not be counted: shown as "unknown", not as zero.`
    );
  }
  const truncated = [...preview.tables, ...preview.storage].filter((t) => t.truncated);
  if (truncated.length > 0) {
    limitations.push(
      `${truncated.length} count(s) reached an internal cap and are a floor, not an exact figure: ${truncated
        .map((t) => t.table)
        .join(', ')}.`
    );
  }
  if (schema.missingNever.length > 0) {
    limitations.push(
      `${schema.missingNever.length} never-deleted table(s) in the classification do not exist on this database (not blocking, nothing is lost): ${schema.missingNever.join(', ')}.`
    );
  }
  limitations.push(
    'The Purge level counted here is preview-only: its deletion step is not built yet (purge slice 3).'
  );
  if (preview.resetLive === false) {
    limitations.push('The destructive database function is not installed on this database.');
  } else if (preview.resetLive === null) {
    limitations.push('Could not determine whether the destructive database function is installed.');
  }

  const firstBlocking = blockingRefusals(refusals)[0];
  const deletionUnavailableReason = firstBlocking
    ? firstBlocking.message
    : preview.resetLive === false
      ? `${PLATFORM_UNAVAILABLE_REASON}; the delete function is not installed`
      : PLATFORM_UNAVAILABLE_REASON;

  // Ids, statuses and counts only (SC-10).
  log.info(
    {
      adminId,
      targetId,
      counted: true,
      rows: preview.totals.rows,
      tablesUnknown: preview.totals.tablesUnknown,
      schemaStatus: schema.status,
      refusals: refusals.map((r) => `${r.id}:${r.status}`),
    },
    'Admin deletion preview built'
  );

  return {
    kind: 'ok',
    preview: {
      ...base,
      counted: true,
      areas: groupByArea(preview.tables),
      storage: preview.storage,
      totals: preview.totals,
      refusals,
      schema: {
        status: schema.status,
        unclassified: schema.unclassified,
        missingDeletable: schema.missingDeletable,
        missingNever: schema.missingNever,
        fingerprint: schema.fingerprint,
      },
      resetLive: preview.resetLive,
      limitations,
      deletionUnavailableReason,
      generatedAt: new Date().toISOString(),
    },
  };
}
