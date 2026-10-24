// lib/business-os/data-export/zipExport.ts
//
// DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §3.2, §6; requirement
// §0.4.1 A, C, E; SA C-1, C-2, C-4, C-9, C-14): build ONE zip of the owner's
// data and files in one request, upload it to the private bucket and mark the
// job ready. The route maps the outcome to HTTP and audit and signs the URL;
// DE-10a calls this same function with the target account, so the admin path
// has the same ceilings and the same file (§0.4.1 C).
//
// Order of work (nothing heavy before the cheap checks):
//   1. pre-flight files: inventory (list only) -> count + listing bytes over
//      the ceiling? -> `over_ceiling`, nothing downloaded;
//   2. records: the bounded section pass (stops at ROW_CEILING; SA Q-3: this
//      is the row check) -> `over_ceiling`;
//   3. the time budget (40 s) -> `timeout`;
//   4. downloads, at most FILE_DOWNLOAD_CONCURRENCY at once; no new download
//      starts after the budget (SA C-9); real bytes are counted (a backstop
//      for a wrong listing size); an unreadable file is listed as
//      `could_not_be_read` and the export continues (TL default BC-5);
//   5. CSVs, data.json (compact, C-10 P-2), READMEs, files-index.csv; the
//      zip through `buildZip` (zipWriter.ts: Node zlib deflate for text, store
//      for files; C-10 P-1), entries in a fixed order (SA C-14), every name
//      checked against the allow-list (SA C-4); the time budget is checked
//      before each entry (SA-C10-6);
//   6. finished size <= 45 MiB and elapsed <= 40 s, else nothing is uploaded;
//   7. upload `{user_id}/{job_id}/1.zip`; 8. markReady; 9. older ready
//      exports of this account AND OF THE SAME KIND expire and their objects
//      go (best effort; the cron is the backstop). DE-10a (SA-4, BC-3): the
//      kind is the ready row's own `requested_by_kind`, never an argument, so
//      an owner export never replaces an admin-prepared one, or the reverse.
//
// FAILURE INVARIANT (SA C-1, C-2). Every exit BEFORE markReady succeeded runs
// markFailed (once) and removes the uploaded object if step 7 ran. markReady
// returning an ERROR is ambiguous (the update may have applied, only the
// answer lost), so the job is re-read: `ready` -> success; `running` ->
// markFailed + remove; anything else -> remove + `timeout`. If the re-read
// fails too, markFailed is tried and the object removed only when it took;
// otherwise the object is left for the cron's orphan sweep, because removing
// the file of a job that is in fact `ready` would break "download again".
// `data === null` with no error means "no longer running" (the stale rule
// took it): remove + `timeout`. No URL exists before upload and ready both
// succeeded: signing is the caller's, after a `ready` outcome.
//
// C-10 (SA-C10-8): `data_export_ready` carries `stepMs` (the duration of each
// step reached) and `textBytes` (the raw size of the text entries); the
// timeout and over-ceiling events carry the steps completed so far, plus, on a
// timeout during the zip, `zip` = the time spent before it stopped. This is the
// only measure of the database read time on a real function.
//
// Logs carry ids, counts, bytes and durations only: never content, file
// names, the business name or the email (§0.3.2, §0.4.1 E).
//
// Server-only.

import 'server-only';
import { EXPORT_LIMITS } from '@/lib/business-os/data-export/limits';
import { ceilingUse, isNearCeiling, type CeilingKey, type CeilingMeasure } from '@/lib/business-os/data-export/ceiling';
import { toCsv } from '@/lib/business-os/data-export/csv';
import { buildReadme, cleanBusinessName, isoWithOffset, type ReadmeFacts } from '@/lib/business-os/data-export/readme';
import { isAllowedEntryName } from '@/lib/business-os/data-export/zipEntries';
import { buildZip, type ZipWriterEntry } from '@/lib/business-os/data-export/zipWriter';
import {
  buildExportPayload,
  failedSections as listFailedSections,
  FILE_INDEX_COLUMNS,
  sectionCounts as countSections,
  type ExportFileIndexRow,
} from '@/lib/business-os/data-export/payload';
import { exportColumnsOf, exportDescriptorOfSection } from '@/lib/business-os/data-export/classification';
import { fileIndexRow, newFileBudget, type ExportFileSource, type PlannedFile } from '@/lib/business-os/data-export/fileManifest';
import type {
  AnyExportedSection,
  ExportContext,
  ExportRunResult,
  ExportSectionId,
  SectionRunLogger,
} from '@/lib/business-os/data-export/sections';
import type { BusinessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import type { BusinessOsDataExportStorageRepository } from '@/lib/repositories/BusinessOsDataExportStorageRepository';
import type { DataExportFailureReason, DataExportJob, DataExportJobCounts } from '@/lib/repositories/types';

export interface ZipExportLogger extends SectionRunLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
}

