// lib/business-os/data-export/moduleExportSending.ts
//
// Module export MX-3a (BUSINESS_OS_EXPORT_MX3_WORKPLAN.md D-3…D-13, §6; SA
// Workplan Review 2026-10-28 Q-3, Q-6, C-3, C-4, C-8): how the MX-3 worker
// sends a module. The numbers it works to, the two idempotency keys, the
// frozen send payloads, and how a keyed send's answer is read.
//
// PURE: no I/O, no logger, no env. The transport is imported for its types
// only. The numbers live here and not in moduleExportPolicy.ts (D-3): that
// file mirrors SQL literals one for one and its migration test pins every key,
// and none of these is in SQL.
//
// The worker that uses all of this is MX-3b. Nothing calls it yet.

import type { EmailAttachment, SendEmailBase, SendEmailResult } from '@/lib/notifications/emailTransport';
import { CODE_SHAPE, MODULE_EXPORT_POLICY } from '@/lib/business-os/data-export/moduleExportPolicy';

/**
 * BQ-42 (user, 2026-10-28): "7 MB per email", read as 7,000,000 bytes of CSV
 * (decimal, SA Q-11): BOM + header + CRLF + every line + CRLF, in UTF-8 bytes.
 * About 9.33 MB once base64-encoded, inside a 10 MB limit however a mail
 * server counts a megabyte.
 */
export const PART_BYTES_MAX = 7_000_000;

/** BQ-28 (user, 2026-10-28): "max 10 emails per module". More → `too_large`. */
export const MAX_PARTS_PER_MODULE = 10;

/** XC-8: sends are sequential and at least this far apart, across a whole run (Resend's 2/s team limit). */
export const SEND_GAP_MS = 600;

/** D-9: tries of one part inside one run, with the same key and the same payload. */
export const PART_SEND_TRIES = 3;

/** C-8: the transport aborts a part send after this (up to about 9.4 MB of base64 upload). */
export const PART_SEND_TIMEOUT_MS = 45_000;

/** C-8: the transport aborts a notice send after this (the MX-1b value). */
export const NOTICE_SEND_TIMEOUT_MS = 10_000;

/**
 * D-10: no new build is started after this many seconds of a run, so a fresh
 * job has at least 180 s of the 270 s budget. Whether a run stops claiming
 * altogether here (SA C-1 option a, preferred) or refunds the attempt of a late
 * claim (option b) is settled in MX-3b; no separate notice cutoff is defined
 * until then.
 */
export const BUILD_CLAIM_CUTOFF_SECONDS = 90;

/** D-11: the wait on a 429 that carries no usable `retry-after`. */
export const RETRY_AFTER_DEFAULT_SECONDS = 1;

/** Every part's attachment type. */
export const PART_CONTENT_TYPE = 'text/csv; charset=utf-8';

/**
 * The `failure_code` values the worker writes on a failed or interrupted job.
 * Distinct codes on purpose: `too_large` and `over_ceiling` stay apart from
 * other failures, so a later rule on what counts toward the daily limit (user
 * 2026-10-28: too-large does not count, for now) can tell them apart with no
 * data lost.
 */
export const MODULE_JOB_FAILURE_CODES = {
  ATTEMPTS_EXHAUSTED: 'attempts_exhausted',
  TOO_LARGE: 'too_large',
  OVER_CEILING: 'over_ceiling',
  MODULE_SWITCHED_OFF: 'module_switched_off',
  MODULE_UNKNOWN: 'module_unknown',
  RECIPIENT_UNAVAILABLE: 'recipient_unavailable',
  /** SA C-4: the job's user_id and its request's owner disagree (no FK prevents it). Never retried. */
  REQUEST_MISMATCH: 'request_mismatch',
  /** The only code of an `interrupted` job (row CHECK). */
  INTERRUPTED: 'interrupted',
} as const;

