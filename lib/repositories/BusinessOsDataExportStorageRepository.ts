// lib/repositories/BusinessOsDataExportStorageRepository.ts
//
// Data export DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §3.1, §12): the
// private zip bucket `business-data-exports` (migration 20261074), and only
// that bucket.
//
// SERVICE ROLE BY DESIGN. The bucket has no policy for anon or authenticated
// on any verb (AC-36 pattern): the owner never touches it directly, only
// through a short signed URL this repository mints. So the default client is
// `supabaseServer`.
//
// Paths come ONLY from `exportObjectPath(userId, jobId)` (jobPolicy.ts), which
// refuses anything that is not two uuids: nothing a caller supplies (a `../`,
// a business name) can reach Storage. The sweep rebuilds every path it
// removes from the two folder uuids, never from a raw listed name (SA C-10).
//
// The signed URL carries a token and, in its `download` option, the business
// name: it is returned to the caller and NEVER logged here (SA C-3).
//
// Logs carry ids, counts, bytes and durations only. Every method returns
// { data, error } and never throws; invalid ids are an error with no call.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { EXPORT_JOB_POLICY, exportObjectPath } from '@/lib/business-os/data-export/jobPolicy';
import type {
  AgentRepositoryResult as RepositoryResult,
  ExportBucketListing,
  ExportBucketObject,
  ExportFileBudget,
} from './types';

const BUCKET = EXPORT_JOB_POLICY.BUCKET;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_PAGE = 1000;
const PART_FILE = '1.zip';
const ttlSchema = z.number().int().min(1).max(600);

function toError(error: unknown): Error {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const out = new Error(typeof record.message === 'string' ? record.message : 'Unknown storage error') as Error & { code?: string };
  if (typeof record.code === 'string') out.code = record.code;
  return out;
}

/** `exportObjectPath`, as a result instead of a throw. */
function pathOf(userId: string, jobId: string): { path: string } | { error: Error } {
  try {
    return { path: exportObjectPath(userId, jobId) };
  } catch (err) {
    return { error: toError(err) };
  }
}

interface ListedEntry {
  name?: unknown;
  id?: unknown;
  created_at?: unknown;
}

export class BusinessOsDataExportStorageRepository {
  private supabase: SupabaseClient;
  private logger: Logger;
  private now: () => number;

  constructor(supabaseClient?: SupabaseClient, clock: () => number = Date.now) {
    // Service role on purpose: the bucket has no policy (header).
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsDataExportStorageRepository' });
    this.now = clock;
  }

