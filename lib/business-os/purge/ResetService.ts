// lib/business-os/purge/ResetService.ts
//
// T16 — the slice 2 orchestrator, generalised in purge slice 3b to both levels
// (Reset and Purge) and the opt-in extras. The whole run, in the mandated
// three-phase shape, and in an order where every step that can refuse runs
// before the first step that produces something irreversible.
//
//   PRE      1. RPC-existence probe                (refuse if not applied)
//            2. agents option                      (refused permanently, OQ-1 (c))
//            3. delete-graph check                 (refuse unless `ok`; SA C-5)
//            4. Reset guard — control 1, control 2 (refuse on either)
//   PHASE 1  5. snapshot, VERIFIED by read-back    (abort on failure, AC-35)
//   PHASE 2  6. purge_business_data RPC            (one transaction)
//   PHASE 3  7. storage removal                    (non-transactional, never fatal)
//            8. structured report
//            9. audit — for refusals as well as successes (FR-20, AC-18)
//
// The file keeps its slice-2 name and a `runReset` wrapper (SA OQ-5): the
// single-orchestrator pins name this file, and the rename lands with slice 5.
//
// ── Why the probe runs FIRST, before even the guard ────────────────────────
// A snapshot is the most sensitive object this system writes: a full row-level
// copy of a business's contacts, messages and invoices. Writing one for a run
// that was never going to reach the commit is a real cost with no benefit.
// Until `20260916b` is applied the function does not exist, so every run would
// otherwise snapshot and then fail — producing an artefact per attempt. Asking
// "can this run finish at all?" before anything else is the cheapest way to
// make sure the answer is never discovered halfway. It is also the inactive
// proof (slice 3 §6.3): on a database without the function, nothing below the
// probe runs, the delete-graph read included.
//
// ── Resume is rejected ─────────────────────────────────────────────────────
// There is no partial state to resume from, by construction: phase 2 is one
// transaction, so it either happened or did not. Phase 3 failures are reported
// as residue, not retried, because retrying needs durable half-state and D7
// refused a grace period.

import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

import { CASCADE_COUNT_EXEMPT, descriptorsForRun, STORAGE_DESCRIPTORS } from './descriptors';
import { runDeleteGraphCheck, type DeleteGraphResult } from './deleteGraph';
import { evaluateResetGuard } from './ResetGuard';
import { writeVerifiedSnapshot } from './SnapshotWriter';
import { hasCapability } from './capabilities';
import { isDevelopment, withDevDetail } from './devDetail';
import type { PurgeLevel, PurgeOptions } from './types';
import { businessPurgeRepository } from '@/lib/repositories/BusinessPurgeRepository';

const logger = createLogger({ module: 'PurgeResetService' });
const auditTrail = AuditTrailService.getInstance();

/** Why a run did not complete. Stable strings — the UI switches on them. */
export type ResetRefusal =
  | 'rpc_not_applied'
  | 'rpc_state_unknown'
  | 'capability_missing'
  | 'agents_option_refused'
  | 'delete_graph_refused'
  | 'delete_graph_unreadable'
  | 'stripe_connected'
  | 'stripe_unreadable'
  | 'local_blocking'
  | 'local_unreadable'
  | 'snapshot_failed'
  | 'already_running'
  | 'commit_failed';

/** Every opt-in extra off — slice 2's Reset, and the commit route's default. */
export const NO_OPTIONS: Readonly<PurgeOptions> = Object.freeze({
  integrations: false,
  agents: false,
  activityHistory: false,
});

export type ResetOutcome =
  | {
      status: 'completed';
      correlationId: string;
      level: PurgeLevel;
      options: PurgeOptions;
      snapshotPath: string;
      /**
       * Rows removed per table, from the VERIFIED SNAPSHOT (SA OQ-4): the
       * truth. A statement count misses rows a parent's cascade removed first.
       */
      rows: { total: number; byTable: Record<string, number> };
      /** The RPC's per-statement counts. Diagnostics only (OQ-4). */
      rpcRows: { total: number; byTable: Record<string, number> };
      storage: Array<{ bucket: string; deleted: number; failed: Array<{ path: string; reason: string }> }>;
      /** Non-empty means the rows are gone but some files remain. The run still succeeded. */
      residue: string[];
      /**
       * Internal-surface result notes (FR-24, FR-25, AC-32, AC-42). Plain
       * English; the localised customer copy is slice 5.
       */
      notes: string[];
      committedAt: string;
      durationMs: number;
    }
  | {
      status: 'refused';
      correlationId: string;
      reason: ResetRefusal;
      message: string;
      /** Was anything written before refusing? Always stated, never implied. */
      snapshotWritten: boolean;
      rowsDeleted: 0;
      detail?: unknown;
    };


