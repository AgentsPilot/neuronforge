// lib/business-os/data-export/exportSweep.ts
//
// DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §12; requirement §0.4.1 A,
// C; SA DE-8a Q-6, Q-12; SA DE-8b Q-6, Q-7, C-10, C-11, C-12): the daily
// `/api/cron/data-export`. Ships in the SAME PR as the writer (SA DE-8a Q-6).
//
// NOT A QUEUE DRAIN (`durable-queue-drain` does not apply): every step is
// idempotent, every write is a guarded single-row update (`status = 'running'`
// or `'ready'`), and two overlapping runs are harmless. Each step has its own
// time budget, so one slow step cannot starve the next; a step that throws is
// logged and counted (`incompleteSteps`) and the run continues.
//
// 1 Reap (SA DE-8a Q-12): `running` jobs older than the 90 s stale rule ->
//   markFailed(row.id, row.user_id, 'timeout'); only when that took, the
//   object is removed and DATA_EXPORT_FAILED written with `actorId: null` and
//   `details.actor_kind: 'system'` (there is no system actor id; none is
//   invented).
// 2 Expire: ready jobs past `expires_at` -> remove the object FIRST, then
//   markExpired + DATA_EXPORT_EXPIRED (`reason: 'retention'`, SA C-12). A
//   failed remove leaves the row `ready` for tomorrow; the routes already
//   refuse after `expires_at`, so it cannot be downloaded.
// 3 Orphans (SA Q-6, C-10): only objects named exactly `{uuid}/{uuid}/1.zip`
//   are candidates. One is kept only if a job row has the same id AND the
//   same user_id as its folder AND is `running` or `ready`. Otherwise it is
//   removed once older than 10 minutes, by a path rebuilt from the two folder
//   uuids (exportObjectPath), never from the raw listed name. An object with
//   no created_at is kept and counted. Anything else in the bucket is counted
//   as unexpected and logged (counts only), never removed by a guess. This
//   step is also the backstop for exports `expireOtherReady` turned
//   `expired` when the start route's best-effort remove failed: `expired` is
//   not a kept status, so their objects go here.
// 4 Size watch (§0.4.1 C, SA Q-7, C-11): for each include bucket, the uuid
//   owner folders at its root (non-uuid ones skipped and counted), then per
//   owner THE EXPORT'S OWN INVENTORY (fileManifest), so a document orphan
//   never inflates the watch. One `warn` `data_export_accounts_near_ceiling`
//   with counts and user ids only, when any account is at >= 60% or over.
//   Records are not watched (§0.4.1 C).
//
// Every effect is scoped by the row's own user_id or the folder's uuids
// (tenant-isolation-guard Step 6). Counts only: no money, no names.
//
// DE-10a (SA-1, SA-2, W10-6): where the step 1 and step 2 audit rows go.
// An OWNER job's row is written on the owner's account, as in DE-8b. An ADMIN
// job's row is written with `userId: null` and `actorId: null` (the invites
// N-6 precedent): no owner policy and no owner reader can return it, so the
// owner never learns of an export an admin prepared (BQ-SA-2), and writing
// the requesting admin as the user would forge an admin action through the
// D-7 actor fallback. The target is `entityId` and `details.target_user_id`.
// Any kind other than exactly 'owner' (a schema surprise) gets the admin
// placement, so an unknown row fails toward hidden, never toward the owner.