/** The `last_error_code` values of a job released for a retry (no part reached `sending`). */
export const MODULE_JOB_RETRY_CODES = {
  SECTION_READ_FAILED: 'section_read_failed',
  OWNER_UNREADABLE: 'owner_unreadable',
  BUDGET_SPENT: 'budget_spent',
  SEND_REFUSED_BEFORE_FIRST_PART: 'send_refused',
} as const;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertJobId(jobId: string): void {
  if (!UUID_SHAPE.test(jobId)) throw new RangeError('Module export: a job id must be a uuid');
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE KEYS AND HOW LONG THEY MUST HOLD (SA Q-6)
 *
 * Resend documents a 24 h key window. The design must not depend on more than
 * ONE HOUR, and does not: a part's key is re-sent only inside one run (≤ 300 s,
 * the route's maxDuration), and a notice's key across at most five notice
 * claims (about 25 to 30 minutes with the 5-minute cron). If Resend ever
 * documents a window under one hour, reopen this.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** XC-9: `export:{module_job_id}:{n}`, n from 1. Throws on a malformed id or n (a programming error). */
export function partIdempotencyKey(jobId: string, n: number): string {
  assertJobId(jobId);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS_PER_MODULE) throw new RangeError('Module export: a part number must be 1..10');
  return `export:${jobId}:${n}`;
}

/** MX-1a SA MX1A-5: `export-notice:{module_job_id}`, one notice per job. */
export function noticeIdempotencyKey(jobId: string): string {
  assertJobId(jobId);
  return `export-notice:${jobId}`;
}

/**
 * SA C-4: the owner-facts cache key. By user AND request, so a job whose
 * user_id does not own its request can never be served another account's
 * facts from the cache; the worker's request lookup with the job's own
 * user_id then finds nothing and ends the job `request_mismatch`.
 */
export function ownerFactsKey(userId: string, requestId: string): string {
  return `${userId}:${requestId}`;
}

/**
 * The send payload of an export email. `redactRecipientInLogs` is the literal
 * `true` in the type (SA C-3): the transport's "Email sent" line otherwise logs
 * the owner's address. `idempotencyKey` and `timeoutMs` are required.
 */
export type ExportSendParams = Readonly<
  Omit<SendEmailBase, 'to' | 'attachments' | 'idempotencyKey' | 'timeoutMs' | 'redactRecipientInLogs'> & {
    kind: 'transactional';
    // Mutable tuple types so the payload passes to sendEmail as it is; the
    // arrays are frozen at runtime all the same.
    to: [string];
    attachments?: [EmailAttachment];
    idempotencyKey: string;
    timeoutMs: number;
    redactRecipientInLogs: true;
  }
>;

/** A rendered email: what moduleExportEmails.ts returns. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface SendCommon {
  /** The owner's login email, read at send time (D-21). */
  to: string;
  /** `platformSenderAddress()`, read by the worker (this file reads no env). */
  from: string | undefined;
  email: RenderedEmail;
  jobId: string;
}

function assertRecipient(to: string): void {
  if (typeof to !== 'string' || to.trim() === '' || /[\s,;]/.test(to.trim())) {
    throw new RangeError('Module export: exactly one recipient address is required');
  }
}

/**
 * SA Q-3: the COMPLETE payload of one part, built ONCE. Every in-run re-send
 * passes this same object by reference, never a rebuilt one, so the bytes
 * under the key cannot change between tries (a changed payload under one key
 * is Resend's 409 `invalid_idempotent_request`). Frozen, so a caller cannot
 * edit it between tries either; the attachment's Buffer cannot be frozen and
 * must never be written to.
 */
export function buildPartSend(input: SendCommon & { n: number; fileName: string; csvBytes: Buffer }): ExportSendParams {
  assertRecipient(input.to);
  const attachment: EmailAttachment = Object.freeze({
    filename: input.fileName,
    content: input.csvBytes,
    contentType: PART_CONTENT_TYPE,
  });
  return Object.freeze({
    kind: 'transactional' as const,
    to: Object.freeze([input.to.trim()]) as unknown as [string],
    ...(input.from ? { from: input.from } : {}),
    subject: input.email.subject,
    html: input.email.html,
    text: input.email.text,
    attachments: Object.freeze([attachment]) as unknown as [EmailAttachment],
    idempotencyKey: partIdempotencyKey(input.jobId, input.n),
    timeoutMs: PART_SEND_TIMEOUT_MS,
    redactRecipientInLogs: true as const,
  });
}

