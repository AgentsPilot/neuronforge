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
//      FIXED level and option set (SC-2), then the shared facts (reconciler
//      and delete graph for R-8, both `livemode` billing rows for R-3, Connect
//      for R-5 and the local blocking state for R-6), sequentially;
//   4. `evaluateAdminDeletionRefusals` returns every refusal (SC-4).
//
// ── AD-2a changes ───────────────────────────────────────────────────────────
//   * the fixed options are `agents: false` (OQ-1 (c), BQ-2; SA amended SC-2):
//     a purge never deletes agents, so they are listed as kept;
//   * the read helpers live in `adminDeletionFacts.ts`, shared with the
//     commit's two evaluations (FR-A7), and R-8 includes the delete-graph
//     verdict;
//   * it MINTS the signed commit token (`previewToken.ts`, AC-29) when
//     deletion is offerable: counted, no blocking refusal, a fingerprint, a
//     confirmation target, a signing key, AND the admin off switch on (BQ-1,
//     SA T-10). Minting is a pure HMAC: not a write and not the lock. The
//     token goes in the response only, never in a log or an audit row.
//
// ── What this file never does ───────────────────────────────────────────────
//   * delete, snapshot, read whole rows or take the advisory lock. Its only
//     purge-engine entry points are the preview service and the shared read
//     helpers. The one RPC on the path is the preview's existing null-id
//     existence probe, which SA D-2 permits (SC-9 = no DESTRUCTIVE RPC). A
//     Jest test spies on every destructive method and asserts none is reached;
//   * import a Supabase client or name a table in a query position (B-1, B-2):
//     every read is a repository (service role, documented at each
//     repository) or `AdminAccessService`;
//   * log an email, a business name or the token (SC-10, C-12). The first two
//     go in the result only, for the admin's dialog (FR-A2).
//
// The target id is the route path's, validated as a UUID before this runs.
// Every count stays equality-scoped to it by the repository (SC-10).

import { createLogger } from '@/lib/logger';
import { isAdminBusinessDeleteEnabled } from '@/lib/utils/featureFlags';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import type { TableCount } from '@/lib/repositories/BusinessPurgeRepository';
import { buildPurgePreview } from './PreviewService';
import type { SchemaReconcileStatus } from './SchemaReconciler';
import { PURGE_DESCRIPTORS } from './descriptors';
import { gatherAdminDeletionLaterFacts, readBusinessName, readAdminStatus } from './adminDeletionFacts';
import { resolveConfirmationTarget, type ConfirmKind } from './confirmation';
import { mintPreviewToken, PreviewTokenKeyError } from './previewToken';
import { blockingRefusals, evaluateAdminDeletionRefusals, type AdminDeletionRefusal } from './adminDeletionRefusals';
import type { PurgeArea, PurgeDescriptor, PurgeOptions } from './types';

const logger = createLogger({ module: 'AdminDeletionPreview' });

/** SC-2: the admin surface previews Purge, always. The caller chooses nothing. */
export const ADMIN_DELETION_LEVEL = 'purge' as const;

/**
 * SC-2 as amended by SA (2026-10-06) after OQ-1 (c) and BQ-2: integrations
 * disconnected; AgentsPilot agents KEPT (a purge never deletes agents, and the
 * orchestrator refuses `agents: true` permanently); activity history kept (its
 * name is removed when the login closes, AD-3).
 */
export const ADMIN_DELETION_OPTIONS: Readonly<PurgeOptions> = Object.freeze({
  integrations: true,
  agents: false,
  activityHistory: false,
});

/**
 * C-11: bump whenever R-1 … R-8, the level or the fixed options change.
 * Bumping voids every outstanding admin token. Per surface: purge slice 5
 * keeps its own.
 */
export const ADMIN_DELETION_GATE_VERSION = 1;

/** Why the confirm control is disabled when no refusal applies. */
export const PLATFORM_UNAVAILABLE_REASON =
  'deleting a business ships in a later release (the key rotation is not done and the confirmation step is not built)';

/** BQ-1: the admin off switch is off. */
export const ADMIN_DELETE_DISABLED_REASON =
  'admin delete is switched off on this server (it stays off until closing the login and the data export ship)';

/** The note on the agents line of the kept list (BQ-2). */
export const AGENTS_KEPT_NOTE = 'AgentsPilot agents and their history are kept: a purge never deletes agents.';

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
  /** Tables that hold this account's rows and are never deleted (`never`, user-scoped), plus the kept agents area. */
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
  /** True exactly when `commitToken` is set (AD-2a). The AD-1c dialog keeps its confirm disabled until AD-2b. */
  deletionAvailable: boolean;
  /** Shown as "Deletion not yet available: <reason>". */
  deletionUnavailableReason: string;
  /**
   * AD-2a: the signed commit token (AC-29), or null when deletion is not
   * offerable. For the admin's dialog only: never logged, never audited (only
   * `tokenMinted`), held in component state, never persisted (AC2-5).
   */
  commitToken: string | null;
  /** What the admin must type (FR-A6); null when it could not be determined or nothing was counted. */
  confirmKind: ConfirmKind | null;
  correlationId: string;
  generatedAt: string;
}

export type AdminDeletionPreviewOutcome =
  | { kind: 'ok'; preview: AdminDeletionPreview }
  | { kind: 'not_found' }
  /** The identity read failed: the route answers 500 (SA D-1). */
  | { kind: 'identity_error' };

