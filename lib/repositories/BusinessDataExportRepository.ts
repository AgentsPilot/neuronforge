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
//      or `via` with a matching `viaParent` opt-in whose parent is a
//      `user_id`-scoped `include` (V-1…V-6, below), resolved from a SECTION id
//      (never a table name from a caller). Anything else fails closed with
//      `{ error }` and issues no query. (DE-7 amended; was: "A `via` table
//      needs its own parent-scoped reader".)
// E-3  The select string comes only from `exportColumnsOf()`, so the
//      secret-column deny check runs at call time too. Never `*`.
// E-4  The first filter is always `.eq('user_id', userId)`, and `userId` is
//      only ever the session's `getUser().id` (sections.ts `ExportContext`).
//      No caller-supplied entity id is used: there is no find-by-id here.
//      The parent-scoped read's child query is the one place whose first
//      filter is `.in(fk, ids)`; those ids come only from an E-4 read.
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
// ── Through an owner-scoped parent (DE-7 SA-Q1, SA-Q2; C-1…C-6) ────────────
// A `via` table has no `user_id` of its own (only `website_blocks`: a block
// belongs to a page, the page to the owner). It is read inside the same
// method, after Zod and E-2, only when the descriptor carries the export
// opt-in `viaParent` and it equals the purge scope (two keys: a purge scope
// changed to `via` alone still fails closed, `not_user_scoped`, no query).
// V-1  `scope.kind === 'via'` and `viaParent` deep-equals `{ parent, fk }`.
// V-2  The parent is ONE descriptor of the same set, found by the table name
//      on the child descriptor (never an input): `user_id`-scoped (one hop),
//      `include`, `id` in its columns, no `rowKey`, no `rowFilter`.
// V-3  The child lists `id` and the `fk`; no `rowKey`, no `rowFilter`.
//      V-1…V-3 run at request time (`viaParentOf`) and in CI; then E-3 for
//      the child AND the parent; then the reads.
// V-4  The parent ids (the ownership oracle) are read by E-4,
//      `.from(parent).select('id').eq('user_id', userId)`, keyset paged; each
//      id must be a canonical lowercase uuid before it joins the set (C-6),
//      and past ROW_CEILING ids the read stops `overCeiling`, no child query
//      (C-4). Zero ids: `ok`, 0 rows, no child query.
// V-5  Children per chunk of VIA_PARENT_CHUNK ids: `.in(fk, chunk)` is the
//      first filter (a plain string array, never a hand-built list), keyset
//      paged on `id`, `lastId` reset per chunk (C-3).
// V-6  Every child row's `id` and `fk` are strings and its `fk` is in the
//      CURRENT chunk; one that is not fails the whole section (C-1). A
//      PostgREST or fake that ignored `.in` fails the section, never leaks.
//      Rows are counted across chunks against `maxRows` (parent ids are not
//      rows of this section), then sorted by `id` in code-unit order (never
//      locale order: C-2) and a duplicate `id` fails the section.
// The info line adds `parents` (the parent-id count). E-1…E-6 hold.
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
  viaParentOf,
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

// DE-7 QA-B1: both levels are `.strict()`, so a key nobody declared (a caller
// page or parent id slipped into the options object, say) fails the section
// closed before any query, instead of being dropped silently by Zod.
const ReadInputSchema = z
  .object({
    userId: z.string().min(1),
    opts: z.object({ maxRows: z.number().int().min(0) }).strict(),
  })
  .strict();

