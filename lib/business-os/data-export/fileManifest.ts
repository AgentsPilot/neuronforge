// lib/business-os/data-export/fileManifest.ts
//
// DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §9; SA Q-13, Q-16, C-4,
// C-5, C-6, C-11, C-14): "Your files": which of the owner's stored files go
// in the zip, under which names, linked to which record.
//
// THE ONE IMPORTER of BusinessDataExportFilesRepository (F-6, SA C-6). The
// cron's size watch calls `createExportFileSource().inventory(...)` from here,
// so the export and the watch can never disagree about what counts (C-11).
//
// Inventory, per STORAGE_DESCRIPTORS `include` bucket (descriptor order):
// - every object under `${userId}/` (the repository walks from that prefix
//   only and re-checks every name; uuid-validated id, SA C-5);
// - `contact-documents`: THE ROWS are the authority (C-11 of DE-4). An object
//   is in only when a LIVE contact_documents row (status <> 'deleted', the
//   owner's) has `storage_path` equal to its key and `storage_bucket` equal to
//   the bucket (or NULL, the default). Objects of deleted or missing rows are
//   skipped and COUNTED, never named. A live row with no object, or whose
//   client id is not a uuid (never used as a folder, SA C-4), counts as a
//   record without a file. A row pointing outside `${userId}/` can never match:
//   the walk never lists it (the crossed-pointer test).
//   Entry: `files/client-documents/<contact_id>/<clean(file_name)>`: the
//   ORIGINAL upload name (Hebrew survives; SA Q-13). `file_name` is chosen by
//   the public intake uploader, so `cleanSegment` is a security control (C-4).
// - `website-images`: THE LISTING is the authority (Q10b, TL default BC-4):
//   every object in the owner's folder is in; `user_media` rows link the ones
//   that have a record, the others have an empty link.
//   Entry: `files/website-images/<clean(each segment below the owner folder)>`.
// - A bucket included without a rule here fails the inventory (fail closed).
// - The listing budget is shared by both buckets; running out fails the
//   export (`truncated`, SA Q-16): "Your files" is never offered as complete
//   when it is not.
//
// Deterministic (SA C-14): files are ordered by record id, then key, before
// names are claimed, so the ` (2)` suffixes are stable between two exports of
// the same data.
//
// `storage_path` and the storage key are internal: files-index.csv and
// data.json hold the zip path only. Logs carry ids and counts only.
//
// Server-only: it imports a repository.

