/**
 * The data export worker (module export MX-3b, BUSINESS_OS_EXPORT_MX3_WORKPLAN.md
 * §13.4 T-W1…T-W24; SA Workplan Review 2026-10-28 C-1, C-3, C-4, Q-3).
 *
 * A fake clock, a fake sleep and an in-memory job store that behaves like the
 * claim and reap functions of migration 20261095 and refuses any write the
 * row CHECKs of that migration would refuse. No database, no network: the
 * one test that uses the real transport (T-W23) mocks `fetch`.
 */

const logged: Array<{ source: string; level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (bindings: Record<string, unknown>): Record<string, unknown> => {
    const source = String(bindings.module ?? bindings.service ?? 'unknown');
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push({ source, level, args });
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: (bindings: Record<string, unknown>) => make(bindings ?? {}) };
});
jest.mock('@/lib/consent/marketingGate', () => ({
  marketingGate: { check: async () => ({ allowed: true }) },
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import type { AuditLogInput } from '@/lib/audit/types';
import { sendEmail, type SendEmailParams, type SendEmailResult } from '@/lib/notifications/emailTransport';
import { EXPORT_COLUMN_LABELS } from '../columnLabels';
import { CSV_BOM } from '../csv';
import { EXPORT_MODULES, type ExportModuleDefinition } from '../exportModules';
import { buildJoinedCsv as realBuildJoinedCsv, type JoinedCsvInput } from '../joinedCsv';
import { PART_BYTES_MAX } from '../moduleExportSending';
import {
  runModuleExportWorker,
  type ModuleExportJobStore,
  type ModuleExportWorkerDeps,
  type ModuleExportWorkerLogger,
  type WorkerJob,
  type WorkerModulePart,
  type WorkerReapedJob,
  type WorkerResult,
} from '../moduleExportWorker';
import type { ExportRunResult } from '../sections';

// ── Fixtures ───────────────────────────────────────────────────────────────

const T0 = Date.parse('2026-10-29T10:00:00.000Z');
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const REQ_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const REQ_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const EMAIL_A = 'owner.alpha@example.com';
const EMAIL_B = 'owner.beta@example.com';
const RUNNER_1 = '11111111-1111-4111-8111-111111111111';
const RUNNER_2 = '22222222-2222-4222-8222-222222222222';
const RUNNER_3 = '33333333-3333-4333-8333-333333333333';
const OLD_RUNNER = '99999999-9999-4999-8999-999999999999';
const LEASE_MS = 420_000;
const MB_LINE = 'x'.repeat(1_000_000);

let jobSeq = 0;
const jobId = (): string => `cccccccc-0000-4000-8000-${String(++jobSeq).padStart(12, '0')}`;

interface Row extends WorkerJob {
  parts_total: number | null;
  parts: WorkerModulePart[];
  row_count: number | null;
  notice_attempts: number;
  notice_sent_at: string | null;
  notice_resend_id: string | null;
  claimed_by: string | null;
  claimed_at: number | null;
  next_attempt_at: number | null;
  last_error_code: string | null;
  sent_at: string | null;
  finished_at: string | null;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The row CHECKs of 20261095 (§1 of the workplan). A write that breaks one is refused. */
function rowProblem(r: Row): string | null {
  const terminal = r.status === 'sent' || r.status === 'failed' || r.status === 'interrupted';
  if (r.status === 'waiting' && (r.parts.length > 0 || r.parts_total !== null)) return 'waiting_has_no_parts';
  if (r.parts.some((part, i) => part.n !== i + 1 || !('resend_id' in part) || !('at' in part))) return 'parts_shape';
  if (r.status === 'sent' && (!r.sent_at || r.parts.length !== r.parts_total || r.parts.some((p) => p.state !== 'accepted'))) return 'sent_shape';
  if ((r.status === 'sent') !== (r.sent_at !== null)) return 'sent_shape';
  const failedish = r.status === 'failed' || r.status === 'interrupted';
  if (failedish !== (r.failure_code !== null)) return 'failure_shape';
  if (r.status === 'interrupted' && (r.failure_code !== 'interrupted' || r.parts.length === 0)) return 'failure_shape';
  if (failedish !== (r.notice_state !== 'none')) return 'notice_shape';
  if (terminal !== (r.finished_at !== null)) return 'finished_shape';
  if ((r.status === 'sent' || r.status === 'waiting') && r.claimed_by !== null) return 'claim_shape';
  return null;
}

type Injected = 'error' | 'lost' | null;

class FakeStore implements ModuleExportJobStore {
  rows: Row[] = [];
  calls: Array<{ method: string; jobId: string; userId: string; runnerId: string }> = [];
  claimCalls = 0;
  inject: (method: string, row: Row | undefined, callIndex: number) => Injected = () => null;

  constructor(private readonly now: () => number, private readonly events: string[]) {}

  add(partial: Partial<Row> & Pick<Row, 'user_id' | 'request_id' | 'module'>): Row {
    const row: Row = {
      id: jobId(),
      status: 'waiting',
      attempts: 0,
      failure_code: null,
      notice_state: 'none',
      parts_total: null,
      parts: [],
      row_count: null,
      notice_attempts: 0,
      notice_sent_at: null,
      notice_resend_id: null,
      claimed_by: null,
      claimed_at: null,
      next_attempt_at: null,
      last_error_code: null,
      sent_at: null,
      finished_at: null,
      ...partial,
    };
    if (rowProblem(row)) throw new Error(`bad fixture: ${rowProblem(row)}`);
    this.rows.push(row);
    return row;
  }

  get(id: string): Row {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error('no row');
    return row;
  }

  async reapStale(): Promise<WorkerResult<WorkerReapedJob[]>> {
    const now = this.now();
    const out: WorkerReapedJob[] = [];
    for (const r of this.rows) {
      const staleBuild = r.status === 'working' && r.claimed_at !== null && r.claimed_at < now - LEASE_MS;
      const staleNotice = r.notice_state === 'due' && r.notice_attempts >= 5 && (r.claimed_at === null || r.claimed_at < now - LEASE_MS);
      if (!staleBuild && !staleNotice) continue;
      const iso = new Date(now).toISOString();
      if (staleBuild) {
        const accepted = r.parts.filter((p) => p.state === 'accepted').length;
        if (r.parts_total !== null && r.parts.length === r.parts_total && accepted === r.parts_total) {
          Object.assign(r, { status: 'sent', sent_at: iso, finished_at: iso });
        } else if (r.parts.length > 0) {
          Object.assign(r, { status: 'interrupted', failure_code: 'interrupted', notice_state: 'due', finished_at: iso });
        } else if (r.attempts >= 3) {
          Object.assign(r, { status: 'failed', failure_code: 'attempts_exhausted', notice_state: 'due', finished_at: iso });
        } else {
          Object.assign(r, { status: 'waiting', parts_total: null, next_attempt_at: now + 60_000 * r.attempts, last_error_code: 'lease_expired' });
        }
      } else {
        r.notice_state = 'given_up';
      }
      r.claimed_by = null;
      r.claimed_at = null;
      out.push({
        id: r.id,
        userId: r.user_id,
        status: r.status,
        failureCode: r.failure_code,
        noticeState: r.notice_state,
        requestId: r.request_id,
        module: r.module,
        rowCount: r.row_count,
        partsTotal: r.parts_total,
        partsAccepted: r.parts.filter((p) => p.state === 'accepted').length,
      });
    }
    return { data: out, error: null };
  }

  async claimDue(runnerId: string, batch: number): Promise<WorkerResult<WorkerJob[]>> {
    this.claimCalls += 1;
    const now = this.now();
    const due = this.rows
      .filter(
        (r) =>
          (r.status === 'waiting' && (r.next_attempt_at === null || r.next_attempt_at <= now)) ||
          (r.notice_state === 'due' && r.notice_attempts < 5 && (r.claimed_at === null || r.claimed_at < now - LEASE_MS))
      )
      .slice(0, batch);
    for (const r of due) {
      if (r.status === 'waiting') {
        r.status = 'working';
        r.attempts += 1;
      }
      if (r.notice_state === 'due') r.notice_attempts += 1;
      r.claimed_by = runnerId;
      r.claimed_at = now;
    }
    return { data: clone(due), error: null };
  }

  private async cas(
    method: string,
    key: { jobId: string; userId: string; runnerId: string },
    guard: (r: Row) => boolean,
    patch: (r: Row) => void
  ): Promise<WorkerResult<{ updated: boolean }>> {
    this.calls.push({ method, ...key });
    this.events.push(`write:${method}`);
    const row = this.rows.find((r) => r.id === key.jobId && r.user_id === key.userId && r.claimed_by === key.runnerId && guard(r));
    const injected = this.inject(method, row, this.calls.length);
    if (injected === 'error') return { data: null, error: new Error('db down') };
    if (injected === 'lost' || !row) return { data: { updated: false }, error: null };
    const next = clone(row);
    patch(next);
    const problem = rowProblem(next);
    if (problem) return { data: null, error: new Error(`check violation: ${problem}`) };
    Object.assign(row, next);
    return { data: { updated: true }, error: null };
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private readonly working = (r: Row) => r.status === 'working';
  private readonly noticeDue = (r: Row) => r.notice_state === 'due';

  setPartsTotal(jobId: string, userId: string, runnerId: string, input: { partsTotal: number; rowCount: number }) {
    return this.cas('setPartsTotal', { jobId, userId, runnerId }, (r) => this.working(r) && r.parts_total === null, (r) => {
      r.parts_total = input.partsTotal;
      r.row_count = input.rowCount;
    });
  }
  markPartSending(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<WorkerModulePart>) {
    return this.cas('markPartSending', { jobId, userId, runnerId }, this.working, (r) => {
      r.parts = clone([...parts]);
    });
  }
  markPartAccepted(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<WorkerModulePart>) {
    return this.cas('markPartAccepted', { jobId, userId, runnerId }, this.working, (r) => {
      r.parts = clone([...parts]);
    });
  }
  markSent(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<WorkerModulePart>) {
    return this.cas('markSent', { jobId, userId, runnerId }, this.working, (r) => {
      Object.assign(r, { parts: clone([...parts]), status: 'sent', sent_at: this.iso(), finished_at: this.iso(), claimed_by: null, claimed_at: null });
    });
  }
  releaseForRetry(jobId: string, userId: string, runnerId: string, input: { errorCode: string; nextAttemptAt: string }) {
    // SA MX-3b F-1: the repository's compare-and-set also requires parts = '[]'.
    return this.cas('releaseForRetry', { jobId, userId, runnerId }, (r) => this.working(r) && r.parts.length === 0, (r) => {
      Object.assign(r, {
        status: 'waiting',
        parts: [],
        parts_total: null,
        last_error_code: input.errorCode,
        next_attempt_at: Date.parse(input.nextAttemptAt),
        claimed_by: null,
        claimed_at: null,
      });
    });
  }
  markFailed(jobId: string, userId: string, runnerId: string, input: { failureCode: string; noticeState: 'due' | 'given_up' }) {
    return this.cas('markFailed', { jobId, userId, runnerId }, this.working, (r) => {
      Object.assign(r, { status: 'failed', failure_code: input.failureCode, notice_state: input.noticeState, finished_at: this.iso(), claimed_by: null, claimed_at: null });
    });
  }
  markInterrupted(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<WorkerModulePart>) {
    return this.cas('markInterrupted', { jobId, userId, runnerId }, this.working, (r) => {
      Object.assign(r, {
        parts: clone([...parts]),
        status: 'interrupted',
        failure_code: 'interrupted',
        notice_state: 'due',
        finished_at: this.iso(),
        claimed_by: null,
        claimed_at: null,
      });
    });
  }
  markNoticeSent(jobId: string, userId: string, runnerId: string, resendId: string | null) {
    return this.cas('markNoticeSent', { jobId, userId, runnerId }, this.noticeDue, (r) => {
      Object.assign(r, { notice_state: 'sent', notice_sent_at: this.iso(), notice_resend_id: resendId, claimed_by: null, claimed_at: null });
    });
  }
  releaseNotice(jobId: string, userId: string, runnerId: string) {
    return this.cas('releaseNotice', { jobId, userId, runnerId }, this.noticeDue, (r) => {
      Object.assign(r, { claimed_by: null, claimed_at: null });
    });
  }
  markNoticeGivenUp(jobId: string, userId: string, runnerId: string) {
    return this.cas('markNoticeGivenUp', { jobId, userId, runnerId }, this.noticeDue, (r) => {
      Object.assign(r, { notice_state: 'given_up', claimed_by: null, claimed_at: null });
    });
  }
}

interface Sent {
  at: number;
  payload: SendEmailParams;
}

interface Harness {
  deps: ModuleExportWorkerDeps;
  store: FakeStore;
  sends: Sent[];
  audits: AuditLogInput[][];
  events: string[];
  workerLog: ModuleExportWorkerLogger;
  advance: (ms: number) => void;
  now: () => number;
  /** How the next send answers (default: accepted with a fresh Resend id). */
  answer: (fn: (payload: SendEmailParams, index: number) => SendEmailResult) => void;
  linesFor: Record<string, string[]>;
  run: (runnerId?: string) => ReturnType<typeof runModuleExportWorker>;
}

const accepted = (id: string): SendEmailResult => ({ sent: true, provider: 'resend', providerMessageId: id });

function harness(opts: { moduleMap?: readonly ExportModuleDefinition[] } = {}): Harness {
  let t = T0;
  const events: string[] = [];
  const store = new FakeStore(() => t, events);
  const sends: Sent[] = [];
  const audits: AuditLogInput[][] = [];
  const linesFor: Record<string, string[]> = {};
  let answerFn: (payload: SendEmailParams, index: number) => SendEmailResult = (_p, index) => accepted(`re_${index}`);
  const requests = [
    { id: REQ_A, userId: USER_A, requestedAt: '2026-10-29T09:55:00.000Z', origin: 'owner' },
    { id: REQ_B, userId: USER_B, requestedAt: '2026-10-29T09:56:00.000Z', origin: 'admin' },
  ];
  const emails: Record<string, string | null> = { [USER_A]: EMAIL_A, [USER_B]: EMAIL_B };

  const workerLog: ModuleExportWorkerLogger = {
    info: (...args: unknown[]) => logged.push({ source: 'worker', level: 'info', args }),
    warn: (...args: unknown[]) => logged.push({ source: 'worker', level: 'warn', args }),
    error: (...args: unknown[]) => logged.push({ source: 'worker', level: 'error', args }),
  };

  const deps: ModuleExportWorkerDeps = {
    jobs: store,
    findRequest: jest.fn(async (requestId: string, userId: string) => {
      const found = requests.find((r) => r.id === requestId && r.userId === userId);
      return { data: found ? { requestedAt: found.requestedAt, origin: found.origin } : null, error: null };
    }),
    findIdentity: jest.fn(async (userId: string) => ({ data: { id: userId, email: emails[userId] ?? null, createdAt: '2026-01-01T00:00:00.000Z' }, error: null })),
    findPreferredLanguage: jest.fn(async () => ({ data: 'en' as const, error: null })),
    ownerClock: jest.fn(async () => ({ timezone: 'Asia/Jerusalem', isSet: true })),
    readSections: jest.fn(async (_ctx, sectionIds): Promise<ExportRunResult> => ({
      overCeiling: false,
      sections: sectionIds.map((id) => ({ id, group: 'client_records', gdpr_role: 'processor', status: 'ok', row_count: 1, rows: [{ id: 'r1' }] })),
    })),
    buildJoinedCsv: jest.fn((input: JoinedCsvInput) => ({
      header: 'record_type,record_id',
      lines: linesFor[input.moduleId] ?? ['row,1', 'row,2'],
      rowCountBySection: {},
    })),
    moduleMap: opts.moduleMap ?? EXPORT_MODULES,
    send: jest.fn(async (payload: SendEmailParams) => {
      sends.push({ at: t, payload });
      events.push('send');
      t += 50;
      return answerFn(payload, sends.length);
    }),
    senderAddress: () => 'notifications@agentspilot.ai',
    audit: jest.fn(async (entries: AuditLogInput[]) => {
      audits.push(entries);
    }),
    now: () => t,
    sleep: jest.fn(async (ms: number) => {
      t += ms;
    }),
    uuid: () => RUNNER_1,
  };

  return {
    deps,
    store,
    sends,
    audits,
    events,
    workerLog,
    advance: (ms) => {
      t += ms;
    },
    now: () => t,
    answer: (fn) => {
      answerFn = fn;
    },
    linesFor,
    run: (runnerId = RUNNER_1) => runModuleExportWorker({ ...deps, uuid: () => runnerId }, workerLog),
  };
}

const keyOf = (s: Sent): string => (s.payload as { idempotencyKey?: string }).idempotencyKey ?? '';
const keysOf = (h: Harness): string[] => h.sends.map(keyOf);
const auditRows = (h: Harness): AuditLogInput[] => h.audits.flat();
const attachmentOf = (s: Sent): Buffer => s.payload.attachments?.[0]?.content as Buffer;
const bigModule = (lines: number): string[] => Array.from({ length: lines }, () => MB_LINE);

beforeEach(() => {
  logged.length = 0;
});

// ── T-W1 … T-W3: delivery ───────────────────────────────────────────────────

describe('T-W1: the happy path, three modules of one request', () => {
  it('sends one email per module to the login email, with module name and both times, and audits each as sent', async () => {
    const h = harness();
    const jobs = ['clients', 'services', 'bookings'].map((module) => h.store.add({ user_id: USER_A, request_id: REQ_A, module }));
    const counts = await h.run();

    expect(h.sends).toHaveLength(3);
    for (const s of h.sends) {
      expect(s.payload.to).toEqual([EMAIL_A]);
      expect(s.payload.redactRecipientInLogs).toBe(true);
      // QA E-3: the exact owner-zone times. Requested 09:55 UTC and produced at
      // 10:00 UTC on 2026-10-29 are 11:55 and 12:00 in Asia/Jerusalem (UTC+2
      // after the 25 October change), with no "(UTC)" since a zone is set.
      expect(s.payload.text).toContain(' at 11:55. Produced on ');
      expect(s.payload.text).toMatch(/Produced on [^\n]+ at 12:00\./);
      expect(s.payload.text).not.toContain('(UTC)');
    }
    expect(h.sends.map((s) => s.payload.subject)).toEqual([
      'Your data export: Clients (email 1 of 1)',
      'Your data export: Services (email 1 of 1)',
      'Your data export: Bookings (email 1 of 1)',
    ]);
    for (const job of jobs) expect(h.store.get(job.id)).toMatchObject({ status: 'sent', claimed_by: null, parts_total: 1 });
    const sent = auditRows(h).filter((a) => a.action === 'DATA_EXPORT_MODULE_SENT');
    expect(sent.map((a) => a.details?.job_id)).toEqual(jobs.map((j) => j.id));
    expect(counts).toMatchObject({ claimed: 3, modulesSent: 3, partsSent: 3, modulesFailed: 0 });
  });

  it('with the real builder: the attachment is BOM + header + rows, and `buildJoinedCsv` got EXPORT_COLUMN_LABELS (T-W19)', async () => {
    const h = harness();
    const builder = jest.fn((input: JoinedCsvInput) => realBuildJoinedCsv(input));
    h.deps.buildJoinedCsv = builder;
    h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    await h.run();
    expect(builder).toHaveBeenCalledTimes(1);
    expect(builder.mock.calls[0][0].labels).toBe(EXPORT_COLUMN_LABELS);
    const text = attachmentOf(h.sends[0]).toString('utf8');
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text.split('\r\n').length).toBeGreaterThanOrEqual(2);
  });
});

describe('T-W2: a module larger than one email', () => {
  it('is cut into X parts keyed export:{id}:1..X, each within the budget with BOM and header, parts_total fixed first', async () => {
    const h = harness();
    h.linesFor.clients = bigModule(15); // 6 + 6 + 3 lines of 1 MB
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    await h.run();

    expect(keysOf(h)).toEqual([1, 2, 3].map((n) => `export:${job.id}:${n}`));
    for (const s of h.sends) {
      const bytes = attachmentOf(s);
      expect(bytes.length).toBeLessThanOrEqual(PART_BYTES_MAX);
      expect(bytes.toString('utf8').startsWith(`${CSV_BOM}record_type,record_id\r\n`)).toBe(true);
    }
    expect(h.sends.map((s) => s.payload.subject)).toEqual([1, 2, 3].map((n) => `Your data export: Clients (email ${n} of 3)`));
    expect(h.events.indexOf('write:setPartsTotal')).toBeLessThan(h.events.indexOf('send'));
    // `sending` is written before each call (XC-9).
    expect(h.events.filter((e) => e === 'write:markPartSending' || e === 'send')).toEqual(['write:markPartSending', 'send', 'write:markPartSending', 'send', 'write:markPartSending', 'send']);
    expect(h.store.get(job.id)).toMatchObject({ status: 'sent', parts_total: 3, row_count: 15 });
    expect(h.store.get(job.id).parts.map((p) => p.resend_id)).toEqual(['re_1', 're_2', 're_3']);
  });
});

describe('T-W3: pacing', () => {
  it('every send of the run, parts and notices, is at least 600 ms after the one before', async () => {
    const off = EXPORT_MODULES.map((m) => (m.id === 'services' ? { ...m, on: false } : m));
    const h = harness({ moduleMap: off });
    h.linesFor.clients = bigModule(15);
    h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    await h.run();
    expect(h.sends).toHaveLength(4);
    for (let i = 1; i < h.sends.length; i += 1) expect(h.sends[i].at - h.sends[i - 1].at).toBeGreaterThanOrEqual(600);
  });
});

// ── T-W4 … T-W7: in-run re-sends ────────────────────────────────────────────

describe('T-W4 / T-W6: an in-run re-send uses the same key and the SAME payload (SA Q-3)', () => {
  it('a 429 with retry-after 2 on part 2: waits 2 s, re-sends the identical payload, accepted once', async () => {
    const h = harness();
    h.linesFor.clients = bigModule(10); // 2 parts
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    h.answer((_p, index) => (index === 2 ? { sent: false, provider: 'resend', providerStatus: 429, retryAfterSeconds: 2 } : accepted(`re_${index}`)));
    await h.run();
    expect(keysOf(h)).toEqual([`export:${job.id}:1`, `export:${job.id}:2`, `export:${job.id}:2`]);
    expect(h.sends[2].payload).toBe(h.sends[1].payload);
    expect(h.deps.sleep).toHaveBeenCalledWith(2000);
    expect(h.store.get(job.id)).toMatchObject({ status: 'sent' });
    expect(h.store.get(job.id).parts).toHaveLength(2);
  });

  it('a timeout on part 2, then the re-send returns the first send\'s id: one accepted part, no second one (K-7)', async () => {
    const h = harness();
    h.linesFor.clients = bigModule(10);
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    h.answer((_p, index) => {
      if (index === 2) return { sent: false, provider: 'resend', providerErrorCode: 'timeout' };
      if (index === 3) return accepted('re_first');
      return accepted(`re_${index}`);
    });
    await h.run();
    expect(h.sends[2].payload).toBe(h.sends[1].payload);
    expect(h.sends[2].payload).toEqual(h.sends[1].payload);
    expect(h.store.get(job.id).parts).toEqual([
      expect.objectContaining({ n: 1, state: 'accepted', resend_id: 're_1' }),
      expect.objectContaining({ n: 2, state: 'accepted', resend_id: 're_first' }),
    ]);
    expect(h.store.get(job.id).status).toBe('sent');
  });
});

describe('T-W5: a retry-after that does not fit the budget', () => {
  it('ends the job interrupted with the notice due and the claim cleared; the interrupted notice goes once', async () => {
    const h = harness();
    h.linesFor.clients = bigModule(10);
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    h.answer((p, index) => {
      const key = (p as { idempotencyKey?: string }).idempotencyKey ?? '';
      if (key.endsWith(':2')) return { sent: false, provider: 'resend', providerStatus: 429, retryAfterSeconds: 300 };
      return accepted(`re_${index}`);
    });
    const counts = await h.run();
    const row = h.store.get(job.id);
    expect(row).toMatchObject({ status: 'interrupted', failure_code: 'interrupted', claimed_by: null, notice_state: 'sent' });
    expect(row.parts.map((p) => p.state)).toEqual(['accepted', 'sending']);
    expect(h.deps.sleep).not.toHaveBeenCalledWith(300_000);
    expect(counts.budgetStops).toBe(1);
    const notices = h.sends.filter((s) => keyOf(s) === `export-notice:${job.id}`);
    expect(notices).toHaveLength(1);
    expect(notices[0].payload.subject).toBe('Your data export: Clients was interrupted');
  });
});

describe('T-W7: part 2 times out on every try', () => {
  it('ends interrupted with part 1 accepted and part 2 sending; part 3 is never sent', async () => {
    const h = harness();
    h.linesFor.clients = bigModule(15);
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    h.answer((p, index) => {
      const key = (p as { idempotencyKey?: string }).idempotencyKey ?? '';
      return key.endsWith(':2') ? { sent: false, provider: 'resend', providerErrorCode: 'timeout' } : accepted(`re_${index}`);
    });
    const counts = await h.run();
    expect(keysOf(h).filter((k) => k === `export:${job.id}:2`)).toHaveLength(3);
    expect(keysOf(h)).not.toContain(`export:${job.id}:3`);
    expect(h.store.get(job.id).parts.map((p) => [p.n, p.state])).toEqual([
      [1, 'accepted'],
      [2, 'sending'],
    ]);
    expect(h.store.get(job.id).status).toBe('interrupted');
    expect(counts.modulesInterrupted).toBe(1);
    const failed = auditRows(h).find((a) => a.action === 'DATA_EXPORT_MODULE_FAILED');
    expect(failed?.details).toMatchObject({ interrupted: true, failure_code: 'interrupted', parts: 3, parts_accepted: 1 });
  });
});

// ── T-W8 … T-W10: retries and the reaper ────────────────────────────────────

describe('T-W8: a failure before any part is retried, then fails after 3 attempts', () => {
  it('section read failure: waiting with 60 s × attempts backoff, then attempts_exhausted with the failed email', async () => {
    const h = harness();
    h.deps.readSections = jest.fn(async (_ctx, sectionIds): Promise<ExportRunResult> => ({
      overCeiling: false,
      sections: sectionIds.map((id) => ({ id, group: 'client_records', gdpr_role: 'processor', status: 'failed', row_count: 0, rows: [] })),
    }));
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });

    await h.run(RUNNER_1);
    expect(h.store.get(job.id)).toMatchObject({ status: 'waiting', attempts: 1, last_error_code: 'section_read_failed', parts: [], parts_total: null });
    // 60 s × 1 attempt from the moment of the release (a few fake ms into the run).
    const firstNext = h.store.get(job.id).next_attempt_at!;
    expect(firstNext - T0).toBeGreaterThanOrEqual(60_000);
    expect(firstNext - T0).toBeLessThan(61_000);
    expect(h.sends).toHaveLength(0);

    h.advance(61_000);
    await h.run(RUNNER_2);
    expect(h.store.get(job.id)).toMatchObject({ status: 'waiting', attempts: 2 });
    expect(h.store.get(job.id).next_attempt_at! - h.now()).toBeGreaterThan(110_000);

    h.advance(121_000);
    await h.run(RUNNER_3);
    expect(h.store.get(job.id)).toMatchObject({ status: 'failed', failure_code: 'attempts_exhausted', notice_state: 'sent', attempts: 3 });
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].payload.subject).toBe('Your data export: Services failed');
    expect(h.sends[0].payload.text).toContain('Please try again.');
  });
});

