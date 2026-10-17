/**
 * DE-8b T-6 + T-11 (workplan §3.2, §6; SA C-1, C-2, C-4, C-9, C-14, C-15):
 * the one-request zip builder. Every dependency is injected; fixtures are
 * KB-sized (C-15: the 40 MiB memory spike is local, recorded in the workplan).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { unzipSync } from 'fflate';
import { EXPORT_SECTIONS, type AnyExportedSection, type ExportContext, type ExportRunResult } from '../sections';
import { EXPORT_LIMITS } from '../limits';
import { runZipExport, sectionColumns, type ZipExportDeps, type ZipExportLogger } from '../zipExport';
import type { ExportFileSource, FileInventory, PlannedFile } from '../fileManifest';
import { isAllowedEntryName } from '../zipEntries';
import type { DataExportJob } from '@/lib/repositories/types';

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OLD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CONTACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BUSINESS = 'סטודיו נוגה';
const START = Date.parse('2026-10-17T06:30:00.000Z');

const ctx: ExportContext = { userId: USER, authUser: { id: USER, email: 'owner@example.com', created_at: '2026-01-01T00:00:00Z' } };

const JOB_ROW: DataExportJob = {
  id: JOB,
  user_id: USER,
  requested_by: USER,
  requested_by_kind: 'owner',
  status: 'ready',
  failure_reason: null,
  bytes: 1,
  file_count: 2,
  row_count: 3,
  created_at: '2026-10-17T06:30:00.000Z',
  finished_at: '2026-10-17T06:30:05.000Z',
  ready_at: '2026-10-17T06:30:05.000Z',
  expires_at: '2026-10-20T06:30:05.000Z',
  expired_at: null,
  owner_downloaded_at: null,
  updated_at: '2026-10-17T06:30:05.000Z',
};

function sectionsFixture(overrides: Partial<Record<string, AnyExportedSection>> = {}): AnyExportedSection[] {
  return EXPORT_SECTIONS.map((def) => {
    const head = { id: def.id, group: def.group, gdpr_role: def.gdprRole };
    if (overrides[def.id]) return overrides[def.id]!;
    if (def.id === 'account_identity') return { ...head, status: 'ok' as const, row_count: 1, rows: [{ id: USER, email: 'owner@example.com', created_at: '2026-01-01T00:00:00Z' }] };
    if (def.id === 'business_profile') return { ...head, status: 'ok' as const, row_count: 1, rows: [{ id: 'bp1', company_name: BUSINESS }] };
    if (def.id === 'clients') return { ...head, status: 'ok' as const, row_count: 1, rows: [{ id: 'k1', name: 'Dana', phone: '+972501234567' }] };
    return { ...head, status: 'ok' as const, row_count: 0, rows: [] };
  });
}

const DOC: PlannedFile = {
  bucket: 'contact-documents',
  key: `${USER}/${CONTACT}/1_________.pdf`,
  entryPath: `files/client-documents/${CONTACT}/חוזה לקוח.pdf`,
  folder: 'client-documents',
  sizeBytes: 4,
  contentType: 'application/pdf',
  recordSection: 'client_documents',
  recordId: 'd1',
};
const IMG: PlannedFile = {
  bucket: 'website-images',
  key: `${USER}/logo/l.png`,
  entryPath: 'files/website-images/logo/l.png',
  folder: 'website-images',
  sizeBytes: 3,
  contentType: 'image/png',
  recordSection: '',
  recordId: '',
};

function inventoryOf(files: PlannedFile[], extra: Partial<FileInventory> = {}): FileInventory {
  return {
    files,
    totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
    recordsWithoutFile: 0,
    orphanSkipped: 0,
    filesWithoutRecord: 0,
    rejectedPaths: 0,
    ...extra,
  };
}

interface Harness {
  deps: ZipExportDeps;
  log: ZipExportLogger & { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  clock: { now: number };
  jobs: { markReady: jest.Mock; markFailed: jest.Mock; findById: jest.Mock; expireOtherReady: jest.Mock };
  storage: { upload: jest.Mock; remove: jest.Mock };
  files: { inventory: jest.Mock; download: jest.Mock };
  runSections: jest.Mock;
}

function harness(opts: { files?: PlannedFile[]; inventory?: Partial<FileInventory>; bytes?: Record<string, Uint8Array | null>; sections?: ExportRunResult } = {}): Harness {
  const clock = { now: START };
  const files = opts.files ?? [DOC, IMG];
  const bytes: Record<string, Uint8Array | null> = opts.bytes ?? {
    [DOC.key]: new Uint8Array([37, 80, 68, 70]),
    [IMG.key]: new Uint8Array([137, 80, 78]),
  };
  const jobs = {
    markReady: jest.fn(async () => ({ data: JOB_ROW, error: null })),
    markFailed: jest.fn(async () => ({ data: { ...JOB_ROW, status: 'failed' }, error: null })),
    findById: jest.fn(async () => ({ data: JOB_ROW, error: null })),
    expireOtherReady: jest.fn(async () => ({ data: [], error: null })),
  };
  const storage = {
    upload: jest.fn(async () => ({ data: true, error: null })),
    remove: jest.fn(async () => ({ data: true, error: null })),
  };
  const fileSource = {
    includedBuckets: () => [
      { bucket: 'contact-documents', folder: 'client-documents' },
      { bucket: 'website-images', folder: 'website-images' },
    ],
    inventory: jest.fn(async () => ({ ok: true as const, inventory: inventoryOf(files, opts.inventory) })),
    download: jest.fn(async (_u: string, f: PlannedFile) => bytes[f.key] ?? null),
    listOwnerFolders: jest.fn(async () => null),
  };
  const runSections = jest.fn(async () => opts.sections ?? { overCeiling: false as const, sections: sectionsFixture() });
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    deps: {
      jobs: jobs as unknown as ZipExportDeps['jobs'],
      storage: storage as unknown as ZipExportDeps['storage'],
      files: fileSource as unknown as ExportFileSource,
      runSections: runSections as unknown as ZipExportDeps['runSections'],
      ownerClock: async () => ({ timezone: 'Asia/Jerusalem', isSet: true }),
      now: () => clock.now,
    },
    log,
    clock,
    jobs,
    storage,
    files: fileSource,
    runSections,
  };
}

const run = (h: Harness) => runZipExport({ ctx, jobId: JOB, startedAt: START }, h.deps, h.log);
const uploadedZip = (h: Harness) => (h.storage.upload.mock.calls[0] as unknown[])[2] as Uint8Array;

/** Run with one EXPORT_LIMITS value lowered, then restore it. */
async function withLimit<T>(key: keyof typeof EXPORT_LIMITS, value: number, body: () => Promise<T>): Promise<T> {
  // `as const` is compile-time only; the object is writable at runtime (limits.ts: "a test can lower one").
  const limits = EXPORT_LIMITS as unknown as Record<string, number>;
  const saved = limits[key];
  limits[key] = value;
  try {
    return await body();
  } finally {
    limits[key] = saved;
  }
}

