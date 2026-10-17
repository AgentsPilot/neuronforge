// lib/business-os/data-export/adminExportAudit.ts
//
// DE-10a (BUSINESS_OS_DATA_EXPORT_DE10A_WORKPLAN.md §3.2; SA-1, SA-3, W10-4,
// W10-5, W10-9): the ONLY builder of the audit inputs the two admin export
// routes write. Neither route constructs an audit input inline (source pin),
// so the placement below cannot drift between them.
//
// PLACEMENT (SA-1, the "otherwise proven hidden" branch of DE-8b Q-8). Every
// row is ADMIN-OWNED, exactly as the platform's other admin-on-target rows
// (AD-1b BUSINESS_DELETION_PREVIEWED, AD-2a BUSINESS_DELETION_STARTED, the
// test-account cleanup outcome row):
//
//   userId     = the admin's auth id (from the session)
//   actorId    = the admin's auth id, ALWAYS explicit (SA-3: the D-7 actor
//                fallback never applies to an admin action)
//   entityType = 'user', entityId = the target account
//   details    = target_user_id, job_id, surface 'admin', correlationId, ...
//
// The owner reads the audit table only where the row's user id is their own
// (the one owner policy, and every in-app owner reader filters by the session
// id), so a row whose user id is the admin can never reach them (BQ-SA-2).
//
// NEVER in a row (W10-5): the signed URL, its token, the object path, the
// file name, the business name or any email. Inputs carry ids, counts,
// bytes, durations and the admin's typed reason only.
//
// PURE: no I/O, no logger. Imports types and the event names only.

import type { NextRequest } from 'next/server';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import type { AuditLogInput } from '@/lib/audit/types';
import type { DataExportFailureReason, DataExportRequesterKind } from '@/lib/repositories/types';

const RESOURCE = 'Data export';

/** The zip format the export writes (payload.ts `format_version`). */
const FORMAT_VERSION = 2;

export interface AdminExportAuditBase {
  /** The admin's auth user id, from requireAdmin's session (never a body). */
  adminId: string;
  /** The account the export is of: the route path id, lower-cased. */
  targetId: string;
  correlationId: string;
  request?: NextRequest;
}

/** The fields every admin-path row shares (SA-1). */
function placed(
  base: AdminExportAuditBase,
  action: string,
  details: Record<string, unknown>,
  severity: NonNullable<AuditLogInput['severity']>,
  complianceFlags: NonNullable<AuditLogInput['complianceFlags']>
): AuditLogInput {
  const entry: AuditLogInput = {
    action,
    entityType: 'user',
    entityId: base.targetId,
    userId: base.adminId,
    actorId: base.adminId,
    resourceName: RESOURCE,
    // The shared fields last, so no per-event detail can replace the target.
    details: { ...details, target_user_id: base.targetId, surface: 'admin', correlationId: base.correlationId },
    severity,
    complianceFlags,
  };
  if (base.request) entry.request = base.request;
  return entry;
}

/** DATA_EXPORT_REQUESTED: an admin started an export of the target (non-blocking, §0.4.1 B). */
export function adminExportRequestedEntry(base: AdminExportAuditBase, facts: { jobId: string; reason: string }): AuditLogInput {
  return placed(
    base,
    AUDIT_EVENTS.DATA_EXPORT_REQUESTED,
    { job_id: facts.jobId, requested_by_kind: 'admin', reason: facts.reason },
    'info',
    ['GDPR', 'SOC2']
  );
}

export interface AdminExportReadyFacts {
  jobId: string;
  sectionCounts: Partial<Record<string, number>>;
  failedSections: string[];
  bytes: number;
  fileCount: number;
  rowCount: number;
  missingFiles: number;
  ceilingUsePct: number;
  durationMs: number;
}

/** DATA_EXPORT_READY for an admin-prepared export (the owner row's counts, never a name). */
export function adminExportReadyEntry(base: AdminExportAuditBase, facts: AdminExportReadyFacts): AuditLogInput {
  return placed(
    base,
    AUDIT_EVENTS.DATA_EXPORT_READY,
    {
      job_id: facts.jobId,
      requested_by_kind: 'admin',
      section_counts: facts.sectionCounts,
      failed_sections: facts.failedSections,
      bytes: facts.bytes,
      file_count: facts.fileCount,
      row_count: facts.rowCount,
      missing_files: facts.missingFiles,
      ceiling_use_pct: facts.ceilingUsePct,
      duration_ms: facts.durationMs,
      format_version: FORMAT_VERSION,
    },
    'info',
    ['GDPR', 'SOC2']
  );
}

export interface AdminExportFailedFacts {
  jobId: string;
  reason: DataExportFailureReason;
  bytes: number | null;
  fileCount: number | null;
  rowCount: number | null;
  ceilingOver: string[];
  durationMs: number;
}

/** DATA_EXPORT_FAILED for an admin-prepared export. `reason` here is the failure reason, not the admin's. */
export function adminExportFailedEntry(base: AdminExportAuditBase, facts: AdminExportFailedFacts): AuditLogInput {
  return placed(
    base,
    AUDIT_EVENTS.DATA_EXPORT_FAILED,
    {
      job_id: facts.jobId,
      requested_by_kind: 'admin',
      reason: facts.reason,
      bytes: facts.bytes,
      file_count: facts.fileCount,
      row_count: facts.rowCount,
      ceiling_over: facts.ceilingOver,
      duration_ms: facts.durationMs,
    },
    'warning',
    ['GDPR']
  );
}

/**
 * DATA_EXPORT_EXPIRED for an older ADMIN export that the new admin export
 * replaced (SA C-12 'replaced'; with BC-3 an admin run only replaces admin jobs).
 */
export function adminExportReplacedEntry(base: AdminExportAuditBase, facts: { replacedJobId: string; byJobId: string }): AuditLogInput {
  return placed(
    base,
    AUDIT_EVENTS.DATA_EXPORT_EXPIRED,
    { job_id: facts.replacedJobId, replaced_by_job_id: facts.byJobId, requested_by_kind: 'admin', reason: 'replaced' },
    'info',
    ['GDPR']
  );
}

/**
 * DATA_EXPORT_DOWNLOADED_BY_ADMIN: the write-ahead row of an admin download
 * (§0.3.4, W10-3). `critical` is passed explicitly: the Health page's
 * "Critical audit events" tile counts severity critical over every account
 * (W10-9, business call B-2). `requestedByKind` is the downloaded job's own.
 */
export function adminExportDownloadedEntry(
  base: AdminExportAuditBase,
  facts: { jobId: string; requestedByKind: DataExportRequesterKind; reason: string }
): AuditLogInput {
  return placed(
    base,
    AUDIT_EVENTS.DATA_EXPORT_DOWNLOADED_BY_ADMIN,
    { job_id: facts.jobId, part_no: 1, requested_by_kind: facts.requestedByKind, reason: facts.reason },
    'critical',
    ['GDPR', 'SOC2']
  );
}