describe('T-W9: a run killed after a part reached sending', () => {
  it('is reaped next run to interrupted, audited with interrupted: true, and its one notice is sent', async () => {
    const h = harness();
    const job = h.store.add({
      user_id: USER_A,
      request_id: REQ_A,
      module: 'clients',
      status: 'working',
      attempts: 1,
      parts_total: 3,
      row_count: 40,
      claimed_by: OLD_RUNNER,
      claimed_at: T0 - 500_000,
      parts: [
        { n: 1, state: 'accepted', resend_id: 're_old1', at: '2026-10-29T09:51:00.000Z' },
        { n: 2, state: 'sending', resend_id: null, at: '2026-10-29T09:51:01.000Z' },
      ],
    });
    const counts = await h.run();
    expect(counts.reaped).toBe(1);
    expect(h.store.get(job.id)).toMatchObject({ status: 'interrupted', notice_state: 'sent' });
    expect(keysOf(h)).toEqual([`export-notice:${job.id}`]);
    expect(h.sends[0].payload.subject).toBe('Your data export: Clients was interrupted');
    const failed = auditRows(h).filter((a) => a.action === 'DATA_EXPORT_MODULE_FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0].details).toEqual({
      request_id: REQ_A,
      job_id: job.id,
      module: 'clients',
      origin: 'owner',
      rows: 40,
      parts: 3,
      parts_accepted: 1,
      failure_code: 'interrupted',
      interrupted: true,
    });
  });
});