const allLogText = (h: Harness) => JSON.stringify([h.log.info.mock.calls, h.log.warn.mock.calls, h.log.error.mock.calls]);

describe('happy path', () => {
  it('builds, uploads and marks ready; the zip has the fixed layout and every entry passes the allow-list (C-4)', async () => {
    const h = harness();
    const outcome = await run(h);
    expect(outcome.kind).toBe('ready');
    expect(h.storage.upload).toHaveBeenCalledTimes(1);
    expect(h.jobs.markFailed).not.toHaveBeenCalled();
    const entries = unzipSync(uploadedZip(h));
    const names = Object.keys(entries);
    for (const name of names) {
      expect(isAllowedEntryName(name)).toBe(true);
      expect(name.split('/')).not.toContain('..');
      expect(name).not.toMatch(/^\/|\\|^[A-Za-z]:/);
    }
    // C-14: fixed order.
    expect(names.slice(0, 3)).toEqual(['README.txt', 'README-he.txt', 'data.json']);
    const csvs = names.filter((n) => n.startsWith('records/'));
    expect(csvs).toEqual(EXPORT_SECTIONS.map((s) => `records/${s.group}/${s.id}.csv`));
    expect(csvs).toHaveLength(39);
    expect(names[3 + 39]).toBe('files-index.csv');
    expect(names.slice(3 + 39 + 1)).toEqual([DOC.entryPath, IMG.entryPath]);
  });

  it('files are byte-for-byte, data.json parses as the ZIP format with the business as controller', async () => {
    const h = harness();
    await run(h);
    const entries = unzipSync(uploadedZip(h));
    expect(Array.from(entries[DOC.entryPath])).toEqual([37, 80, 68, 70]);
    expect(Array.from(entries[IMG.entryPath])).toEqual([137, 80, 78]);
    const data = JSON.parse(new TextDecoder().decode(entries['data.json']));
    expect(data.export_metadata.export_format).toBe('ZIP');
    expect(data.export_metadata.format_version).toBe(2);
    expect(data.export_metadata.groups.client_records.controller).toBe(BUSINESS);
    expect(data.export_metadata.groups.account.controller).toBe('AgentPilot');
    expect(data.files).toHaveLength(2);
    expect(JSON.stringify(data.files)).not.toContain(`${USER}/`);
    // data.json keeps the exact value; the CSV neutralises it (BC-1).
    expect(JSON.stringify(data)).toContain('"+972501234567"');
    const clients = new TextDecoder().decode(entries['records/client_records/clients.csv']);
    expect(clients).toContain("'+972501234567");
  });

  it('READMEs: BOM, both languages, the business name', async () => {
    const h = harness();
    await run(h);
    const entries = unzipSync(uploadedZip(h));
    for (const name of ['README.txt', 'README-he.txt']) {
      expect(Array.from(entries[name].slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      expect(new TextDecoder().decode(entries[name])).toContain(BUSINESS);
    }
    expect(new TextDecoder().decode(entries['README-he.txt'])).toContain('ייצוא הנתונים שלך');
  });

  it('T-6: the UTF-8 name flag (bit 11) is set on the Hebrew entry, and the stored file is not deflated', async () => {
    const h = harness();
    await run(h);
    const zip = uploadedZip(h);
    const target = new TextEncoder().encode(DOC.entryPath);
    let found = false;
    for (let i = 0; i + 30 < zip.length; i += 1) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x03 && zip[i + 3] === 0x04) {
        const nameLen = zip[i + 26] | (zip[i + 27] << 8);
        const name = zip.slice(i + 30, i + 30 + nameLen);
        if (name.length === target.length && name.every((b, k) => b === target[k])) {
          const flags = zip[i + 6] | (zip[i + 7] << 8);
          const method = zip[i + 8] | (zip[i + 9] << 8);
          expect(flags & 0x0800).toBe(0x0800);
          expect(method).toBe(0);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('records the ready sizes and replaces older exports (their objects removed; ids returned for audit)', async () => {
    const h = harness();
    h.jobs.expireOtherReady.mockResolvedValueOnce({ data: [OLD], error: null });
    const outcome = await run(h);
    if (outcome.kind !== 'ready') throw new Error('expected ready');
    expect(h.jobs.markReady).toHaveBeenCalledWith(JOB, USER, { bytes: uploadedZip(h).byteLength, fileCount: 2, rowCount: 3 });
    expect(h.storage.remove).toHaveBeenCalledWith(USER, OLD);
    expect(h.storage.remove).not.toHaveBeenCalledWith(USER, JOB);
    expect(outcome.replacedJobIds).toEqual([OLD]);
    expect(outcome.businessName).toBe(BUSINESS);
  });

  it('logs ids and counts only: no business name, no file name, no email', async () => {
    const h = harness();
    await run(h);
    const text = allLogText(h);
    expect(text).not.toContain(BUSINESS);
    expect(text).not.toContain('חוזה');
    expect(text).not.toContain('owner@example.com');
    expect(text).not.toContain('l.png');
    expect(text).toContain('data_export_ready');
  });

  it('is deterministic: two builds of the same data have the same entries in the same order (C-14)', async () => {
    const a = harness();
    const b = harness();
    await run(a);
    await run(b);
    expect(Object.keys(unzipSync(uploadedZip(a)))).toEqual(Object.keys(unzipSync(uploadedZip(b))));
  });
});

describe('partial content', () => {
  it('FR-E12: a failed section is a header-only CSV and failed in data.json', async () => {
    const failed: AnyExportedSection = { id: 'invoices', group: 'client_records', gdpr_role: 'processor', status: 'failed', row_count: 0, rows: [] };
    const h = harness({ sections: { overCeiling: false, sections: sectionsFixture({ invoices: failed }) } });
    const outcome = await run(h);
    if (outcome.kind !== 'ready') throw new Error('expected ready');
    expect(outcome.failedSections).toEqual(['invoices']);
    const entries = unzipSync(uploadedZip(h));
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(entries['records/client_records/invoices.csv']);
    expect(csv).toBe(`﻿${sectionColumns('invoices').join(',')}\r\n`);
    const data = JSON.parse(new TextDecoder().decode(entries['data.json']));
    expect(data.sections.find((s: { id: string }) => s.id === 'invoices').status).toBe('failed');
  });

  it('BC-5: an unreadable file is could_not_be_read and the export is still ready', async () => {
    const h = harness({ bytes: { [DOC.key]: null, [IMG.key]: new Uint8Array([1]) } });
    const outcome = await run(h);
    if (outcome.kind !== 'ready') throw new Error('expected ready');
    expect(outcome.missingFiles).toBe(1);
    const entries = unzipSync(uploadedZip(h));
    expect(entries[DOC.entryPath]).toBeUndefined();
    const index = new TextDecoder().decode(entries['files-index.csv']);
    expect(index).toContain('could_not_be_read');
    expect(index).toContain('included');
  });

  it('no business name: the account holder stays the controller', async () => {
    const profile: AnyExportedSection = { id: 'business_profile', group: 'account', gdpr_role: 'controller', status: 'ok', row_count: 0, rows: [] };
    const h = harness({ sections: { overCeiling: false, sections: sectionsFixture({ business_profile: profile }) } });
    const outcome = await run(h);
    if (outcome.kind !== 'ready') throw new Error('expected ready');
    expect(outcome.businessName).toBeNull();
    const data = JSON.parse(new TextDecoder().decode(unzipSync(uploadedZip(h))['data.json']));
    expect(data.export_metadata.groups.client_records.controller).toBe('account_holder');
  });
});

describe('ceilings: refused BEFORE heavy work, no upload, markFailed once', () => {
  const expectRefusedNoUpload = (h: Harness, reason: string) => {
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(h.jobs.markReady).not.toHaveBeenCalled();
    expect(h.jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(h.jobs.markFailed.mock.calls[0][2]).toBe(reason);
  };

  it('file count over 150 (pre-flight): no download, no records read', async () => {
    const many = Array.from({ length: 151 }, (_, i) => ({ ...IMG, key: `${USER}/i${i}.png`, entryPath: `files/website-images/i${i}.png` }));
    const h = harness({ files: many });
    const outcome = await run(h);
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'over_ceiling', over: ['fileCount'] });
    expect(h.files.download).not.toHaveBeenCalled();
    expect(h.runSections).not.toHaveBeenCalled();
    expectRefusedNoUpload(h, 'over_ceiling');
    expect(h.log.warn.mock.calls.some((c) => (c[0] as { event?: string }).event === 'data_export_over_ceiling')).toBe(true);
  });

  it('file bytes over 40 MiB on the listing (pre-flight)', async () => {
    const h = harness({ files: [{ ...DOC, sizeBytes: EXPORT_LIMITS.FILE_BYTES_CEILING + 1 }] });
    expect(await run(h)).toMatchObject({ kind: 'refused', over: ['fileBytes'] });
    expect(h.files.download).not.toHaveBeenCalled();
    expectRefusedNoUpload(h, 'over_ceiling');
  });

  it('rows over the ceiling: no download', async () => {
    const h = harness({ sections: { overCeiling: true, sections: [], atSection: 'clients' } });
    expect(await run(h)).toMatchObject({ kind: 'refused', over: ['rows'] });
    expect(h.files.download).not.toHaveBeenCalled();
    expectRefusedNoUpload(h, 'over_ceiling');
  });

  it('metadata says small, real bytes push past 40 MiB: refused before the zip', async () => {
    await withLimit('FILE_BYTES_CEILING', 5, async () => {
      // The listing reports 0 bytes so the pre-flight passes; only the real downloaded bytes trip the ceiling (QA DE-8b Bug 1).
      const h = harness({ inventory: { totalBytes: 0 } });
      expect(await run(h)).toMatchObject({ kind: 'refused', over: ['fileBytes'] });
      expect(h.files.download).toHaveBeenCalled();
      expectRefusedNoUpload(h, 'over_ceiling');
    });
  });

  it('the finished zip over 45 MiB: nothing uploaded', async () => {
    await withLimit('ZIP_BYTES_CEILING', 100, async () => {
      const h = harness();
      expect(await run(h)).toMatchObject({ kind: 'refused', over: ['zipBytes'] });
      expectRefusedNoUpload(h, 'over_ceiling');
    });
  });
});

describe('time budget (SA Q-5, C-9)', () => {
  it('over 40 s before the downloads: timeout, nothing downloaded or uploaded', async () => {
    const h = harness();
    h.runSections.mockImplementationOnce(async () => {
      h.clock.now = START + EXPORT_LIMITS.BUILD_MS_CEILING + 1;
      return { overCeiling: false, sections: sectionsFixture() };
    });
    expect(await run(h)).toMatchObject({ kind: 'failed', reason: 'timeout' });
    expect(h.files.download).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(h.jobs.markFailed.mock.calls[0][2]).toBe('timeout');
  });

  it('C-9: no new download starts once the budget is spent mid-loop', async () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ ...IMG, key: `${USER}/i${i}.png`, entryPath: `files/website-images/i${i}.png` }));
    const h = harness({ files, bytes: Object.fromEntries(files.map((f) => [f.key, new Uint8Array([1])])) });
    h.files.download.mockImplementation(async () => {
      h.clock.now = START + EXPORT_LIMITS.BUILD_MS_CEILING + 1;
      return new Uint8Array([1]);
    });
    expect(await run(h)).toMatchObject({ kind: 'failed', reason: 'timeout' });
    // At most one download per worker was in flight when the budget ran out.
    expect(h.files.download.mock.calls.length).toBeLessThanOrEqual(EXPORT_LIMITS.FILE_DOWNLOAD_CONCURRENCY);
    expect(h.storage.upload).not.toHaveBeenCalled();
  });
});