import 'server-only';
import { STORAGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import { EXPORT_LIMITS } from '@/lib/business-os/data-export/limits';
import { EntryNamer, cleanSegment, joinEntry } from '@/lib/business-os/data-export/zipEntries';
import type { ExportFileIndexRow } from '@/lib/business-os/data-export/payload';
import {
  businessDataExportFilesRepository,
  type BusinessDataExportFilesRepository,
} from '@/lib/repositories/BusinessDataExportFilesRepository';
import type { ExportFileBudget } from '@/lib/repositories/types';

// Lower case only: Supabase auth ids and Postgres uuids are printed in lower case, and an id
// in any other shape is never used as a prefix or a folder.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** How each included bucket decides what is "yours". */
type BucketRule = 'live_document_rows' | 'listing_with_media_links';

const BUCKET_RULES: Readonly<Record<string, BucketRule>> = {
  'contact-documents': 'live_document_rows',
  'website-images': 'listing_with_media_links',
};

export interface PlannedFile {
  bucket: string;
  /** Internal storage key, `${userId}/...`. Never written to the zip, a CSV or a log. */
  key: string;
  /** The zip entry name, `files/<folder>/...`. */
  entryPath: string;
  folder: string;
  /** From the listing; 0 when unknown (real bytes are counted on download). */
  sizeBytes: number;
  contentType: string;
  recordSection: ExportFileIndexRow['record_section'];
  recordId: string;
}

export interface FileInventory {
  files: PlannedFile[];
  /** Sum of the listing sizes of `files`. */
  totalBytes: number;
  /** Live document records with no file in the zip (no object, or an unusable client id). */
  recordsWithoutFile: number;
  /** Stored document files with no live record: skipped (C-11). */
  orphanSkipped: number;
  /** Pictures included with no picture-library record (Q10b). */
  filesWithoutRecord: number;
  /** Names the repository dropped as unsafe (should be 0). */
  rejectedPaths: number;
}

export type InventoryResult =
  | { ok: true; inventory: FileInventory }
  | { ok: false; reason: 'truncated' | 'error' };

/** Only what the manifest uses, so a test can hand in a fake. */
export type ExportFilesRepositoryPort = Pick<
  BusinessDataExportFilesRepository,
  'listOwnerObjects' | 'downloadOwnerObject' | 'listLiveDocumentFiles' | 'listMediaPaths' | 'listOwnerFolders'
>;

export interface ManifestLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export interface ExportFileSource {
  /** The include buckets, descriptor order. */
  includedBuckets(): Array<{ bucket: string; folder: string }>;
  inventory(userId: string, budget: ExportFileBudget, log: ManifestLogger): Promise<InventoryResult>;
  /** The bytes of one planned file, or null when it could not be read (one retry). */
  download(userId: string, file: PlannedFile): Promise<Uint8Array | null>;
  /** CRON ONLY: owner folder ids at a bucket's root (names only). */
  listOwnerFolders(bucket: string, budget: ExportFileBudget): Promise<{ owners: string[]; skipped: number; truncated: boolean } | null>;
}

/** A fresh listing budget starting now. */
export function newFileBudget(nowMs: number): ExportFileBudget {
  return { deadlineAt: nowMs + EXPORT_LIMITS.FILE_WALK_MAX_MS, callsLeft: EXPORT_LIMITS.FILE_WALK_MAX_CALLS };
}

function includedBuckets(): Array<{ bucket: string; folder: string }> {
  const out: Array<{ bucket: string; folder: string }> = [];
  for (const descriptor of STORAGE_DESCRIPTORS) {
    if (descriptor.export.kind === 'include') out.push({ bucket: descriptor.bucket, folder: descriptor.export.folder });
  }
  return out;
}

const byRecordThenKey = (a: { recordId: string; key: string }, b: { recordId: string; key: string }) =>
  a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

function contentTypeOf(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(candidate)) return candidate;
  }
  return 'application/octet-stream';
}