describe('T-W10: a run killed before any part', () => {
  it('is reaped back to waiting and built from scratch by a later run', async () => {
    const h = harness();
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services', status: 'working', attempts: 1, claimed_by: OLD_RUNNER, claimed_at: T0 - 500_000 });
    await h.run(RUNNER_1);
    expect(h.store.get(job.id)).toMatchObject({ status: 'waiting', last_error_code: 'lease_expired' });
    expect(h.sends).toHaveLength(0);
    expect(auditRows(h)).toHaveLength(0);
    h.advance(61_000);
    await h.run(RUNNER_2);
    expect(h.store.get(job.id)).toMatchObject({ status: 'sent', attempts: 2 });
    expect(keysOf(h)).toEqual([`export:${job.id}:1`]);
  });
});

// ── T-W11 … T-W15: failures that end a module ───────────────────────────────

describe('T-W11 / T-W12: too large', () => {
  it('11 parts: failed too_large, the too-large email, no part email', async () => {
    const h = harness();
    h.linesFor.clients = bigModule(61);
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    await h.run();
    expect(h.store.get(job.id)).toMatchObject({ status: 'failed', failure_code: 'too_large', parts: [], notice_state: 'sent' });
    expect(keysOf(h)).toEqual([`export-notice:${job.id}`]);
    expect(h.sends[0].payload.subject).toBe('Your data export: Clients is too large to email');
  });

  it('over the row ceiling: failed over_ceiling, the too-large email', async () => {
    const h = harness();
    h.deps.readSections = jest.fn(async (): Promise<ExportRunResult> => ({ overCeiling: true, sections: [], atSection: 'clients' }));
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    await h.run();
    expect(h.store.get(job.id)).toMatchObject({ status: 'failed', failure_code: 'over_ceiling' });
    expect(h.sends[0].payload.subject).toBe('Your data export: Clients is too large to email');
    expect(h.deps.buildJoinedCsv).not.toHaveBeenCalled();
  });
});

