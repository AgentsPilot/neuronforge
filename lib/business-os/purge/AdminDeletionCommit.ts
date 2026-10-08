// lib/business-os/purge/AdminDeletionCommit.ts
//
// Admin delete AD-2a (T9): an admin deletes ONE business at the Purge level
// (requirement FR-A4 … FR-A13, AC-A6 … AC-A11; workplan §2.5; SA AC2-1 …
// AC2-14). The composition behind `POST /api/admin/users/[id]/deletion/commit`.
//
// ⚠️ ONCE `purge_business_data` IS APPLIED AND THE OFF SWITCH IS ON, THIS
// DELETES A CUSTOMER'S BUSINESS DATA. Until then it refuses: the off switch
// (`isAdminBusinessDeleteEnabled`, BQ-1, default off) answers first, and the
// orchestrator's probe answers `rpc_not_applied` before anything is copied.
//
// ── Order (workplan §2.5, SA AC2-6) ─────────────────────────────────────────
// The route has already run `requireAdmin`, the path UUID and the strict body.
//   5. the off switch                       → 409 admin_delete_disabled
//   4. the signed token (previewToken.ts)   → 500 token_key_unavailable / 400 / 409
//   6. the target's identity                → 404 / 500
//   7. FRESH admin re-check: the actor is still an admin; R-1 / R-2 (fresh)
//   8. the typed confirmation, vs the server's value, and its kind vs the token
//   9. EVALUATION 1: every refusal (the shared facts) + fingerprint vs token
//  10. `runPurgeCommit` (admin arm): capability → probe → agents → graph →
//      guard → verified snapshot → GATE → RPC → storage
//  10a. the gate: EVALUATION 2 (fresh), then the CONFIRMED write-ahead row
//  11. revoke the target's pending invites (after the commit; residue if it fails)
//  12. the outcome row (confirmed), then the result
// Every refusal is recorded by a `BUSINESS_DATA_PURGE_BLOCKED` row, awaited.
//
// ── Audit placement (SA T-1 option A, BQ-4) ─────────────────────────────────
// Every row is ADMIN-OWNED: `user_id = actor_id = admin`, `entity_type =
// 'user'`, `entity_id = target`. The owner can never read it, and it survives
// the target's erasure. Blocked rows use `logAndFlush` (WC-7, bounded);
// `BUSINESS_DELETION_STARTED` and `BUSINESS_DATA_PURGED` use `writeNow`
// (confirmed, AC2-3 / AC2-4): no confirmed STARTED row, no RPC.
//
// ── Tenant isolation (tenant-isolation-guard) ───────────────────────────────
// The target id comes only from the path. Every engine call, read and the
// invite revoke takes `targetId`; the admin id reaches only the audit rows,
// the snapshot's context and `revoked_by_admin_id`. Pino carries ids, codes
// and counts only: never an email, a business name or the token (C-12).

import type { NextRequest } from 'next/server';