export function createExportFileSource(repo: ExportFilesRepositoryPort = businessDataExportFilesRepository): ExportFileSource {
  return {
    includedBuckets,

    async inventory(userId, budget, log) {
      if (!UUID.test(userId)) return { ok: false, reason: 'error' };
      const owner = userId;
      const namer = new EntryNamer();
      const files: PlannedFile[] = [];
      let recordsWithoutFile = 0;
      let orphanSkipped = 0;
      let filesWithoutRecord = 0;
      let rejectedPaths = 0;

      for (const { bucket, folder } of includedBuckets()) {
        const rule = BUCKET_RULES[bucket];
        if (!rule) {
          log.error({ userId: owner, bucket }, 'Data export: an included bucket has no file rule');
          return { ok: false, reason: 'error' };
        }
        const listing = await repo.listOwnerObjects(bucket, owner, budget);
        if (listing.error || !listing.data) return { ok: false, reason: 'error' };
        if (listing.data.truncated) {
          log.warn({ userId: owner, bucket }, 'Data export: file listing hit its budget; the export fails rather than ship part of "Your files"');
          return { ok: false, reason: 'truncated' };
        }
        rejectedPaths += listing.data.rejected;
        const objects = listing.data.objects;
        const prefix = `files/${folder}`;

        if (rule === 'live_document_rows') {
          const rows = await repo.listLiveDocumentFiles(owner, EXPORT_LIMITS.FILE_ROWS_MAX);
          if (rows.error || !rows.data) return { ok: false, reason: 'error' };
          const objectsByKey = new Map(objects.map((object) => [object.key, object] as const));
          const used = new Set<string>();
          const planned: Array<Omit<PlannedFile, 'entryPath'> & { contactId: string; fileName: string | null }> = [];
          for (const row of rows.data) {
            const inBucket = row.storage_bucket === null || row.storage_bucket === bucket;
            const object = inBucket && typeof row.storage_path === 'string' ? objectsByKey.get(row.storage_path) : undefined;
            // Never a folder from a value that is not a uuid (SA C-4); one object, one record.
            if (!object || used.has(object.key) || typeof row.contact_id !== 'string' || !UUID.test(row.contact_id)) {
              recordsWithoutFile += 1;
              continue;
            }
            used.add(object.key);
            planned.push({
              bucket,
              key: object.key,
              folder,
              sizeBytes: object.size,
              contentType: contentTypeOf(row.mime_type, object.contentType),
              recordSection: 'client_documents',
              recordId: row.id,
              contactId: row.contact_id,
              fileName: row.file_name,
            });
          }
          orphanSkipped += objects.filter((object) => !used.has(object.key)).length;
          planned.sort(byRecordThenKey);
          for (const item of planned) {
            const dir = `${prefix}/${item.contactId}`;
            // No usable original name: the last key segment (ASCII by V-3).
            const name = cleanSegment(item.fileName && item.fileName.trim() ? item.fileName : item.key.split('/').pop());
            const { contactId: _contactId, fileName: _fileName, ...file } = item;
            void _contactId;
            void _fileName;
            files.push({ ...file, entryPath: namer.claim(dir, name) });
          }
        } else {
          const media = await repo.listMediaPaths(owner, EXPORT_LIMITS.FILE_ROWS_MAX);
          if (media.error || !media.data) return { ok: false, reason: 'error' };
          const recordByKey = new Map<string, string>();
          for (const row of media.data) {
            if (typeof row.storage_path === 'string' && !recordByKey.has(row.storage_path)) recordByKey.set(row.storage_path, row.id);
          }
          const planned = objects
            .map((object) => ({ object, recordId: recordByKey.get(object.key) ?? '', key: object.key }))
            .sort(byRecordThenKey);
          for (const { object, recordId } of planned) {
            if (!recordId) filesWithoutRecord += 1;
            const below = object.key.slice(owner.length + 1).split('/');
            const joined = joinEntry(prefix, below);
            const cut = joined.lastIndexOf('/');
            files.push({
              bucket,
              key: object.key,
              folder,
              sizeBytes: object.size,
              contentType: contentTypeOf(object.contentType),
              recordSection: recordId ? 'images' : '',
              recordId,
              entryPath: namer.claim(joined.slice(0, cut), joined.slice(cut + 1)),
            });
          }
        }
      }

      const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
      return { ok: true, inventory: { files, totalBytes, recordsWithoutFile, orphanSkipped, filesWithoutRecord, rejectedPaths } };
    },

    async download(userId, file) {
      // One retry (SA optimisation), then "could not be read" (TL default BC-5).
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data, error } = await repo.downloadOwnerObject(file.bucket, userId, file.key);
        if (!error && data) return data;
      }
      return null;
    },

    async listOwnerFolders(bucket, budget) {
      const { data, error } = await repo.listOwnerFolders(bucket, budget);
      return error || !data ? null : data;
    },
  };
}

/** The files-index.csv / data.json row of a planned file. */
export function fileIndexRow(file: PlannedFile, status: ExportFileIndexRow['status']): ExportFileIndexRow {
  return {
    path_in_export: file.entryPath,
    folder: file.folder,
    size_bytes: file.sizeBytes,
    content_type: file.contentType,
    record_section: file.recordSection,
    record_id: file.recordId,
    status,
  };
}