describe('T-W13 / T-W14: a module switched off or unknown fails closed (SA-P4)', () => {
  it('switched off: failed module_switched_off, no section read, no builder, "not available" email', async () => {
    const off = EXPORT_MODULES.map((m) => (m.id === 'services' ? { ...m, on: false } : m));
    const h = harness({ moduleMap: off });
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    await h.run();
    expect(h.store.get(job.id)).toMatchObject({ status: 'failed', failure_code: 'module_switched_off' });
    expect(h.deps.readSections).not.toHaveBeenCalled();
    expect(h.deps.buildJoinedCsv).not.toHaveBeenCalled();
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].payload.subject).toBe('Your data export: Services failed');
    expect(h.sends[0].payload.text).toContain('This part is not available for export right now.');
  });

  it('an id not in the map (renamed): failed module_unknown', async () => {
    const h = harness();
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'old_module' });
    await h.run();
    expect(h.store.get(job.id)).toMatchObject({ status: 'failed', failure_code: 'module_unknown' });
    expect(h.deps.readSections).not.toHaveBeenCalled();
  });
});

describe('T-W15: one module fails among three', () => {
  it('the other two arrive', async () => {
    const h = harness();
    h.deps.readSections = jest.fn(async (_ctx, sectionIds): Promise<ExportRunResult> => ({
      overCeiling: false,
      sections: sectionIds.map((id) =>
        id === 'bookings'
          ? { id, group: 'client_records' as const, gdpr_role: 'processor' as const, status: 'failed' as const, row_count: 0 as const, rows: [] as [] }
          : { id, group: 'client_records' as const, gdpr_role: 'processor' as const, status: 'ok' as const, row_count: 1, rows: [{ id: 'r' }] }
      ),
    }));
    const a = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    const b = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'bookings', attempts: 2 });
    const c = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    await h.run();
    expect(h.store.get(a.id).status).toBe('sent');
    expect(h.store.get(b.id)).toMatchObject({ status: 'failed', failure_code: 'attempts_exhausted' });
    expect(h.store.get(c.id).status).toBe('sent');
    expect(keysOf(h)).toEqual([`export:${a.id}:1`, `export-notice:${b.id}`, `export:${c.id}:1`]);
  });
});