export interface ZipExportDeps {
  jobs: Pick<BusinessOsDataExportJobRepository, 'markReady' | 'markFailed' | 'findById' | 'expireOtherReady'>;
  storage: Pick<BusinessOsDataExportStorageRepository, 'upload' | 'remove'>;
  files: ExportFileSource;
  runSections: (ctx: ExportContext, logger: SectionRunLogger, opts: { rowCeiling: number }) => Promise<ExportRunResult>;
  /** The owner's clock (ownerClock.ts). Never fails: UTC when unknown. */
  ownerClock: (userId: string) => Promise<{ timezone: string; isSet: boolean }>;
  /** Milliseconds; injected so a test can move the clock. */
  now: () => number;
}

export interface ZipExportInput {
  ctx: ExportContext;
  /** From the start RPC, never from a caller. */
  jobId: string;
  /** `now()` when the request began: the 40 s budget counts from here. */
  startedAt: number;
}

export interface ZipExportReady {
  kind: 'ready';
  job: DataExportJob;
  /** Cleaned business name, or null. For the file name and README only: NEVER log or audit it. */
  businessName: string | null;
  timezone: string;
  sectionCounts: Partial<Record<ExportSectionId, number>>;
  failedSections: ExportSectionId[];
  /** Files the owner holds that are not in the zip: unreadable, or a record with no file. */
  missingFiles: number;
  filesIncluded: number;
  sizes: DataExportJobCounts;
  ceilingUsePct: number;
  durationMs: number;
  /** Jobs this export replaced (now `expired`): the caller audits them (SA C-12). */
  replacedJobIds: string[];
}

export interface ZipExportNotReady {
  kind: 'refused' | 'failed';
  reason: DataExportFailureReason;
  measured: Partial<CeilingMeasure>;
  over: CeilingKey[];
  durationMs: number;
}

export type ZipExportOutcome = ZipExportReady | ZipExportNotReady;

const encoder = new TextEncoder();
const BOM = '﻿';

/** C-10 (SA-C10-6): thrown from `buildZip`'s per-entry hook when the time budget is spent. */
class BuildBudgetSpent extends Error {}

/** The steps whose duration goes on the export's events (SA-C10-8). */
type ExportStep = 'inventory' | 'read' | 'download' | 'build' | 'zip' | 'upload';

/** The CSV header of a section: the descriptor's columns (DE-4); account_identity its three. */
export function sectionColumns(id: ExportSectionId): readonly string[] {
  if (id === 'account_identity') return ['id', 'email', 'created_at'];
  return exportColumnsOf(exportDescriptorOfSection(id).table);
}

function sizesOf(measured: Partial<CeilingMeasure>): Partial<DataExportJobCounts> {
  const out: Partial<DataExportJobCounts> = {};
  const bytes = measured.zipBytes ?? measured.fileBytes;
  if (typeof bytes === 'number') out.bytes = Math.max(0, Math.floor(bytes));
  if (typeof measured.fileCount === 'number') out.fileCount = Math.max(0, Math.floor(measured.fileCount));
  if (typeof measured.rows === 'number') out.rowCount = Math.max(0, Math.floor(measured.rows));
  return out;
}

function businessNameOf(sections: readonly AnyExportedSection[]): string | null {
  const profile = sections.find((section) => section.id === 'business_profile');
  if (!profile || profile.status !== 'ok') return null;
  const row = profile.rows[0] as Record<string, unknown> | undefined;
  return cleanBusinessName(row?.company_name);
}

