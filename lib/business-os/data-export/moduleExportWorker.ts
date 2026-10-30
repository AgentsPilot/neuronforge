// lib/business-os/data-export/moduleExportWorker.ts
//
// Module export MX-3b (BUSINESS_OS_EXPORT_MX3_WORKPLAN.md §4, §5, D-1…D-21;
// SA Workplan Review 2026-10-28 C-1, C-3, C-4, C-5; requirement §3, §4.3,
// XC-8, XC-9, XC-13): the data export worker. One run of the 5-minute cron
// `/api/cron/data-export-modules`, its ONLY caller (SA C-5, pinned by the
// route suite).
//
// The run (durable-queue-drain step 5):
//
//   1. Reap first. Stale jobs of killed runs end (sent / interrupted / failed)
//      or go back to waiting; every job the reaper ENDED is audited.
//   2. Claim one job at a time (D-2), and only while the run is under
//      BUILD_CLAIM_CUTOFF_SECONDS (SA C-1 option a: no claim of ANY kind after
//      the cutoff, because a claim always spends an attempt of a waiting job).
//   3. A `working` job is built and sent: module switch (D-7), owner facts
//      (D-6, cached by user AND request, SA C-4), the module's own sections,
//      then its lookup sections (D-15), the MX-2 builder with the MX-2b labels,
//      the part cut (D-4, D-5), `parts_total` fixed, then each part marked
//      `sending`, sent with its key, and marked `accepted` (XC-9).
//   4. A failed or interrupted job with its notice due gets its one notice,
//      keyed `export-notice:{job}` (D-13).
//
// Every write after a claim is a compare-and-set on the claimed row's id,
// user_id and this run's runner id (tenant-isolation-guard step 6). Every read
// and every effect is keyed on the claimed row's user_id; no value comes from
// a request (the route takes no input).
//
// All I/O is injected (`ModuleExportWorkerDeps`), so the run is unit-tested
// with a fake clock, a fake sleep and an in-memory store. The production
// wiring is moduleExportWorkerDeps.ts. This file names no repository class,
// so the export-storage callers guard does not list it.
//
// It reads no feature flag (R-6, D-19; export MX-3.1 removed the export
// switch). Nothing here imports lib/business-os/entitlements (XC-19).
//
// Logs carry ids, counts, byte totals, durations and codes. Never an address,
// a subject, a file name or a cell value (requirement §12). Every send passes
// `redactRecipientInLogs: true` (SA C-3), so the transport's own lines mask
// the address too.

import { AUDIT_EVENTS, EVENT_METADATA } from '@/lib/audit/events';
import type { AuditLogInput } from '@/lib/audit/types';
import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';
import { EXPORT_COLUMN_LABELS } from '@/lib/business-os/data-export/columnLabels';
import { csvPartTextOf, cutCsvParts } from '@/lib/business-os/data-export/csvParts';
import type { ExportEmailLanguage } from '@/lib/business-os/data-export/exportRequestedEmail';
import {
  isModuleEnabled,
  sectionsOfModule,
  type ExportModuleDefinition,
  type ExportModuleId,
} from '@/lib/business-os/data-export/exportModules';
import { lookupSectionsFor, type JoinedCsv, type JoinedCsvInput, type JoinedCsvRows } from '@/lib/business-os/data-export/joinedCsv';
import { EXPORT_LIMITS } from '@/lib/business-os/data-export/limits';
import { buildModuleNoticeEmail, buildModulePartEmail, partFileName } from '@/lib/business-os/data-export/moduleExportEmails';
import { MODULE_EXPORT_POLICY } from '@/lib/business-os/data-export/moduleExportPolicy';
import {
  BUILD_CLAIM_CUTOFF_SECONDS,
  MODULE_JOB_FAILURE_CODES,
  MODULE_JOB_RETRY_CODES,
  PART_SEND_TIMEOUT_MS,
  PART_SEND_TRIES,
  SEND_DEADLINE_MARGIN_MS,
  SEND_GAP_MS,
  buildNoticeSend,
  buildPartSend,
  classifyKeyedSend,
  ownerFactsKey,
  type ExportSendParams,
} from '@/lib/business-os/data-export/moduleExportSending';
import type { ExportContext, ExportRunResult, SectionRunLogger } from '@/lib/business-os/data-export/sections';
import { isInvalidDomainRecipient, type SendEmailParams, type SendEmailResult } from '@/lib/notifications/emailTransport';

// ── The ports ───────────────────────────────────────────────────────────────

/** `{ data, error }`, the repositories' shape. */
export interface WorkerResult<T> {
  data: T | null;
  error: Error | null;
}

/** One emailed part, all four keys (XC-9; MX-1a QA edge case 1). */
export interface WorkerModulePart {
  n: number;
  state: 'sending' | 'accepted';
  resend_id: string | null;
  at: string;
}

