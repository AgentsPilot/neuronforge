// lib/business-os/purge/ResetService.ts
//
// T16 — the slice 2 orchestrator. The whole Reset, in the mandated three-phase
// shape, and in an order where every step that can refuse runs before the
// first step that produces something irreversible.
//
//   PRE      1. RPC-existence probe                (refuse if not applied)
//            2. Reset guard — control 1, control 2 (refuse on either)
//   PHASE 1  3. snapshot, VERIFIED by read-back    (abort on failure, AC-35)
//   PHASE 2  4. purge_business_data RPC            (one transaction)
//   PHASE 3  5. storage removal                    (non-transactional, never fatal)
//            6. structured report
//            7. audit — for refusals as well as successes (FR-20, AC-18)
//
// ── Why the probe runs FIRST, before even the guard ────────────────────────
// A snapshot is the most sensitive object this system writes: a full row-level
// copy of a business's contacts, messages and invoices. Writing one for a run
// that was never going to reach the commit is a real cost with no benefit.
// Until `20260916b` is applied the function does not exist, so every run would
// otherwise snapshot and then fail — producing an artefact per attempt. Asking
// "can this run finish at all?" before anything else is the cheapest way to
// make sure the answer is never discovered halfway.
//
// ── Resume is rejected ─────────────────────────────────────────────────────
// There is no partial state to resume from, by construction: phase 2 is one
// transaction, so it either happened or did not. Phase 3 failures are reported
// as residue, not retried, because retrying needs durable half-state and D7
// refused a grace period.

import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

import { descriptorsForRun, STORAGE_DESCRIPTORS } from './descriptors';
import { evaluateResetGuard } from './ResetGuard';
import { writeVerifiedSnapshot } from './SnapshotWriter';
import { hasCapability } from './capabilities';
import type { PurgeOptions } from './types';
import { businessPurgeRepository } from '@/lib/repositories/BusinessPurgeRepository';

const logger = createLogger({ module: 'PurgeResetService' });
const auditTrail = AuditTrailService.getInstance();

/** Why a Reset did not complete. Stable strings — the UI switches on them. */
export type ResetRefusal =
  | 'rpc_not_applied'
  | 'rpc_state_unknown'
  | 'capability_missing'
  | 'stripe_connected'
  | 'stripe_unreadable'
  | 'local_blocking'
  | 'local_unreadable'
  | 'snapshot_failed'
  | 'already_running'
  | 'commit_failed';

export type ResetOutcome =
  | {
      status: 'completed';
      correlationId: string;
      snapshotPath: string;
      rows: { total: number; byTable: Record<string, number> };
      storage: Array<{ bucket: string; deleted: number; failed: Array<{ path: string; reason: string }> }>;
      /** Non-empty means the rows are gone but some files remain. The run still succeeded. */
      residue: string[];
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

export async function runReset(params: {
  userId: string;
  actorEmail: string | null;
  correlationId: string;
}): Promise<ResetOutcome> {
  const { userId, actorEmail, correlationId } = params;
  const log = logger.child({ correlationId });
  const startedAt = Date.now();

  // Slice 2: Reset level, opt-ins deferred to slice 3.
  const options: PurgeOptions = { integrations: false, agents: false, activityHistory: false };

  const refuse = async (
    reason: ResetRefusal,
    message: string,
    snapshotWritten: boolean,
    detail?: unknown,
  ): Promise<ResetOutcome> => {
    log.warn({ userId, reason, snapshotWritten }, 'Reset refused');

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
          level: 'reset',
          surface: 'internal',
          reason,
          message,
          snapshotWritten,
          correlationId,
          detail: detail ?? null,
        },
      })
      .catch((err) => log.error({ err }, 'Audit of refused reset failed (non-blocking)'));

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

  // ── 2. The two pre-delete controls ──────────────────────────────────────
  const guard = await evaluateResetGuard({ userId, correlationId });
  if (guard.outcome === 'refused') {
    return refuse(guard.control, guard.message, false, guard.detail);
  }

  // ── PHASE 1 — verified snapshot ─────────────────────────────────────────
  const snapshot = await writeVerifiedSnapshot({
    userId,
    level: 'reset',
    options,
    correlationId,
    context: { surface: 'internal', actorEmail },
  });

  if (!snapshot.ok || !snapshot.verified || !snapshot.path) {
    // AC-35: no verified snapshot, no delete. `snapshotWritten` reports whether
    // an object may nonetheless exist — a write can succeed and read-back fail.
    return refuse(
      'snapshot_failed',
      `The pre-reset snapshot could not be verified (${snapshot.error ?? 'unknown'}). Nothing was deleted.`,
      Boolean(snapshot.path),
    );
  }

  // ── PHASE 2 — the commit ────────────────────────────────────────────────
  const descriptors = descriptorsForRun('reset', options);
  const tables = descriptors.map((d) =>
    d.scope.kind === 'via'
      ? { table: d.table, scope: 'via' as const, parent: d.scope.parent, fk: d.scope.fk }
      : { table: d.table, scope: 'user_id' as const },
  );

  const { result, error } = await businessPurgeRepository.executePurge({
    userId,
    level: 'reset',
    options,
    tables,
  });

  if (!result) {
    return refuse(
      'commit_failed',
      `The reset transaction failed and was rolled back — nothing was deleted. A verified snapshot was written first and remains at ${snapshot.path}. (${error ?? 'unknown error'})`,
      true,
      { snapshotPath: snapshot.path },
    );
  }

  if (!result.ok) {
    return refuse(
      'already_running',
      'Another reset for this business is already running. Nothing was deleted by this attempt.',
      true,
      { snapshotPath: snapshot.path },
    );
  }

  // ── PHASE 3 — storage (after commit; never fails the run) ───────────────
  const storage: Array<{ bucket: string; deleted: number; failed: Array<{ path: string; reason: string }> }> = [];
  for (const bucket of STORAGE_DESCRIPTORS.filter((s) => s.level === 'reset')) {
    storage.push(await businessPurgeRepository.removeStorageUnderUser(bucket.bucket, userId));
  }

  const residue = storage.flatMap((s) =>
    s.failed.map((f) => `${s.bucket}: ${f.path} — ${f.reason}`),
  );

  const durationMs = Date.now() - startedAt;

  log.info(
    { userId, rows: result.total_rows, tables: result.table_count, residue: residue.length, durationMs },
    'Reset completed',
  );

  // ── Audit ───────────────────────────────────────────────────────────────
  // The OUTCOME, not just the intent — the retired delete-account route
  // audited intent and never outcome, so its records said nothing about what
  // actually happened.
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
        level: 'reset',
        surface: 'internal',
        correlationId,
        snapshotPath: snapshot.path,
        rowsDeleted: result.total_rows,
        rowsByTable: result.counts,
        storage: storage.map((s) => ({ bucket: s.bucket, deleted: s.deleted, failed: s.failed.length })),
        residue,
        committedAt: result.committed_at,
        durationMs,
      },
    })
    .catch((err) => log.error({ err }, 'Audit of completed reset failed (non-blocking)'));

  return {
    status: 'completed',
    correlationId,
    snapshotPath: snapshot.path,
    rows: { total: result.total_rows, byTable: result.counts },
    storage,
    residue,
    committedAt: result.committed_at,
    durationMs,
  };
}
