// lib/repositories/BusinessDataExportRepository.ts
//
// DE-4 (BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md §2.1, §2.2, §2.4, §2.6;
// requirement BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.3.2 SQ-A5, §0.3.6,
// §0.4.1 C): the ONE reader behind every descriptor-driven section of
// "Download my data": the `client_records` sections (DE-4), the four
// `account` sections from tables (DE-3: preferences, notification settings,
// business profile, business addresses) and, from DE-5 on, the later Business
// OS sections. Comment only in DE-3: no behaviour changed (DE-3 SA C-4).
// DE-5 money sections (quotes, invoices, payments, refunds, payment plans and
// instalments, saved payment methods, the Stripe account, payment providers)
// read through the same method: comment only, no behaviour changed. Every
// child table (refunds, instalments) is read by its OWN `user_id`, never by
// following a parent id, so a crossed pointer carries a bare id, never a row.
//
// ── Why one repository and not one method per domain repository ────────────
// SA granted this as a GRANULARITY exception inside the repository layer (DE-4
// SA-Q1), the same kind `BusinessPurgeRepository` holds (DEV-Q1). DE-5/6/7 add
// about thirty more tables; one tested place for the tenant filter, the paging,
// the row filter and the ceiling is safer than a copy per repository (R-10).
//
// ── The six bounds of that exception (SA C-5) ──────────────────────────────
// E-1  READ-ONLY. No insert, update, upsert, delete or rpc, ever.
//      BusinessDataExportRepository.test.ts scans this file for them.
// E-2  Accepts only an `include` descriptor whose `scope.kind` is `user_id`,
//      resolved from a SECTION id (never a table name from a caller). Anything
//      else fails closed with `{ error }` and issues no query. A `via` table
//      (DE-7 `website_blocks`) needs its own parent-scoped reader.
// E-3  The select string comes only from `exportColumnsOf()`, so the
//      secret-column deny check runs at call time too. Never `*`.
// E-4  The first filter is always `.eq('user_id', userId)`, and `userId` is
//      only ever the session's `getUser().id` (sections.ts `ExportContext`).
//      No caller-supplied entity id is used: there is no find-by-id here.
// E-5  Service role, both reasons stated: (1) DE-1 SA C-2 / DE-0b: the export
//      runs as the service role, so it reads the same rows on every table
//      whatever each table's `authenticated` grants are; (2) RLS is therefore
//      bypassed, which is why E-4's filter is the tenant boundary and is tested
//      against a cross-tenant fake (BusinessDataExportRepository.test.ts).
// E-6  Export only. The sole importer is lib/business-os/data-export/sections.ts
//      (tests aside). It is not re-exported from lib/repositories/index.ts, and
//      no other module may import it. The test scans for importers.
//
// ── Reading to the end (F-3, SA-Q8) ────────────────────────────────────────
// Keyset paging on `id`, ascending: `.order('id').limit(PAGE_SIZE)`, then
// `.gt('id', lastId)`. The loop ends on an EMPTY page, not a short one: a
// project `max-rows` below PAGE_SIZE would make a short-page loop stop early
// and drop rows without a word. A page whose last id is not strictly after the
// previous page's last id fails the section (C-8) instead of looping.
//
// ── One row, keyed on user_id (DE-6 SA-Q1) ─────────────────────────────────
// A descriptor with `rowKey: 'user_id'` (only `marketing_consent_settings`:
// no `id`, PK `user_id`) is not paged. It is read once, inside the same
// method, after the same E-2 and E-3 checks:
// `.eq('user_id', userId).limit(2)`, no order, no `.gt`, no other filter.
// Two rows fail the section closed (the key is not what the classification
// says). E-1…E-6 are unchanged.
//
// ── Ceiling (§0.4.1 C) ─────────────────────────────────────────────────────
// The caller passes the rows still left in the export's budget. Past
// `maxRows` the read stops, returns `overCeiling: true` and NO rows, so a
// partial section can never be written.
//
// Logs carry the section, table, user id, page and row counts. Never row
// content, names or emails.

import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import {
  ExportClassificationError,
  exportColumnsOf,
  exportDescriptorOfSection,
  rowFilterInList,
} from '@/lib/business-os/data-export/classification';
import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';
import { EXPORT_LIMITS } from '@/lib/business-os/data-export/limits';
import type { PurgeDescriptor } from '@/lib/business-os/purge/types';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** One exported row: the descriptor's columns, as PostgREST returns them. */
export type OwnedExportRow = Record<string, unknown>;

export interface OwnedRowsForExport {
  rows: OwnedExportRow[];
  /** True when the table holds more than `maxRows`; `rows` is then empty. */
  overCeiling: boolean;
}

/** Test seams only. Production uses the defaults. */
export interface BusinessDataExportRepositoryOptions {
  descriptors?: readonly PurgeDescriptor[];
  pageSize?: number;
}

const ReadInputSchema = z.object({
  userId: z.string().min(1),
  maxRows: z.number().int().min(0),
});

export class BusinessDataExportRepository {
  private supabase: SupabaseClient;
  private logger: Logger;
  private descriptors?: readonly PurgeDescriptor[];
  private pageSize?: number;

  constructor(supabaseClient?: SupabaseClient, options: BusinessDataExportRepositoryOptions = {}) {
    // Intentionally bypasses RLS: the data export runs as the service role (E-5).
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessDataExportRepository' });
    this.descriptors = options.descriptors;
    this.pageSize = options.pageSize;
  }