describe('the failure invariant (SA C-1, C-2)', () => {
  it('inventory error: failed / error, markFailed once, nothing uploaded', async () => {
    const h = harness();
    h.files.inventory.mockResolvedValueOnce({ ok: false, reason: 'truncated' });
    expect(await run(h)).toMatchObject({ kind: 'failed', reason: 'error' });
    expect(h.jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(h.storage.remove).not.toHaveBeenCalled();
  });

  it('upload error: markFailed + the (possibly written) object removed', async () => {
    const h = harness();
    h.storage.upload.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    expect(await run(h)).toMatchObject({ kind: 'failed', reason: 'error' });
    expect(h.jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(h.storage.remove).toHaveBeenCalledWith(USER, JOB);
    expect(h.jobs.markReady).not.toHaveBeenCalled();
  });

  it('markReady null (the stale rule took it): object removed, timeout, no markFailed', async () => {
    const h = harness();
    h.jobs.markReady.mockResolvedValueOnce({ data: null, error: null });
    expect(await run(h)).toMatchObject({ kind: 'failed', reason: 'timeout' });
    expect(h.storage.remove).toHaveBeenCalledWith(USER, JOB);
    expect(h.jobs.markFailed).not.toHaveBeenCalled();
  });

  it('C-2: markReady error, re-read says ready: success', async () => {
    const h = harness();
    h.jobs.markReady.mockResolvedValueOnce({ data: null, error: new Error('response lost') });
    h.jobs.findById.mockResolvedValueOnce({ data: JOB_ROW, error: null });
    const outcome = await run(h);
    expect(outcome.kind).toBe('ready');
    expect(h.jobs.findById).toHaveBeenCalledWith(JOB, USER);
    expect(h.storage.remove).not.toHaveBeenCalledWith(USER, JOB);
    expect(h.jobs.markFailed).not.toHaveBeenCalled();
  });

  it('C-2: markReady error, re-read says running: markFailed + remove', async () => {
    const h = harness();
    h.jobs.markReady.mockResolvedValueOnce({ data: null, error: new Error('x') });
    h.jobs.findById.mockResolvedValueOnce({ data: { ...JOB_ROW, status: 'running' }, error: null });
    expect(await run(h)).toMatchObject({ kind: 'failed', reason: 'error' });
    expect(h.jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(h.storage.remove).toHaveBeenCalledWith(USER, JOB);
  });

  it('C-2: markReady error, re-read says failed (or gone): remove + timeout', async () => {
    for (const data of [{ ...JOB_ROW, status: 'failed' }, null]) {
      const h = harness();
      h.jobs.markReady.mockResolvedValueOnce({ data: null, error: new Error('x') });
      h.jobs.findById.mockResolvedValueOnce({ data, error: null });
      expect(await run(h)).toMatchObject({ kind: 'failed', reason: 'timeout' });
      expect(h.storage.remove).toHaveBeenCalledWith(USER, JOB);
      expect(h.jobs.markFailed).not.toHaveBeenCalled();
    }
  });

  it('C-2: markReady AND the re-read fail: markFailed tried; remove only when it took', async () => {
    const took = harness();
    took.jobs.markReady.mockResolvedValueOnce({ data: null, error: new Error('x') });
    took.jobs.findById.mockResolvedValueOnce({ data: null, error: new Error('y') });
    expect(await run(took)).toMatchObject({ kind: 'failed', reason: 'error' });
    expect(took.storage.remove).toHaveBeenCalledWith(USER, JOB);

    const didNot = harness();
    didNot.jobs.markReady.mockResolvedValueOnce({ data: null, error: new Error('x') });
    didNot.jobs.findById.mockResolvedValueOnce({ data: null, error: new Error('y') });
    didNot.jobs.markFailed.mockResolvedValueOnce({ data: null, error: null });
    expect(await run(didNot)).toMatchObject({ kind: 'failed', reason: 'error' });
    expect(didNot.storage.remove).not.toHaveBeenCalled();
  });

  it('a throw inside the build settles as error (markFailed once)', async () => {
    const h = harness();
    h.runSections.mockRejectedValueOnce(new Error('defect'));
    expect(await run(h)).toMatchObject({ kind: 'failed', reason: 'error' });
    expect(h.jobs.markFailed).toHaveBeenCalledTimes(1);
  });

  it('a failing remove of a replaced export never fails the ready export', async () => {
    const h = harness();
    h.jobs.expireOtherReady.mockResolvedValueOnce({ data: [OLD], error: null });
    h.storage.remove.mockResolvedValueOnce({ data: null, error: new Error('x') });
    expect((await run(h)).kind).toBe('ready');
  });
});

describe('DE-10a (SA-4, T-20): a newer export replaces only older ready exports of its own kind', () => {
  it.each(['owner', 'admin'] as const)('a ready %s job passes its own kind, read from the markReady row', async (kind) => {
    const h = harness();
    h.jobs.markReady.mockResolvedValueOnce({ data: { ...JOB_ROW, requested_by_kind: kind }, error: null });
    expect((await run(h)).kind).toBe('ready');
    expect(h.jobs.expireOtherReady).toHaveBeenCalledTimes(1);
    expect(h.jobs.expireOtherReady).toHaveBeenCalledWith(USER, JOB, kind);
  });

  it('after an ambiguous markReady, the kind comes from the re-read row', async () => {
    const h = harness();
    h.jobs.markReady.mockResolvedValueOnce({ data: null, error: new Error('lost answer') });
    h.jobs.findById.mockResolvedValueOnce({ data: { ...JOB_ROW, requested_by_kind: 'admin' }, error: null });
    expect((await run(h)).kind).toBe('ready');
    expect(h.jobs.expireOtherReady).toHaveBeenCalledWith(USER, JOB, 'admin');
  });

  it('runZipExport takes no kind from its caller (source pin)', () => {
    const source = readFileSync(join(process.cwd(), 'lib/business-os/data-export/zipExport.ts'), 'utf8');
    const input = source.slice(source.indexOf('export interface ZipExportInput'), source.indexOf('export interface ZipExportReady'));
    expect(input).not.toMatch(/kind/i);
    expect(source).toContain('deps.jobs.expireOtherReady(userId, jobId, readyJob.requested_by_kind)');
  });
});