// ── T-W16: tenant isolation (tenant-isolation-guard step 6, SA C-4) ─────────

describe('T-W16: two accounts in one run', () => {
  it('every read, write and email of a job is keyed on that job\'s own user_id', async () => {
    const h = harness();
    const a = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    const b = h.store.add({ user_id: USER_B, request_id: REQ_B, module: 'clients' });
    const readsByUser: string[] = [];
    const base = h.deps.readSections;
    h.deps.readSections = jest.fn(async (ctx, ids, l, o) => {
      readsByUser.push(`${ctx.userId}:${ctx.authUser.id}:${ctx.authUser.email}`);
      return base(ctx, ids, l, o);
    });
    await h.run();

    const byJob = (id: string) => h.sends.filter((s) => keyOf(s).includes(id));
    expect(byJob(a.id).map((s) => s.payload.to)).toEqual([[EMAIL_A]]);
    expect(byJob(b.id).map((s) => s.payload.to)).toEqual([[EMAIL_B]]);
    // QA E-2: the read list is not empty (so `every` proves something), and holds both accounts.
    expect(readsByUser.length).toBeGreaterThan(0);
    expect(readsByUser.every((r) => r === `${USER_A}:${USER_A}:${EMAIL_A}` || r === `${USER_B}:${USER_B}:${EMAIL_B}`)).toBe(true);
    expect(new Set(readsByUser)).toEqual(new Set([`${USER_A}:${USER_A}:${EMAIL_A}`, `${USER_B}:${USER_B}:${EMAIL_B}`]));
    expect(h.deps.findRequest).toHaveBeenCalledWith(REQ_A, USER_A);
    expect(h.deps.findRequest).toHaveBeenCalledWith(REQ_B, USER_B);
    // QA E-2: every owner read takes the job's own user_id, and only those two.
    for (const read of [h.deps.findIdentity, h.deps.findPreferredLanguage, h.deps.ownerClock] as jest.Mock[]) {
      expect(read).toHaveBeenCalledWith(USER_A);
      expect(read).toHaveBeenCalledWith(USER_B);
      expect(read.mock.calls.every(([userId]) => userId === USER_A || userId === USER_B)).toBe(true);
      expect(read).toHaveBeenCalledTimes(2);
    }
    for (const call of h.store.calls) {
      const owner = h.store.get(call.jobId).user_id;
      expect(call.userId).toBe(owner);
      expect(call.runnerId).toBe(RUNNER_1);
    }
    const auditUsers = auditRows(h).map((e) => [e.details?.job_id, e.userId, e.entityId]);
    expect(auditUsers).toEqual([
      [a.id, USER_A, USER_A],
      [b.id, USER_B, USER_B],
    ]);
  });

  it('C-4: a job whose user_id does not own its request fails request_mismatch: no send, an error line, no retry', async () => {
    const h = harness();
    // Account B's job pointing at account A's request: no FK prevents it.
    const job = h.store.add({ user_id: USER_B, request_id: REQ_A, module: 'clients' });
    // A sibling of account A's on the same request id must not be served B's facts, nor B A's.
    const sibling = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    await h.run();
    expect(h.store.get(job.id)).toMatchObject({ status: 'failed', failure_code: 'request_mismatch', notice_state: 'given_up' });
    expect(h.sends.some((s) => keyOf(s).includes(job.id))).toBe(false);
    expect(h.sends.every((s) => !(s.payload.to as string[]).includes(EMAIL_B))).toBe(true);
    expect(h.deps.findRequest).toHaveBeenCalledWith(REQ_A, USER_B);
    expect(h.deps.readSections).toHaveBeenCalledTimes(1);
    expect(h.store.get(sibling.id).status).toBe('sent');
    const errorLine = logged.find((l) => l.source === 'worker' && l.level === 'error' && JSON.stringify(l.args).includes('request_mismatch'));
    expect(errorLine).toBeDefined();
    // No retry: a later run does not pick it up again.
    h.advance(600_000);
    await h.run(RUNNER_2);
    expect(h.store.get(job.id).attempts).toBe(1);
  });
});