import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { businessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import { claimLeaseCutoff } from '@/lib/business-os/invites/signupCodePolicy';
import { isAdminBusinessDeleteEnabled } from '@/lib/utils/featureFlags';

import { ADMIN_DELETION_GATE_VERSION, ADMIN_DELETION_LEVEL, ADMIN_DELETION_OPTIONS, AGENTS_KEPT_NOTE } from './AdminDeletionPreview';
import { gatherAdminDeletionLaterFacts, readAdminStatus } from './adminDeletionFacts';
import {
  blockingRefusals,
  evaluateAdminDeletionRefusals,
  r7AlreadyRunning,
  type AdminDeletionRefusal,
} from './adminDeletionRefusals';
import { confirmationMatches, resolveConfirmationTarget } from './confirmation';
import {
  PreviewTokenKeyError,
  tokenDigest,
  verifyPreviewToken,
  type PreviewTokenMismatch,
  type PreviewTokenPayload,
} from './previewToken';
import { runPurgeCommit, type PreCommitGate, type ResetOutcome } from './ResetService';
import type { PurgeOptions } from './types';

const logger = createLogger({ module: 'AdminDeletionCommit' });

/** The `revoke_reason` on the deleted business's pending invites (≥ 3 characters, the CHECK). */
export const ADMIN_DELETE_INVITE_REVOKE_REASON = 'Issuer business deleted by an admin';

/** Stable codes: the AD-2b dialog switches on them. */
export type AdminDeletionCommitCode =
  | 'admin_delete_disabled'
  | 'token_key_unavailable'
  | PreviewTokenMismatch
  | 'user_not_found'
  | 'identity_read_failed'
  | 'actor_not_admin'
  | 'refused'
  | 'confirmation_unverified'
  | 'nothing_to_confirm'
  | 'confirmation_kind_changed'
  | 'confirmation_mismatch'
  | 'schema_changed'
  | ResetOutcomeRefusalCode;

type ResetOutcomeRefusalCode = Extract<ResetOutcome, { status: 'refused' }>['reason'];

/** A stale token (re-open the preview) is 409; a token that is wrong for this request is 400. */
const STALE_TOKEN_CODES: ReadonlySet<PreviewTokenMismatch> = new Set(['token_expired', 'token_version', 'token_gate_version']);

export interface AdminDeletionCommitRefusal {
  kind: 'refused';
  httpStatus: 400 | 403 | 404 | 409 | 500;
  code: AdminDeletionCommitCode;
  message: string;
  /** Present when the refusal list was evaluated (evaluation 1 or 2, or R-7 at the RPC). */
  refusals?: AdminDeletionRefusal[];
  /** Was a snapshot written before refusing? Always stated (purge AC-35). */
  snapshotWritten: boolean;
  /** Client-safe detail (e.g. the snapshot path). Never the orchestrator's audit detail. */
  detail?: unknown;
  /** For the confirmation refusals: what to type. */
  expectedKind?: 'business name' | 'account email';
}

export interface AdminDeletionCommitCompleted {
  kind: 'completed';
  result: {
    targetId: string;
    level: typeof ADMIN_DELETION_LEVEL;
    options: PurgeOptions;
    snapshotPath: string;
    rows: { total: number; byTable: Record<string, number> };
    storage: Array<{ bucket: string; deleted: number; failed: number }>;
    /** Rows are gone but these remain (storage files, or the invite revoke). The delete still happened. */
    residue: string[];
    invites: {
      /** Pending invites this business sent, now revoked. `null` when the revoke failed (see residue). */
      revoked: number | null;
      /** Pending invites left alone because a friend was mid-signup (BQ-3). `null` when not counted. */
      skippedMidSignup: number | null;
    };
    /** What a purge keeps, in plain words (FR-A9). */
    kept: string[];
    notes: string[];
    /** False if the outcome row could not be confirmed (AC2-4): the delete happened, its record may be missing. */
    auditRecorded: boolean;
    committedAt: string;
    durationMs: number;
    correlationId: string;
    previewCorrelationId: string;
  };
}

export type AdminDeletionCommitOutcome = AdminDeletionCommitRefusal | AdminDeletionCommitCompleted;

/** The ids-only summary of a refusal list, for logs and audit rows (FR-A7). */
const codesOf = (refusals: readonly AdminDeletionRefusal[]) => refusals.map((r) => `${r.id}:${r.status}`);

export interface AdminDeletionCommitParams {
  admin: { id: string; email: string | null };
  /** The path id, already a lower-cased UUID. */
  targetId: string;
  token: string;
  confirmText: string;
  correlationId: string;
  /** For the audit rows' request context (IP, user agent). */
  request?: NextRequest;
}

/**
 * Build the pre-commit gate: EVALUATION 2, immediately before the RPC (FR-A7,
 * AC-A8), then the CONFIRMED write-ahead row (AC2-3 / AC2-4).
 *
 * Verdict only (SA AC2-2): it reads the shared helpers and writes exactly one
 * thing, the write-ahead audit row via `writeNow`. It holds no repository
 * write, cannot change the target, the tables or the options, and refuses
 * (rather than throws) on anything it cannot verify. A source pin in the test
 * suite holds this function to that.
 */
export function buildPreCommitGate(ctx: {
  admin: { id: string; email: string | null };
  target: { id: string; email: string | null; businessName: string | null };
  token: PreviewTokenPayload;
  evaluation1: readonly string[];
  correlationId: string;
  request?: NextRequest;
  /** Filled in by the gate, read by the composition: evaluation 2's codes. */
  record: { evaluation2: string[] | null };
}): PreCommitGate {
  return async () => {
    const actorIsAdmin = await readAdminStatus(ctx.admin, { fresh: true });
    if (actorIsAdmin !== true) {
      return { ok: false, message: 'Your admin access could not be re-confirmed. Nothing was deleted.', detail: { code: 'actor_not_admin' } };
    }
    const targetIsAdmin = await readAdminStatus({ id: ctx.target.id, email: ctx.target.email }, { fresh: true });
    const { later, schema } = await gatherAdminDeletionLaterFacts({
      targetId: ctx.target.id,
      level: ADMIN_DELETION_LEVEL,
      options: { ...ADMIN_DELETION_OPTIONS },
      correlationId: ctx.correlationId,
    });
    const { refusals } = evaluateAdminDeletionRefusals({
      adminId: ctx.admin.id,
      targetId: ctx.target.id,
      targetIsAdmin,
      later,
    });
    ctx.record.evaluation2 = codesOf(refusals);
    const blocking = blockingRefusals(refusals);
    if (blocking.length > 0) {
      return {
        ok: false,
        message: `Something changed since the check a moment ago: ${blocking[0].message} Nothing was deleted.`,
        detail: { code: 'refused', refusals: ctx.record.evaluation2 },
      };
    }
    // Never reuse the step-9 fingerprint (SA note on R-5): recomputed here.
    if (!schema.fingerprint || schema.fingerprint !== ctx.token.schemaFingerprint) {
      return {
        ok: false,
        message: 'The database structure changed since the preview. Nothing was deleted.',
        detail: { code: 'schema_changed' },
      };
    }

    const { written } = await AuditTrailService.getInstance().writeNow({
      action: AUDIT_EVENTS.BUSINESS_DELETION_STARTED,
      entityType: 'user',
      entityId: ctx.target.id,
      userId: ctx.admin.id,
      actorId: ctx.admin.id,
      resourceName: ctx.target.businessName ?? ctx.target.id,
      severity: 'critical',
      details: {
        surface: 'admin',
        targetId: ctx.target.id,
        businessName: ctx.target.businessName,
        level: ADMIN_DELETION_LEVEL,
        options: { ...ADMIN_DELETION_OPTIONS },
        evaluation1: [...ctx.evaluation1],
        evaluation2: ctx.record.evaluation2,
        schemaFingerprint: schema.fingerprint,
        correlationId: ctx.correlationId,
        previewCorrelationId: ctx.token.correlationId,
        startedAt: new Date().toISOString(),
      },
      request: ctx.request,
    });
    if (!written) {
      return {
        ok: false,
        reason: 'audit_unavailable',
        message: 'The deletion could not be recorded before starting, so it was not started. Nothing was deleted.',
      };
    }
    return { ok: true };
  };
}

/**
 * Run an admin's commit of one business deletion. Never throws for a refusal;
 * an unexpected throw reaches the route's 500.
 */
export async function commitAdminDeletion(params: AdminDeletionCommitParams): Promise<AdminDeletionCommitOutcome> {
  const { admin, targetId, token, confirmText, correlationId, request } = params;
  const log = logger.child({ correlationId, adminId: admin.id, targetId });
  const startedAt = Date.now();

  // Facts the blocked row carries, filled in as the steps run.
  let businessName: string | null = null;
  let previewCorrelationId: string | null = null;
  let evaluation1: string[] | null = null;
  const gateRecord: { evaluation2: string[] | null } = { evaluation2: null };

  const refuse = async (r: Omit<AdminDeletionCommitRefusal, 'kind'> & { auditDetail?: unknown }): Promise<AdminDeletionCommitRefusal> => {
    // Ids, codes and counts only.
    log.warn(
      {
        code: r.code,
        httpStatus: r.httpStatus,
        snapshotWritten: r.snapshotWritten,
        evaluation1,
        evaluation2: gateRecord.evaluation2,
        tokenDigest: tokenDigest(token),
      },
      'Admin deletion refused'
    );
    // Awaited and bounded (WC-7). logAndFlush never rejects; the catch keeps that true.
    await logAndFlush(
      {
        action: AUDIT_EVENTS.BUSINESS_DATA_PURGE_BLOCKED,
        entityType: 'user',
        entityId: targetId,
        userId: admin.id,
        actorId: admin.id,
        resourceName: businessName ?? targetId,
        severity: 'warning',
        details: {
          surface: 'admin',
          targetId,
          businessName,
          level: ADMIN_DELETION_LEVEL,
          options: { ...ADMIN_DELETION_OPTIONS },
          reason: r.code,
          message: r.message,
          snapshotWritten: r.snapshotWritten,
          refusals: r.refusals ? codesOf(r.refusals) : null,
          evaluation1,
          evaluation2: gateRecord.evaluation2,
          correlationId,
          previewCorrelationId,
          detail: r.auditDetail ?? r.detail ?? null,
        },
        request,
      },
      log,
      { reason: 'refused admin deletion', continues: 'the refusal is unaffected' }
    ).catch((err) => log.error({ err }, 'Audit failed (non-blocking)'));
    const { auditDetail: _omit, ...publicPart } = r;
    void _omit;
    return { kind: 'refused', ...publicPart };
  };

  // 5. The off switch, before any crypto (SA AC2-6).
  if (!isAdminBusinessDeleteEnabled()) {
    return refuse({
      httpStatus: 409,
      code: 'admin_delete_disabled',
      message: 'Admin delete is switched off on this server. Nothing was read or deleted.',
      snapshotWritten: false,
    });
  }

  // 4. The signed token.
  let payload: PreviewTokenPayload;
  try {
    const verified = verifyPreviewToken(token, {
      surface: 'admin',
      actorId: admin.id,
      targetId,
      level: ADMIN_DELETION_LEVEL,
      options: { ...ADMIN_DELETION_OPTIONS },
      gateVersion: ADMIN_DELETION_GATE_VERSION,
    });
    if (!verified.ok) {
      return refuse({
        httpStatus: STALE_TOKEN_CODES.has(verified.code) ? 409 : 400,
        code: verified.code,
        message: STALE_TOKEN_CODES.has(verified.code)
          ? 'This confirmation has expired. Open the deletion preview again.'
          : 'This confirmation is not valid for this business, this admin or these settings. Open the deletion preview again.',
        snapshotWritten: false,
      });
    }
    payload = verified.payload;
    previewCorrelationId = payload.correlationId;
  } catch (err) {
    if (!(err instanceof PreviewTokenKeyError)) throw err;
    // C-7: a 500, never "no token needed".
    log.error({ code: 'token_key_unavailable' }, 'Admin deletion: the token key is unavailable');
    return refuse({
      httpStatus: 500,
      code: 'token_key_unavailable',
      message: 'The server cannot verify the confirmation. Nothing was deleted.',
      snapshotWritten: false,
    });
  }

  // 6. The target's identity, re-read.
  const identity = await authAccountRepository.findUserIdentity(targetId);
  if (identity.error) {
    return refuse({ httpStatus: 500, code: 'identity_read_failed', message: 'The account could not be read. Nothing was deleted.', snapshotWritten: false });
  }
  if (!identity.data) {
    return refuse({ httpStatus: 404, code: 'user_not_found', message: 'No account has this id.', snapshotWritten: false });
  }
  const targetEmail = identity.data.email;

  // 7. Fresh admin re-check (AC2-7): no cache, no stale fallback; null refuses.
  const actorIsAdmin = await readAdminStatus(admin, { fresh: true });
  if (actorIsAdmin !== true) {
    return refuse({ httpStatus: 403, code: 'actor_not_admin', message: 'Your admin access could not be re-confirmed.', snapshotWritten: false });
  }
  const targetIsAdmin = await readAdminStatus({ id: targetId, email: targetEmail }, { fresh: true });
  const identityOnly = evaluateAdminDeletionRefusals({ adminId: admin.id, targetId, targetIsAdmin });
  if (identityOnly.identityRefused) {
    evaluation1 = codesOf(identityOnly.refusals);
    return refuse({
      httpStatus: 409,
      code: 'refused',
      message: blockingRefusals(identityOnly.refusals)[0].message,
      refusals: identityOnly.refusals,
      snapshotWritten: false,
    });
  }

  // 8. The typed confirmation, against the server's value (FR-A6, AC2-8).
  const confirmation = await resolveConfirmationTarget(targetId, targetEmail);
  if (confirmation.status === 'unverified') {
    return refuse({
      httpStatus: 500,
      code: 'confirmation_unverified',
      message: 'Could not read what to confirm against. Nothing was deleted.',
      snapshotWritten: false,
    });
  }
  if (confirmation.status === 'none') {
    return refuse({ httpStatus: 409, code: 'nothing_to_confirm', message: 'There is nothing to confirm against. Refusing.', snapshotWritten: false });
  }
  if (confirmation.kind === 'business name') businessName = confirmation.value;
  if (confirmation.kind !== payload.confirmKind) {
    return refuse({
      httpStatus: 409,
      code: 'confirmation_kind_changed',
      message: 'What to type has changed since the preview. Open the deletion preview again.',
      snapshotWritten: false,
      expectedKind: confirmation.kind,
    });
  }
  if (!confirmationMatches(confirmText, confirmation.value)) {
    return refuse({
      httpStatus: 400,
      code: 'confirmation_mismatch',
      message: `Confirmation did not match. Type the ${confirmation.kind} exactly.`,
      snapshotWritten: false,
      expectedKind: confirmation.kind,
    });
  }

  // 9. EVALUATION 1: every refusal, with the shared facts, and the fingerprint.
  const first = await gatherAdminDeletionLaterFacts({
    targetId,
    level: ADMIN_DELETION_LEVEL,
    options: { ...ADMIN_DELETION_OPTIONS },
    correlationId,
  });
  const eval1 = evaluateAdminDeletionRefusals({ adminId: admin.id, targetId, targetIsAdmin, later: first.later });
  evaluation1 = codesOf(eval1.refusals);
  log.info({ evaluation: 1, refusals: evaluation1 }, 'Admin deletion: evaluation 1');
  const blocking1 = blockingRefusals(eval1.refusals);
  if (blocking1.length > 0) {
    return refuse({ httpStatus: 409, code: 'refused', message: blocking1[0].message, refusals: eval1.refusals, snapshotWritten: false });
  }
  if (!first.schema.fingerprint || first.schema.fingerprint !== payload.schemaFingerprint) {
    return refuse({
      httpStatus: 409,
      code: 'schema_changed',
      message: 'The database structure changed since the preview. Open the deletion preview again.',
      snapshotWritten: false,
    });
  }

  // 10. The one orchestrator, admin arm: the target is userId, the admin is the actor.
  const gate = buildPreCommitGate({
    admin,
    target: { id: targetId, email: targetEmail, businessName },
    token: payload,
    evaluation1,
    correlationId,
    request,
    record: gateRecord,
  });
  const outcome = await runPurgeCommit({
    surface: 'admin',
    userId: targetId,
    actor: { id: admin.id },
    correlationId,
    level: ADMIN_DELETION_LEVEL,
    options: { ...ADMIN_DELETION_OPTIONS },
    preCommitGate: gate,
  });
  if (gateRecord.evaluation2) {
    log.info({ evaluation: 2, refusals: gateRecord.evaluation2 }, 'Admin deletion: evaluation 2');
  }

  if (outcome.status === 'refused') {
    // AC-A11: the RPC's lock is R-7, for real.
    const refusals = outcome.reason === 'already_running' ? [...eval1.refusals.filter((r) => r.id !== 'R-7'), r7AlreadyRunning()] : undefined;
    return refuse({
      httpStatus: outcome.reason === 'capability_missing' ? 500 : 409,
      code: outcome.reason,
      message: outcome.message,
      refusals: refusals?.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      snapshotWritten: outcome.snapshotWritten,
      detail: outcome.detail,
      auditDetail: outcome.auditDetail,
    });
  }

  // 11. The deleted business's pending invites (T-3: after the commit; non-fatal).
  const residue = [...outcome.residue];
  const now = new Date();
  const revoked = await businessOsInviteRepository.revokePendingForIssuerAccountByAdmin({
    issuerAccountId: targetId,
    adminId: admin.id,
    reason: ADMIN_DELETE_INVITE_REVOKE_REASON,
    now,
    claimLeaseCutoff: claimLeaseCutoff(now),
  });
  if (revoked.error || revoked.data === null) {
    residue.push('Invites: the pending invites this business sent could not be revoked. Revoke them from the invites page.');
  }
  const revokeFailed = Boolean(revoked.error) || revoked.data === null;
  // After a failed revoke every pending invite is still pending, so the count
  // would not mean "mid-signup" — report it as unknown instead.
  const skipped = revokeFailed
    ? null
    : await businessOsInviteRepository.countPendingForIssuerAccountByAdmin(targetId);
  const invites = {
    revoked: revokeFailed ? null : revoked.data,
    skippedMidSignup: skipped === null || skipped.error ? null : skipped.data,
  };

  const durationMs = Date.now() - startedAt;
  const storage = outcome.storage.map((s) => ({ bucket: s.bucket, deleted: s.deleted, failed: s.failed.length }));

  // 12. The outcome row, CONFIRMED (AC2-4). It cannot undo the delete, so a
  // failure is reported, never hidden behind a clean success.
  const { written: auditRecorded } = await AuditTrailService.getInstance().writeNow({
    action: AUDIT_EVENTS.BUSINESS_DATA_PURGED,
    entityType: 'user',
    entityId: targetId,
    userId: admin.id,
    actorId: admin.id,
    resourceName: businessName ?? targetId,
    severity: 'critical',
    details: {
      surface: 'admin',
      targetId,
      businessName,
      level: outcome.level,
      options: outcome.options,
      correlationId,
      previewCorrelationId,
      evaluation1,
      evaluation2: gateRecord.evaluation2,
      snapshotPath: outcome.snapshotPath,
      rowsDeleted: outcome.rows.total,
      rowsByTable: outcome.rows.byTable,
      rpcRowsDeleted: outcome.rpcRows.total,
      rpcRowsByTable: outcome.rpcRows.byTable,
      storage,
      residue,
      invites,
      committedAt: outcome.committedAt,
      durationMs,
    },
    request,
  });
  if (!auditRecorded) {
    log.error({ snapshotPath: outcome.snapshotPath }, 'Admin deletion COMPLETED but its outcome audit row could not be confirmed');
  }

  log.info(
    {
      rows: outcome.rows.total,
      residue: residue.length,
      invitesRevoked: invites.revoked,
      invitesSkipped: invites.skippedMidSignup,
      auditRecorded,
      durationMs,
    },
    'Admin deletion completed'
  );

  return {
    kind: 'completed',
    result: {
      targetId,
      level: ADMIN_DELETION_LEVEL,
      options: outcome.options,
      snapshotPath: outcome.snapshotPath,
      rows: outcome.rows,
      storage,
      residue,
      invites,
      kept: [
        AGENTS_KEPT_NOTE,
        'The login is kept (closing it is a later step), along with the plan, billing and credit records.',
        'Friends who already joined through this business’s invites keep their own accounts.',
      ],
      notes: outcome.notes,
      auditRecorded,
      committedAt: outcome.committedAt,
      durationMs,
      correlationId,
      previewCorrelationId: payload.correlationId,
    },
  };
}