  /**
   * Every row the session user owns in the table behind `sectionId`, keyset
   * paged to the end, rows of the descriptor's `rowFilter` left out. Fails
   * closed (`{ data: null, error }`, the section is then `failed`) on a bad
   * descriptor, a PostgREST error or a non-advancing page.
   */
  async listOwnedRowsForExport(
    sectionId: ExportSectionId,
    userId: string,
    opts: { maxRows: number }
  ): Promise<RepositoryResult<OwnedRowsForExport>> {
    const startTime = Date.now();
    let table: string | undefined;
    try {
      const input = ReadInputSchema.parse({ userId, maxRows: opts.maxRows });
      // E-2: resolved from the section, never from a table name a caller gives.
      const descriptor = exportDescriptorOfSection(sectionId, this.descriptors);
      table = descriptor.table;
      if (descriptor.scope.kind !== 'user_id') {
        throw new ExportClassificationError('not_user_scoped', table, `scope ${descriptor.scope.kind} needs a parent-scoped reader`);
      }
      // E-3: deny check at call time.
      const columns = exportColumnsOf(table, this.descriptors);
      const select = columns.join(', ');
      const rowFilter = descriptor.export.kind === 'include' ? descriptor.export.rowFilter : undefined;
      const rowKey = descriptor.export.kind === 'include' ? descriptor.export.rowKey : undefined;

      if (rowKey !== undefined) {
        // DE-6 SA-Q1 (4): the single-row read (no `id`; PK `user_id`). The
        // type admits only 'user_id'; a planted value or a row filter beside
        // it (Jest does not type-check) fails closed here as well as in CI.
        if (rowKey !== 'user_id' || rowFilter) {
          throw new ExportClassificationError('invalid_column', table, 'a single-row read needs rowKey user_id and no row filter');
        }
        // E-4: the tenant filter is first, and it is the only filter. No order, no gt.
        const { data, error } = await this.supabase.from(table).select(select).eq('user_id', input.userId).limit(2);
        if (error) throw error;
        // A dynamic select string types as an error shape; the rows are plain objects.
        const single = (data ?? []) as unknown as OwnedExportRow[];
        if (single.length > 1) {
          // Two rows: the key is not unique, so the classification is wrong. Counts only in the message.
          throw new Error(`Data export single-row read found ${single.length} rows for one owner`);
        }
        if (single.length > input.maxRows) {
          this.logger.warn(
            { sectionId, table, userId: input.userId, pages: 1, maxRows: input.maxRows, duration: Date.now() - startTime },
            'Data export section is over the row ceiling'
          );
          return { data: { rows: [], overCeiling: true }, error: null };
        }
        this.logger.info(
          { sectionId, table, userId: input.userId, pages: 1, rows: single.length, duration: Date.now() - startTime },
          'Data export section read'
        );
        return { data: { rows: single, overCeiling: false }, error: null };
      }

      if (!columns.includes('id')) {
        throw new ExportClassificationError('invalid_column', table, 'keyset paging needs the id column');
      }
      const notInList = rowFilter ? rowFilterInList(rowFilter) : undefined;
      const pageSize = this.pageSize ?? EXPORT_LIMITS.PAGE_SIZE;

      const rows: OwnedExportRow[] = [];
      let lastId: string | null = null;
      let pages = 0;
      for (;;) {
        // E-4: the tenant filter is always first.
        let query = this.supabase.from(table).select(select).eq('user_id', input.userId);
        if (rowFilter && notInList) query = query.not(rowFilter.column, 'in', notInList);
        if (lastId !== null) query = query.gt('id', lastId);
        const { data, error } = await query.order('id', { ascending: true }).limit(pageSize);
        pages += 1;
        if (error) throw error;
        // A dynamic select string types as an error shape; the rows are plain objects.
        const page = (data ?? []) as unknown as OwnedExportRow[];
        if (page.length === 0) break;

        const pageLastId = page[page.length - 1].id;
        if (typeof pageLastId !== 'string' || (lastId !== null && !(pageLastId > lastId))) {
          // C-8: a page that does not move forward would loop forever. Every
          // DE-4 id is a uuid, which PostgREST returns as lowercase canonical
          // text, whose string order is Postgres's uuid (byte) order. Were the
          // two ever to disagree, the section fails closed; it cannot leak.
          throw new Error('Data export page did not advance past the previous page');
        }
        lastId = pageLastId;

        for (const row of page) rows.push(row);
        if (rows.length > input.maxRows) {
          this.logger.warn(
            { sectionId, table, userId: input.userId, pages, maxRows: input.maxRows, duration: Date.now() - startTime },
            'Data export section is over the row ceiling'
          );
          return { data: { rows: [], overCeiling: true }, error: null };
        }
      }

      this.logger.info(
        { sectionId, table, userId: input.userId, pages, rows: rows.length, duration: Date.now() - startTime },
        'Data export section read'
      );
      return { data: { rows, overCeiling: false }, error: null };
    } catch (error) {
      this.logger.error(
        { err: error, sectionId, table, userId, duration: Date.now() - startTime },
        'Failed to read owned rows for the data export'
      );
      return { data: null, error: error as Error };
    }
  }
}

/** Export only (E-6): imported by lib/business-os/data-export/sections.ts alone. */
export const businessDataExportRepository = new BusinessDataExportRepository();