import 'server-only';
import { EXPORT_JOB_POLICY } from '@/lib/business-os/data-export/jobPolicy';
import { filesCeilingUse, isNearCeiling } from '@/lib/business-os/data-export/ceiling';
import type { ExportFileSource, ManifestLogger } from '@/lib/business-os/data-export/fileManifest';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import type { AuditLogInput } from '@/lib/audit/types';
import type { BusinessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import { DATA_EXPORT_JOB_LIMITS } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import type { BusinessOsDataExportStorageRepository } from '@/lib/repositories/BusinessOsDataExportStorageRepository';
import type { DataExportSweepRef, ExportFileBudget } from '@/lib/repositories/types';

export const SWEEP_LIMITS = {
  REAP_MS: 8_000,
  EXPIRE_MS: 10_000,
  ORPHAN_MS: 15_000,
  ORPHAN_CALLS: 500,
  WATCH_MS: 20_000,
  WATCH_CALLS: 600,
  ORPHAN_GRACE_MS: 10 * 60_000,
} as const;

export interface ExportSweepDeps {
  jobs: Pick<BusinessOsDataExportJobRepository, 'listStaleRunning' | 'markFailed' | 'listDueForExpiry' | 'markExpired' | 'findJobsByIds'>;
  storage: Pick<BusinessOsDataExportStorageRepository, 'remove' | 'listForSweep'>;
  files: ExportFileSource;
  now: () => number;
}

export interface SweepLogger extends ManifestLogger {
  info: (context: Record<string, unknown>, message: string) => void;
}

export interface ExportSweepResult {
  staleReaped: number;
  expired: number;
  expireFailed: number;
  orphansRemoved: number;
  orphansKept: number;
  orphansUnexpected: number;
  accountsWatched: number;
  accountsNearCeiling: number;
  accountsOverCeiling: number;
  incompleteSteps: number;
  /** Written by the caller with one bounded flush. */
  auditEntries: AuditLogInput[];
}

const KEPT_STATUSES = new Set(['running', 'ready']);

/**
 * Who the row is written on (DE-10a W10-6). Only an exact 'owner' is an owner
 * job; anything else, a missing value included, is placed as an admin job.
 */
function isOwnerJob(row: DataExportSweepRef): boolean {
  return row.requested_by_kind === 'owner';
}

/** The system row of one swept job, placed by its kind. SA Q-12: no system actor id exists, and none is invented. */
function systemEntry(
  row: DataExportSweepRef,
  action: string,
  reason: 'timeout' | 'retention',
  severity: 'warning' | 'info'
): AuditLogInput {
  const isOwner = isOwnerJob(row);
  const details: Record<string, unknown> = { job_id: row.id, reason, actor_kind: 'system' };
  if (!isOwner) {
    details.target_user_id = row.user_id;
    details.requested_by_kind = 'admin';
  }
  return {
    action,
    entityType: 'user',
    entityId: row.user_id,
    // An admin job's row is on no account (null), never the owner's (SA-2).
    userId: isOwner ? row.user_id : null,
    actorId: null,
    resourceName: 'Data export',
    details,
    severity,
    complianceFlags: ['GDPR'],
  };
}

function systemFailedEntry(row: DataExportSweepRef): AuditLogInput {
  return systemEntry(row, AUDIT_EVENTS.DATA_EXPORT_FAILED, 'timeout', 'warning');
}

function expiredEntry(row: DataExportSweepRef): AuditLogInput {
  return systemEntry(row, AUDIT_EVENTS.DATA_EXPORT_EXPIRED, 'retention', 'info');
}

function budget(nowMs: number, maxMs: number, calls: number): ExportFileBudget {
  return { deadlineAt: nowMs + maxMs, callsLeft: calls };
}

export async function runExportSweep(deps: ExportSweepDeps, log: SweepLogger): Promise<ExportSweepResult> {
  const result: ExportSweepResult = {
    staleReaped: 0,
    expired: 0,
    expireFailed: 0,
    orphansRemoved: 0,
    orphansKept: 0,
    orphansUnexpected: 0,
    accountsWatched: 0,
    accountsNearCeiling: 0,
    accountsOverCeiling: 0,
    incompleteSteps: 0,
    auditEntries: [],
  };

  const step = async (name: string, body: () => Promise<boolean>) => {
    try {
      const complete = await body();
      if (!complete) result.incompleteSteps += 1;
    } catch (err) {
      result.incompleteSteps += 1;
      log.error({ err, step: name }, 'Data export sweep step failed; the run continues');
    }
  };

  // ── 1. Reap stale runs ────────────────────────────────────────────────────
  await step('reap', async () => {
    const deadline = deps.now() + SWEEP_LIMITS.REAP_MS;
    const stale = await deps.jobs.listStaleRunning(new Date(deps.now() - EXPORT_JOB_POLICY.STALE_RUNNING_SECONDS * 1000));
    if (stale.error || !stale.data) return false;
    for (const row of stale.data) {
      if (deps.now() > deadline) return false;
      const failed = await deps.jobs.markFailed(row.id, row.user_id, 'timeout');
      if (failed.error || !failed.data) continue; // already settled elsewhere: nothing to do
      result.staleReaped += 1;
      await deps.storage.remove(row.user_id, row.id);
      result.auditEntries.push(systemFailedEntry(row));
    }
    return stale.data.length < DATA_EXPORT_JOB_LIMITS.DUE_FOR_EXPIRY_MAX;
  });

  // ── 2. Expire after 72 hours ──────────────────────────────────────────────
  await step('expire', async () => {
    const deadline = deps.now() + SWEEP_LIMITS.EXPIRE_MS;
    const due = await deps.jobs.listDueForExpiry(new Date(deps.now()));
    if (due.error || !due.data) return false;
    for (const row of due.data) {
      if (deps.now() > deadline) return false;
      // The file first: a failed remove keeps the row ready, retried tomorrow.
      const removed = await deps.storage.remove(row.user_id, row.id);
      if (removed.error) {
        result.expireFailed += 1;
        continue;
      }
      const marked = await deps.jobs.markExpired(row.id, row.user_id);
      if (marked.error) {
        result.expireFailed += 1;
        continue;
      }
      if (marked.data) {
        result.expired += 1;
        result.auditEntries.push(expiredEntry(row));
      }
    }
    // A full page means a backlog: visible as an incomplete step (SA optimisation).
    return due.data.length < DATA_EXPORT_JOB_LIMITS.DUE_FOR_EXPIRY_MAX;
  });

  // ── 3. Orphan objects ─────────────────────────────────────────────────────
  await step('orphans', async () => {
    const listing = await deps.storage.listForSweep(budget(deps.now(), SWEEP_LIMITS.ORPHAN_MS, SWEEP_LIMITS.ORPHAN_CALLS));
    if (listing.error || !listing.data) return false;
    const { objects, unexpected, truncated } = listing.data;
    result.orphansUnexpected += unexpected;
    if (unexpected > 0) {
      log.warn({ event: 'data_export_bucket_unexpected_objects', unexpected }, 'Data export bucket holds objects outside {uuid}/{uuid}/1.zip; left alone');
    }
    const considered = objects.slice(0, DATA_EXPORT_JOB_LIMITS.IDS_MAX);
    const jobs = await deps.jobs.findJobsByIds(considered.map((object) => object.jobId));
    if (jobs.error || !jobs.data) return false;
    // Postgres prints uuids in lower case, and the listing's folder ids are lower case (the storage repository), so equality is exact.
    const byId = new Map(jobs.data.map((job) => [job.id, job] as const));
    for (const object of considered) {
      const job = byId.get(object.jobId);
      if (job && job.user_id === object.userId && KEPT_STATUSES.has(job.status)) {
        result.orphansKept += 1;
        continue;
      }
      const created = object.createdAt ? Date.parse(object.createdAt) : Number.NaN;
      if (Number.isNaN(created) || deps.now() - created < SWEEP_LIMITS.ORPHAN_GRACE_MS) {
        result.orphansKept += 1;
        continue;
      }
      // The path is rebuilt from the two folder uuids inside remove (exportObjectPath).
      const removed = await deps.storage.remove(object.userId, object.jobId);
      if (removed.error) result.orphansKept += 1;
      else result.orphansRemoved += 1;
    }
    return !truncated && considered.length === objects.length;
  });

  // ── 4. Size watch (the export's own inventory, C-11) ─────────────────────
  await step('watch', async () => {
    const watchBudget = budget(deps.now(), SWEEP_LIMITS.WATCH_MS, SWEEP_LIMITS.WATCH_CALLS);
    const owners = new Set<string>();
    let complete = true;
    let skippedFolders = 0;
    for (const { bucket } of deps.files.includedBuckets()) {
      const folders = await deps.files.listOwnerFolders(bucket, watchBudget);
      if (!folders) return false;
      if (folders.truncated) complete = false;
      skippedFolders += folders.skipped;
      for (const owner of folders.owners) owners.add(owner);
    }
    const near: string[] = [];
    const over: string[] = [];
    for (const owner of [...owners].sort()) {
      const inventory = await deps.files.inventory(owner, watchBudget, log);
      if (!inventory.ok) {
        complete = false;
        if (inventory.reason === 'truncated') break;
        continue;
      }
      result.accountsWatched += 1;
      const use = filesCeilingUse(inventory.inventory.totalBytes, inventory.inventory.files.length);
      if (use.over.length > 0) over.push(owner);
      else if (isNearCeiling(use)) near.push(owner);
    }
    result.accountsNearCeiling = near.length;
    result.accountsOverCeiling = over.length;
    if (near.length > 0 || over.length > 0) {
      log.warn(
        {
          event: 'data_export_accounts_near_ceiling',
          accountsNearCeiling: near.length,
          accountsOverCeiling: over.length,
          nearUserIds: near,
          overUserIds: over,
        },
        'Data export: accounts at or above 60% of the Phase 1 file ceiling'
      );
    }
    if (skippedFolders > 0) log.info({ skippedFolders }, 'Data export size watch: non-owner root folders skipped');
    return complete;
  });

  return result;
}