/** DE-7 C-6: PostgREST's text form of a uuid: lowercase, canonical, nothing else. */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
      const parsed = ReadInputSchema.parse({ userId, opts });
      const input = { userId: parsed.userId, maxRows: parsed.opts.maxRows };
      // E-2: resolved from the section, never from a table name a caller gives.
      const descriptor = exportDescriptorOfSection(sectionId, this.descriptors);
      table = descriptor.table;
      const viaParent = descriptor.export.kind === 'include' ? descriptor.export.viaParent : undefined;
      if (descriptor.scope.kind === 'via' && viaParent !== undefined) {
        // DE-7 C-5: V-1…V-3 (throws, no query), then E-3 for the child AND the parent, then the reads.
        const parent = viaParentOf(descriptor, this.descriptors);
        const childColumns = exportColumnsOf(table, this.descriptors);
        const parentColumns = exportColumnsOf(parent.table, this.descriptors);
        if (!parentColumns.includes('id')) {
          throw new ExportClassificationError('invalid_via_parent', table, 'the parent must export its id column');
        }
        return await this.readThroughParent({
          sectionId,
          table,
          parentTable: parent.table,
          fk: descriptor.scope.fk,
          select: childColumns.join(', '),
          userId: input.userId,
          maxRows: input.maxRows,
          startTime,
        });
      }
      if (descriptor.scope.kind !== 'user_id') {
        // Unchanged since DE-4: a `via` scope without the export opt-in (or any other scope).
        throw new ExportClassificationError('not_user_scoped', table, `scope ${descriptor.scope.kind} needs a parent-scoped reader`);
      }
      if (viaParent !== undefined) {
        // A `viaParent` beside a user_id scope (Jest does not type-check): fail closed with no query.
        viaParentOf(descriptor, this.descriptors);
        throw new ExportClassificationError('invalid_via_parent', table, 'viaParent needs a via scope');
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

  /**
   * DE-7 (SA-Q1; V-4…V-6, C-1…C-6): the rows of a `via` table whose parent
   * the session user owns. Called only from `listOwnedRowsForExport`, after
   * V-1…V-3 and E-3, with code-constant table, parent and fk names. Throws on
   * any failure; the caller turns that into `{ error }` (section `failed`).
   */
  private async readThroughParent(args: {
    sectionId: ExportSectionId;
    table: string;
    parentTable: string;
    fk: string;
    select: string;
    userId: string;
    maxRows: number;
    startTime: number;
  }): Promise<RepositoryResult<OwnedRowsForExport>> {
    const { sectionId, table, parentTable, fk, select, userId, maxRows, startTime } = args;
    const pageSize = this.pageSize ?? EXPORT_LIMITS.PAGE_SIZE;
    const chunkSize = EXPORT_LIMITS.VIA_PARENT_CHUNK;
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new ExportClassificationError('invalid_via_parent', table, 'VIA_PARENT_CHUNK must be a positive integer');
    }
    let pages = 0;
    const overCeiling = (parents: number): RepositoryResult<OwnedRowsForExport> => {
      this.logger.warn(
        { sectionId, table, userId, pages, parents, maxRows, duration: Date.now() - startTime },
        'Data export section is over the row ceiling'
      );
      return { data: { rows: [], overCeiling: true }, error: null };
    };

    // V-4: the ownership oracle. E-4: the tenant filter is first; the only select is `id`.
    const parentIds: string[] = [];
    const owned = new Set<string>();
    let lastParentId: string | null = null;
    for (;;) {
      let query = this.supabase.from(parentTable).select('id').eq('user_id', userId);
      if (lastParentId !== null) query = query.gt('id', lastParentId);
      const { data, error } = await query.order('id', { ascending: true }).limit(pageSize);
      pages += 1;
      if (error) throw error;
      // A dynamic select string types as an error shape; the rows are plain objects.
      const page = (data ?? []) as unknown as OwnedExportRow[];
      if (page.length === 0) break;
      for (const row of page) {
        const id = row.id;
        // C-6: checked before the id joins the set, so nothing odd can reach `.in()`.
        if (typeof id !== 'string' || !CANONICAL_UUID.test(id)) {
          throw new Error('Data export parent id is not a canonical uuid');
        }
        if (owned.has(id)) throw new Error('Data export parent ids repeated');
        owned.add(id);
        parentIds.push(id);
      }
      const pageLastId = page[page.length - 1].id as string;
      if (lastParentId !== null && !(pageLastId > lastParentId)) {
        throw new Error('Data export page did not advance past the previous page');
      }
      lastParentId = pageLastId;
      // C-4: an unbounded id list never builds up in memory or in queries.
      if (parentIds.length > EXPORT_LIMITS.ROW_CEILING) return overCeiling(parentIds.length);
    }

    const rows: OwnedExportRow[] = [];
    for (let start = 0; start < parentIds.length; start += chunkSize) {
      // V-5: a non-empty subset of the owned ids, as a plain string array.
      const chunk = parentIds.slice(start, start + chunkSize);
      const inChunk = new Set(chunk);
      // C-3: keyset paging restarts for every chunk.
      let lastId: string | null = null;
      for (;;) {
        let query = this.supabase.from(table).select(select).in(fk, chunk);
        if (lastId !== null) query = query.gt('id', lastId);
        const { data, error } = await query.order('id', { ascending: true }).limit(pageSize);
        pages += 1;
        if (error) throw error;
        const page = (data ?? []) as unknown as OwnedExportRow[];
        if (page.length === 0) break;

        // V-6 / C-1: every row belongs to a page of THIS chunk, or the section fails. Counts only.
        const unowned = page.filter((row) => typeof row.id !== 'string' || typeof row[fk] !== 'string' || !inChunk.has(row[fk] as string)).length;
        if (unowned > 0) {
          throw new Error(`Data export parent-scoped read returned ${unowned} rows outside the owned parents`);
        }
        const pageLastId = page[page.length - 1].id as string;
        if (lastId !== null && !(pageLastId > lastId)) {
          throw new Error('Data export page did not advance past the previous page');
        }
        lastId = pageLastId;

        for (const row of page) rows.push(row);
        if (rows.length > maxRows) return overCeiling(parentIds.length);
      }
    }

    // C-2: code-unit order (uuid byte order for PostgREST's lowercase canonical text), never localeCompare.
    rows.sort((a, b) => {
      const x = a.id as string;
      const y = b.id as string;
      return x < y ? -1 : x > y ? 1 : 0;
    });
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].id === rows[i - 1].id) throw new Error('Data export parent-scoped read found a repeated id');
    }

    this.logger.info(
      { sectionId, table, userId, pages, parents: parentIds.length, rows: rows.length, duration: Date.now() - startTime },
      'Data export section read'
    );
    return { data: { rows, overCeiling: false }, error: null };
  }
}

/** Export only (E-6): imported by lib/business-os/data-export/sections.ts alone. */
export const businessDataExportRepository = new BusinessDataExportRepository();