  /** Upload a finished zip. Never overwrites (`upsert: false`). */
  async upload(userId: string, jobId: string, bytes: Uint8Array): Promise<RepositoryResult<true>> {
    const target = pathOf(userId, jobId);
    if ('error' in target) return { data: null, error: target.error };
    const startTime = this.now();
    try {
      const { error } = await this.supabase.storage
        .from(BUCKET)
        .upload(target.path, bytes, { contentType: EXPORT_JOB_POLICY.BUCKET_MIME_TYPE, upsert: false });
      if (error) throw error;
      this.logger.info({ method: 'upload', userId, jobId, bytes: bytes.byteLength, duration: this.now() - startTime }, 'Data export zip uploaded');
      return { data: true, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'upload', userId, jobId, bytes: bytes.byteLength }, 'Failed to upload the data export zip');
      return { data: null, error: safe };
    }
  }

  /**
   * A short signed URL. `downloadName` becomes the saved file's name through
   * Storage's Content-Disposition. Neither the URL nor the name is logged.
   */
  async sign(userId: string, jobId: string, ttlSeconds: number, downloadName: string): Promise<RepositoryResult<string>> {
    const target = pathOf(userId, jobId);
    if ('error' in target) return { data: null, error: target.error };
    if (!ttlSchema.safeParse(ttlSeconds).success) return { data: null, error: new Error('Invalid input: ttl') };
    try {
      const { data, error } = await this.supabase.storage
        .from(BUCKET)
        .createSignedUrl(target.path, ttlSeconds, { download: downloadName });
      if (error) throw error;
      const url = data?.signedUrl;
      if (typeof url !== 'string' || url.length === 0) throw new Error('no signed URL returned');
      return { data: url, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'sign', userId, jobId }, 'Failed to sign the data export zip');
      return { data: null, error: safe };
    }
  }

  /** Remove one export's zip. Idempotent: removing a missing object is not an error. */
  async remove(userId: string, jobId: string): Promise<RepositoryResult<true>> {
    const target = pathOf(userId, jobId);
    if ('error' in target) return { data: null, error: target.error };
    try {
      const { error } = await this.supabase.storage.from(BUCKET).remove([target.path]);
      if (error) throw error;
      this.logger.info({ method: 'remove', userId, jobId }, 'Data export zip removed');
      return { data: true, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'remove', userId, jobId }, 'Failed to remove the data export zip');
      return { data: null, error: safe };
    }
  }

  /**
   * CROSS-ACCOUNT, cron only (the orphan sweep): every `{uuid}/{uuid}/1.zip`
   * in the bucket, with its folder ids. Anything else (a non-uuid folder, a
   * stray object at any depth, another file name) is COUNTED as unexpected
   * and never descended or returned, so it can never be removed by a guess.
   */
  async listForSweep(budget: ExportFileBudget): Promise<RepositoryResult<ExportBucketListing>> {
    const objects: ExportBucketObject[] = [];
    let unexpected = 0;
    const spent = () => this.now() > budget.deadlineAt || budget.callsLeft <= 0;
    try {
      // Cross-account by design: the sweep has no user context; every removal it leads to is rebuilt from the two folder uuids (tenant-isolation-guard Step 6).
      const owners = await this.listLevel('', budget, spent);
      if (owners === 'truncated') return { data: { objects, unexpected, truncated: true }, error: null };
      for (const owner of owners) {
        if (owner.id || typeof owner.name !== 'string' || !UUID.test(owner.name)) {
          unexpected += 1;
          continue;
        }
        const userId = owner.name.toLowerCase();
        const jobs = await this.listLevel(owner.name, budget, spent);
        if (jobs === 'truncated') return { data: { objects, unexpected, truncated: true }, error: null };
        for (const job of jobs) {
          if (job.id || typeof job.name !== 'string' || !UUID.test(job.name)) {
            unexpected += 1;
            continue;
          }
          const files = await this.listLevel(`${owner.name}/${job.name}`, budget, spent);
          if (files === 'truncated') return { data: { objects, unexpected, truncated: true }, error: null };
          for (const file of files) {
            if (!file.id || file.name !== PART_FILE) {
              unexpected += 1;
              continue;
            }
            objects.push({
              userId,
              jobId: job.name.toLowerCase(),
              createdAt: typeof file.created_at === 'string' && file.created_at ? file.created_at : null,
            });
          }
        }
      }
      return { data: { objects, unexpected, truncated: false }, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'listForSweep', listed: objects.length }, 'Failed to list the data export bucket');
      return { data: null, error: safe };
    }
  }

  private async listLevel(prefix: string, budget: ExportFileBudget, spent: () => boolean): Promise<ListedEntry[] | 'truncated'> {
    const out: ListedEntry[] = [];
    for (let offset = 0; ; offset += LIST_PAGE) {
      if (spent()) return 'truncated';
      budget.callsLeft -= 1;
      const { data, error } = await this.supabase.storage.from(BUCKET).list(prefix, { limit: LIST_PAGE, offset });
      if (error) throw error;
      const entries = (data ?? []) as ListedEntry[];
      out.push(...entries);
      if (entries.length < LIST_PAGE) return out;
    }
  }
}

export const businessOsDataExportStorageRepository = new BusinessOsDataExportStorageRepository();