/** The columns of a claimed row the worker reads. The repository's `ModuleJob` satisfies it. */
export interface WorkerJob {
  id: string;
  request_id: string;
  user_id: string;
  module: string;
  status: 'waiting' | 'working' | 'sent' | 'failed' | 'interrupted';
  attempts: number;
  failure_code: string | null;
  notice_state: 'none' | 'due' | 'sent' | 'given_up';
}

/** What the reaper changed. The repository's `ReapedModuleJob` satisfies it. */
export interface WorkerReapedJob {
  id: string;
  userId: string;
  status: WorkerJob['status'];
  failureCode: string | null;
  noticeState: WorkerJob['notice_state'];
  requestId: string;
  module: string;
  rowCount: number | null;
  partsTotal: number | null;
  partsAccepted: number;
}

type WriteOutcome = Promise<WorkerResult<{ updated: boolean }>>;

/** The job store: the module-job repository's claim, reap and compare-and-set writes (§7). */
export interface ModuleExportJobStore {
  reapStale(): Promise<WorkerResult<WorkerReapedJob[]>>;
  claimDue(runnerId: string, batch: number): Promise<WorkerResult<WorkerJob[]>>;
  setPartsTotal(jobId: string, userId: string, runnerId: string, input: { partsTotal: number; rowCount: number }): WriteOutcome;
  markPartSending(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<WorkerModulePart>): WriteOutcome;
  markPartAccepted(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<WorkerModulePart>): WriteOutcome;
  markSent(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<WorkerModulePart>): WriteOutcome;
  releaseForRetry(jobId: string, userId: string, runnerId: string, input: { errorCode: string; nextAttemptAt: string }): WriteOutcome;
  markFailed(jobId: string, userId: string, runnerId: string, input: { failureCode: string; noticeState: 'due' | 'given_up' }): WriteOutcome;
  markInterrupted(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<WorkerModulePart>): WriteOutcome;
  markNoticeSent(jobId: string, userId: string, runnerId: string, resendId: string | null): WriteOutcome;
  releaseNotice(jobId: string, userId: string, runnerId: string): WriteOutcome;
  markNoticeGivenUp(jobId: string, userId: string, runnerId: string): WriteOutcome;
}

/** The structural logger the run writes to (a Pino child satisfies it). */
export interface ModuleExportWorkerLogger extends SectionRunLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export interface ModuleExportWorkerDeps {
  jobs: ModuleExportJobStore;
  /** The request's facts, read with the JOB's user_id: null = not this account's request (SA C-4). */
  findRequest: (requestId: string, userId: string) => Promise<WorkerResult<{ requestedAt: string; origin: string } | null>>;
  /** The login email at send time (D-21). null = the account is gone. */
  findIdentity: (userId: string) => Promise<WorkerResult<{ id: string; email: string | null; createdAt: string | null } | null>>;
  findPreferredLanguage: (userId: string) => Promise<WorkerResult<ExportEmailLanguage>>;
  /** `user_preferences.timezone` through `ownerClock` (CLAUDE.md § Currency & Timezone). */
  ownerClock: (userId: string) => Promise<{ timezone: string; isSet: boolean }>;
  /** The classified section readers, for exactly these section ids, in registry order. */
  readSections: (
    ctx: ExportContext,
    sectionIds: readonly ExportSectionId[],
    log: SectionRunLogger,
    opts: { rowCeiling: number }
  ) => Promise<ExportRunResult>;
  /** The MX-2 builder (injected so a test can prove it is never reached for a module switched off). */
  buildJoinedCsv: (input: JoinedCsvInput) => JoinedCsv;
  /** The module map: `EXPORT_MODULES` in production; tests switch a module off. */
  moduleMap: readonly ExportModuleDefinition[];
  send: (params: SendEmailParams) => Promise<SendEmailResult>;
  senderAddress: () => string | undefined;
  /** Writes the entries with one bounded flush (logAndFlush in production). Never rejects. */
  audit: (entries: AuditLogInput[], reason: string) => Promise<void>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  uuid: () => string;
}

/** What the run record keeps (bosCronJobs.ts): counts only. */
export interface ModuleExportWorkerCounts {
  reaped: number;
  claimed: number;
  modulesSent: number;
  partsSent: number;
  modulesFailed: number;
  modulesInterrupted: number;
  retried: number;
  noticesSent: number;
  noticesFailed: number;
  budgetStops: number;
}

// ── Owner facts (D-6, D-21, SA C-4) ─────────────────────────────────────────

interface OwnerFacts {
  email: string;
  createdAt: string | null;
  language: ExportEmailLanguage;
  timezone: string;
  isTimezoneSet: boolean;
  requestedAt: Date;
  origin: string;
}

/** Definite answers are cached for the run; `unreadable` never is (the next job tries again). */
type OwnerOutcome =
  | { kind: 'ok'; facts: OwnerFacts }
  | { kind: 'mismatch' }
  | { kind: 'no_recipient'; origin: string }
  | { kind: 'unreadable' };