// ── T-W17: no switch, no entitlements (R-6, XC-19) ─────────────────────────

describe('T-W17: the worker never reads the export switch or the entitlements', () => {
  it.each(['lib/business-os/data-export/moduleExportWorker.ts', 'lib/business-os/data-export/moduleExportWorkerDeps.ts'])('%s', (file) => {
    // Code only: the headers say in words that the switch is not read.
    const code = readFileSync(join(process.cwd(), file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toMatch(/import /);
    expect(code).not.toMatch(/featureFlags|isModuleExportEnabled/);
    expect(code).not.toMatch(/business-os\/entitlements/);
  });
});

// ── T-W18: language once per request ───────────────────────────────────────

describe('T-W18: the owner\'s language and clock, once per request per run', () => {
  it('two modules of one request share the first language read, even if the preference changes', async () => {
    const h = harness();
    const language = jest.fn().mockResolvedValueOnce({ data: 'he', error: null }).mockResolvedValue({ data: 'es', error: null });
    h.deps.findPreferredLanguage = language;
    h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    await h.run();
    expect(language).toHaveBeenCalledTimes(1);
    expect(h.deps.ownerClock).toHaveBeenCalledTimes(1);
    expect(h.sends.map((s) => s.payload.subject.startsWith('ייצוא הנתונים שלך'))).toEqual([true, true]);
    expect(h.sends.every((s) => s.payload.html.includes('dir="rtl"'))).toBe(true);
  });

  it('an unreadable language: English and a language_unreadable warn', async () => {
    const h = harness();
    h.deps.findPreferredLanguage = jest.fn(async () => ({ data: null, error: new Error('db') }));
    h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    await h.run();
    expect(h.sends[0].payload.subject).toBe('Your data export: Clients (email 1 of 1)');
    expect(logged.some((l) => l.level === 'warn' && JSON.stringify(l.args).includes('language_unreadable'))).toBe(true);
  });
});

// ── T-W20: notices ─────────────────────────────────────────────────────────

describe('T-W20: the notice of a failed job (D-13)', () => {
  const failedRow = (h: Harness, extra: Partial<Row> = {}) =>
    h.store.add({
      user_id: USER_A,
      request_id: REQ_A,
      module: 'clients',
      status: 'failed',
      failure_code: 'attempts_exhausted',
      notice_state: 'due',
      attempts: 3,
      finished_at: '2026-10-29T09:00:00.000Z',
      ...extra,
    });

  it('accepted: keyed export-notice:{id}, notice sent with its Resend id', async () => {
    const h = harness();
    const job = failedRow(h);
    await h.run();
    expect(keysOf(h)).toEqual([`export-notice:${job.id}`]);
    expect(h.sends[0].payload.attachments).toBeUndefined();
    expect(h.store.get(job.id)).toMatchObject({ notice_state: 'sent', notice_resend_id: 're_1', claimed_by: null, notice_attempts: 1 });
  });

  it('a 500: one send this run, the claim released only after the claim loop, retried by the next run', async () => {
    const h = harness();
    const job = failedRow(h);
    h.answer(() => ({ sent: false, provider: 'resend', providerStatus: 500 }));
    const counts = await h.run(RUNNER_1);
    expect(h.sends).toHaveLength(1);
    expect(counts.noticesFailed).toBe(1);
    expect(h.store.get(job.id)).toMatchObject({ notice_state: 'due', claimed_by: null, notice_attempts: 1 });
    h.answer((_p, index) => accepted(`re_${index}`));
    h.advance(300_000);
    await h.run(RUNNER_2);
    expect(h.store.get(job.id)).toMatchObject({ notice_state: 'sent', notice_attempts: 2 });
    expect(h.sends[1].payload).toEqual(h.sends[0].payload);
  });

  it('an .invalid recipient: given up, nothing sent', async () => {
    const h = harness();
    h.deps.findIdentity = jest.fn(async (userId: string) => ({ data: { id: userId, email: 'deleted-user@account.invalid', createdAt: null }, error: null }));
    const job = failedRow(h);
    await h.run();
    expect(h.sends).toHaveLength(0);
    expect(h.store.get(job.id)).toMatchObject({ notice_state: 'given_up', claimed_by: null });
  });

  it('409 invalid_idempotent_request: treated as sent', async () => {
    const h = harness();
    const job = failedRow(h, { status: 'interrupted', failure_code: 'interrupted', parts_total: 2, parts: [{ n: 1, state: 'accepted', resend_id: 're_p', at: '2026-10-29T09:00:00.000Z' }] });
    h.answer(() => ({ sent: false, provider: 'resend', providerStatus: 409, providerErrorCode: 'invalid_idempotent_request' }));
    await h.run();
    expect(h.store.get(job.id)).toMatchObject({ notice_state: 'sent', notice_resend_id: null });
  });

  it('a part answered 409 invalid_idempotent_request ends interrupted (SA Q-3)', async () => {
    const h = harness();
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    h.answer((p) =>
      (p as { idempotencyKey?: string }).idempotencyKey?.startsWith('export:')
        ? { sent: false, provider: 'resend', providerStatus: 409, providerErrorCode: 'invalid_idempotent_request' }
        : accepted('re_n')
    );
    await h.run();
    expect(h.store.get(job.id)).toMatchObject({ status: 'interrupted', notice_state: 'sent' });
    expect(keysOf(h).filter((k) => k.startsWith('export:'))).toHaveLength(1);
  });
});

// ── T-W21: the claim cutoff (SA C-1 option a) ──────────────────────────────

describe('T-W21: no claim of any kind after BUILD_CLAIM_CUTOFF_SECONDS', () => {
  it('a late run leaves waiting jobs and due notices exactly as they were: attempts unchanged', async () => {
    const h = harness();
    const base = h.deps.readSections;
    // The first build's reads take 95 s, past the 90 s cutoff.
    h.deps.readSections = jest.fn(async (ctx, ids, l, o) => {
      h.advance(95_000);
      return base(ctx, ids, l, o);
    });
    const first = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    const waiting = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    const notice = h.store.add({
      user_id: USER_A,
      request_id: REQ_A,
      module: 'bookings',
      status: 'failed',
      failure_code: 'attempts_exhausted',
      notice_state: 'due',
      attempts: 3,
      finished_at: '2026-10-29T09:00:00.000Z',
    });
    await h.run();
    expect(h.store.get(first.id).status).toBe('sent');
    expect(h.store.claimCalls).toBe(1);
    expect(h.store.get(waiting.id)).toMatchObject({ status: 'waiting', attempts: 0, claimed_by: null, next_attempt_at: null });
    expect(h.store.get(notice.id)).toMatchObject({ notice_state: 'due', notice_attempts: 0, claimed_by: null });
  });
});

// ── T-W22: claim lost ──────────────────────────────────────────────────────

describe('T-W22: a claim lost mid-job', () => {
  it('count 0 on markPartAccepted: nothing more is sent for that job, claim_lost is logged, the run goes on', async () => {
    const h = harness();
    h.linesFor.clients = bigModule(10);
    const lost = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    const next = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    h.store.inject = (method, row) => (method === 'markPartAccepted' && row?.id === lost.id ? 'lost' : null);
    await h.run();
    expect(keysOf(h)).toEqual([`export:${lost.id}:1`, `export:${next.id}:1`]);
    expect(logged.some((l) => l.level === 'error' && JSON.stringify(l.args).includes('claim_lost'))).toBe(true);
    expect(h.store.get(next.id).status).toBe('sent');
  });

  it('K-7: one transient error on markSent is retried once, so a delivered module is not interrupted', async () => {
    const h = harness();
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    let failures = 0;
    h.store.inject = (method) => (method === 'markSent' && failures++ === 0 ? 'error' : null);
    await h.run();
    expect(h.store.get(job.id).status).toBe('sent');
    expect(h.store.calls.filter((c) => c.method === 'markSent')).toHaveLength(2);
  });
});

// ── SA MX-3b code review F-1 / F-2 ─────────────────────────────────────────

describe('SA F-1: a throw after a part reached sending never leads to a retry (XC-9)', () => {
  it('a throw while building part 2, after part 1 was delivered: interrupted, part 1 never sent again', async () => {
    const h = harness();
    h.linesFor.clients = bigModule(10); // 2 parts
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    // Part 2's payload build throws (a defect after part 1 was accepted and recorded).
    let built = 0;
    h.deps.senderAddress = () => {
      built += 1;
      if (built === 2) throw new Error('defect while building part 2');
      return 'notifications@agentspilot.ai';
    };
    const counts = await h.run(RUNNER_1);
    const row = h.store.get(job.id);
    expect(row.status).toBe('interrupted');
    expect(row.parts).toEqual([expect.objectContaining({ n: 1, state: 'accepted' })]);
    expect(h.store.calls.some((c) => c.method === 'releaseForRetry')).toBe(false);
    expect(counts).toMatchObject({ modulesInterrupted: 1, retried: 0 });
    // A later run sends only the notice: part 1 is never sent a second time.
    h.advance(600_000);
    await h.run(RUNNER_2);
    expect(keysOf(h).filter((k) => k === `export:${job.id}:1`)).toHaveLength(1);
    expect(keysOf(h).filter((k) => k.startsWith(`export:${job.id}`))).toHaveLength(1);
  });

  it('the store refuses a release once a part is stored (the repository guard, mirrored)', async () => {
    const h = harness();
    const row = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    await h.store.claimDue(RUNNER_1, 1);
    await h.store.markPartSending(row.id, USER_A, RUNNER_1, [{ n: 1, state: 'sending', resend_id: null, at: '2026-10-29T10:00:00.000Z' }]);
    expect(await h.store.releaseForRetry(row.id, USER_A, RUNNER_1, { errorCode: 'build_failed', nextAttemptAt: '2026-10-29T10:01:00.000Z' })).toEqual({
      data: { updated: false },
      error: null,
    });
    expect(h.store.get(row.id)).toMatchObject({ status: 'working', parts: [expect.objectContaining({ n: 1 })] });
  });
});

describe('SA F-2: no part try starts unless it ends before maxDuration', () => {
  it('a part reached at 255 s is not started (45 s timeout + gap would pass 295 s): budget stop, retry before any part', async () => {
    const h = harness();
    const base = h.deps.readSections;
    // The reads end at 255 s: under the 270 s budget, but a 45 s try would run past 295 s.
    h.deps.readSections = jest.fn(async (ctx, ids, l, o) => {
      h.advance(255_000);
      return base(ctx, ids, l, o);
    });
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    const counts = await h.run();
    expect(h.sends).toHaveLength(0);
    expect(counts.budgetStops).toBe(1);
    expect(h.store.get(job.id)).toMatchObject({ status: 'waiting', last_error_code: 'budget_spent', parts: [] });
  });

  it('after part 1, a part whose try would not end in time ends the job interrupted at once', async () => {
    const h = harness();
    h.linesFor.clients = bigModule(10); // 2 parts
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    // Part 1's send takes until 250 s: part 2 would need 250 + 0.6 + 45 > 295 s.
    h.answer((_p, index) => {
      if (index === 1) h.advance(250_000);
      return accepted(`re_${index}`);
    });
    const counts = await h.run();
    expect(keysOf(h).filter((k) => k.startsWith('export:'))).toEqual([`export:${job.id}:1`]);
    expect(h.store.get(job.id)).toMatchObject({ status: 'interrupted' });
    expect(counts.budgetStops).toBe(1);
  });
});

// ── QA MX-3b pass 1, E-1: the retry and recipient branches of a build ──────

describe('QA E-1: the build paths that end before any part', () => {
  it('the budget spent before part 1 (reads past 270 s): released for a retry with budget_spent, nothing sent', async () => {
    const h = harness();
    const base = h.deps.readSections;
    h.deps.readSections = jest.fn(async (ctx, ids, l, o) => {
      h.advance(271_000);
      return base(ctx, ids, l, o);
    });
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    const counts = await h.run();
    expect(h.sends).toHaveLength(0);
    expect(counts).toMatchObject({ budgetStops: 1, retried: 1 });
    expect(h.store.get(job.id)).toMatchObject({ status: 'waiting', attempts: 1, last_error_code: 'budget_spent', parts: [], parts_total: null });
  });

  it.each([
    ['no login email', null],
    ['an .invalid login email', 'deleted-user@account.invalid'],
  ])('%s: failed recipient_unavailable, notice given up, no part marked, nothing sent', async (_name, email) => {
    const h = harness();
    h.deps.findIdentity = jest.fn(async (userId: string) => ({ data: { id: userId, email, createdAt: null }, error: null }));
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    await h.run();
    expect(h.store.get(job.id)).toMatchObject({ status: 'failed', failure_code: 'recipient_unavailable', notice_state: 'given_up', parts: [], claimed_by: null });
    expect(h.store.calls.some((c) => c.method === 'markPartSending' || c.method === 'setPartsTotal')).toBe(false);
    expect(h.deps.readSections).not.toHaveBeenCalled();
    expect(h.sends).toHaveLength(0);
  });

  it('an account that no longer exists (identity null): failed recipient_unavailable, notice given up', async () => {
    const h = harness();
    h.deps.findIdentity = jest.fn(async () => ({ data: null, error: null }));
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    await h.run();
    expect(h.store.get(job.id)).toMatchObject({ status: 'failed', failure_code: 'recipient_unavailable', notice_state: 'given_up' });
    expect(h.sends).toHaveLength(0);
  });

  it.each([
    ['the request read fails', 'request'],
    ['the identity read fails', 'identity'],
  ])('owner_unreadable (%s): released for a retry, nothing read or sent, not cached', async (_name, which) => {
    const h = harness();
    if (which === 'request') h.deps.findRequest = jest.fn(async () => ({ data: null, error: new Error('db down') }));
    else h.deps.findIdentity = jest.fn(async () => ({ data: null, error: new Error('auth down') }));
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    const counts = await h.run();
    expect(counts.retried).toBe(1);
    expect(h.store.get(job.id)).toMatchObject({ status: 'waiting', attempts: 1, last_error_code: 'owner_unreadable', parts: [] });
    expect(h.deps.readSections).not.toHaveBeenCalled();
    expect(h.sends).toHaveLength(0);
  });
});

// ── T-W23: privacy of every log line (SA C-3) ──────────────────────────────

describe('T-W23: no address, file name or cell value in any log line, the transport\'s included', () => {
  const ENV = { ...process.env };
  // SA MX-3b F-6: the global fetch is put back after the test.
  const originalFetch = (global as unknown as { fetch: unknown }).fetch;
  afterEach(() => {
    process.env = { ...ENV };
    (global as unknown as { fetch: unknown }).fetch = originalFetch;
  });

  it('through the REAL transport with a mocked Resend', async () => {
    process.env = { ...ENV, RESEND_API_KEY: 're_test_key' };
    delete process.env.VERCEL_ENV;
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (): string | null => null },
      text: async () => '{"id":"re_live"}',
      json: async (): Promise<unknown> => ({ id: 're_live' }),
    }));
    const off = EXPORT_MODULES.map((m) => (m.id === 'services' ? { ...m, on: false } : m));
    const h = harness({ moduleMap: off });
    h.deps.send = sendEmail;
    h.linesFor.clients = ['client,SECRET-CELL-VALUE', 'client,another'];
    const job = h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    await h.run();
    expect(h.store.get(job.id).status).toBe('sent');
    expect(logged.some((l) => l.source === 'EmailTransport')).toBe(true);

    const fileName = /clients_\d{4}-\d{2}-\d{2}_part-1-of-1\.csv/;
    for (const line of logged) {
      const text = JSON.stringify(line.args);
      expect(text).not.toContain(EMAIL_A);
      expect(text).not.toMatch(fileName);
      expect(text).not.toContain('SECRET-CELL-VALUE');
      if (line.source === 'worker') expect(text).not.toContain('Your data export');
    }
  });
});