export async function runZipExport(input: ZipExportInput, deps: ZipExportDeps, log: ZipExportLogger): Promise<ZipExportOutcome> {
  const { ctx, jobId, startedAt } = input;
  const userId = ctx.userId;
  const measured: Partial<CeilingMeasure> = {};
  const elapsed = () => deps.now() - startedAt;
  const overTime = () => elapsed() > EXPORT_LIMITS.BUILD_MS_CEILING;
  let uploaded = false;
  let settled = false;
  const stepMs: Partial<Record<ExportStep, number>> = {};
  let stepStart = deps.now();
  /** Close the current step: record its duration and start the next one. */
  const step = (name: ExportStep) => {
    const at = deps.now();
    stepMs[name] = at - stepStart;
    stepStart = at;
  };

  /** Every exit before markReady succeeded (C-1). Settles once. */
  const settle = async (kind: 'refused' | 'failed', reason: DataExportFailureReason, over: CeilingKey[] = []): Promise<ZipExportNotReady> => {
    if (!settled) {
      settled = true;
      const failed = await deps.jobs.markFailed(jobId, userId, reason, sizesOf(measured));
      if (failed.error) log.error({ err: failed.error, userId, jobId, reason }, 'Data export: could not mark the job failed (the stale rule will)');
      if (uploaded) await removeUploaded();
    }
    return { kind, reason, measured: { ...measured }, over, durationMs: elapsed() };
  };

  const removeUploaded = async () => {
    const removed = await deps.storage.remove(userId, jobId);
    if (removed.error) log.error({ err: removed.error, userId, jobId }, 'Data export: could not remove the uploaded zip (the cron sweep will)');
  };

  const refuse = async (over: CeilingKey[]) => {
    log.warn(
      {
        event: 'data_export_over_ceiling',
        userId,
        jobId,
        bytes: measured.zipBytes ?? measured.fileBytes ?? 0,
        files: measured.fileCount ?? 0,
        rows: measured.rows ?? 0,
        over,
        stepMs,
      },
      'Data export refused: over the Phase 1 ceiling'
    );
    return settle('refused', 'over_ceiling', over);
  };

  const timeout = async () => {
    log.warn({ event: 'data_export_timeout', userId, jobId, elapsedMs: elapsed(), stepMs }, 'Data export stopped at its time budget');
    return settle('failed', 'timeout', ['buildMs']);
  };

  try {
    // ── 1. Pre-flight files: list only, nothing downloaded ──────────────────
    const inventoryResult = await deps.files.inventory(userId, newFileBudget(deps.now()), log);
    if (!inventoryResult.ok) return await settle('failed', 'error');
    const inventory = inventoryResult.inventory;
    step('inventory');
    measured.fileCount = inventory.files.length;
    measured.fileBytes = inventory.totalBytes;
    const preflight = ceilingUse({ fileBytes: measured.fileBytes, fileCount: measured.fileCount }).over;
    if (preflight.length > 0) return await refuse(preflight);

    // ── 2. Records: the bounded pass is the row check (SA Q-3) ──────────────
    const run = await deps.runSections(ctx, log, { rowCeiling: EXPORT_LIMITS.ROW_CEILING });
    step('read');
    const rowsRead = run.sections.reduce((sum, section) => sum + section.row_count, 0);
    measured.rows = rowsRead;
    if (run.overCeiling) {
      // Reading stopped as the ceiling was passed, so the total is unknown: the
      // rows recorded are the ones read before it, and `over` says which ceiling.
      return await refuse(['rows']);
    }
    const sections = run.sections;

    // ── 3. Time budget before the heavy part ────────────────────────────────
    if (overTime()) return await timeout();

    // ── 4. Downloads (SA C-9: no new download after the budget) ─────────────
    const planned = inventory.files;
    const bytesOf: Array<Uint8Array | null> = new Array(planned.length).fill(null);
    let next = 0;
    let realBytes = 0;
    let stop: 'timeout' | 'over' | null = null;
    const worker = async () => {
      while (stop === null) {
        const index = next;
        next += 1;
        if (index >= planned.length) return;
        if (overTime()) {
          stop = 'timeout';
          return;
        }
        const data = await deps.files.download(userId, planned[index]);
        if (!data) continue;
        realBytes += data.byteLength;
        if (realBytes > EXPORT_LIMITS.FILE_BYTES_CEILING) {
          stop = 'over';
          return;
        }
        bytesOf[index] = data;
      }
    };
    const workers = Math.min(EXPORT_LIMITS.FILE_DOWNLOAD_CONCURRENCY, planned.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (stop === 'over') {
      measured.fileBytes = realBytes;
      return await refuse(['fileBytes']);
    }
    if (stop === 'timeout') return await timeout();
    measured.fileBytes = realBytes;
    step('download');

    // ── 5. Build ────────────────────────────────────────────────────────────
    const { timezone, isSet } = await deps.ownerClock(userId);
    const businessName = businessNameOf(sections);
    const startedAtDate = new Date(startedAt);
    const indexRows: ExportFileIndexRow[] = planned.map((file: PlannedFile, i) => {
      const data = bytesOf[i];
      return data ? { ...fileIndexRow(file, 'included'), size_bytes: data.byteLength } : fileIndexRow(file, 'could_not_be_read');
    });
    const couldNotBeRead = indexRows.filter((row) => row.status === 'could_not_be_read').length;
    const filesIncluded = indexRows.length - couldNotBeRead;

    const payload = buildExportPayload({
      userId,
      now: startedAtDate,
      sections,
      durationMs: elapsed(),
      zip: { accountHolderName: businessName, files: indexRows },
    });
    const readmeFacts: ReadmeFacts = {
      businessName,
      startedAtUtc: startedAtDate.toISOString(),
      startedAtLocal: isoWithOffset(startedAtDate, timezone),
      timezone,
      timezoneSet: isSet,
      sections: sections.map((section) => ({ id: section.id, group: section.group, rowCount: section.row_count, status: section.status })),
      files: {
        included: filesIncluded,
        couldNotBeRead,
        recordsWithoutFile: inventory.recordsWithoutFile,
        filesWithoutRecord: inventory.filesWithoutRecord,
        deletedDocumentFiles: inventory.orphanSkipped,
      },
    };

    // Fixed order (SA C-14): README, README-he, data.json, records in section
    // order, files-index.csv, then the files in inventory order.
    const entries: ZipWriterEntry[] = [];
    const names = new Set<string>();
    let textBytes = 0;
    const add = (name: string, data: Uint8Array, method: ZipWriterEntry['method']) => {
      // SA C-4: the last check before an entry is written.
      if (!isAllowedEntryName(name)) throw new Error('data export: an entry name failed the allow-list');
      if (names.has(name)) throw new Error('data export: duplicate entry name');
      names.add(name);
      if (method === 'deflate') textBytes += data.byteLength;
      entries.push({ name, data, method });
    };
    add('README.txt', encoder.encode(BOM + buildReadme('en', readmeFacts)), 'deflate');
    add('README-he.txt', encoder.encode(BOM + buildReadme('he', readmeFacts)), 'deflate');
    // C-10 P-2: no indentation (-30% raw bytes at the ceiling); the same JSON value, format_version 2.
    add('data.json', encoder.encode(JSON.stringify(payload)), 'deflate');
    for (const section of sections) {
      // FR-E12: a failed section still gets its CSV, header row only.
      add(`records/${section.group}/${section.id}.csv`, toCsv(sectionColumns(section.id), section.rows as Record<string, unknown>[]), 'deflate');
    }
    add('files-index.csv', toCsv(FILE_INDEX_COLUMNS, indexRows as unknown as Record<string, unknown>[]), 'deflate');
    planned.forEach((file, i) => {
      const data = bytesOf[i];
      if (data) add(file.entryPath, data, 'store');
    });
    step('build');

    if (overTime()) return await timeout();
    let zip: Uint8Array;
    try {
      zip = buildZip(entries, {
        mtime: startedAtDate,
        // SA-C10-6: a slow function stops between entries, not after the whole zip.
        beforeEntry: () => {
          if (overTime()) throw new BuildBudgetSpent();
        },
      });
    } catch (err) {
      if (err instanceof BuildBudgetSpent) {
        step('zip');
        return await timeout();
      }
      throw err;
    }
    step('zip');
    measured.zipBytes = zip.byteLength;

    // ── 6. Finished size and time, BEFORE upload ────────────────────────────
    if (measured.zipBytes > EXPORT_LIMITS.ZIP_BYTES_CEILING) return await refuse(['zipBytes']);
    if (overTime()) return await timeout();

    // ── 7. Upload ───────────────────────────────────────────────────────────
    const upload = await deps.storage.upload(userId, jobId, zip);
    if (upload.error) {
      // An upload error can still have written the object: remove it (idempotent).
      uploaded = true;
      return await settle('failed', 'error');
    }
    uploaded = true;
    step('upload');

    // ── 8. markReady (SA C-2) ───────────────────────────────────────────────
    const sizes: DataExportJobCounts = { bytes: zip.byteLength, fileCount: filesIncluded, rowCount: measured.rows };
    const ready = await deps.jobs.markReady(jobId, userId, sizes);
    let job: DataExportJob | null = ready.data;
    if (ready.error) {
      const reread = await deps.jobs.findById(jobId, userId);
      if (reread.error) {
        // Unknown state: never remove the file of a job that may be ready.
        settled = true;
        const failed = await deps.jobs.markFailed(jobId, userId, 'error', sizesOf(measured));
        if (failed.data) await removeUploaded();
        log.error({ err: ready.error, userId, jobId }, 'Data export: markReady and the re-read both failed');
        return { kind: 'failed', reason: 'error', measured: { ...measured }, over: [], durationMs: elapsed() };
      }
      const status = reread.data?.status;
      if (status === 'ready' && reread.data) {
        job = reread.data;
      } else if (status === 'running') {
        return await settle('failed', 'error');
      } else {
        settled = true;
        await removeUploaded();
        return { kind: 'failed', reason: 'timeout', measured: { ...measured }, over: [], durationMs: elapsed() };
      }
    } else if (!job) {
      // No longer running: the stale rule took it.
      settled = true;
      await removeUploaded();
      log.warn({ userId, jobId }, 'Data export: the job was no longer running at markReady (stale rule)');
      return { kind: 'failed', reason: 'timeout', measured: { ...measured }, over: [], durationMs: elapsed() };
    }
    settled = true;

    // ── 9. A newer export replaces the old ones of its kind (best effort) ──
    let replacedJobIds: string[] = [];
    try {
      // SA-4: the kind from the row markReady (or the re-read) returned.
      const readyJob = job as DataExportJob;
      const replaced = await deps.jobs.expireOtherReady(userId, jobId, readyJob.requested_by_kind);
      if (replaced.error) {
        log.warn({ err: replaced.error, userId, jobId }, 'Data export: older exports not expired (the cron sweep will)');
      } else {
        replacedJobIds = replaced.data ?? [];
        for (const oldJobId of replacedJobIds) {
          const removed = await deps.storage.remove(userId, oldJobId);
          if (removed.error) log.warn({ userId, jobId: oldJobId }, 'Data export: replaced zip not removed (the cron sweep will)');
        }
      }
    } catch (err) {
      log.warn({ err, userId, jobId }, 'Data export: replacing older exports failed (the cron sweep will)');
    }

    const use = ceilingUse({ ...measured, buildMs: elapsed() });
    const outcome: ZipExportReady = {
      kind: 'ready',
      job: job as DataExportJob,
      businessName,
      timezone,
      sectionCounts: countSections(sections),
      failedSections: listFailedSections(sections),
      missingFiles: couldNotBeRead + inventory.recordsWithoutFile,
      filesIncluded,
      sizes,
      ceilingUsePct: use.pct,
      durationMs: elapsed(),
      replacedJobIds,
    };
    const facts = {
      userId,
      jobId,
      bytes: sizes.bytes,
      files: sizes.fileCount,
      rows: sizes.rowCount,
      missingFiles: outcome.missingFiles,
      failedSections: outcome.failedSections.length,
      ceilingUsePct: use.pct,
      durationMs: outcome.durationMs,
    };
    log.info({ event: 'data_export_ready', ...facts, stepMs, textBytes }, 'Data export ready');
    if (isNearCeiling(use)) log.warn({ event: 'data_export_near_ceiling', ...facts }, 'Data export is near the Phase 1 ceiling');
    return outcome;
  } catch (err) {
    log.error({ err, userId, jobId }, 'Data export build failed');
    if (settled) return { kind: 'failed', reason: 'error', measured: { ...measured }, over: [], durationMs: elapsed() };
    return settle('failed', 'error');
  }
}