const ROW_CEILING = (): number => EXPORT_LIMITS.ROW_CEILING;
const BUDGET_MS = MODULE_EXPORT_POLICY.WORKER_BUDGET_SECONDS * 1000;
/** The latest moment a part send may still be running: maxDuration minus SEND_DEADLINE_MARGIN_MS (SA MX-3b F-2). */
const SEND_DEADLINE_MS = MODULE_EXPORT_POLICY.WORKER_MAX_DURATION_SECONDS * 1000 - SEND_DEADLINE_MARGIN_MS;
const CLAIM_CUTOFF_MS = BUILD_CLAIM_CUTOFF_SECONDS * 1000;

type SendOutcome = { kind: 'accepted'; resendId: string | null } | { kind: 'failed'; reason: string };

/**
 * What a build has done so far, kept OUTSIDE `runBuild` so the run's catch
 * can end a job that threw by what it really did (SA MX-3b F-1): once a part
 * write was attempted, never a retry.
 */
interface BuildProgress {
  partMarkAttempted: boolean;
  parts: WorkerModulePart[];
  total: number;
  rows: number;
}

/**
 * One run. Never throws for a job: a job that throws is ended (retry before
 * any part, interrupted after) or, if even that fails, left to the reaper.
 */
export async function runModuleExportWorker(deps: ModuleExportWorkerDeps, log: ModuleExportWorkerLogger): Promise<ModuleExportWorkerCounts> {
  const start = deps.now();
  const runnerId = deps.uuid();
  const counts: ModuleExportWorkerCounts = {
    reaped: 0,
    claimed: 0,
    modulesSent: 0,
    partsSent: 0,
    modulesFailed: 0,
    modulesInterrupted: 0,
    retried: 0,
    noticesSent: 0,
    noticesFailed: 0,
    budgetStops: 0,
  };
  const facts = new Map<string, OwnerOutcome>();
  /** Notices that failed in a retryable way: their claims are released when the claim loop is over, never inside it (see below). */
  const noticesToRelease: WorkerJob[] = [];
  const elapsedMs = (): number => deps.now() - start;
  /**
   * SA MX-3b F-2: one part try, after `waitMs` and the pacer's gap, can block
   * for PART_SEND_TIMEOUT_MS. It may start only if it ends before maxDuration
   * minus a margin, so the platform never kills a run mid-send (the run record,
   * the counts, the audit and the notice releases would all be lost).
   */
  const fitsOneTry = (waitMs: number): boolean =>
    elapsedMs() + waitMs + SEND_GAP_MS + PART_SEND_TIMEOUT_MS <= SEND_DEADLINE_MS;
  const iso = (): string => new Date(deps.now()).toISOString();

  // ── The pacer (D-11): every send of the run, parts and notices, ≥ 600 ms apart ──
  let lastSendAt: number | null = null;
  const pace = async (): Promise<void> => {
    if (lastSendAt !== null) {
      const gap = lastSendAt + SEND_GAP_MS - deps.now();
      if (gap > 0) await deps.sleep(gap);
    }
    lastSendAt = deps.now();
  };

  const sendOnce = async (payload: ExportSendParams): Promise<SendEmailResult> => {
    await pace();
    try {
      return await deps.send(payload);
    } catch {
      // The transport never throws by contract; a throw is "outcome unknown", a retry under the same key.
      return { sent: false, provider: 'none' };
    }
  };

  // ── Writes ────────────────────────────────────────────────────────────────

  type Written = 'ok' | 'lost' | 'error';
  const written = async (method: string, job: WorkerJob, write: () => WriteOutcome, opts: { retryOnce?: boolean } = {}): Promise<Written> => {
    let result = await write();
    // K-7 (SA optimisation): one retry of a write that records a DELIVERED part,
    // so one transient DB error does not turn a delivered module into
    // `interrupted`. Safe: the write is a compare-and-set on this claim.
    if (result.error && opts.retryOnce) result = await write();
    if (result.error) {
      log.error({ runnerId, jobId: job.id, method, code: 'write_failed' }, 'Module export job write failed');
      return 'error';
    }
    if (!result.data?.updated) {
      log.error({ runnerId, jobId: job.id, method, code: 'claim_lost' }, 'Module export job claim lost; nothing more is sent for it');
      return 'lost';
    }
    return 'ok';
  };

  // ── Audit (D-18, XC-13) ──────────────────────────────────────────────────

  const auditEntry = (
    action: typeof AUDIT_EVENTS.DATA_EXPORT_MODULE_SENT | typeof AUDIT_EVENTS.DATA_EXPORT_MODULE_FAILED,
    input: {
      userId: string;
      requestId: string;
      jobId: string;
      module: string;
      origin: string | null;
      rows: number | null;
      parts: number | null;
      partsAccepted: number;
      failureCode?: string;
    }
  ): AuditLogInput => {
    const meta = EVENT_METADATA[action];
    const details: Record<string, unknown> = {
      request_id: input.requestId,
      job_id: input.jobId,
      module: input.module,
      origin: input.origin,
      rows: input.rows,
      parts: input.parts ?? 0,
      parts_accepted: input.partsAccepted,
    };
    if (action === AUDIT_EVENTS.DATA_EXPORT_MODULE_FAILED) {
      details.failure_code = input.failureCode ?? null;
      details.interrupted = input.failureCode === MODULE_JOB_FAILURE_CODES.INTERRUPTED;
    }
    return {
      action,
      entityType: 'user',
      entityId: input.userId,
      userId: input.userId,
      resourceName: 'Data export',
      details,
      severity: meta?.severity,
      complianceFlags: meta?.complianceFlags ? [...meta.complianceFlags] : undefined,
    };
  };

  const writeAudit = async (entries: AuditLogInput[], reason: string): Promise<void> => {
    if (entries.length === 0) return;
    try {
      await deps.audit(entries, reason);
    } catch (err) {
      // The port never rejects by contract; an audit must still never stop the run.
      log.error({ err, runnerId, code: 'audit_failed' }, 'Module export audit write failed; the run continues');
    }
  };

  const cachedOrigin = (job: WorkerJob): string | null => {
    const known = facts.get(ownerFactsKey(job.user_id, job.request_id));
    if (known?.kind === 'ok') return known.facts.origin;
    if (known?.kind === 'no_recipient') return known.origin;
    return null;
  };

  // ── Owner facts, once per user + request per run (D-6, SA C-4) ───────────

  const resolveOwner = async (job: WorkerJob): Promise<OwnerOutcome> => {
    const key = ownerFactsKey(job.user_id, job.request_id);
    const cached = facts.get(key);
    if (cached) return cached;

    const request = await deps.findRequest(job.request_id, job.user_id);
    if (request.error) return { kind: 'unreadable' };
    if (!request.data) {
      // SA C-4: the job's user_id does not own its request. No FK prevents it.
      log.error({ runnerId, jobId: job.id, requestId: job.request_id, userId: job.user_id, code: 'request_mismatch' }, 'Module export job does not match its request; nothing is sent');
      const outcome: OwnerOutcome = { kind: 'mismatch' };
      facts.set(key, outcome);
      return outcome;
    }
    const origin = request.data.origin;
    const requestedAt = new Date(request.data.requestedAt);

    const [identity, language, clock] = await Promise.all([
      deps.findIdentity(job.user_id),
      deps.findPreferredLanguage(job.user_id).then(
        (result): ExportEmailLanguage => {
          if (result.error || !result.data) {
            if (result.error) log.warn({ runnerId, userId: job.user_id, code: 'language_unreadable' }, 'Module export: language unreadable, sent in English');
            return 'en';
          }
          return result.data;
        },
        (): ExportEmailLanguage => {
          log.warn({ runnerId, userId: job.user_id, code: 'language_unreadable' }, 'Module export: language unreadable, sent in English');
          return 'en';
        }
      ),
      deps.ownerClock(job.user_id),
    ]);
    if (identity.error) return { kind: 'unreadable' };
    const email = typeof identity.data?.email === 'string' ? identity.data.email.trim() : '';
    if (!identity.data || email === '' || isInvalidDomainRecipient(email)) {
      log.warn({ runnerId, jobId: job.id, userId: job.user_id, code: 'recipient_unavailable' }, 'Module export: the account has no usable login email');
      const outcome: OwnerOutcome = { kind: 'no_recipient', origin };
      facts.set(key, outcome);
      return outcome;
    }
    const outcome: OwnerOutcome = {
      kind: 'ok',
      facts: {
        email,
        createdAt: identity.data.createdAt,
        language,
        timezone: clock.timezone,
        isTimezoneSet: clock.isSet,
        requestedAt,
        origin,
      },
    };
    facts.set(key, outcome);
    return outcome;
  };

  // ── Terminal and retry transitions of a build ────────────────────────────

  const fail = async (
    job: WorkerJob,
    failureCode: string,
    noticeState: 'due' | 'given_up',
    extra: { rows: number | null; parts: number | null } = { rows: null, parts: null }
  ): Promise<void> => {
    const outcome = await written('markFailed', job, () => deps.jobs.markFailed(job.id, job.user_id, runnerId, { failureCode, noticeState }));
    if (outcome !== 'ok') return;
    counts.modulesFailed += 1;
    log.warn({ runnerId, jobId: job.id, module: job.module, code: failureCode, noticeState }, 'Module export job failed');
    await writeAudit(
      [
        auditEntry(AUDIT_EVENTS.DATA_EXPORT_MODULE_FAILED, {
          userId: job.user_id,
          requestId: job.request_id,
          jobId: job.id,
          module: job.module,
          origin: cachedOrigin(job),
          rows: extra.rows,
          parts: extra.parts,
          partsAccepted: 0,
          failureCode,
        }),
      ],
      'module export job failed'
    );
  };

  /** XC-9 / D-8: only while no part reached `sending`. After 3 attempts the job fails for good. */
  const retryOrFail = async (job: WorkerJob, code: string): Promise<void> => {
    if (job.attempts >= MODULE_EXPORT_POLICY.BUILD_MAX_ATTEMPTS) {
      log.warn({ runnerId, jobId: job.id, code, attempts: job.attempts }, 'Module export job out of attempts');
      await fail(job, MODULE_JOB_FAILURE_CODES.ATTEMPTS_EXHAUSTED, 'due');
      return;
    }
    const nextAttemptAt = new Date(deps.now() + MODULE_EXPORT_POLICY.RETRY_BACKOFF_SECONDS * 1000 * job.attempts).toISOString();
    const outcome = await written('releaseForRetry', job, () =>
      deps.jobs.releaseForRetry(job.id, job.user_id, runnerId, { errorCode: code, nextAttemptAt })
    );
    if (outcome !== 'ok') return;
    counts.retried += 1;
    log.warn({ runnerId, jobId: job.id, code, attempts: job.attempts }, 'Module export job released for a retry');
  };

  /** A part reached `sending` and the job cannot finish (D-8): `interrupted`, never sent again. */
  const interrupt = async (job: WorkerJob, parts: WorkerModulePart[], partsTotal: number, rows: number, reason: string): Promise<void> => {
    const outcome = await written('markInterrupted', job, () => deps.jobs.markInterrupted(job.id, job.user_id, runnerId, parts));
    if (outcome !== 'ok') return;
    counts.modulesInterrupted += 1;
    const accepted = parts.filter((part) => part.state === 'accepted').length;
    log.warn({ runnerId, jobId: job.id, module: job.module, code: reason, partsTotal, partsAccepted: accepted }, 'Module export job interrupted');
    await writeAudit(
      [
        auditEntry(AUDIT_EVENTS.DATA_EXPORT_MODULE_FAILED, {
          userId: job.user_id,
          requestId: job.request_id,
          jobId: job.id,
          module: job.module,
          origin: cachedOrigin(job),
          rows,
          parts: partsTotal,
          partsAccepted: accepted,
          failureCode: MODULE_JOB_FAILURE_CODES.INTERRUPTED,
        }),
      ],
      'module export job interrupted'
    );
  };

  // ── One part, with its in-run tries (D-9, D-11, SA Q-3) ──────────────────

  const sendPart = async (job: WorkerJob, n: number, payload: ExportSendParams): Promise<SendOutcome> => {
    for (let attempt = 1; attempt <= PART_SEND_TRIES; attempt += 1) {
      // SA MX-3b F-2: a try may block for the whole PART_SEND_TIMEOUT_MS; start
      // it only if it ends before the platform kill. The first try is gated in
      // the part loop, before the part is marked `sending`.
      if (attempt > 1 && !fitsOneTry(0)) {
        counts.budgetStops += 1;
        return { kind: 'failed', reason: MODULE_JOB_RETRY_CODES.BUDGET_SPENT };
      }
      // The SAME frozen payload on every try: the bytes under the key cannot change (SA Q-3).
      const result = await sendOnce(payload);
      const outcome = classifyKeyedSend(result);
      if (outcome.outcome === 'accepted') return { kind: 'accepted', resendId: outcome.resendId };
      if (outcome.outcome === 'key_conflict') return { kind: 'failed', reason: 'key_conflict' };
      if (outcome.outcome === 'refused') {
        log.warn({ runnerId, jobId: job.id, n, code: outcome.reason }, 'Module export part refused by the mail provider');
        return { kind: 'failed', reason: 'send_refused' };
      }
      log.warn({ runnerId, jobId: job.id, n, attempt, providerStatus: result.providerStatus ?? null, waitSeconds: outcome.waitSeconds }, 'Module export part send not confirmed; same key again');
      if (attempt === PART_SEND_TRIES) return { kind: 'failed', reason: 'tries_spent' };
      const waitMs = Math.max(0, outcome.waitSeconds) * 1000;
      if (elapsedMs() + waitMs >= BUDGET_MS || !fitsOneTry(waitMs)) {
        counts.budgetStops += 1;
        return { kind: 'failed', reason: MODULE_JOB_RETRY_CODES.BUDGET_SPENT };
      }
      if (waitMs > 0) await deps.sleep(waitMs);
    }
    return { kind: 'failed', reason: 'tries_spent' };
  };

  // ── A build (§5 runBuild) ────────────────────────────────────────────────

  const runBuild = async (job: WorkerJob, progress: BuildProgress): Promise<void> => {
    const map = deps.moduleMap;
    // D-7 / SA-P4: the switch is checked before ANY section read and before the builder.
    if (!isModuleEnabled(job.module, map)) {
      const known = map.some((module) => module.id === job.module);
      await fail(job, known ? MODULE_JOB_FAILURE_CODES.MODULE_SWITCHED_OFF : MODULE_JOB_FAILURE_CODES.MODULE_UNKNOWN, 'due');
      return;
    }
    // Safe after isModuleEnabled: only a known id in the map is enabled.
    const moduleId = job.module as ExportModuleId;

    const owner = await resolveOwner(job);
    if (owner.kind === 'unreadable') {
      await retryOrFail(job, MODULE_JOB_RETRY_CODES.OWNER_UNREADABLE);
      return;
    }
    if (owner.kind === 'mismatch') {
      // SA C-4: no send (not even a notice), an error line (above), no retry.
      await fail(job, MODULE_JOB_FAILURE_CODES.REQUEST_MISMATCH, 'given_up');
      return;
    }
    if (owner.kind === 'no_recipient') {
      await fail(job, MODULE_JOB_FAILURE_CODES.RECIPIENT_UNAVAILABLE, 'given_up');
      return;
    }
    const o = owner.facts;
    const ctx: ExportContext = {
      userId: job.user_id,
      // The section readers' context, keyed on the JOB's account (tenant-isolation-guard step 6).
      authUser: { id: job.user_id, email: o.email, created_at: o.createdAt ?? '' },
    };

    const readStart = deps.now();
    const own = await deps.readSections(ctx, sectionsOfModule(moduleId, map), log, { rowCeiling: ROW_CEILING() });
    if (own.overCeiling) {
      await fail(job, MODULE_JOB_FAILURE_CODES.OVER_CEILING, 'due');
      return;
    }
    const failedSections = own.sections.filter((section) => section.status === 'failed').map((section) => section.id);
    if (failedSections.length > 0) {
      log.warn({ runnerId, jobId: job.id, failedSections }, 'Module export: a section of the module could not be read');
      await retryOrFail(job, MODULE_JOB_RETRY_CODES.SECTION_READ_FAILED);
      return;
    }
    const rowsBySection: JoinedCsvRows = {};
    for (const section of own.sections) {
      // Section rows are plain records; the account interfaces lack an index signature only.
      if (section.status === 'ok') rowsBySection[section.id] = section.rows as unknown as readonly Readonly<Record<string, unknown>>[];
    }

    // D-15: lookups only turn ids into labels. A failed or over-ceiling lookup keeps the ids.
    const lookupRowsBySection: JoinedCsvRows = {};
    const lookupIds = lookupSectionsFor(moduleId, map);
    if (lookupIds.length > 0) {
      const lookups = await deps.readSections(ctx, lookupIds, log, { rowCeiling: ROW_CEILING() });
      const usable = lookups.sections.filter((section) => section.status === 'ok');
      if (lookups.overCeiling || usable.length < lookupIds.length) {
        log.warn({ runnerId, jobId: job.id, code: 'lookup_unreadable', lookups: lookupIds.length, usable: usable.length }, 'Module export: a lookup could not be read; its ids are kept');
      }
      for (const section of usable) {
        lookupRowsBySection[section.id] = section.rows as unknown as readonly Readonly<Record<string, unknown>>[];
      }
    }
    const readMs = deps.now() - readStart;

    const buildStart = deps.now();
    const csv = deps.buildJoinedCsv({
      moduleId,
      language: o.language,
      rowsBySection,
      lookupRowsBySection,
      // MX-2b D-3: the one label set, never a constructed one (T-W19).
      labels: EXPORT_COLUMN_LABELS,
      map,
    });
    const rows = csv.lines.length;
    // Fixed once per job (SA Q-3): every part and every re-send say the same.
    const producedAt = new Date(deps.now());

    const cut = cutCsvParts(csv.header, csv.lines);
    const buildMs = deps.now() - buildStart;
    if (cut.tooLarge) {
      log.warn({ runnerId, jobId: job.id, module: job.module, rows, reason: cut.reason, readMs, buildMs }, 'Module export too large to email');
      await fail(job, MODULE_JOB_FAILURE_CODES.TOO_LARGE, 'due', { rows, parts: null });
      return;
    }
    const total = cut.parts.length;

    if (elapsedMs() >= BUDGET_MS) {
      counts.budgetStops += 1;
      await retryOrFail(job, MODULE_JOB_RETRY_CODES.BUDGET_SPENT);
      return;
    }

    // XC-9: parts_total is fixed before the first send, so "email n of X" is always true.
    const totalWritten = await written('setPartsTotal', job, () => deps.jobs.setPartsTotal(job.id, job.user_id, runnerId, { partsTotal: total, rowCount: rows }));
    if (totalWritten === 'lost') return;
    if (totalWritten === 'error') {
      await retryOrFail(job, MODULE_JOB_RETRY_CODES.BUILD_FAILED);
      return;
    }
    log.info({ runnerId, jobId: job.id, module: job.module, rows, partsTotal: total, bytes: cut.parts.map((part) => part.bytes), readMs, buildMs }, 'Module export built');

    let parts: WorkerModulePart[] = [];
    progress.total = total;
    progress.rows = rows;
    for (let index = 0; index < total; index += 1) {
      const n = index + 1;
      // F-2: the first try of this part must also end before the platform kill.
      if (elapsedMs() >= BUDGET_MS || !fitsOneTry(0)) {
        // D-10: before part 1 a retry; after a part reached `sending`, interrupted now (not in 420 s).
        counts.budgetStops += 1;
        if (parts.length === 0) await retryOrFail(job, MODULE_JOB_RETRY_CODES.BUDGET_SPENT);
        else await interrupt(job, parts, total, rows, MODULE_JOB_RETRY_CODES.BUDGET_SPENT);
        return;
      }

      // The part's text and bytes live only for this part (XC-8 memory).
      const csvBytes = Buffer.from(csvPartTextOf(csv.header, csv.lines, cut.parts[index]), 'utf8');
      const clock = { timezone: o.timezone, isTimezoneSet: o.isTimezoneSet };
      const email = buildModulePartEmail({ language: o.language, moduleId, n, total, requestedAt: o.requestedAt, producedAt, ...clock });
      // SA Q-3: the complete payload, built ONCE for this part, re-sent by reference.
      const payload = buildPartSend({
        to: o.email,
        from: deps.senderAddress(),
        email,
        jobId: job.id,
        n,
        fileName: partFileName({ moduleId, producedAt, n, total, ...clock }),
        csvBytes,
      });

      // XC-9: `sending` is written BEFORE the call. From here the job is never retried.
      const sending: WorkerModulePart[] = [...parts, { n, state: 'sending', resend_id: null, at: iso() }];
      // From the moment this write is attempted, the job may hold a part: a
      // throw from here on must never lead to a retry (SA MX-3b F-1).
      progress.partMarkAttempted = true;
      const marked = await written('markPartSending', job, () => deps.jobs.markPartSending(job.id, job.user_id, runnerId, sending));
      if (marked === 'lost') return;
      if (marked === 'error') {
        // Whether the write landed is unknown. Before part 1, a retry: if the
        // part did land, releaseForRetry's `parts = '[]'` guard matches nothing
        // (the row CHECK would not stop it, the patch empties `parts`; SA F-1),
        // and the reaper ends the job interrupted after the lease. After part
        // 1, interrupted with the parts known to be stored.
        if (parts.length === 0) await retryOrFail(job, MODULE_JOB_RETRY_CODES.BUILD_FAILED);
        else await interrupt(job, parts, total, rows, 'write_failed');
        return;
      }
      parts = sending;
      progress.parts = parts;

      const sendStart = deps.now();
      const sent = await sendPart(job, n, payload);
      if (sent.kind === 'failed') {
        await interrupt(job, parts, total, rows, sent.reason);
        return;
      }
      parts = parts.map((part) => (part.n === n ? { n, state: 'accepted', resend_id: sent.resendId, at: iso() } : part));
      progress.parts = parts;
      counts.partsSent += 1;
      log.info({ runnerId, jobId: job.id, n, partsTotal: total, bytes: csvBytes.length, sendMs: deps.now() - sendStart }, 'Module export part accepted');

      const last = n === total;
      const snapshot = parts;
      const recorded = await written(
        last ? 'markSent' : 'markPartAccepted',
        job,
        () =>
          last
            ? deps.jobs.markSent(job.id, job.user_id, runnerId, snapshot)
            : deps.jobs.markPartAccepted(job.id, job.user_id, runnerId, snapshot),
        { retryOnce: true }
      );
      // K-7: the part arrived but could not be recorded. Stop; the reaper ends
      // the job interrupted and the owner gets one interrupted email.
      if (recorded !== 'ok') return;
    }

    counts.modulesSent += 1;
    log.info({ runnerId, jobId: job.id, module: job.module, rows, partsTotal: total }, 'Module export job sent');
    await writeAudit(
      [
        auditEntry(AUDIT_EVENTS.DATA_EXPORT_MODULE_SENT, {
          userId: job.user_id,
          requestId: job.request_id,
          jobId: job.id,
          module: job.module,
          origin: o.origin,
          rows,
          parts: total,
          partsAccepted: total,
        }),
      ],
      'module export job sent'
    );
  };

  // ── A notice (D-13) ──────────────────────────────────────────────────────

  const runNotice = async (job: WorkerJob): Promise<void> => {
    const owner = await resolveOwner(job);
    if (owner.kind === 'unreadable') {
      counts.noticesFailed += 1;
      noticesToRelease.push(job);
      return;
    }
    if (owner.kind !== 'ok') {
      // No usable recipient, or (C-4) not this account's request: nothing can be sent, ever.
      counts.noticesFailed += 1;
      await written('markNoticeGivenUp', job, () => deps.jobs.markNoticeGivenUp(job.id, job.user_id, runnerId));
      return;
    }
    const o = owner.facts;
    if (elapsedMs() >= BUDGET_MS) {
      counts.noticesFailed += 1;
      noticesToRelease.push(job);
      return;
    }
    const email = buildModuleNoticeEmail({
      language: o.language,
      moduleId: job.module,
      failureCode: job.failure_code ?? MODULE_JOB_FAILURE_CODES.ATTEMPTS_EXHAUSTED,
      requestedAt: o.requestedAt,
      timezone: o.timezone,
      isTimezoneSet: o.isTimezoneSet,
    });
    const payload = buildNoticeSend({ to: o.email, from: deps.senderAddress(), email, jobId: job.id });
    const outcome = classifyKeyedSend(await sendOnce(payload));

    if (outcome.outcome === 'accepted' || outcome.outcome === 'key_conflict') {
      // D-13: 409 `invalid_idempotent_request` means this key already carried a notice: treated as sent.
      const resendId = outcome.outcome === 'accepted' ? outcome.resendId : null;
      const recorded = await written('markNoticeSent', job, () => deps.jobs.markNoticeSent(job.id, job.user_id, runnerId, resendId));
      if (recorded === 'ok') counts.noticesSent += 1;
      log.info({ runnerId, jobId: job.id, kind: email.kind, code: outcome.outcome }, 'Module export notice sent');
      return;
    }
    counts.noticesFailed += 1;
    if (outcome.outcome === 'refused') {
      log.warn({ runnerId, jobId: job.id, code: outcome.reason }, 'Module export notice refused for good');
      await written('markNoticeGivenUp', job, () => deps.jobs.markNoticeGivenUp(job.id, job.user_id, runnerId));
      return;
    }
    log.warn({ runnerId, jobId: job.id, code: 'notice_retry' }, 'Module export notice not confirmed; retried next run');
    noticesToRelease.push(job);
  };

  // ── 1. The reaper FIRST ──────────────────────────────────────────────────

  const reaped = await deps.jobs.reapStale();
  if (reaped.error || !reaped.data) {
    log.error({ runnerId, code: 'reap_failed' }, 'Module export reap failed; the run continues');
  } else {
    counts.reaped = reaped.data.length;
    // Audit only the jobs the reaper ENDED: sent, or failed / interrupted with
    // the notice now due. A notice given up and a job back to waiting are not
    // a module's outcome.
    const ended = reaped.data.filter((row) => row.status === 'sent' || ((row.status === 'failed' || row.status === 'interrupted') && row.noticeState === 'due'));
    const entries: AuditLogInput[] = [];
    for (const row of ended) {
      const request = await deps.findRequest(row.requestId, row.userId);
      const sentInFull = row.status === 'sent';
      entries.push(
        auditEntry(sentInFull ? AUDIT_EVENTS.DATA_EXPORT_MODULE_SENT : AUDIT_EVENTS.DATA_EXPORT_MODULE_FAILED, {
          userId: row.userId,
          requestId: row.requestId,
          jobId: row.id,
          module: row.module,
          origin: request.data?.origin ?? null,
          rows: row.rowCount,
          parts: row.partsTotal,
          partsAccepted: row.partsAccepted,
          ...(sentInFull ? {} : { failureCode: row.failureCode ?? MODULE_JOB_FAILURE_CODES.ATTEMPTS_EXHAUSTED }),
        })
      );
    }
    await writeAudit(entries, 'module export jobs reaped');
  }

  // ── 2. Claim, one job at a time, only before the cutoff (SA C-1 option a) ──

  while (elapsedMs() < CLAIM_CUTOFF_MS) {
    const claimed = await deps.jobs.claimDue(runnerId, 1);
    if (claimed.error || !claimed.data) {
      log.error({ runnerId, code: 'claim_failed' }, 'Module export claim failed; the run stops claiming');
      break;
    }
    if (claimed.data.length === 0) break;
    const job = claimed.data[0];
    counts.claimed += 1;

    if (job.status === 'working') {
      const progress: BuildProgress = { partMarkAttempted: false, parts: [], total: 0, rows: 0 };
      try {
        await runBuild(job, progress);
      } catch (err) {
        // A throw is a defect. Ended by what the build really did (SA MX-3b
        // F-1, XC-9): before any part write, a retry; once a part write was
        // attempted, NEVER a retry, so a delivered part is never wiped and
        // sent again. With parts known, interrupted now; with none known (the
        // first part's write itself threw), left to the reaper, which ends it
        // interrupted if the part landed.
        log.error({ err, runnerId, jobId: job.id, code: MODULE_JOB_RETRY_CODES.BUILD_FAILED }, 'Module export build threw');
        if (!progress.partMarkAttempted) await retryOrFail(job, MODULE_JOB_RETRY_CODES.BUILD_FAILED);
        else if (progress.parts.length > 0) await interrupt(job, progress.parts, progress.total, progress.rows, MODULE_JOB_RETRY_CODES.BUILD_FAILED);
        else log.error({ runnerId, jobId: job.id, code: 'left_to_reaper' }, 'Module export build threw while marking its first part; left to the reaper');
      }
    } else {
      try {
        await runNotice(job);
      } catch (err) {
        log.error({ err, runnerId, jobId: job.id, code: 'notice_threw' }, 'Module export notice threw');
        noticesToRelease.push(job);
      }
    }
  }

  // ── 3. Notices to retry are released only now ─────────────────────────────
  // A released notice is claimable at once, and every claim counts one of its
  // five notice attempts. Released inside the loop, one failing notice would
  // be re-claimed and burn all five in seconds. Released here, the next run
  // retries it (D-13: "retried next run").
  for (const job of noticesToRelease) {
    await written('releaseNotice', job, () => deps.jobs.releaseNotice(job.id, job.user_id, runnerId));
  }

  log.info({ runnerId, ...counts, durationMs: elapsedMs() }, 'Module export worker run finished');
  return counts;
}