// ── T-W24: audit details (XC-13) ───────────────────────────────────────────

describe('T-W24: audit details carry exactly the XC-13 keys', () => {
  it('SENT and FAILED', async () => {
    const off = EXPORT_MODULES.map((m) => (m.id === 'services' ? { ...m, on: false } : m));
    const h = harness({ moduleMap: off });
    h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'clients' });
    h.store.add({ user_id: USER_A, request_id: REQ_A, module: 'services' });
    await h.run();
    const sent = auditRows(h).find((a) => a.action === 'DATA_EXPORT_MODULE_SENT');
    const failed = auditRows(h).find((a) => a.action === 'DATA_EXPORT_MODULE_FAILED');
    expect(Object.keys(sent?.details ?? {}).sort()).toEqual(['job_id', 'module', 'origin', 'parts', 'parts_accepted', 'request_id', 'rows'].sort());
    expect(Object.keys(failed?.details ?? {}).sort()).toEqual(
      ['failure_code', 'interrupted', 'job_id', 'module', 'origin', 'parts', 'parts_accepted', 'request_id', 'rows'].sort()
    );
    expect(sent).toMatchObject({ entityType: 'user', entityId: USER_A, userId: USER_A, severity: 'info', complianceFlags: ['GDPR', 'SOC2'] });
    expect(failed).toMatchObject({ entityType: 'user', severity: 'warning', complianceFlags: ['GDPR'] });
    expect(failed?.details).toMatchObject({ failure_code: 'module_switched_off', interrupted: false, parts: 0, parts_accepted: 0 });
    expect(JSON.stringify(auditRows(h))).not.toContain(EMAIL_A);
  });
});
