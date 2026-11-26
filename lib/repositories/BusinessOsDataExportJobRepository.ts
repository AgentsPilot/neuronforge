// lib/repositories/BusinessOsDataExportJobRepository.ts
//
// Receipt export facts only (module export MX-7, BUSINESS_OS_EXPORT_MX7_WORKPLAN.md
// §4.5). Reads the two module-export tables through their repositories.
//
// This file began as the data export DE-8a repository of the "Download my data"
// jobs table, public.business_os_data_exports (migration 20261074). The ZIP was
// retired in MX-3.1 and MX-7 drops that table (migration 20261135), so every
// ZIP method went with it. What stays is `findDeletionFacts`, whose path,
// class, constructor, method and result type are a frozen interface
// (requirement SR-2, S-3, B.6): two DELETE routes call it, and their tests
// mock it.
//
// SERVICE ROLE BY DESIGN. The deletion check and the admin delete read the
// facts of the account they act on, with no browser path. So the default
// client is `supabaseServer`, and the user_id filter of both reads is the
// tenant boundary (CLAUDE.md rule 4, tenant-isolation-guard). This file makes
// no `.from(` of its own: each table is read by its own repository with this
// client (SA Q-9 D-1).
//
// Logs carry ids and field names only, never a value. Every method returns
// { data, error } and never throws. Invalid input is an error WITHOUT a
// database call.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
// MX-4a receipt facts only (findDeletionFacts): each new table is read by its
// own repository (SA Q-9 D-1). Allow-listed in
// lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts.
import { BusinessOsExportModuleJobRepository } from '@/lib/repositories/BusinessOsExportModuleJobRepository';
import { BusinessOsExportRequestRepository } from '@/lib/repositories/BusinessOsExportRequestRepository';
import type { AgentRepositoryResult as RepositoryResult } from './types';

const uuid = z.string().uuid();

/** A fresh Error carrying only code and message, so `details` never reaches a log. */
function toError(error: unknown): Error {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const out = new Error(typeof record.message === 'string' ? record.message : 'Unknown database error') as Error & { code?: string };
  if (typeof record.code === 'string') out.code = record.code;
  return out;
}

function invalid(what: string): Error {
  return new Error(`Invalid input: ${what}`);
}

/** The export facts a deletion receipt records (DE-10b.1). Timestamps as the database returns them. */
export interface DataExportDeletionFacts {
  ownerLastExportReadyAt: string | null;
  ownerExportDownloadedAt: string | null;
  adminExportExisted: boolean;
}

export class BusinessOsDataExportJobRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role on purpose: see the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsDataExportJobRepository' });
  }

  /**
   * DE-10b.1 (requirement §5.1): what our records show about the account's
   * exports, copied into the deletion receipt BEFORE the delete (the export
   * rows are deleted with the account).
   *
   * From MX-7, the new tables only (requirement XC-12, B.6 "After MX-7: new
   * tables only"; SA-Q5). Two reads, both on `user_id`, each through its own
   * repository with this client: N1 the newest `sent_at` of an owner-origin
   * module job with status `sent`, and N2 whether any admin-origin request
   * exists.
   *
   * - `ownerLastExportReadyAt`: the last owner module job accepted, that is
   *   N1's `sent_at` (the message the provider accepted, SA MX-4 ruling on
   *   "accepted"), or `null`. Per job, not per request: one module sent out of
   *   five counts. It means "some owner data reached the owner at this time",
   *   not "a complete export". An admin-origin send never counts here (SA Q-2).
   * - `ownerExportDownloadedAt`: always `null`. No download exists in the
   *   module export (XC-12).
   * - `adminExportExisted`: any admin-origin request (N2), whatever its outcome.
   * - An old ZIP export ("Download my data", before 2026-10-30) no longer
   *   counts: its table is dropped by migration 20261135. An account whose
   *   only export was an old ZIP reads "none on record" from MX-7 on. The user
   *   accepted this on 2026-11-26 (BQ-E10-2); receipts already written are
   *   untouched.
   * - A `sent_at` that does not parse makes the whole call an error (SA Q-5),
   *   as does any read error or a missing fact: never partial facts (K-3).
   */
  async findDeletionFacts(userId: string): Promise<RepositoryResult<DataExportDeletionFacts>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: invalid('user id') };
    try {
      // The delete route waits on these, so they run together. Neither
      // rejects: both repository methods return { data, error }.
      const [moduleSent, adminRequest] = await Promise.all([
        new BusinessOsExportModuleJobRepository(this.supabase).findLatestOwnerSentAt(userId),
        new BusinessOsExportRequestRepository(this.supabase).hasAdminOriginRequest(userId),
      ]);
      if (moduleSent.error || moduleSent.data === null) throw moduleSent.error ?? new Error('No module export fact returned');
      if (adminRequest.error || typeof adminRequest.data !== 'boolean') throw adminRequest.error ?? new Error('No admin request fact returned');

      const moduleSentAt = moduleSent.data.sentAt;
      // The field name only, never the value (Q-5: fail closed).
      if (moduleSentAt !== null && Number.isNaN(Date.parse(moduleSentAt))) {
        throw new Error('Unparseable timestamp: module job sent_at');
      }

      return {
        data: {
          ownerLastExportReadyAt: moduleSentAt,
          ownerExportDownloadedAt: null,
          adminExportExisted: adminRequest.data,
        },
        error: null,
      };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findDeletionFacts', userId }, 'Failed to read the export facts for a deletion receipt');
      return { data: null, error: safe };
    }
  }
}