/**
 * The result notes for a completed run on the INTERNAL surface. Pure, so the
 * copy is testable without a run. No table name appears: the notes describe
 * what the owner sees, and the descriptor set is the only table inventory
 * (requirement §10.9).
 */
export function commitResultNotes(level: PurgeLevel, options: PurgeOptions): string[] {
  const notes: string[] = [];

  if (level === 'purge') {
    notes.push(
      // FR-25 / AC-43
      'The business subdomain has been released. Anyone can now claim it, so the old public address may later show a different business.',
      // AC-42 (and M-7: the plan row is `never`, so no fresh trial)
      'Setting the business up again through onboarding creates a NEW public code, so old /c/ booking and contact links will not work again. The free trial does not restart: the plan record is kept.',
      // AC-32
      'Channel connections were removed. Purge always removes them, whether or not "disconnect integrations" was ticked.',
    );
  }

  if (options.integrations) {
    notes.push('Integrations were disconnected. Reconnect them from Settings before running anything that uses them.');
  }

  if (options.activityHistory) {
    notes.push('Activity history was deleted, including archived copies. The audit record of THIS run is written afterwards and is kept.');
  }

  // FR-24: the internal surface's result only.
  notes.push(
    'Chat action history was deleted, so a plan-level automated send (one not tied to a specific contact or record) can run again if the same saved plan is run again. This is accepted (FR-24).',
  );

  return notes;
}

/** Counts only — the production-safe summary of a graph refusal (SA C-4). */
function graphSummary(graph: DeleteGraphResult) {
  return {
    status: graph.status,
    blockingOrderViolations: graph.blockingOrderViolations.length,
    unlistedCascadeChildren: graph.unlistedCascadeChildren.length,
    unreviewedDeleteTriggers: graph.unreviewedDeleteTriggers.length,
  };
}

/** Back-compat wrapper (SA OQ-5): slice 2's Reset with every option off. */
export async function runReset(params: {
  userId: string;
  actorEmail: string | null;
  correlationId: string;
}): Promise<ResetOutcome> {
  return runPurgeCommit({ ...params, level: 'reset', options: { ...NO_OPTIONS } });
}

