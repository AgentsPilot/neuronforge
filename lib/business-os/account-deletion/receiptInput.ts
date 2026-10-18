/**
 * What the app sends the cleanup function as `p_receipt` (data export
 * DE-10b.1; workplan §4, §5; SA W-7).
 *
 * The function inserts the receipt inside its own transaction, last, so a
 * receipt exists if and only if the deletion committed (R-2). It computes the
 * id, status, mode, the placeholder reference, the totals and `completed_at`
 * itself and ignores those keys here; `executor_admin_id` is its `p_actor`.
 * This schema is `.strict()` and has no slot for the subject's email: only its
 * keyed fingerprint (`receiptFingerprint.ts`). `executor_admin_email` is the
 * admin's own address at that moment, taken from the `requireAdmin` session,
 * never from a request body.
 *
 * `DELETION_RECEIPT_RETENTION` is the ONE retention setting (BQ-13,
 * placeholder 7 years until the CPA answers). A Jest pin keeps it at one year
 * or more (R-6), and the table refuses less.
 *
 * @module lib/business-os/account-deletion/receiptInput
 */

import { z } from 'zod';
import { ADMIN_DELETE_REASONS } from './reason';

/** BQ-13 placeholder. The release-3 sweep deletes a receipt only after `retain_until`. */
export const DELETION_RECEIPT_RETENTION = { years: 7 } as const;

/** `now` plus the retention, in UTC calendar years. */
export function computeRetainUntil(now: Date): Date {
  const out = new Date(now.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + DELETION_RECEIPT_RETENTION.years);
  return out;
}

const isoDateTime = z.string().datetime({ offset: true });

const receiptShape = {
  email_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  fingerprint_key_version: z.number().int().min(1).max(32767),
  origin: z.enum(['owner', 'admin']),
  executor_kind: z.enum(['self_service', 'admin']),
  executor_admin_email: z.string().trim().min(3).max(320).nullable(),
  reason_category: z.enum(ADMIN_DELETE_REASONS).nullable(),
  reason_note: z.string().trim().min(5).max(500).nullable(),
  statement_language: z.enum(['en', 'he', 'es']).nullable(),
  statement_text: z.string().max(500).nullable(),
  owner_last_export_ready_at: isoDateTime.nullable(),
  owner_export_downloaded_at: isoDateTime.nullable(),
  admin_export_existed: z.boolean().nullable(),
  requested_at: isoDateTime,
  retain_until: isoDateTime,
  correlation_id: z.string().max(200).nullable(),
};

/** The receipt before the storage step: everything but the file count. */
export const deletionReceiptBaseSchema = z
  .object(receiptShape)
  .strict()
  .superRefine((value, ctx) => {
    // W-7, mirrored by the table CHECK: origin and executor never disagree.
    if ((value.origin === 'owner') !== (value.executor_kind === 'self_service')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'origin and executor_kind disagree' });
    }
    if (value.origin === 'admin' && value.reason_category === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'an admin deletion needs a reason' });
    }
    if (value.reason_category === 'other' && value.reason_note === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'the reason Other needs a note' });
    }
  });

export type DeletionReceiptBase = z.infer<typeof deletionReceiptBaseSchema>;

/** Exactly what `p_receipt` holds: the base plus the files the storage step removed. */
export type DeletionReceiptInput = DeletionReceiptBase & { files_removed: number };

/** The keys `p_receipt` may hold, in one place. The generator test compares them with what the SQL reads. */
export const DELETION_RECEIPT_INPUT_KEYS = [...Object.keys(receiptShape), 'files_removed'] as const;

export interface AdminReceiptFacts {
  emailFingerprint: string;
  fingerprintKeyVersion: number;
  adminEmail: string | null;
  reasonCategory: (typeof ADMIN_DELETE_REASONS)[number];
  reasonNote: string | null;
  ownerLastExportReadyAt: string | null;
  ownerExportDownloadedAt: string | null;
  adminExportExisted: boolean | null;
  requestedAt: Date;
  correlationId: string | null;
}

/**
 * The receipt of an admin deletion (both modes). Throws a ZodError on a value
 * the table would refuse, so the route answers before anything is removed.
 */
export function buildAdminReceipt(facts: AdminReceiptFacts): DeletionReceiptBase {
  return deletionReceiptBaseSchema.parse({
    email_fingerprint: facts.emailFingerprint,
    fingerprint_key_version: facts.fingerprintKeyVersion,
    origin: 'admin',
    executor_kind: 'admin',
    executor_admin_email: facts.adminEmail && facts.adminEmail.trim() !== '' ? facts.adminEmail.trim() : null,
    reason_category: facts.reasonCategory,
    reason_note: facts.reasonNote,
    statement_language: null,
    statement_text: null,
    owner_last_export_ready_at: toIso(facts.ownerLastExportReadyAt),
    owner_export_downloaded_at: toIso(facts.ownerExportDownloadedAt),
    admin_export_existed: facts.adminExportExisted,
    requested_at: facts.requestedAt.toISOString(),
    retain_until: computeRetainUntil(facts.requestedAt).toISOString(),
    correlation_id: facts.correlationId ? facts.correlationId.slice(0, 200) : null,
  });
}

/** The receipt as the function reads it, with the storage step's file count. */
export function withFilesRemoved(base: DeletionReceiptBase, filesRemoved: number): DeletionReceiptInput {
  return { ...base, files_removed: Math.max(0, Math.trunc(filesRemoved)) };
}

/** A database timestamp ("2026-10-10 10:00:00+00" or ISO) as an ISO string, or null. */
function toIso(value: string | null): string | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