/** The payload of a job's one notice, keyed `export-notice:{job}`; same rules as a part. */
export function buildNoticeSend(input: SendCommon): ExportSendParams {
  assertRecipient(input.to);
  return Object.freeze({
    kind: 'transactional' as const,
    to: Object.freeze([input.to.trim()]) as unknown as [string],
    ...(input.from ? { from: input.from } : {}),
    subject: input.email.subject,
    html: input.email.html,
    text: input.email.text,
    idempotencyKey: noticeIdempotencyKey(input.jobId),
    timeoutMs: NOTICE_SEND_TIMEOUT_MS,
    redactRecipientInLogs: true as const,
  });
}

/**
 * What a keyed send's answer means for the worker.
 *
 * - `accepted`: Resend took it. `resendId` may be null when its body could not
 *   be read (the mail went; tracking is lost).
 * - `retry`: outcome unknown or transient (timeout, 5xx, network, 429, 409
 *   `concurrent_idempotent_requests`). Re-send the SAME payload after
 *   `waitSeconds`, inside the budget and the try limit (D-9, D-11).
 * - `key_conflict`: 409 `invalid_idempotent_request`, the key was used with
 *   other bytes. A part ends `interrupted` (SA Q-3); a notice reads it as
 *   already sent (D-13).
 * - `refused`: retrying cannot change it (`.invalid` recipient, a bad key, no
 *   Resend in production, any other 4xx).
 */
export type KeyedSendOutcome =
  | { outcome: 'accepted'; resendId: string | null }
  | { outcome: 'retry'; waitSeconds: number }
  | { outcome: 'key_conflict' }
  | { outcome: 'refused'; reason: string };

const REFUSAL_ERRORS = new Set(['invalid_idempotency_key', 'idempotency_unsupported', 'invalid_timeout_ms']);

export function classifyKeyedSend(result: SendEmailResult): KeyedSendOutcome {
  if (result.sent) {
    // Only a Resend id is a `resend_id`: outside production a keyed send may
    // fall back to SMTP, whose message id must not be stored (MX-3a SA code review #1).
    const id = result.provider === 'resend' ? result.providerMessageId : undefined;
    return { outcome: 'accepted', resendId: typeof id === 'string' && id.length >= 1 && id.length <= 128 ? id : null };
  }
  if (result.blocked) return { outcome: 'refused', reason: result.blocked };
  if (result.error && REFUSAL_ERRORS.has(result.error)) return { outcome: 'refused', reason: result.error };

  const status = result.providerStatus;
  const code = result.providerErrorCode;
  if (code === 'timeout') return { outcome: 'retry', waitSeconds: 0 };
  if (status === 429) return { outcome: 'retry', waitSeconds: result.retryAfterSeconds ?? RETRY_AFTER_DEFAULT_SECONDS };
  if (status === 409 && code === 'invalid_idempotent_request') return { outcome: 'key_conflict' };
  if (status === 409 && code === 'concurrent_idempotent_requests') {
    return { outcome: 'retry', waitSeconds: result.retryAfterSeconds ?? RETRY_AFTER_DEFAULT_SECONDS };
  }
  if (status !== undefined && status >= 500) return { outcome: 'retry', waitSeconds: 0 };
  if (status !== undefined) return { outcome: 'refused', reason: CODE_SHAPE.test(code ?? '') ? (code as string) : `http_${status}` };
  // No status: a network failure on Resend, or (outside production) a failed
  // SMTP / Gmail fallback. Outcome unknown, so it is a retry under the same key.
  return { outcome: 'retry', waitSeconds: 0 };
}

/** The guardrails these numbers must keep, for the MX-3a constants test (T-S1). */
export const MODULE_EXPORT_SENDING_BOUNDS = {
  buildCutoffSeconds: BUILD_CLAIM_CUTOFF_SECONDS,
  budgetSeconds: MODULE_EXPORT_POLICY.WORKER_BUDGET_SECONDS,
  maxDurationSeconds: MODULE_EXPORT_POLICY.WORKER_MAX_DURATION_SECONDS,
  leaseSeconds: MODULE_EXPORT_POLICY.LEASE_SECONDS,
} as const;