export async function runPurgeCommit(params: {
  userId: string;
  actorEmail: string | null;
  correlationId: string;
  level: PurgeLevel;
  options: PurgeOptions;
}): Promise<ResetOutcome> {
  const { userId, actorEmail, correlationId, level } = params;
  // Copied field by field: only the three known keys reach the run, the
  // snapshot, the RPC and the audit row.
  const options: PurgeOptions = {
    integrations: params.options.integrations === true,
    agents: params.options.agents === true,
    activityHistory: params.options.activityHistory === true,
  };
  const log = logger.child({ correlationId });
  const startedAt = Date.now();
  const label = level === 'purge' ? 'Purge' : 'Reset';

  const refuse = async (
    reason: ResetRefusal,
    message: string,
    snapshotWritten: boolean,
    detail?: unknown,
    /** Server-side only: recorded in the audit row, never returned. Defaults to `detail`. */
    auditDetail?: unknown,
  ): Promise<ResetOutcome> => {
    log.warn({ userId, level, options, reason, snapshotWritten }, `${label} refused`);

    auditTrail
      .log({
        action: AUDIT_EVENTS.BUSINESS_DATA_PURGE_BLOCKED,
        entityType: 'user',
        entityId: userId,
        userId,
        actorId: userId,
        resourceName: actorEmail ?? userId,
        severity: 'warning',
        details: {
          level,
          options,
          surface: 'internal',
          reason,
          message,
          snapshotWritten,
          correlationId,
          detail: auditDetail ?? detail ?? null,
        },
      })
      .catch((err) => log.error({ err }, `Audit of refused ${level} failed (non-blocking)`));

    return { status: 'refused', correlationId, reason, message, snapshotWritten, rowsDeleted: 0, detail };
  };

  // ── Capability ──────────────────────────────────────────────────────────
  // SA-S1: capability gates the OPERATION. The table list below is resolved
  // from level + options only, and nothing here can shorten it.
  if (!hasCapability('delete_rows')) {
    return refuse(
      'capability_missing',
      'This build does not have the delete capability granted.',
      false,
    );
  }

  // ── 1. Is the destructive function applied at all? ──────────────────────
  const exists = await businessPurgeRepository.purgeFunctionExists();
  if (exists === false) {
    return refuse(
      'rpc_not_applied',
      'The destructive database function (purge_business_data) has not been applied. Nothing was snapshotted and nothing was deleted. It is held back until the service-role key is rotated.',
      false,
    );
  }
  if (exists === null) {
    return refuse(
      'rpc_state_unknown',
      'Could not confirm the destructive database function is in the expected state. Refusing rather than assuming.',
      false,
    );
  }

  // ── 2. The agents option is refused permanently (OQ-1 = (c)) ────────────
  // Decided by the user 2026-10-05: a purge never deletes agents. Refused on
  // its own terms (SA C-4), NOT because the live graph happens to refuse it
  // today: if the agent-platform cascade children were ever classified into
  // the run, the graph check would pass, and this must still refuse.
  if (options.agents) {
    return refuse(
      'agents_option_refused',
      'Deleting agents is not offered: a purge never deletes agents. Untick that option and run again. Nothing was snapshotted and nothing was deleted.',
      false,
    );
  }

  // ── 3. Delete-graph check, fail closed (SA C-5, T7's FK half) ───────────
  const graph = await runDeleteGraphCheck({ level, options, correlationId });
  if (graph.status === 'unreadable') {
    return refuse(
      'delete_graph_unreadable',
      'The live database structure could not be read, so it is not known what this run would remove by cascade. Refusing rather than assuming. Nothing was snapshotted and nothing was deleted.',
      false,
      isDevelopment() ? graph : graphSummary(graph),
      graph,
    );
  }
  if (graph.status !== 'ok') {
    return refuse(
      'delete_graph_refused',
      'The live database structure would make this run remove or block rows outside what it lists (a cascade, a delete order or an unreviewed trigger). Nothing was snapshotted and nothing was deleted.',
      false,
      // C-4: child-table names only under the development guard.
      isDevelopment() ? graph : graphSummary(graph),
      graph,
    );
  }

  // ── 4. The two pre-delete controls ──────────────────────────────────────
  // AC-33 (ordering half): control 1 reads the integration connections for
  // Stripe account ids HERE, before phase 2 deletes them (`integrations`).
  const guard = await evaluateResetGuard({ userId, correlationId });
  if (guard.outcome === 'refused') {
    return refuse(guard.control, guard.message, false, guard.detail, guard.auditDetail);
  }

  // ── PHASE 1 — verified snapshot ─────────────────────────────────────────
  const snapshot = await writeVerifiedSnapshot({
    userId,
    level,
    options,
    correlationId,
    context: { surface: 'internal', actorEmail },
  });

  if (!snapshot.ok || !snapshot.verified || !snapshot.path) {
    // AC-35: no verified snapshot, no delete. `snapshotWritten` reports whether
    // an object may nonetheless exist — a write can succeed and read-back fail.
    log.warn({ userId, level, error: snapshot.error }, 'Pre-purge snapshot could not be verified');
    return refuse(
      'snapshot_failed',
      withDevDetail(`The pre-${level} snapshot could not be verified. Nothing was deleted.`, snapshot.error),
      Boolean(snapshot.path),
      undefined,
      { error: snapshot.error ?? null },
    );
  }

  // ── PHASE 2 — the commit ────────────────────────────────────────────────
  const descriptors = descriptorsForRun(level, options);
  const tables = descriptors.map((d) =>
    d.scope.kind === 'via'
      ? { table: d.table, scope: 'via' as const, parent: d.scope.parent, fk: d.scope.fk }
      : { table: d.table, scope: 'user_id' as const },
  );

  const { result, error } = await businessPurgeRepository.executePurge({
    userId,
    level,
    options,
    tables,
  });

  if (!result) {
    return refuse(
      'commit_failed',
      withDevDetail(
        `The ${level} transaction failed and was rolled back — nothing was deleted. A verified snapshot was written first and remains at ${snapshot.path}.`,
        error,
      ),
      true,
      { snapshotPath: snapshot.path },
      { snapshotPath: snapshot.path, error: error ?? null },
    );
  }

  if (!result.ok) {
    return refuse(
      'already_running',
      `Another ${level} for this business is already running. Nothing was deleted by this attempt.`,
      true,
      { snapshotPath: snapshot.path },
    );
  }

  // ── PHASE 3 — storage (after commit; never fails the run) ───────────────
  // A bucket is emptied when its level is in the run: `reset` buckets always,
  // `purge` buckets only for Purge, `never` buckets never.
  const storage: Array<{ bucket: string; deleted: number; failed: Array<{ path: string; reason: string }> }> = [];
  for (const bucket of STORAGE_DESCRIPTORS.filter(
    (s) => s.level === 'reset' || (s.level === 'purge' && level === 'purge'),
  )) {
    storage.push(await businessPurgeRepository.removeStorageUnderUser(bucket.bucket, userId));
  }

  const residue = storage.flatMap((s) =>
    s.failed.map((f) => `${s.bucket}: ${f.path} — ${f.reason}`),
  );

  // ── Counts (SA OQ-4): the snapshot is the truth, the RPC a diagnostic ───
  const byTable = snapshot.tableCounts ?? result.counts;
  const total = snapshot.tableCounts
    ? Object.values(byTable).reduce((sum, n) => sum + n, 0)
    : result.total_rows;
  const exempt = new Set(CASCADE_COUNT_EXEMPT);
  const countMismatches = Object.keys(byTable)
    .filter((t) => !exempt.has(t) && (result.counts[t] ?? 0) !== byTable[t])
    .map((t) => ({ table: t, snapshot: byTable[t], rpc: result.counts[t] ?? 0 }));
  if (countMismatches.length > 0) {
    // Expected only when rows changed between the snapshot and the commit, or
    // a cascade reached a table the bands should have ordered first.
    log.warn({ userId, level, countMismatches }, 'Snapshot and RPC row counts differ outside the exempt list');
  }

  const durationMs = Date.now() - startedAt;
  const notes = commitResultNotes(level, options);

  log.info(
    {
      userId,
      level,
      options,
      rows: total,
      rpcRows: result.total_rows,
      tables: result.table_count,
      residue: residue.length,
      durationMs,
    },
    `${label} completed`,
  );

  // ── Audit ───────────────────────────────────────────────────────────────
  // The OUTCOME, not just the intent. Written AFTER the commit, so with
  // `activityHistory` on, the record of this run survives its own delete
  // (requirement §10.3).
  auditTrail
    .log({
      action: AUDIT_EVENTS.BUSINESS_DATA_PURGED,
      entityType: 'user',
      entityId: userId,
      userId,
      actorId: userId,
      resourceName: actorEmail ?? userId,
      severity: 'critical',
      details: {
        level,
        options,
        surface: 'internal',
        correlationId,
        snapshotPath: snapshot.path,
        rowsDeleted: total,
        rowsByTable: byTable,
        rpcRowsDeleted: result.total_rows,
        rpcRowsByTable: result.counts,
        storage: storage.map((s) => ({ bucket: s.bucket, deleted: s.deleted, failed: s.failed.length })),
        residue,
        committedAt: result.committed_at,
        durationMs,
      },
    })
    .catch((err) => log.error({ err }, `Audit of completed ${level} failed (non-blocking)`));

  return {
    status: 'completed',
    correlationId,
    level,
    options,
    snapshotPath: snapshot.path,
    rows: { total, byTable },
    rpcRows: { total: result.total_rows, byTable: result.counts },
    storage,
    residue,
    notes,
    committedAt: result.committed_at,
    durationMs,
  };
}
