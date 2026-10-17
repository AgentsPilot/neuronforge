// lib/repositories/BusinessDataExportFilesRepository.ts
//
// Data export DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §9, §14 bounds
// F-1 ... F-6; SA Q-4, C-5, C-6): READ-ONLY access to the owner's stored files
// for "Your files" in the zip, and to the two record tables that say which
// files are live (contact_documents) and which are in the picture library
// (user_media). A granularity exception on the DE-4 SA-Q1 precedent: one
// export-only repository instead of new methods spread over
// ContactDocumentsRepository / UserMediaRepository plus storage calls
// elsewhere. The storage walk follows BusinessPurgeRepository's
// listObjectPathsRecursive (folders have no id; a budget gives `truncated`).
//
// BOUNDS (pinned by its tests):
// - F-1 READ-ONLY: no upload, remove, update, insert, delete or rpc. A source
//   scan pins it.
// - F-2 A bucket is accepted only when its STORAGE_DESCRIPTORS entry is
//   `include`, looked up by name. Anything else is an error with no call.
// - F-3 Every list and download path is `${userId}/...`; every name a listing
//   returns is checked again (one segment, no `.`/`..`, no `/` or `\`, no
//   control character) and dropped and counted when it is not.
// - F-4 `userId` is the caller's session id (or DE-10a's path id after
//   requireAdmin). It is uuid-validated before any call (SA C-5), so an empty
//   or `/`-bearing prefix is impossible. There is no find-by-object-key.
// - F-5 SERVICE ROLE, on purpose: the buckets are private and have no read
//   policy the server could use as the owner, and the export needs exactly
//   the owner's own objects. The prefix and the user_id filter are the tenant
//   boundary (CLAUDE.md rule 4, tenant-isolation-guard).
// - F-6 Importers: `lib/business-os/data-export/fileManifest.ts` only (the
//   cron's size watch calls fileManifest, SA C-6). Not in
//   lib/repositories/index.ts. A scan pins it.
//
// `storage_path` is read here INTERNALLY to match files to records. It is
// never returned to a section, never written to a CSV (the descriptors keep it
// excluded), and files-index.csv holds the zip path, never the key.
//
// The one cross-account read, `listOwnerFolders`, lists only the ROOT of an
// include bucket and returns uuid folder names (owner ids), never an object
// and never a file: the cron's size watch (§0.4.1 C, SA C-11).
//
// Logs carry ids, counts, bytes and durations only, never a file name.
// Every method returns { data, error } and never throws.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { STORAGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import type {
  AgentRepositoryResult as RepositoryResult,
  ExportFileBudget,
  ExportLiveDocumentFile,
  ExportMediaPath,
  ExportOwnerFolders,
  ExportOwnerObject,
  ExportOwnerObjects,
} from './types';

const uuid = z.string().uuid();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_PAGE = 1000;
const ROW_PAGE = 1000;
const BAD_NAME_CHAR = /[/\\\u0000-\u001F\u007F-\u009F]/;

/** F-2: the folder of an include bucket, or null (exclude, planned, unknown). */
export function includedBucketFolder(bucket: string): string | null {
  const descriptor = STORAGE_DESCRIPTORS.find((d) => d.bucket === bucket);
  return descriptor && descriptor.export.kind === 'include' ? descriptor.export.folder : null;
}

/** One listed name is one safe segment (F-3). */
export function isSafeListedName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !BAD_NAME_CHAR.test(name);
}

/** A full object key is the owner's: `${userId}/` + safe segments only (F-3). */
export function isOwnerObjectKey(userId: string, key: string): boolean {
  if (!key.startsWith(`${userId}/`)) return false;
  const rest = key.slice(userId.length + 1).split('/');
  return rest.length >= 1 && rest.every((segment) => isSafeListedName(segment));
}

function toError(error: unknown): Error {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const out = new Error(typeof record.message === 'string' ? record.message : 'Unknown storage or database error') as Error & { code?: string };
  if (typeof record.code === 'string') out.code = record.code;
  return out;
}

function invalid(what: string): Error {
  return new Error(`Invalid input: ${what}`);
}