/**
 * `never` descriptors that hold this account's rows: what stays, and why.
 * Plus one line for the agents area while the fixed options keep agents
 * (BQ-2): the descriptor area's name, not its table list.
 */
function keptTables(): AdminDeletionKeptTable[] {
  const kept = PURGE_DESCRIPTORS.filter((d) => d.level === 'never' && d.scope.kind !== 'global').map((d) => ({
    table: d.table,
    notes: d.notes ?? null,
  }));
  if (!ADMIN_DELETION_OPTIONS.agents && PURGE_DESCRIPTORS.some((d) => d.level === 'optional:agents')) {
    kept.push({ table: 'agents', notes: AGENTS_KEPT_NOTE });
  }
  return kept.sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0));
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
  // The cached read: a preview deletes nothing, and the commit re-checks R-2
  // with a fresh read, twice (SA AC2-7).
  const targetIsAdmin = await readAdminStatus({ id: targetId, email: identity.data.email }, { fresh: false });
  const identityOnly = evaluateAdminDeletionRefusals({ adminId, targetId, targetIsAdmin });

  // Read before the R-1 / R-2 short-circuit on purpose: display only, so the dialog header names the business even when it is refused.
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
        deletionAvailable: false,
        deletionUnavailableReason: first.message,
        commitToken: null,
        confirmKind: null,
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

  // The shared facts (FR-A7). Never throws: an unreadable schema is R-8
  // `unverified`, and the counts and the other refusals still render (SA
  // further condition 3). The preview already holds the delete-graph verdict
  // for the same level and options, so it is passed in rather than read twice.
  const { later, schema } = await gatherAdminDeletionLaterFacts({
    targetId,
    level: ADMIN_DELETION_LEVEL,
    options: { ...ADMIN_DELETION_OPTIONS },
    correlationId,
    deleteGraph: preview.deleteGraph,
  });
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
  // The honest live / not-applied line (G-1 precedent). It replaces AD-1's
  // "preview-only" line: the Purge level's deletion step exists since 3b.
  if (preview.resetLive === true) {
    limitations.push('The destructive database function is installed on this database: a confirmed deletion would run.');
  } else if (preview.resetLive === false) {
    limitations.push(
      'The destructive database function is not installed on this database, so the server would refuse a deletion before anything is copied or deleted.'
    );
  } else {
    limitations.push('Could not determine whether the destructive database function is installed.');
  }

  // 5. The commit token (AC-29; BQ-1, SA T-10).
  const firstBlocking = blockingRefusals(refusals)[0];
  const confirmation = await resolveConfirmationTarget(targetId, identity.data.email);
  const confirmKind: ConfirmKind | null = confirmation.status === 'ok' ? confirmation.kind : null;
  if (confirmation.status === 'unverified') {
    limitations.push('What to type to confirm could not be determined (the business profile could not be read).');
  } else if (confirmation.status === 'none') {
    limitations.push('This account has no business name and no email, so a deletion cannot be confirmed.');
  }
  const switchOn = isAdminBusinessDeleteEnabled();

  let commitToken: string | null = null;
  let tokenKeyUnavailable = false;
  if (!firstBlocking && switchOn && confirmKind !== null && schema.fingerprint) {
    try {
      commitToken = mintPreviewToken({
        surface: 'admin',
        actorId: adminId,
        targetId,
        level: ADMIN_DELETION_LEVEL,
        options: { ...ADMIN_DELETION_OPTIONS },
        confirmKind,
        gateVersion: ADMIN_DELETION_GATE_VERSION,
        schemaFingerprint: schema.fingerprint,
        correlationId,
      });
    } catch (err) {
      // C-7: never "no token needed". No token, and the reason says why.
      if (!(err instanceof PreviewTokenKeyError)) throw err;
      tokenKeyUnavailable = true;
      log.error({ adminId, targetId }, 'Admin deletion preview: the commit token key is unavailable');
    }
  }

  let deletionUnavailableReason: string;
  if (firstBlocking) deletionUnavailableReason = firstBlocking.message;
  else if (!switchOn) deletionUnavailableReason = ADMIN_DELETE_DISABLED_REASON;
  else if (tokenKeyUnavailable) deletionUnavailableReason = 'the server cannot sign a confirmation';
  else if (confirmKind === null) deletionUnavailableReason = 'what to type to confirm could not be determined';
  else if (!schema.fingerprint) deletionUnavailableReason = 'the database structure could not be fingerprinted';
  else if (preview.resetLive === false)
    deletionUnavailableReason = `${PLATFORM_UNAVAILABLE_REASON}; the delete function is not installed`;
  else deletionUnavailableReason = PLATFORM_UNAVAILABLE_REASON;

  // Ids, statuses and counts only (SC-10). Never the token (C-12).
  log.info(
    {
      adminId,
      targetId,
      counted: true,
      rows: preview.totals.rows,
      tablesUnknown: preview.totals.tablesUnknown,
      schemaStatus: schema.status,
      deleteGraph: preview.deleteGraph.status,
      refusals: refusals.map((r) => `${r.id}:${r.status}`),
      tokenMinted: commitToken !== null,
      adminDeleteSwitchOn: switchOn,
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
      deletionAvailable: commitToken !== null,
      deletionUnavailableReason,
      commitToken,
      confirmKind,
      generatedAt: new Date().toISOString(),
    },
  };
}