interface ListedEntry {
  name?: unknown;
  id?: unknown;
  created_at?: unknown;
  metadata?: { size?: unknown; mimetype?: unknown } | null;
}

function budgetSpent(budget: ExportFileBudget, now: () => number): boolean {
  return now() > budget.deadlineAt || budget.callsLeft <= 0;
}

export class BusinessDataExportFilesRepository {
  private supabase: SupabaseClient;
  private logger: Logger;
  private now: () => number;

  constructor(supabaseClient?: SupabaseClient, clock: () => number = Date.now) {
    // F-5: service role on purpose (header).
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessDataExportFilesRepository' });
    this.now = clock;
  }

  // ============ Storage (read-only) ============

  /**
   * Every object under `${userId}/` in an include bucket, recursively. The
   * budget is shared (mutated) across calls, so both buckets of one export
   * draw on one listing budget. `truncated: true` when it ran out: the caller
   * must not treat the listing as complete (SA Q-16).
   */
  async listOwnerObjects(bucket: string, userId: string, budget: ExportFileBudget): Promise<RepositoryResult<ExportOwnerObjects>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: invalid('user id') };
    if (includedBucketFolder(bucket) === null) return { data: null, error: invalid('bucket is not included in the export') };
    const owner = userId.toLowerCase();
    const objects: ExportOwnerObject[] = [];
    let rejected = 0;
    const queue: string[] = [owner];
    try {
      while (queue.length > 0) {
        const prefix = queue.shift() as string;
        for (let offset = 0; ; offset += LIST_PAGE) {
          if (budgetSpent(budget, this.now)) {
            this.logger.warn({ method: 'listOwnerObjects', bucket, userId: owner, listed: objects.length }, 'Export file listing stopped at its budget');
            return { data: { objects, rejected, truncated: true }, error: null };
          }
          budget.callsLeft -= 1;
          const { data, error } = await this.supabase.storage.from(bucket).list(prefix, { limit: LIST_PAGE, offset });
          if (error) throw error;
          const entries = (data ?? []) as ListedEntry[];
          for (const entry of entries) {
            if (!isSafeListedName(entry.name)) {
              rejected += 1;
              continue;
            }
            const key = `${prefix}/${entry.name}`;
            // F-3 again on the joined key (belt and braces: the prefix is ours).
            if (!isOwnerObjectKey(owner, key)) {
              rejected += 1;
              continue;
            }
            if (entry.id) {
              const size = entry.metadata?.size;
              const mimetype = entry.metadata?.mimetype;
              objects.push({
                key,
                size: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : 0,
                contentType: typeof mimetype === 'string' ? mimetype : null,
              });
            } else {
              queue.push(key);
            }
          }
          if (entries.length < LIST_PAGE) break;
        }
      }
      if (rejected > 0) {
        this.logger.warn({ event: 'data_export_file_path_rejected', bucket, userId: owner, rejected }, 'Export file listing dropped unsafe names');
      }
      return { data: { objects, rejected, truncated: false }, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'listOwnerObjects', bucket, userId: owner }, 'Failed to list the owner files');
      return { data: null, error: safe };
    }
  }

  /** The bytes of one of the owner's objects (F-3: the key must be the owner's). */
  async downloadOwnerObject(bucket: string, userId: string, key: string): Promise<RepositoryResult<Uint8Array>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: invalid('user id') };
    if (includedBucketFolder(bucket) === null) return { data: null, error: invalid('bucket is not included in the export') };
    const owner = userId.toLowerCase();
    if (typeof key !== 'string' || !isOwnerObjectKey(owner, key)) return { data: null, error: invalid('object key') };
    try {
      const { data, error } = await this.supabase.storage.from(bucket).download(key);
      if (error) throw error;
      if (!data) throw new Error('empty download');
      return { data: new Uint8Array(await data.arrayBuffer()), error: null };
    } catch (err) {
      const safe = toError(err);
      // No key in the log: it carries the uploader's file name.
      this.logger.warn({ err: safe, method: 'downloadOwnerObject', bucket, userId: owner }, 'Failed to read one owner file');
      return { data: null, error: safe };
    }
  }

  /**
   * CROSS-ACCOUNT, cron only (the size watch, SA C-11): the uuid folders at the
   * root of an include bucket. Names only, no object and no file is read.
   * Non-uuid entries (PROD has two, S-1b) are counted, never descended.
   */
  async listOwnerFolders(bucket: string, budget: ExportFileBudget): Promise<RepositoryResult<ExportOwnerFolders>> {
    if (includedBucketFolder(bucket) === null) return { data: null, error: invalid('bucket is not included in the export') };
    const owners: string[] = [];
    let skipped = 0;
    try {
      for (let offset = 0; ; offset += LIST_PAGE) {
        if (budgetSpent(budget, this.now)) return { data: { owners, skipped, truncated: true }, error: null };
        budget.callsLeft -= 1;
        // Cross-account by design: the size watch has no user context and reads names only (tenant-isolation-guard Step 6).
        const { data, error } = await this.supabase.storage.from(bucket).list('', { limit: LIST_PAGE, offset });
        if (error) throw error;
        const entries = (data ?? []) as ListedEntry[];
        for (const entry of entries) {
          if (!entry.id && typeof entry.name === 'string' && UUID.test(entry.name)) owners.push(entry.name.toLowerCase());
          else skipped += 1;
        }
        if (entries.length < LIST_PAGE) break;
      }
      return { data: { owners, skipped, truncated: false }, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'listOwnerFolders', bucket }, 'Failed to list the owner folders');
      return { data: null, error: safe };
    }
  }

  // ============ Record tables (read-only, user-scoped) ============

  /**
   * The owner's LIVE documents (status <> 'deleted'): the inventory authority
   * for contact-documents (C-11 of DE-4). Keyset paged by id; more than
   * `maxRows` is an error (never a silently partial match).
   */
  async listLiveDocumentFiles(userId: string, maxRows: number): Promise<RepositoryResult<ExportLiveDocumentFile[]>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: invalid('user id') };
    return this.pageRows<ExportLiveDocumentFile>('listLiveDocumentFiles', maxRows, (after) => {
      let query = this.supabase
        .from('contact_documents')
        .select('id, contact_id, storage_path, storage_bucket, file_name, mime_type')
        .eq('user_id', userId)
        .neq('status', 'deleted')
        .order('id', { ascending: true })
        .limit(ROW_PAGE);
      if (after) query = query.gt('id', after);
      return query;
    }, userId);
  }

  /** The owner's picture-library rows with their storage key, to link files to records. */
  async listMediaPaths(userId: string, maxRows: number): Promise<RepositoryResult<ExportMediaPath[]>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: invalid('user id') };
    return this.pageRows<ExportMediaPath>('listMediaPaths', maxRows, (after) => {
      let query = this.supabase
        .from('user_media')
        .select('id, storage_path')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .limit(ROW_PAGE);
      if (after) query = query.gt('id', after);
      return query;
    }, userId);
  }

  private async pageRows<Row extends { id: string }>(
    method: string,
    maxRows: number,
    page: (after: string | null) => PromiseLike<{ data: unknown; error: unknown }>,
    userId: string,
  ): Promise<RepositoryResult<Row[]>> {
    if (!z.number().int().positive().safeParse(maxRows).success) return { data: null, error: invalid('maxRows') };
    const rows: Row[] = [];
    let after: string | null = null;
    try {
      for (;;) {
        const { data, error } = await page(after);
        if (error) throw error;
        const batch = (data as Row[] | null) ?? [];
        rows.push(...batch);
        if (rows.length > maxRows) throw new Error(`${method}: more rows than the export reads`);
        // Ends on a short or empty page (a project max-rows below ROW_PAGE still ends on the empty one).
        if (batch.length === 0) break;
        after = batch[batch.length - 1].id;
      }
      return { data: rows, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method, userId }, 'Failed to read the export file records');
      return { data: null, error: safe };
    }
  }
}

export const businessDataExportFilesRepository = new BusinessDataExportFilesRepository();
