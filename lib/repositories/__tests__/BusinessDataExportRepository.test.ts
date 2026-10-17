/**
 * BusinessDataExportRepository (DE-4; BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md
 * §2.1, §2.2, §2.4, §2.6, §8 U-5 / U-6; SA review DE-4 C-5, C-7, C-8).
 *
 * The one reader behind the `client_records` sections. Pinned here:
 * - U-5: the select string is the descriptor's columns (never `*`); the first
 *   filter is `.eq('user_id', id)`; keyset paging on `id` to an EMPTY page; the
 *   rowFilter only on contact_documents, quoted; the ceiling at maxRows + 1
 *   with no further page; fail closed (no query) on a bad descriptor;
 *   a non-advancing page fails the section instead of looping (C-8).
 * - U-6 (cross-tenant, C-7): an in-memory fake holding rows for tenants A and
 *   B in every table, honouring eq / gt / not / order / limit. The WHOLE
 *   registry runs for A; no B id appears anywhere. Its negative control (a fake
 *   that ignores `.eq('user_id')`) must show the leak.
 * - C-5: the exception's bounds E-1 (read-only) and E-6 (sole importer) by a
 *   source scan, with negative controls.
 *
 * `@/lib/supabaseServer` is a delegating stub, so the registry's singletons
 * read from whichever fake the test installs. Unit cases inject their client.
 *
 * DE-3 (BUSINESS_OS_DATA_EXPORT_DE3_WORKPLAN.md §7 X-7 / X-8): the four
 * account sections read from tables go through the same method, so U-5 and
 * U-6 run over them too. X-8: A's business profile points at one of B's
 * addresses (`address_id`); A's file holds that bare id and nothing else of
 * B's: the address book is read by its own `user_id`, never via the pointer.
 *
 * DE-5 (BUSINESS_OS_DATA_EXPORT_DE5_WORKPLAN.md §8 M-7, M-8, M-11; SA C-3,
 * C-8): the ten money sections go through the same method, so U-5 and U-6
 * run over them too. M-7 / C-8: B's refund names A's payment, B's instalment
 * names A's subscription AND A's invoice, A's instalment names B's plan: A's
 * file holds A's rows only, and A's bare pointer ids, never a row of B's.
 * Children are read by their own `user_id`, never by following a parent id.
 *
 * DE-6 (BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md §8 N-3, N-8, N-9, N-10; SA
 * C-1): nine DE-6 sections go through the keyset reader unchanged; the tenth,
 * `consent_settings` (no `id`, PK `user_id`), through the single-row branch:
 * 0 / 1 / 2 rows, the ceiling, the query shape (`eq('user_id')` then
 * `limit(2)`, no order, no gt) and fail-closed plants. N-8: B's step, B's
 * enrollment, B's consent event and B's subscriber all point at A's rows;
 * A's file holds none of them. The DE-6 cases are appended; nothing above
 * changed.
 *
 * DE-7 (BUSINESS_OS_DATA_EXPORT_DE7_WORKPLAN.md §2.6, §8 D-5…D-10, D-14,
 * D-19; SA review DE-7 C-1…C-6): four content sections go through the keyset
 * reader unchanged; `website_blocks` through the new parent-scoped read (the
 * owner's page ids first, then `.in('page_id', chunk)`, every block checked
 * against its chunk). The fake gains `in` and a negative-control option that
 * ignores it. The DE-7 cases are appended; nothing above changed but the fake.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type Call = [string, ...unknown[]];

let mockActiveClient: { from: (table: string) => unknown } = {
  from: () => {
    throw new Error('no fake client installed');
  },
};
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { from: (table: string) => mockActiveClient.from(table) } }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        mockLogged.push({
          level,
          fields: typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {},
          msg: typeof first === 'string' ? first : String(second ?? ''),
        });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { BusinessDataExportRepository } from '@/lib/repositories/BusinessDataExportRepository';
import { PURGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import type { PurgeDescriptor } from '@/lib/business-os/purge/types';
import { exportColumnsOf } from '@/lib/business-os/data-export/classification';
import type { ExportSectionId } from '@/lib/business-os/data-export/classificationTypes';
import { EXPORT_SECTIONS, runExportSections, type ExportContext } from '@/lib/business-os/data-export/sections';
// DE-7: the parent-scoped read's chunk size and parent-id bound, lowered per test (read at call time).
import { EXPORT_LIMITS } from '@/lib/business-os/data-export/limits';

// ── The fake ────────────────────────────────────────────────────────────────

interface FakeOptions {
  /** NEGATIVE CONTROL ONLY: drop `.eq('user_id', …)`, as a buggy reader would. */
  ignoreUserIdFilter?: boolean;
  /** DE-7 NEGATIVE CONTROL ONLY: drop `.in(…)`, as a PostgREST or proxy that ignored it would. */
  ignoreInFilter?: boolean;
  /** A PostgREST `max-rows` below the page size. */
  maxPerResponse?: number;
  errorOn?: Record<string, unknown>;
}

const FAKE_CALL_CAP = 200;

/** An in-memory PostgREST: applies the recorded filters, then order, then limit, then projects the select. */
function fakeClient(db: Record<string, Row[]>, options: FakeOptions = {}) {
  const log: Array<{ table: string; calls: Call[] }> = [];
  const client = {
    from(table: string) {
      if (log.length >= FAKE_CALL_CAP) throw new Error('fake call cap reached: the reader is looping');
      const calls: Call[] = [];
      log.push({ table, calls });
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'order', 'limit', 'range']) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      const run = (): { data: Row[] | null; error: unknown } => {
        if (options.errorOn?.[table]) return { data: null, error: options.errorOn[table] };
        let rows = [...(db[table] ?? [])];
        let columns: string[] = [];
        let order: { column: string; ascending: boolean } | null = null;
        let limit = Infinity;
        for (const [method, ...args] of calls) {
          if (method === 'select') {
            columns = String(args[0]).split(',').map((c) => c.trim());
            if (columns.includes('*')) throw new Error('select * is never allowed');
          } else if (method === 'eq') {
            if (options.ignoreUserIdFilter && args[0] === 'user_id') continue;
            rows = rows.filter((r) => r[String(args[0])] === args[1]);
          } else if (method === 'not') {
            if (args[1] !== 'in') throw new Error(`unsupported not ${String(args[1])}`);
            const values = String(args[2]).slice(1, -1).split(',').map((v) => v.replace(/^"|"$/g, ''));
            rows = rows.filter((r) => !values.includes(String(r[String(args[0])])));
          } else if (method === 'gt') {
            rows = rows.filter((r) => String(r[String(args[0])]) > String(args[1]));
          } else if (method === 'in') {
            // DE-7: PostgREST `in`, from a plain array (C-6), never a hand-built string.
            if (!Array.isArray(args[1])) throw new Error('in needs an array');
            if (options.ignoreInFilter) continue;
            const values = args[1] as unknown[];
            rows = rows.filter((r) => values.includes(r[String(args[0])]));
          } else if (method === 'order') {
            order = { column: String(args[0]), ascending: (args[1] as { ascending?: boolean })?.ascending !== false };
          } else if (method === 'limit') {
            limit = Number(args[0]);
          } else {
            throw new Error(`the fake does not support ${method}`);
          }
        }
        if (order) {
          const { column, ascending } = order;
          rows.sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (ascending ? 1 : -1));
        }
        rows = rows.slice(0, Math.min(limit, options.maxPerResponse ?? Infinity));
        return { data: rows.map((r) => Object.fromEntries(columns.filter((c) => c in r).map((c) => [c, r[c]]))), error: null };
      };
      builder.maybeSingle = () => {
        const { data, error } = run();
        return Promise.resolve({ data: data?.[0] ?? null, error });
      };
      builder.single = builder.maybeSingle;
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, log };
}

// ── Seed data ───────────────────────────────────────────────────────────────

const USER_A = 'a0a0a0a0-0000-4000-8000-00000000000a';
const USER_B = 'b0b0b0b0-0000-4000-8000-00000000000b';

/** A uuid-shaped id whose order interleaves the two tenants, so pages cross between them. */
function uid(tenant: 'a' | 'b', table: string, n: number): string {
  let h = 2166136261;
  for (const ch of `${tenant}:${table}:${n}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `${h.toString(16).padStart(8, '0')}-0000-4000-8000-${tenant.repeat(4)}${n.toString(16).padStart(8, '0')}`;
}

const DE4_SECTIONS: Record<string, ExportSectionId> = {
  crm_pipeline_stages: 'pipeline_stages',
  crm_contacts: 'clients',
  crm_activities: 'client_activities',
  crm_tasks: 'client_tasks',
  contact_documents: 'client_documents',
  scheduling_services: 'services',
  scheduling_bookings: 'bookings',
  scheduling_availability_exceptions: 'time_off',
};

/** DE-3: the four account sections read from tables (X-7). */
const DE3_SECTIONS: Record<string, ExportSectionId> = {
  user_preferences: 'preferences',
  notification_settings: 'notification_settings',
  business_profiles: 'business_profile',
  business_addresses: 'business_addresses',
};

/** DE-5: the ten money sections (two account, eight client_records). */
const DE5_SECTIONS: Record<string, ExportSectionId> = {
  stripe_connect_accounts: 'payment_account',
  payment_processors: 'payment_providers',
  proposals: 'quotes',
  payment_invoices: 'invoices',
  payment_transactions: 'payments',
  payment_refunds: 'refunds',
  payment_plans: 'payment_plans',
  payment_plan_subscriptions: 'client_payment_plans',
  payment_plan_installments: 'installments',
  saved_payment_methods: 'client_payment_methods',
};

/** Every table the registry reads through this repository. DE-5: + DE5_SECTIONS. */
const OWNED_SECTIONS: Record<string, ExportSectionId> = { ...DE3_SECTIONS, ...DE4_SECTIONS, ...DE5_SECTIONS };

/** A full row for `table`: every declared column, plus the ones the export must never select. */
function rowFor(table: string, tenant: 'a' | 'b', n: number, extra: Row = {}): Row {
  const userId = tenant === 'a' ? USER_A : USER_B;
  const row: Row = {};
  for (const column of exportColumnsOf(table)) row[column] = `${tenant}-${table}-${column}-${n}`;
  const d = PURGE_DESCRIPTORS.find((x) => x.table === table);
  if (d?.export.kind === 'include') {
    for (const column of Object.keys(d.export.excludedColumns ?? {})) row[column] = `${tenant}-EXCLUDED-${column}-${n}`;
  }
  return { ...row, id: uid(tenant, table, n), user_id: userId, ...extra };
}

/** Tenants A and B in every table the registry reads. A has > PAGE_SIZE activities (C-7). */
function seedBothTenants(): Record<string, Row[]> {
  const db: Record<string, Row[]> = {};
  for (const table of Object.keys(DE4_SECTIONS)) {
    db[table] = [];
    for (const tenant of ['a', 'b'] as const) {
      const count = table === 'crm_activities' && tenant === 'a' ? 1_003 : 3;
      for (let n = 0; n < count; n += 1) db[table].push(rowFor(table, tenant, n));
    }
  }
  // DE-3: one row per tenant in the 1:1 tables (user_id is unique live), two saved addresses each.
  for (const table of Object.keys(DE3_SECTIONS)) {
    db[table] = [];
    for (const tenant of ['a', 'b'] as const) {
      const count = table === 'business_addresses' ? 2 : 1;
      for (let n = 0; n < count; n += 1) db[table].push(rowFor(table, tenant, n));
    }
  }
  // DE-5: three rows per tenant in every money table.
  for (const table of Object.keys(DE5_SECTIONS)) {
    db[table] = [];
    for (const tenant of ['a', 'b'] as const) {
      for (let n = 0; n < 3; n += 1) db[table].push(rowFor(table, tenant, n));
    }
  }
  // C-7: A has an active, an archived and a deleted document.
  db.contact_documents = [
    rowFor('contact_documents', 'a', 0, { status: 'active' }),
    rowFor('contact_documents', 'a', 1, { status: 'archived' }),
    rowFor('contact_documents', 'a', 2, { status: 'deleted' }),
    rowFor('contact_documents', 'b', 0, { status: 'active' }),
    rowFor('contact_documents', 'b', 1, { status: 'archived' }),
  ];
  db.crm_contacts[0].source_metadata = {
    capture_channel: 'website',
    ip_hash: 'A-IP-HASH-NEVER-EXPORTED',
    user_agent: 'A-UA-NEVER-EXPORTED',
    session_id: 'A-SESSION-NEVER-EXPORTED',
  };
  db.profiles = [
    { id: USER_A, full_name: 'Owner A' },
    { id: USER_B, full_name: 'Owner B' },
  ];
  db.plugin_connections = [
    { user_id: USER_A, plugin_key: 'google-mail', profile_data: {} },
    { user_id: USER_B, plugin_key: 'slack', profile_data: {} },
  ];
  return db;
}

/** B's identifiers anywhere in `text`: its user id, any of its row ids, any of its values. */
function foreignMarkers(text: string, db: Record<string, Row[]>): string[] {
  const markers = new Set<string>([USER_B, 'Owner B']);
  for (const rows of Object.values(db)) {
    for (const r of rows) if (r.user_id === USER_B || r.id === USER_B) markers.add(String(r.id ?? r.plugin_key));
  }
  for (const r of db.plugin_connections) if (r.user_id === USER_B) markers.add(String(r.plugin_key));
  markers.add('b-crm_contacts-first_name-0');
  return [...markers].filter((m) => text.includes(m));
}

const CTX_A: ExportContext = { userId: USER_A, authUser: { id: USER_A, email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' } };
const silentLogger = { error: () => undefined };

beforeEach(() => {
  mockLogged.length = 0;
});

// ── U-5 ─────────────────────────────────────────────────────────────────────

describe('U-5 listOwnedRowsForExport: one table, paged to the end', () => {
  // DE-3 X-7: + the four account sections read from tables.
  it.each(Object.entries(OWNED_SECTIONS))('%s: select = exportColumnsOf, eq user_id first, keyset on id', async (table, section) => {
    const db: Record<string, Row[]> = { [table]: [0, 1, 2, 3, 4].map((n) => rowFor(table, 'a', n)) };
    const { client, log } = fakeClient(db);
    const result = await new BusinessDataExportRepository(client, { pageSize: 2 }).listOwnedRowsForExport(section, USER_A, { maxRows: 100 });
    expect(result.error).toBeNull();
    // Archived/active/whatever: rowFor sets status to a non-deleted value, so all five come back.
    expect(result.data?.rows).toHaveLength(5);
    expect(result.data?.overCeiling).toBe(false);
    // 2 + 2 + 1 + the empty page that ends the loop.
    expect(log).toHaveLength(4);
    expect(new Set(log.map((l) => l.table))).toEqual(new Set([table]));
    const select = exportColumnsOf(table).join(', ');
    const filter: Call[] = table === 'contact_documents' ? [['not', 'status', 'in', '("deleted")']] : [];
    const sorted = [...db[table]].map((r) => String(r.id)).sort();
    expect(log[0].calls).toEqual([['select', select], ['eq', 'user_id', USER_A], ...filter, ['order', 'id', { ascending: true }], ['limit', 2]]);
    expect(log[1].calls).toEqual([['select', select], ['eq', 'user_id', USER_A], ...filter, ['gt', 'id', sorted[1]], ['order', 'id', { ascending: true }], ['limit', 2]]);
    expect(log[3].calls).toContainEqual(['gt', 'id', sorted[4]]);
    // Rows come back in id order, with exactly the declared columns.
    expect(result.data?.rows.map((r) => r.id)).toEqual(sorted);
    for (const r of result.data?.rows ?? []) expect(Object.keys(r)).toEqual(exportColumnsOf(table));
    // Never the excluded columns, never the owner id.
    expect(JSON.stringify(result.data)).not.toContain('EXCLUDED');
    expect(JSON.stringify(result.data)).not.toContain(USER_A);
  });

  it('uses the Phase 1 page size by default (1000)', async () => {
    const { client, log } = fakeClient({ crm_tasks: [] });
    await new BusinessDataExportRepository(client).listOwnedRowsForExport('client_tasks', USER_A, { maxRows: 10 });
    expect(log[0].calls).toContainEqual(['limit', 1000]);
  });

  it('negative control: a max-rows of 500 (short pages) still yields every row, ending on an empty page', async () => {
    const db = { crm_activities: Array.from({ length: 1_200 }, (_, n) => rowFor('crm_activities', 'a', n)) };
    const { client, log } = fakeClient(db, { maxPerResponse: 500 });
    const result = await new BusinessDataExportRepository(client).listOwnedRowsForExport('client_activities', USER_A, { maxRows: 100_000 });
    expect(result.data?.rows).toHaveLength(1_200);
    expect(new Set(result.data?.rows.map((r) => r.id)).size).toBe(1_200);
    expect(log).toHaveLength(4);
  });

  it('contact_documents: deleted rows out, archived in; no other table gets a row filter', async () => {
    const db = {
      contact_documents: [
        rowFor('contact_documents', 'a', 0, { status: 'active' }),
        rowFor('contact_documents', 'a', 1, { status: 'archived' }),
        rowFor('contact_documents', 'a', 2, { status: 'deleted' }),
      ],
      scheduling_bookings: [rowFor('scheduling_bookings', 'a', 0, { status: 'cancelled' }), rowFor('scheduling_bookings', 'a', 1, { status: 'no_show' })],
    };
    const { client, log } = fakeClient(db);
    const repo = new BusinessDataExportRepository(client);
    const docs = await repo.listOwnedRowsForExport('client_documents', USER_A, { maxRows: 10 });
    expect(docs.data?.rows.map((r) => r.status).sort()).toEqual(['active', 'archived']);
    const bookings = await repo.listOwnedRowsForExport('bookings', USER_A, { maxRows: 10 });
    // Cancelled and no-show are statuses, not deletes (BC-2).
    expect(bookings.data?.rows).toHaveLength(2);
    const bookingCalls = log.filter((l) => l.table === 'scheduling_bookings').flatMap((l) => l.calls);
    expect(bookingCalls.some((c) => c[0] === 'not')).toBe(false);
  });

  it('the ceiling: exactly maxRows is exported; maxRows + 1 is overCeiling with no rows and no further page', async () => {
    const db = { crm_tasks: Array.from({ length: 10 }, (_, n) => rowFor('crm_tasks', 'a', n)) };
    const at = fakeClient(db);
    const exact = await new BusinessDataExportRepository(at.client, { pageSize: 3 }).listOwnedRowsForExport('client_tasks', USER_A, { maxRows: 10 });
    expect(exact.data).toMatchObject({ overCeiling: false });
    expect(exact.data?.rows).toHaveLength(10);

    const over = fakeClient(db);
    const result = await new BusinessDataExportRepository(over.client, { pageSize: 3 }).listOwnedRowsForExport('client_tasks', USER_A, { maxRows: 5 });
    expect(result).toEqual({ data: { rows: [], overCeiling: true }, error: null });
    // Page 1 (3 rows), page 2 (6 > 5): stop. No third page.
    expect(over.log).toHaveLength(2);
    expect(mockLogged.find((l) => l.msg === 'Data export section is over the row ceiling')?.level).toBe('warn');

    const zero = fakeClient(db);
    const none = await new BusinessDataExportRepository(zero.client).listOwnedRowsForExport('client_tasks', USER_A, { maxRows: 0 });
    expect(none.data?.overCeiling).toBe(true);
  });

  it('an empty table is ok with 0 rows after one query', async () => {
    const { client, log } = fakeClient({});
    const result = await new BusinessDataExportRepository(client).listOwnedRowsForExport('time_off', USER_A, { maxRows: 10 });
    expect(result).toEqual({ data: { rows: [], overCeiling: false }, error: null });
    expect(log).toHaveLength(1);
  });

  it('a PostgREST error returns { data: null, error } and logs { err } with ids only', async () => {
    const pgError = { message: 'column crm_tasks.secret does not exist', code: '42703' };
    const { client } = fakeClient({}, { errorOn: { crm_tasks: pgError } });
    const result = await new BusinessDataExportRepository(client).listOwnedRowsForExport('client_tasks', USER_A, { maxRows: 10 });
    expect(result).toEqual({ data: null, error: pgError });
    const errorLine = mockLogged.find((l) => l.level === 'error');
    expect(errorLine?.msg).toBe('Failed to read owned rows for the data export');
    expect(errorLine?.fields).toMatchObject({ err: pgError, sectionId: 'client_tasks', table: 'crm_tasks', userId: USER_A });
  });

  it('C-8: a page that does not advance fails the section instead of looping', async () => {
    const stuck = [rowFor('crm_tasks', 'a', 0), rowFor('crm_tasks', 'a', 1)].sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1));
    const log: string[] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'not', 'gt', 'order', 'limit']) builder[m] = () => builder;
    builder.then = (resolve: (v: unknown) => unknown) => {
      if (log.length > 20) throw new Error('looping');
      return Promise.resolve({ data: stuck, error: null }).then(resolve);
    };
    const client = { from: (t: string) => (log.push(t), builder) } as unknown as SupabaseClient;
    const result = await new BusinessDataExportRepository(client, { pageSize: 2 }).listOwnedRowsForExport('client_tasks', USER_A, { maxRows: 100 });
    expect(result.data).toBeNull();
    expect(String(result.error?.message)).toMatch(/did not advance/);
    expect(log).toHaveLength(2);
  });

  describe('fails closed with no query (E-2, E-3)', () => {
    const replace = (table: string, patch: (d: PurgeDescriptor) => PurgeDescriptor): PurgeDescriptor[] =>
      PURGE_DESCRIPTORS.map((d) => (d.table === table ? patch(d) : d));
    const tasks = PURGE_DESCRIPTORS.find((d) => d.table === 'crm_tasks')!;
    const tasksInclude = tasks.export.kind === 'include' ? tasks.export : null;

    it.each<[string, PurgeDescriptor[] | undefined, ExportSectionId]>([
      ['a planned table', replace('crm_tasks', (d) => ({ ...d, export: { kind: 'planned', slice: 'DE-4' } })), 'client_tasks'],
      ['an excluded table', replace('crm_tasks', (d) => ({ ...d, export: { kind: 'exclude', reason: 'x' } })), 'client_tasks'],
      ['an unknown section', undefined, 'calendar_busy_times' as ExportSectionId],
      ['a non-table section', undefined, 'account_identity'],
      ['a via-scoped descriptor', replace('crm_tasks', (d) => ({ ...d, scope: { kind: 'via', parent: 'crm_contacts', fk: 'contact_id' } })), 'client_tasks'],
      ['a deny-listed column planted in a copy', replace('crm_tasks', (d) => ({ ...d, export: { ...tasksInclude!, columns: [...tasksInclude!.columns, 'access_token'] } })), 'client_tasks'],
      ['a list without id', replace('crm_tasks', (d) => ({ ...d, export: { ...tasksInclude!, columns: tasksInclude!.columns.filter((c) => c !== 'id') } })), 'client_tasks'],
      ['a malformed row-filter value', replace('contact_documents', (d) => (d.export.kind === 'include' ? { ...d, export: { ...d.export, rowFilter: { column: 'status', notIn: ['a,b'], reason: 'r' } } } : d)), 'client_documents'],
    ])('%s', async (_name, descriptors, section) => {
      const { client, log } = fakeClient({ crm_tasks: [rowFor('crm_tasks', 'a', 0)] });
      const result = await new BusinessDataExportRepository(client, { descriptors }).listOwnedRowsForExport(section, USER_A, { maxRows: 10 });
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(log).toHaveLength(0);
    });

    it.each([
      ['an empty user id', '', 10],
      ['a negative budget', USER_A, -1],
      ['a fractional budget', USER_A, 1.5],
    ])('Zod: %s', async (_name, userId, maxRows) => {
      const { client, log } = fakeClient({});
      const result = await new BusinessDataExportRepository(client).listOwnedRowsForExport('client_tasks', userId, { maxRows });
      expect(result.data).toBeNull();
      expect(log).toHaveLength(0);
    });
  });

  it('logs ids and counts only, never row content', async () => {
    const db = { crm_contacts: [rowFor('crm_contacts', 'a', 0, { first_name: 'Dana-Client-Name', email: 'dana@example.com' })] };
    const { client } = fakeClient(db);
    await new BusinessDataExportRepository(client).listOwnedRowsForExport('clients', USER_A, { maxRows: 10 });
    const read = mockLogged.find((l) => l.msg === 'Data export section read');
    expect(read?.level).toBe('info');
    expect(Object.keys(read?.fields ?? {}).sort()).toEqual(['duration', 'pages', 'rows', 'sectionId', 'table', 'userId']);
    expect(read?.fields).toMatchObject({ sectionId: 'clients', table: 'crm_contacts', userId: USER_A, pages: 2, rows: 1 });
    const logged = JSON.stringify(mockLogged);
    expect(logged).not.toContain('Dana-Client-Name');
    expect(logged).not.toContain('dana@example.com');
  });
});

// ── U-6 cross-tenant ────────────────────────────────────────────────────────

describe('U-6 cross-tenant: the whole registry for A returns only A (C-7)', () => {
  it("A's export holds every A row, no B id or value, deleted documents out, paging past PAGE_SIZE", async () => {
    const db = seedBothTenants();
    const fake = fakeClient(db);
    mockActiveClient = fake.client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    expect(run.overCeiling).toBe(false);
    for (const s of run.sections) expect([s.id, s.status]).toEqual([s.id, 'ok']);
    const text = JSON.stringify(run.sections);

    expect(foreignMarkers(text, db)).toEqual([]);

    const byId = Object.fromEntries(run.sections.map((s) => [s.id, s]));
    expect(byId.client_activities.row_count).toBe(1_003);
    expect(byId.client_documents.rows.map((r) => (r as Row).status).sort()).toEqual(['active', 'archived']);
    // DE-3: and the four account sections read from tables.
    for (const [table, section] of Object.entries(OWNED_SECTIONS)) {
      const expected = db[table].filter((r) => r.user_id === USER_A && r.status !== 'deleted').map((r) => String(r.id)).sort();
      expect(byId[section].rows.map((r) => String((r as Row).id))).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
    }
    // The source_metadata allow-list held through the real reader.
    expect(text).not.toContain('NEVER-EXPORTED');
    expect((byId.clients.rows as Row[]).find((r) => r.id === db.crm_contacts[0].id)?.source_metadata).toEqual({ capture_channel: 'website' });
    // Every DE-4 (and DE-3) query's first filter is the session id.
    const owned = fake.log.filter((l) => l.table in OWNED_SECTIONS);
    expect(new Set(owned.map((l) => l.table))).toEqual(new Set(Object.keys(OWNED_SECTIONS)));
    for (const entry of owned) {
      expect(entry.calls[1]).toEqual(['eq', 'user_id', USER_A]);
    }
    // Paging crossed tenants' ids: the activities took 2 data pages + the empty one.
    expect(fake.log.filter((l) => l.table === 'crm_activities')).toHaveLength(3);
  });

  it('negative control: a fake that ignores .eq(user_id) shows the leak (the test can see one)', async () => {
    const db = seedBothTenants();
    mockActiveClient = fakeClient(db, { ignoreUserIdFilter: true }).client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    expect(foreignMarkers(JSON.stringify(run.sections), db).length).toBeGreaterThan(0);
  });

  // DE-3 X-8 (tenant-isolation-guard): a crossed pointer carries an id, never an address.
  it("X-8: A's profile naming B's address id exports that bare id only; B's address stays out", async () => {
    const db = seedBothTenants();
    const bAddress = db.business_addresses.find((r) => r.user_id === USER_B)!;
    const aProfile = db.business_profiles.find((r) => r.user_id === USER_A)!;
    aProfile.address_id = bAddress.id;
    mockActiveClient = fakeClient(db).client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    const byId = Object.fromEntries(run.sections.map((s) => [s.id, s]));
    const text = JSON.stringify(run.sections);
    // The pointer is exported as held, a bare uuid on A's own row.
    expect((byId.business_profile.rows[0] as Row).address_id).toBe(bAddress.id);
    // The address book holds A's addresses only: B's row is never read through the pointer.
    expect(byId.business_addresses.rows.map((r) => (r as Row).id)).toEqual(
      db.business_addresses.filter((r) => r.user_id === USER_A).map((r) => r.id).sort()
    );
    for (const value of Object.values(bAddress)) if (value !== bAddress.id) expect(text).not.toContain(String(value));
    // Of B's markers, only that one id appears.
    expect(foreignMarkers(text, db)).toEqual([String(bAddress.id)]);
  });

  it('X-8 negative control: a fake that ignores .eq(user_id) puts B\'s address in the book', async () => {
    const db = seedBothTenants();
    mockActiveClient = fakeClient(db, { ignoreUserIdFilter: true }).client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    const book = run.sections.find((s) => s.id === 'business_addresses')!;
    expect(book.rows.some((r) => (r as Row).id === db.business_addresses.find((x) => x.user_id === USER_B)!.id)).toBe(true);
  });
});

// ── C-5: the exception's bounds ─────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REPO_FILE = path.join(REPO_ROOT, 'lib', 'repositories', 'BusinessDataExportRepository.ts');

/** Source with comments and string contents removed, so only code is matched. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''");
}

const WRITES = /\.(insert|update|upsert|delete|rpc)\s*\(/;

describe('C-5 E-1: read-only', () => {
  it('the repository calls no insert / update / upsert / delete / rpc', () => {
    const code = codeOnly(fs.readFileSync(REPO_FILE, 'utf-8'));
    expect(code).toMatch(/\.select\(/);
    expect(code.match(WRITES)).toBeNull();
  });

  it('negative controls: each write is flagged; one in a comment or a string is not', () => {
    for (const w of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
      expect(WRITES.test(codeOnly(`await this.supabase.from(t).${w}({ a: 1 });`))).toBe(true);
    }
    expect(WRITES.test(codeOnly("// .delete( here\nconst s = '.update(';"))).toBe(false);
  });
});

/**
 * Every .ts / .tsx file, tracked or new, that names the repository at all.
 * `git grep` (precedent: the tailwind and security-definer guards use git) is
 * milliseconds; walking and reading ~4,000 files was seconds (C-12).
 */
function filesNamingTheRepository(): string[] {
  const out = execFileSync(
    'git',
    ['grep', '-l', '-z', '--untracked', '-e', 'BusinessDataExportRepository', '--', '*.ts', '*.tsx', ':!node_modules', ':!.claude'],
    { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 }
  ).toString('utf-8');
  return out.split('\0').filter(Boolean).map((f) => path.join(REPO_ROOT, f));
}

const IMPORTS_IT = /(?:from|import|require\()\s*\(?\s*['"][^'"]*\/BusinessDataExportRepository['"]/;
const ALLOWED_IMPORTER = path.join('lib', 'business-os', 'data-export', 'sections.ts');

function disallowedImporters(files: readonly string[], read: (f: string) => string): string[] {
  return files
    .filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`))
    .filter((f) => path.relative(REPO_ROOT, f) !== ALLOWED_IMPORTER)
    .filter((f) => path.relative(REPO_ROOT, f) !== path.join('lib', 'repositories', 'BusinessDataExportRepository.ts'))
    .filter((f) => IMPORTS_IT.test(read(f)))
    .map((f) => path.relative(REPO_ROOT, f));
}

describe('C-5 E-6: the sole importer is data-export/sections.ts', () => {
  it('scanned the source tree (non-vacuous), and sections.ts is the one importer', () => {
    const files = filesNamingTheRepository();
    const relative = files.map((f) => path.relative(REPO_ROOT, f));
    // Non-vacuous: the scan sees the importer, the repository and this test.
    expect(relative).toEqual(expect.arrayContaining([ALLOWED_IMPORTER, path.join('lib', 'repositories', '__tests__', 'BusinessDataExportRepository.test.ts')]));
    const read = (f: string) => fs.readFileSync(f, 'utf-8');
    expect(IMPORTS_IT.test(read(path.join(REPO_ROOT, ALLOWED_IMPORTER)))).toBe(true);
    expect(disallowedImporters(files, read)).toEqual([]);
    // Not re-exported from the repositories index.
    expect(read(path.join(REPO_ROOT, 'lib', 'repositories', 'index.ts'))).not.toMatch(/BusinessDataExportRepository/);
  });

  it('negative control: a planted importer is flagged', () => {
    const planted = path.join(REPO_ROOT, 'lib', 'services', 'Planted.ts');
    const read = (f: string) =>
      f === planted ? "import { businessDataExportRepository } from '@/lib/repositories/BusinessDataExportRepository';" : '';
    expect(disallowedImporters([planted], read)).toEqual([path.join('lib', 'services', 'Planted.ts')]);
  });
});

// ── DE-5: client money (M-7, M-8, M-11; SA C-3, C-8) ─────────────────────────

describe('DE-5 M-7 / C-8 cross-tenant pointers carry a bare id, never a row', () => {
  const byOwner = (db: Record<string, Row[]>, table: string, owner: string) => db[table].filter((r) => r.user_id === owner);

  /** Both tenants in the ten money tables only (the other sections read empty), so the whole-registry runs stay fast (SA C-9). */
  function seedMoneyOnly(): Record<string, Row[]> {
    const db: Record<string, Row[]> = { plugin_connections: [] };
    for (const table of Object.keys(DE5_SECTIONS)) {
      db[table] = [];
      for (const tenant of ['a', 'b'] as const) for (let n = 0; n < 3; n += 1) db[table].push(rowFor(table, tenant, n));
    }
    return db;
  }

  function crossedSeed(): { db: Record<string, Row[]>; bRefund: Row; bInstallment: Row; aInstallment: Row; aPayment: Row; aSub: Row; aInvoice: Row; bPlan: Row } {
    const db = seedMoneyOnly();
    const aPayment = byOwner(db, 'payment_transactions', USER_A)[0];
    const aSub = byOwner(db, 'payment_plan_subscriptions', USER_A)[0];
    const aInvoice = byOwner(db, 'payment_invoices', USER_A)[0];
    const bPlan = byOwner(db, 'payment_plans', USER_B)[0];
    // B's refund names A's payment; B's instalment names A's subscription AND A's invoice.
    const bRefund = byOwner(db, 'payment_refunds', USER_B)[0];
    bRefund.transaction_id = aPayment.id;
    bRefund.amount = 'QA-B-REFUND-AMOUNT-NEVER';
    const bInstallment = byOwner(db, 'payment_plan_installments', USER_B)[0];
    bInstallment.subscription_id = aSub.id;
    bInstallment.invoice_id = aInvoice.id;
    bInstallment.label = 'QA-B-INSTALMENT-NEVER';
    // A's instalment names B's plan.
    const aInstallment = byOwner(db, 'payment_plan_installments', USER_A)[0];
    aInstallment.payment_plan_id = bPlan.id;
    return { db, bRefund, bInstallment, aInstallment, aPayment, aSub, aInvoice, bPlan };
  }

  it("A's export holds every A money row and none of B's, though B's rows name A's payment, subscription and invoice", async () => {
    const seeded = crossedSeed();
    const fake = fakeClient(seeded.db);
    mockActiveClient = fake.client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    expect(run.overCeiling).toBe(false);
    const byId = Object.fromEntries(run.sections.map((s) => [s.id, s]));
    const text = JSON.stringify(run.sections);
    for (const [table, section] of Object.entries(DE5_SECTIONS)) {
      expect(byId[section].status).toBe('ok');
      expect(byId[section].rows.map((r) => String((r as Row).id))).toEqual(byOwner(seeded.db, table, USER_A).map((r) => String(r.id)).sort());
    }
    // B's refund and instalment are absent although they point at A's rows.
    expect(byId.refunds.rows.map((r) => (r as Row).id)).not.toContain(seeded.bRefund.id);
    expect(byId.installments.rows.map((r) => (r as Row).id)).not.toContain(seeded.bInstallment.id);
    for (const leaked of ['QA-B-REFUND-AMOUNT-NEVER', 'QA-B-INSTALMENT-NEVER']) expect(text).not.toContain(leaked);
    // A's instalment exports B's plan id as held, a bare uuid; B's plan row is not in payment_plans.
    expect((byId.installments.rows as Row[]).find((r) => r.id === seeded.aInstallment.id)?.payment_plan_id).toBe(seeded.bPlan.id);
    expect(byId.payment_plans.rows.map((r) => (r as Row).id)).not.toContain(seeded.bPlan.id);
    expect(text).not.toContain(String(seeded.bPlan.name));
    // Of B's markers, only that one pointer id appears.
    expect(foreignMarkers(text, seeded.db)).toEqual([String(seeded.bPlan.id)]);
    // Children were read by their own user_id: no query on a money table filters by a parent id.
    const money = fake.log.filter((l) => l.table in DE5_SECTIONS);
    expect(new Set(money.map((l) => l.table))).toEqual(new Set(Object.keys(DE5_SECTIONS)));
    for (const entry of money) {
      expect(entry.calls[1]).toEqual(['eq', 'user_id', USER_A]);
      expect(entry.calls.filter((c) => c[0] === 'eq')).toEqual([['eq', 'user_id', USER_A]]);
      expect(entry.calls.some((c) => c[0] === 'in' || c[0] === 'not')).toBe(false);
    }
  });

  it("negative control: a fake that ignores .eq(user_id) puts B's refund (naming A's payment) in A's file", async () => {
    const seeded = crossedSeed();
    mockActiveClient = fakeClient(seeded.db, { ignoreUserIdFilter: true }).client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    const refunds = run.sections.find((s) => s.id === 'refunds')!;
    expect(refunds.rows.some((r) => (r as Row).id === seeded.bRefund.id)).toBe(true);
    const installments = run.sections.find((s) => s.id === 'installments')!;
    expect(installments.rows.some((r) => (r as Row).id === seeded.bInstallment.id)).toBe(true);
  });
});

describe('DE-5 M-8 all history is in: every status, no row filter on a money table', () => {
  const STATUSES: Record<string, string[]> = {
    payment_transactions: ['succeeded', 'failed', 'pending', 'refunded'],
    payment_refunds: ['succeeded', 'failed', 'cancelled'],
    payment_invoices: ['draft', 'sent', 'paid', 'cancelled', 'refunded', 'overdue'],
    proposals: ['draft', 'sent', 'accepted', 'declined', 'superseded', 'stopped', 'withdrawn'],
    payment_plan_subscriptions: ['active', 'past_due', 'cancelled', 'completed'],
    payment_plan_installments: ['pending', 'paid', 'overdue', 'cancelled'],
  };

  it.each(Object.entries(STATUSES))('%s: every seeded status is exported', async (table, statuses) => {
    const db = { [table]: statuses.map((status, n) => rowFor(table, 'a', n, { status })) };
    const { client, log } = fakeClient(db);
    const result = await new BusinessDataExportRepository(client).listOwnedRowsForExport(DE5_SECTIONS[table], USER_A, { maxRows: 100 });
    expect(result.data?.rows.map((r) => r.status).sort()).toEqual([...statuses].sort());
    expect(log.flatMap((l) => l.calls).some((c) => c[0] === 'not')).toBe(false);
  });

  it('inactive plans and disconnected providers are in', async () => {
    const db = {
      payment_plans: [rowFor('payment_plans', 'a', 0, { is_active: false }), rowFor('payment_plans', 'a', 1, { is_active: true })],
      payment_processors: [rowFor('payment_processors', 'a', 0, { connection_status: 'disconnected', is_active: false })],
    };
    const repo = new BusinessDataExportRepository(fakeClient(db).client);
    expect((await repo.listOwnedRowsForExport('payment_plans', USER_A, { maxRows: 10 })).data?.rows).toHaveLength(2);
    expect((await repo.listOwnedRowsForExport('payment_providers', USER_A, { maxRows: 10 })).data?.rows).toHaveLength(1);
  });
});

describe('DE-5 M-11 / C-3 secrets and metadata through the real reader', () => {
  it('credentials, idempotency_key and the refund / subscription metadata are never selected', async () => {
    const db: Record<string, Row[]> = {};
    for (const table of Object.keys(DE5_SECTIONS)) db[table] = [rowFor(table, 'a', 0)];
    db.payment_processors[0].credentials = { secret_key: 'sk_live_QA_NEVER' };
    const { client, log } = fakeClient(db);
    const repo = new BusinessDataExportRepository(client);
    const out: Row[] = [];
    for (const section of Object.values(DE5_SECTIONS)) out.push(...((await repo.listOwnedRowsForExport(section, USER_A, { maxRows: 10 })).data?.rows ?? []));
    const selects = Object.fromEntries(log.map((l) => [l.table, String(l.calls[0][1])]));
    const columnsOf = (table: string) => selects[table].split(', ');
    expect(columnsOf('payment_processors')).not.toContain('credentials');
    expect(columnsOf('payment_refunds')).not.toContain('idempotency_key');
    expect(columnsOf('payment_refunds')).not.toContain('metadata');
    expect(columnsOf('payment_plan_subscriptions')).not.toContain('metadata');
    expect(columnsOf('payment_transactions')).toContain('metadata');
    expect(JSON.stringify(out)).not.toContain('sk_live_QA_NEVER');
    expect(JSON.stringify(out)).not.toContain('EXCLUDED');
  });

  it('payments.metadata through the registry: only notes and source, as strings', async () => {
    // Only the payments table is seeded (the other sections read empty), so the run stays fast (SA C-9).
    const db: Record<string, Row[]> = { payment_transactions: [rowFor('payment_transactions', 'a', 0), rowFor('payment_transactions', 'b', 0)] };
    const aPayment = db.payment_transactions.find((r) => r.user_id === USER_A)!;
    aPayment.metadata = {
      notes: 'Bank transfer, ref 42',
      source: 'manual_mark_paid',
      checkout_session_id: 'cs_QA_NEVER',
      connect_account_id: 'acct_QA_NEVER',
      client_secret: 'pi_QA_secret_NEVER',
      unknown_key: 'QA-UNKNOWN-NEVER',
    };
    mockActiveClient = fakeClient(db).client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    const payments = run.sections.find((s) => s.id === 'payments')!;
    expect((payments.rows as Row[]).find((r) => r.id === aPayment.id)?.metadata).toEqual({ notes: 'Bank transfer, ref 42', source: 'manual_mark_paid' });
    expect(JSON.stringify(run.sections)).not.toContain('QA_NEVER');
    expect(JSON.stringify(run.sections)).not.toContain('QA-UNKNOWN-NEVER');
  });
});

// ── DE-6 (BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md §8 N-3, N-8, N-9, N-10; SA review DE-6 C-1) ──

/** DE-6: the nine paged sections (each table has an `id`). */
const DE6_PAGED_SECTIONS: Record<string, ExportSectionId> = {
  user_intake_settings: 'intake_settings',
  business_intake_forms: 'intake_forms',
  email_campaigns: 'email_campaigns',
  email_sequences: 'email_sequences',
  email_sequence_steps: 'email_sequence_steps',
  email_sequence_enrollments: 'email_sequence_enrollments',
  business_subscribers: 'newsletter_subscribers',
  marketing_consent_events: 'consent_records',
  email_unsubscribes: 'email_unsubscribes',
};
/** DE-6: all ten, the single-row `consent_settings` included (SA-Q1). */
const DE6_SECTIONS: Record<string, ExportSectionId> = { ...DE6_PAGED_SECTIONS, marketing_consent_settings: 'consent_settings' };

/** A consent-settings row: no `id` (PK `user_id`), every declared column plus the owner id. */
function settingsRow(tenant: 'a' | 'b', n = 0, extra: Row = {}): Row {
  const row: Row = {};
  for (const column of exportColumnsOf('marketing_consent_settings')) row[column] = `${tenant}-settings-${column}-${n}`;
  return { ...row, user_id: tenant === 'a' ? USER_A : USER_B, ...extra };
}

describe('DE-6 the nine paged sections go through the keyset reader unchanged', () => {
  it.each(Object.entries(DE6_PAGED_SECTIONS))('%s: select = exportColumnsOf, eq user_id first, keyset on id', async (table, section) => {
    const db: Record<string, Row[]> = { [table]: [0, 1, 2].map((n) => rowFor(table, 'a', n)) };
    const { client, log } = fakeClient(db);
    const result = await new BusinessDataExportRepository(client, { pageSize: 2 }).listOwnedRowsForExport(section, USER_A, { maxRows: 100 });
    expect(result.error).toBeNull();
    expect(result.data?.rows).toHaveLength(3);
    const select = exportColumnsOf(table).join(', ');
    expect(log[0].calls).toEqual([['select', select], ['eq', 'user_id', USER_A], ['order', 'id', { ascending: true }], ['limit', 2]]);
    expect(log).toHaveLength(3);
    for (const r of result.data?.rows ?? []) expect(Object.keys(r)).toEqual(exportColumnsOf(table));
    expect(JSON.stringify(result.data)).not.toContain('EXCLUDED');
  });
});

describe('DE-6 N-9 the single-row read (SA-Q1 (4), (5))', () => {
  const read = (db: Record<string, Row[]>, maxRows = 10) => {
    const fake = fakeClient(db);
    const repo = new BusinessDataExportRepository(fake.client, { pageSize: 2 });
    return { fake, result: repo.listOwnedRowsForExport('consent_settings', USER_A, { maxRows }) };
  };
  const SELECT = exportColumnsOf('marketing_consent_settings').join(', ');

  it('0 rows: ok, empty, after exactly one query', async () => {
    const { fake, result } = read({ marketing_consent_settings: [settingsRow('b')] });
    expect(await result).toEqual({ data: { rows: [], overCeiling: false }, error: null });
    expect(fake.log).toHaveLength(1);
  });

  it('1 row: ok; the query is eq(user_id) then limit(2), with no order and no gt; the declared columns only', async () => {
    const { fake, result } = read({ marketing_consent_settings: [settingsRow('b'), settingsRow('a')] });
    const r = await result;
    expect(r.error).toBeNull();
    expect(r.data?.rows).toEqual([Object.fromEntries(exportColumnsOf('marketing_consent_settings').map((c) => [c, `a-settings-${c}-0`]))]);
    expect(fake.log).toHaveLength(1);
    expect(fake.log[0]).toEqual({ table: 'marketing_consent_settings', calls: [['select', SELECT], ['eq', 'user_id', USER_A], ['limit', 2]] });
    // B's settings row is never returned to A, and the owner id is not selected.
    const text = JSON.stringify(r.data);
    expect(text).not.toContain('b-settings');
    expect(text).not.toContain(USER_A);
    const info = mockLogged.find((l) => l.msg === 'Data export section read');
    expect(info?.fields).toMatchObject({ sectionId: 'consent_settings', table: 'marketing_consent_settings', userId: USER_A, pages: 1, rows: 1 });
  });

  it('2 rows: fails closed (section failed); the log carries counts only, never row content', async () => {
    const { result } = read({ marketing_consent_settings: [settingsRow('a', 0), settingsRow('a', 1)] });
    const r = await result;
    expect(r.data).toBeNull();
    expect(r.error).toBeInstanceOf(Error);
    expect(r.error?.message).toBe('Data export single-row read found 2 rows for one owner');
    const logged = JSON.stringify(mockLogged);
    expect(logged).not.toContain('a-settings');
  });

  it('maxRows 0 with 1 row: over the ceiling, no rows', async () => {
    const { result } = read({ marketing_consent_settings: [settingsRow('a')] }, 0);
    expect(await result).toEqual({ data: { rows: [], overCeiling: true }, error: null });
    expect(mockLogged.find((l) => l.msg === 'Data export section is over the row ceiling')?.fields).toMatchObject({ pages: 1, maxRows: 0 });
  });

  it('a PostgREST error fails the section', async () => {
    const fake = fakeClient({}, { errorOn: { marketing_consent_settings: new Error('down') } });
    const r = await new BusinessDataExportRepository(fake.client).listOwnedRowsForExport('consent_settings', USER_A, { maxRows: 10 });
    expect(r.data).toBeNull();
  });

  describe('fails closed with no query', () => {
    const settings = PURGE_DESCRIPTORS.find((d) => d.table === 'marketing_consent_settings')!;
    const e = settings.export as Extract<PurgeDescriptor['export'], { kind: 'include' }>;
    const replace = (patch: PurgeDescriptor): PurgeDescriptor[] => PURGE_DESCRIPTORS.map((d) => (d.table === settings.table ? patch : d));

    it.each<[string, PurgeDescriptor[]]>([
      // A planted rowKey other than user_id (Jest does not type-check).
      ["rowKey 'id'", replace({ ...settings, export: { ...e, rowKey: 'id' as never } })],
      ['a rowFilter beside the rowKey', replace({ ...settings, export: { ...e, rowFilter: { column: 'privacy_policy_mode', notIn: ['none'], reason: 'x' } } })],
      ['a via scope (E-2 runs first)', replace({ ...settings, scope: { kind: 'via', parent: 'business_profiles', fk: 'user_id' } })],
      ['a deny-listed column (E-3 runs first)', replace({ ...settings, export: { ...e, columns: [...e.columns, 'user_agent'] } })],
      ['without the rowKey (no id to page on)', replace({ ...settings, export: { ...e, rowKey: undefined } })],
    ])('%s', async (_name, descriptors) => {
      const { client, log } = fakeClient({ marketing_consent_settings: [settingsRow('a')] });
      const r = await new BusinessDataExportRepository(client, { descriptors }).listOwnedRowsForExport('consent_settings', USER_A, { maxRows: 10 });
      expect(r.data).toBeNull();
      expect(r.error).toBeInstanceOf(Error);
      expect(log).toHaveLength(0);
    });
  });
});

describe('DE-6 N-3 a tracking column planted in the consent ledger fails the section at request time (SA-Q5)', () => {
  it.each(['user_agent', 'session_id', 'ip_hash_salt', 'ip_hash'])('%s: no query, section failed', async (column) => {
    const events = PURGE_DESCRIPTORS.find((d) => d.table === 'marketing_consent_events')!;
    const e = events.export as Extract<PurgeDescriptor['export'], { kind: 'include' }>;
    const descriptors = PURGE_DESCRIPTORS.map((d) => (d === events ? { ...d, export: { ...e, columns: [...e.columns, column] } } : d));
    const { client, log } = fakeClient({ marketing_consent_events: [rowFor('marketing_consent_events', 'a', 0)] });
    const r = await new BusinessDataExportRepository(client, { descriptors }).listOwnedRowsForExport('consent_records', USER_A, { maxRows: 10 });
    expect(r.data).toBeNull();
    expect(log).toHaveLength(0);
  });

  it('the real ledger select names none of the four', async () => {
    const { client, log } = fakeClient({ marketing_consent_events: [rowFor('marketing_consent_events', 'a', 0)] });
    await new BusinessDataExportRepository(client).listOwnedRowsForExport('consent_records', USER_A, { maxRows: 10 });
    const select = String(log[0].calls[0][1]).split(', ');
    for (const c of ['ip_hash', 'ip_hash_salt', 'user_agent', 'session_id', 'recorded_by', 'email_normalized', 'user_id']) {
      expect(select).not.toContain(c);
    }
  });
});

describe('DE-6 N-8 cross-tenant: crossed pointers carry a bare id, never a row (tenant-isolation-guard)', () => {
  const byOwner = (db: Record<string, Row[]>, table: string, owner: string) => db[table].filter((r) => r.user_id === owner);

  /** Both tenants in the ten DE-6 tables only, plus each tenant's own contacts for the pointers. */
  function crossedSeed() {
    const db: Record<string, Row[]> = { plugin_connections: [] };
    for (const table of Object.keys(DE6_PAGED_SECTIONS)) {
      db[table] = [];
      for (const tenant of ['a', 'b'] as const) for (let n = 0; n < 2; n += 1) db[table].push(rowFor(table, tenant, n));
    }
    db.marketing_consent_settings = [settingsRow('a'), settingsRow('b')];
    const aSequence = byOwner(db, 'email_sequences', USER_A)[0];
    const aContactId = uid('a', 'crm_contacts', 0);
    // B's step under A's sequence; B's enrollment on A's sequence and contact; B's consent event and
    // subscriber naming A's contact.
    const bStep = byOwner(db, 'email_sequence_steps', USER_B)[0];
    bStep.sequence_id = aSequence.id;
    bStep.subject = 'QA-B-STEP-NEVER';
    const bEnrollment = byOwner(db, 'email_sequence_enrollments', USER_B)[0];
    bEnrollment.sequence_id = aSequence.id;
    bEnrollment.contact_id = aContactId;
    const bEvent = byOwner(db, 'marketing_consent_events', USER_B)[0];
    bEvent.contact_id = aContactId;
    bEvent.statement_text = 'QA-B-CONSENT-NEVER';
    const bSubscriber = byOwner(db, 'business_subscribers', USER_B)[0];
    bSubscriber.promoted_contact_id = aContactId;
    bSubscriber.email = 'qa-b-subscriber-never@example.com';
    // A's enrollment on B's sequence: exported as a bare id.
    const bSequence = byOwner(db, 'email_sequences', USER_B)[0];
    const aEnrollment = byOwner(db, 'email_sequence_enrollments', USER_A)[0];
    aEnrollment.sequence_id = bSequence.id;
    return { db, bStep, bEnrollment, bEvent, bSubscriber, bSequence, aEnrollment };
  }

  it("A's export holds every A row of the ten tables and none of B's, though B's rows point at A's", async () => {
    const seeded = crossedSeed();
    const fake = fakeClient(seeded.db);
    mockActiveClient = fake.client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    expect(run.overCeiling).toBe(false);
    const byId = Object.fromEntries(run.sections.map((s) => [s.id, s]));
    const text = JSON.stringify(run.sections);
    for (const [table, section] of Object.entries(DE6_PAGED_SECTIONS)) {
      expect(byId[section].status).toBe('ok');
      expect(byId[section].rows.map((r) => String((r as Row).id))).toEqual(byOwner(seeded.db, table, USER_A).map((r) => String(r.id)).sort());
    }
    expect(byId.consent_settings).toMatchObject({ status: 'ok', row_count: 1 });
    expect(text).not.toContain('b-settings');
    for (const leaked of ['QA-B-STEP-NEVER', 'QA-B-CONSENT-NEVER', 'qa-b-subscriber-never@example.com']) expect(text).not.toContain(leaked);
    for (const bRow of [seeded.bStep, seeded.bEnrollment, seeded.bEvent, seeded.bSubscriber]) expect(text).not.toContain(String(bRow.id));
    // A's enrollment exports B's sequence id as held; B's sequence row is not in A's sequences.
    expect((byId.email_sequence_enrollments.rows as Row[]).find((r) => r.id === seeded.aEnrollment.id)?.sequence_id).toBe(seeded.bSequence.id);
    expect(byId.email_sequences.rows.map((r) => (r as Row).id)).not.toContain(seeded.bSequence.id);
    expect(foreignMarkers(text, seeded.db)).toEqual([String(seeded.bSequence.id)]);
    // Children were read by their own user_id: the only filter on every DE-6 query.
    const de6 = fake.log.filter((l) => l.table in DE6_SECTIONS);
    expect(new Set(de6.map((l) => l.table))).toEqual(new Set(Object.keys(DE6_SECTIONS)));
    for (const entry of de6) {
      expect(entry.calls[1]).toEqual(['eq', 'user_id', USER_A]);
      expect(entry.calls.filter((c) => c[0] === 'eq')).toEqual([['eq', 'user_id', USER_A]]);
      expect(entry.calls.some((c) => c[0] === 'in' || c[0] === 'not')).toBe(false);
    }
    // The tables DE-6 excluded, and email_sends, are never read.
    for (const table of ['lead_responses', 'marketing_consent_state', 'email_sends']) expect(fake.log.some((l) => l.table === table)).toBe(false);
  });

  it("negative control: a fake that ignores .eq(user_id) puts B's rows (and B's settings) in A's file", async () => {
    const seeded = crossedSeed();
    mockActiveClient = fakeClient(seeded.db, { ignoreUserIdFilter: true }).client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    const steps = run.sections.find((s) => s.id === 'email_sequence_steps')!;
    expect(steps.rows.some((r) => (r as Row).id === seeded.bStep.id)).toBe(true);
    // Two owners' settings rows: the single-row read fails closed rather than export B's.
    expect(run.sections.find((s) => s.id === 'consent_settings')?.status).toBe('failed');
  });
});

describe('DE-6 N-10 all history is in: every status, no row filter on a DE-6 table', () => {
  const STATUSES: Record<string, Array<[string, unknown]>> = {
    business_intake_forms: [['status', 'draft'], ['status', 'published'], ['status', 'archived']],
    business_subscribers: [['status', 'pending'], ['status', 'confirmed'], ['status', 'unsubscribed'], ['status', 'promoted']],
    marketing_consent_events: [['decision', 'granted'], ['decision', 'withdrawn'], ['redacted_at', '2026-10-01T00:00:00Z']],
    email_sequence_enrollments: [['status', 'active'], ['status', 'paused'], ['status', 'completed'], ['status', 'cancelled']],
    email_campaigns: [['status', 'draft'], ['status', 'scheduled'], ['status', 'sent']],
  };

  it.each(Object.entries(STATUSES))('%s: every seeded state is exported', async (table, states) => {
    const db = { [table]: states.map(([column, value], n) => rowFor(table, 'a', n, { [column]: value })) };
    const { client, log } = fakeClient(db);
    const result = await new BusinessDataExportRepository(client).listOwnedRowsForExport(DE6_PAGED_SECTIONS[table], USER_A, { maxRows: 100 });
    expect(result.data?.rows).toHaveLength(states.length);
    expect(log.flatMap((l) => l.calls).some((c) => c[0] === 'not')).toBe(false);
  });
});

// ── DE-7 (BUSINESS_OS_DATA_EXPORT_DE7_WORKPLAN.md §2.6, §8 D-5…D-10, D-14, D-19; SA review DE-7 C-1…C-6) ──


/** DE-7: the four content sections read by their own user_id. */
const DE7_KEYSET_SECTIONS: Record<string, ExportSectionId> = {
  website_content: 'website_content',
  website_pages: 'website_pages',
  smart_links: 'smart_links',
  user_media: 'images',
};
const BLOCKS_SELECT = 'id, page_id, block_type, position, content, styles, created_at, enabled, capability_config';

/** A block row: every declared column, NO user_id (the live table has none), on `pageId`. */
function blockRow(tenant: 'a' | 'b', n: number, pageId: unknown, extra: Row = {}): Row {
  const row = rowFor('website_blocks', tenant, n, { page_id: pageId, ...extra });
  delete row.user_id;
  return row;
}

/** A page row of `tenant` (user_id scoped). */
const pageRow = (tenant: 'a' | 'b', n: number, extra: Row = {}): Row => rowFor('website_pages', tenant, n, extra);

/** Lower an EXPORT_LIMITS value for one test (read at call time, limits.ts), then restore it. */
async function withLimit<T>(key: 'VIA_PARENT_CHUNK' | 'ROW_CEILING', value: number, run: () => Promise<T>): Promise<T> {
  const limits = EXPORT_LIMITS as unknown as Record<string, number>;
  const before = limits[key];
  limits[key] = value;
  try {
    return await run();
  } finally {
    limits[key] = before;
  }
}

const readBlocks = (client: SupabaseClient, opts: { pageSize?: number; maxRows?: number; descriptors?: PurgeDescriptor[] } = {}) =>
  new BusinessDataExportRepository(client, { pageSize: opts.pageSize, descriptors: opts.descriptors }).listOwnedRowsForExport(
    'website_blocks',
    USER_A,
    { maxRows: opts.maxRows ?? 1_000 }
  );

const sortedIds = (rows: Row[]) => rows.map((r) => String(r.id)).sort();

describe('DE-7 the four user_id content tables go through the keyset reader unchanged', () => {
  it.each(Object.entries(DE7_KEYSET_SECTIONS))('%s: select = exportColumnsOf, eq user_id first, keyset on id', async (table, section) => {
    const db: Record<string, Row[]> = { [table]: [0, 1, 2].map((n) => rowFor(table, 'a', n)) };
    const { client, log } = fakeClient(db);
    const result = await new BusinessDataExportRepository(client, { pageSize: 2 }).listOwnedRowsForExport(section, USER_A, { maxRows: 100 });
    expect(result.error).toBeNull();
    expect(result.data?.rows).toHaveLength(3);
    const select = exportColumnsOf(table).join(', ');
    expect(log[0].calls).toEqual([['select', select], ['eq', 'user_id', USER_A], ['order', 'id', { ascending: true }], ['limit', 2]]);
    expect(log).toHaveLength(3);
    for (const r of result.data?.rows ?? []) expect(Object.keys(r)).toEqual(exportColumnsOf(table));
    expect(JSON.stringify(result.data)).not.toContain('EXCLUDED');
  });
});

describe('DE-7 D-5 the parent-scoped read: query shape, order, logging', () => {
  it("parent ids by eq(user_id), then the blocks by in('page_id', chunk) first, keyset on id; rows sorted by id; counts only in the log", async () => {
    const aPages = [pageRow('a', 0), pageRow('a', 1)];
    const db: Record<string, Row[]> = {
      website_pages: [...aPages, pageRow('b', 0)],
      website_blocks: [
        ...[0, 1, 2].map((n) => blockRow('a', n, aPages[0].id, { content: { headline: `QA-A-CONTENT-${n}` } })),
        ...[3, 4, 5].map((n) => blockRow('a', n, aPages[1].id)),
        blockRow('b', 0, uid('b', 'website_pages', 0)),
      ],
    };
    const { client, log } = fakeClient(db);
    const result = await readBlocks(client, { pageSize: 2 });
    expect(result.error).toBeNull();
    const aIds = sortedIds(db.website_blocks.filter((r) => r.page_id !== uid('b', 'website_pages', 0)));
    expect(result.data?.rows.map((r) => r.id)).toEqual(aIds);
    for (const r of result.data?.rows ?? []) expect(Object.keys(r)).toEqual(exportColumnsOf('website_blocks'));

    // Parent: 2 ids, then the empty page. Children: 6 blocks at 2 a page, then the empty page.
    expect(log.map((l) => l.table)).toEqual(['website_pages', 'website_pages', 'website_blocks', 'website_blocks', 'website_blocks', 'website_blocks']);
    const pageIds = aPages.map((p) => String(p.id)).sort();
    expect(log[0].calls).toEqual([['select', 'id'], ['eq', 'user_id', USER_A], ['order', 'id', { ascending: true }], ['limit', 2]]);
    expect(log[1].calls).toEqual([['select', 'id'], ['eq', 'user_id', USER_A], ['gt', 'id', pageIds[1]], ['order', 'id', { ascending: true }], ['limit', 2]]);
    // V-5: the in filter is the first filter of every child query, a plain array of owned ids.
    expect(log[2].calls).toEqual([['select', BLOCKS_SELECT], ['in', 'page_id', pageIds], ['order', 'id', { ascending: true }], ['limit', 2]]);
    for (const entry of log.slice(2)) {
      expect(entry.calls[1]).toEqual(['in', 'page_id', pageIds]);
      expect(entry.calls.some((c) => c[0] === 'eq')).toBe(false);
    }
    expect(log[3].calls).toContainEqual(['gt', 'id', aIds[1]]);
    expect(BLOCKS_SELECT).toBe(exportColumnsOf('website_blocks').join(', '));

    const info = mockLogged.find((l) => l.msg === 'Data export section read');
    expect(Object.keys(info?.fields ?? {}).sort()).toEqual(['duration', 'pages', 'parents', 'rows', 'sectionId', 'table', 'userId']);
    expect(info?.fields).toMatchObject({ sectionId: 'website_blocks', table: 'website_blocks', userId: USER_A, pages: 6, parents: 2, rows: 6 });
    expect(JSON.stringify(mockLogged)).not.toContain('QA-A-CONTENT');
  });
});

describe('DE-7 D-6 chunks and paging (C-3)', () => {
  it('0 pages: one query, ok and empty, no child query', async () => {
    const { client, log } = fakeClient({ website_pages: [pageRow('b', 0)], website_blocks: [blockRow('b', 0, uid('b', 'website_pages', 0))] });
    expect(await readBlocks(client)).toEqual({ data: { rows: [], overCeiling: false }, error: null });
    expect(log.map((l) => l.table)).toEqual(['website_pages']);
    expect(mockLogged.find((l) => l.msg === 'Data export section read')?.fields).toMatchObject({ pages: 1, parents: 0, rows: 0 });
  });

  it('101 pages: two chunks (100 + 1), each a non-empty subset of the owned ids', async () => {
    const pages = Array.from({ length: 101 }, (_, n) => pageRow('a', n));
    const ids = pages.map((p) => String(p.id)).sort();
    const db = { website_pages: pages, website_blocks: [blockRow('a', 0, ids[0]), blockRow('a', 1, ids[100])] };
    const { client, log } = fakeClient(db);
    const result = await readBlocks(client);
    expect(result.data?.rows.map((r) => r.id)).toEqual(sortedIds(db.website_blocks));
    const ins = log.filter((l) => l.table === 'website_blocks').map((l) => l.calls.find((c) => c[0] === 'in')?.[2] as string[]);
    expect(ins.map((chunk) => chunk.length)).toEqual([100, 100, 1, 1]);
    expect(ins[0]).toEqual(ids.slice(0, 100));
    expect(ins[2]).toEqual([ids[100]]);
    expect(EXPORT_LIMITS.VIA_PARENT_CHUNK).toBe(100);
  });

  it("C-3: chunk 2's block ids sort before chunk 1's last id; lastId resets per chunk and the final sort holds", async () => {
    const [p0, p1] = [pageRow('a', 0), pageRow('a', 1)].sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1));
    const late = blockRow('a', 0, p0.id, { id: 'ffffffff-0000-4000-8000-00000000000f' });
    const early = blockRow('a', 1, p1.id, { id: '00000000-0000-4000-8000-000000000001' });
    const { client, log } = fakeClient({ website_pages: [p0, p1], website_blocks: [late, early] });
    const result = await withLimit('VIA_PARENT_CHUNK', 1, () => readBlocks(client));
    expect(result.data?.rows.map((r) => r.id)).toEqual([early.id, late.id]);
    const child = log.filter((l) => l.table === 'website_blocks');
    // Chunk 1: data page, empty page after `late`. Chunk 2 starts again with no gt.
    expect(child.map((l) => l.calls.find((c) => c[0] === 'in')?.[2])).toEqual([[p0.id], [p0.id], [p1.id], [p1.id]]);
    expect(child[2].calls.some((c) => c[0] === 'gt')).toBe(false);
    expect(child[1].calls).toContainEqual(['gt', 'id', late.id]);
  });

  it('a chunk with more blocks than the page size pages to an empty page', async () => {
    const page = pageRow('a', 0);
    const db = { website_pages: [page], website_blocks: [0, 1, 2, 3, 4].map((n) => blockRow('a', n, page.id)) };
    const { client, log } = fakeClient(db);
    const result = await readBlocks(client, { pageSize: 2 });
    expect(result.data?.rows).toHaveLength(5);
    expect(log.filter((l) => l.table === 'website_blocks')).toHaveLength(4);
  });

  it('a PostgREST max-rows below the page size (short pages) still yields every block', async () => {
    const page = pageRow('a', 0);
    const db = { website_pages: [page], website_blocks: [0, 1, 2, 3, 4].map((n) => blockRow('a', n, page.id)) };
    const { client, log } = fakeClient(db, { maxPerResponse: 2 });
    const result = await readBlocks(client);
    expect(result.data?.rows.map((r) => r.id)).toEqual(sortedIds(db.website_blocks));
    expect(log.filter((l) => l.table === 'website_blocks')).toHaveLength(4);
  });
});

describe('DE-7 D-7 the ceiling across chunks (and the parent-id bound, C-4)', () => {
  function twoPagesTwoBlocksEach() {
    const pages = [pageRow('a', 0), pageRow('a', 1)];
    return { website_pages: pages, website_blocks: [0, 1, 2, 3].map((n) => blockRow('a', n, pages[n < 2 ? 0 : 1].id)) };
  }

  it('exactly maxRows blocks is ok', async () => {
    const result = await withLimit('VIA_PARENT_CHUNK', 1, () => readBlocks(fakeClient(twoPagesTwoBlocksEach()).client, { maxRows: 4 }));
    expect(result.data).toMatchObject({ overCeiling: false });
    expect(result.data?.rows).toHaveLength(4);
  });

  it('maxRows + 1 split across two chunks: overCeiling, no rows, no further query', async () => {
    const fake = fakeClient(twoPagesTwoBlocksEach());
    const result = await withLimit('VIA_PARENT_CHUNK', 1, () => readBlocks(fake.client, { maxRows: 3 }));
    expect(result).toEqual({ data: { rows: [], overCeiling: true }, error: null });
    // Parent 2, chunk 1 (data + empty) 2, chunk 2 (data: 4 > 3) 1: stop.
    expect(fake.log.map((l) => l.table)).toEqual(['website_pages', 'website_pages', 'website_blocks', 'website_blocks', 'website_blocks']);
    expect(mockLogged.find((l) => l.msg === 'Data export section is over the row ceiling')?.fields).toMatchObject({ parents: 2, maxRows: 3 });
  });

  it('C-4: past ROW_CEILING parent ids the read stops overCeiling with no child query; parent ids never count against maxRows', async () => {
    const pages = [0, 1, 2].map((n) => pageRow('a', n));
    const over = fakeClient({ website_pages: pages, website_blocks: [blockRow('a', 0, pages[0].id)] });
    const result = await withLimit('ROW_CEILING', 2, () => readBlocks(over.client, { maxRows: 1_000 }));
    expect(result).toEqual({ data: { rows: [], overCeiling: true }, error: null });
    expect(over.log.every((l) => l.table === 'website_pages')).toBe(true);
    // Three pages with one block, maxRows 1: the pages do not count, the one block fits.
    const fits = await readBlocks(fakeClient({ website_pages: pages, website_blocks: [blockRow('a', 0, pages[0].id)] }).client, { maxRows: 1 });
    expect(fits.data?.rows).toHaveLength(1);
  });
});

describe('DE-7 D-8 cross-tenant: a block whose page is another owner\'s never appears (tenant-isolation-guard)', () => {
  /** A and B each with pages and blocks; B's block content names A's page id and A's picture URL. */
  function crossedSeed() {
    const aPages = [pageRow('a', 0), pageRow('a', 1)];
    const bPages = [pageRow('b', 0), pageRow('b', 1)];
    const aPicture = `https://cdn.test/storage/v1/object/public/website-images/${USER_A}/stock/1.jpg`;
    const db: Record<string, Row[]> = {
      plugin_connections: [],
      website_pages: [...aPages, ...bPages],
      website_blocks: [
        blockRow('a', 0, aPages[0].id, { content: { image: aPicture } }),
        blockRow('a', 1, aPages[1].id, { enabled: false }),
        blockRow('b', 0, bPages[0].id, { content: { note: `QA-B-BLOCK-NEVER on ${String(aPages[0].id)}`, image: aPicture } }),
        blockRow('b', 1, bPages[1].id, { content: { note: 'QA-B-BLOCK-NEVER-2' } }),
      ],
    };
    const bBlocks = db.website_blocks.filter((r) => bPages.some((p) => p.id === r.page_id));
    return { db, aPages, bPages, bBlocks };
  }

  it("A's export holds every A block and no B block; no B page id reaches the child queries", async () => {
    const seeded = crossedSeed();
    const fake = fakeClient(seeded.db);
    mockActiveClient = fake.client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    expect(run.overCeiling).toBe(false);
    const byId = Object.fromEntries(run.sections.map((s) => [s.id, s]));
    expect(byId.website_blocks.status).toBe('ok');
    const aBlockIds = seeded.db.website_blocks.filter((r) => seeded.aPages.some((p) => p.id === r.page_id)).map((r) => String(r.id)).sort();
    expect(byId.website_blocks.rows.map((r) => String((r as Row).id))).toEqual(aBlockIds);
    expect(byId.website_pages.rows.map((r) => String((r as Row).id))).toEqual(seeded.aPages.map((p) => String(p.id)).sort());
    const text = JSON.stringify(run.sections);
    expect(text).not.toContain('QA-B-BLOCK-NEVER');
    for (const r of [...seeded.bBlocks, ...seeded.bPages]) expect(text).not.toContain(String(r.id));
    expect(foreignMarkers(text, seeded.db)).toEqual([]);
    // The parent read is E-4 scoped; every child in-list holds A's page ids only.
    const parentReads = fake.log.filter((l) => l.table === 'website_pages' && String(l.calls[0][1]) === 'id');
    expect(parentReads.length).toBeGreaterThan(0);
    for (const entry of parentReads) expect(entry.calls[1]).toEqual(['eq', 'user_id', USER_A]);
    const inLists = fake.log.filter((l) => l.table === 'website_blocks').map((l) => l.calls[1]);
    expect(inLists.length).toBeGreaterThan(0);
    for (const call of inLists) {
      expect(call[0]).toBe('in');
      for (const id of call[2] as string[]) expect(seeded.aPages.map((p) => p.id)).toContain(id);
    }
  });

  it("negative control (a): a fake that ignores .eq(user_id) puts B's blocks in A's file (the test can see a leak)", async () => {
    const seeded = crossedSeed();
    mockActiveClient = fakeClient(seeded.db, { ignoreUserIdFilter: true }).client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    const blocks = run.sections.find((s) => s.id === 'website_blocks')!;
    expect(blocks.rows.some((r) => seeded.bBlocks.some((b) => b.id === (r as Row).id))).toBe(true);
  });

  it('negative control (b): a fake that ignores .in fails the section (V-6); no B row is in the body', async () => {
    const seeded = crossedSeed();
    mockActiveClient = fakeClient(seeded.db, { ignoreInFilter: true }).client as unknown as { from: (table: string) => unknown };
    const run = await runExportSections(CTX_A, EXPORT_SECTIONS, silentLogger);
    const blocks = run.sections.find((s) => s.id === 'website_blocks')!;
    expect(blocks).toMatchObject({ status: 'failed', row_count: 0, rows: [] });
    const text = JSON.stringify(run.sections);
    expect(text).not.toContain('QA-B-BLOCK-NEVER');
    for (const r of seeded.bBlocks) expect(text).not.toContain(String(r.id));
    // The other content sections are unaffected.
    for (const id of ['website_content', 'website_pages', 'smart_links', 'images']) expect(run.sections.find((s) => s.id === id)?.status).toBe('ok');
    // The log carries the count only, never a row.
    const failure = mockLogged.find((l) => l.level === 'error' && l.fields.sectionId === 'website_blocks');
    expect(String((failure?.fields.err as Error)?.message)).toBe('Data export parent-scoped read returned 2 rows outside the owned parents');
    expect(JSON.stringify(mockLogged)).not.toContain('QA-B-BLOCK-NEVER');
  });

  it('negative control (c): V-6 is load-bearing; with the .in ignored, the raw child response DOES carry B\'s blocks', async () => {
    // Without V-6, nothing else filters the child rows: the response below is what the section would hold.
    const seeded = crossedSeed();
    const inner = fakeClient(seeded.db, { ignoreInFilter: true });
    const responses: Row[][] = [];
    const recording = {
      from(table: string) {
        const builder = inner.client.from(table) as unknown as Record<string, unknown>;
        if (table !== 'website_blocks') return builder;
        const then = builder.then as (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => Promise<unknown>;
        builder.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
          then((value) => {
            responses.push(((value as { data: Row[] | null }).data ?? []) as Row[]);
            return resolve(value);
          }, reject);
        return builder;
      },
    } as unknown as SupabaseClient;
    const result = await readBlocks(recording);
    expect(result.data).toBeNull();
    expect(responses.flat().some((r) => seeded.bBlocks.some((b) => b.id === r.id))).toBe(true);
  });
});

describe('DE-7 D-9 fails closed', () => {
  it('a malformed parent id (not a canonical lowercase uuid) fails after the parent query only', async () => {
    for (const bad of ['A0A0A0A0-0000-4000-8000-00000000000A', 'not-a-uuid', 42]) {
      mockLogged.length = 0;
      const { client, log } = fakeClient({ website_pages: [{ ...pageRow('a', 0), id: bad }], website_blocks: [] });
      const r = await readBlocks(client);
      expect(r.data).toBeNull();
      expect(String(r.error?.message)).toBe('Data export parent id is not a canonical uuid');
      expect(log.map((l) => l.table)).toEqual(['website_pages']);
    }
  });

  it('repeated parent ids fail the section', async () => {
    const page = pageRow('a', 0);
    const r = await readBlocks(fakeClient({ website_pages: [page, { ...page }] }).client);
    expect(r.data).toBeNull();
  });

  it('a PostgREST error on the parent read or on the child read fails the section', async () => {
    const page = pageRow('a', 0);
    const db = { website_pages: [page], website_blocks: [blockRow('a', 0, page.id)] };
    const parentErr = fakeClient(db, { errorOn: { website_pages: { message: 'boom', code: 'XX000' } } });
    expect((await readBlocks(parentErr.client)).data).toBeNull();
    expect(parentErr.log.map((l) => l.table)).toEqual(['website_pages']);
    const childErr = fakeClient(db, { errorOn: { website_blocks: { message: 'boom', code: '42703' } } });
    expect((await readBlocks(childErr.client)).data).toBeNull();
  });

  it('C-1: a child row with a non-string id or page_id fails the section', async () => {
    const page = pageRow('a', 0);
    // A NULL page_id never matches a real `in`, so that case runs on a fake that ignores it.
    for (const [extra, options] of [[{ id: 7 }, {}], [{ page_id: null }, { ignoreInFilter: true }]] as Array<[Row, FakeOptions]>) {
      const r = await readBlocks(fakeClient({ website_pages: [page], website_blocks: [blockRow('a', 0, page.id, extra)] }, options).client);
      expect(r.data).toBeNull();
    }
  });

  it('C-1: a block in the wrong chunk fails the section, even when its page is the owner\'s', async () => {
    // With one id per chunk, a fake that ignored `.in` would hand chunk 1 the block of A's other page.
    const pages = [pageRow('a', 0), pageRow('a', 1)];
    const db = { website_pages: pages, website_blocks: [blockRow('a', 0, pages[0].id), blockRow('a', 1, pages[1].id)] };
    const r = await withLimit('VIA_PARENT_CHUNK', 1, () => readBlocks(fakeClient(db, { ignoreInFilter: true }).client));
    expect(r.data).toBeNull();
    expect(String(r.error?.message)).toMatch(/outside the owned parents/);
  });

  it('C-1: a repeated id after the final sort fails the section', async () => {
    const pages = [pageRow('a', 0), pageRow('a', 1)];
    const twin = 'cccccccc-0000-4000-8000-00000000000c';
    const db = { website_pages: pages, website_blocks: [blockRow('a', 0, pages[0].id, { id: twin }), blockRow('a', 1, pages[1].id, { id: twin })] };
    const r = await withLimit('VIA_PARENT_CHUNK', 1, () => readBlocks(fakeClient(db).client));
    expect(r.data).toBeNull();
    expect(String(r.error?.message)).toBe('Data export parent-scoped read found a repeated id');
  });

  describe('a bad descriptor fails with no query (V-1…V-3, E-3; C-5)', () => {
    const blocks = PURGE_DESCRIPTORS.find((d) => d.table === 'website_blocks')!;
    const be = blocks.export as Extract<PurgeDescriptor['export'], { kind: 'include' }>;
    const replace = (table: string, patch: (d: PurgeDescriptor) => PurgeDescriptor): PurgeDescriptor[] =>
      PURGE_DESCRIPTORS.map((d) => (d.table === table ? patch(d) : d));
    const pagesInclude = (d: PurgeDescriptor) => d.export as Extract<PurgeDescriptor['export'], { kind: 'include' }>;

    it.each<[string, PurgeDescriptor[], string]>([
      ['the export opt-in removed (the DE-4 code and message, unchanged)', replace('website_blocks', (d) => ({ ...d, export: { ...be, viaParent: undefined } })), 'not_user_scoped'],
      ['viaParent naming another fk', replace('website_blocks', (d) => ({ ...d, export: { ...be, viaParent: { parent: 'website_pages', fk: 'id' } } })), 'invalid_via_parent'],
      ['viaParent with an empty parent', replace('website_blocks', (d) => ({ ...d, scope: { kind: 'via', parent: '', fk: 'page_id' }, export: { ...be, viaParent: { parent: '', fk: 'page_id' } } })), 'invalid_via_parent'],
      ['viaParent beside a user_id scope', replace('website_blocks', (d) => ({ ...d, scope: { kind: 'user_id' } })), 'invalid_via_parent'],
      ['the parent excluded', replace('website_pages', (d) => ({ ...d, export: { kind: 'exclude', reason: 'x' } })), 'invalid_via_parent'],
      ['the parent via-scoped (via-of-via)', replace('website_pages', (d) => ({ ...d, scope: { kind: 'via', parent: 'business_profiles', fk: 'user_id' } })), 'invalid_via_parent'],
      ['the parent filtered', replace('website_pages', (d) => ({ ...d, export: { ...pagesInclude(d), rowFilter: { column: 'status', notIn: ['archived'], reason: 'x' } } })), 'invalid_via_parent'],
      ['the parent with a deny-listed column (E-3 on the parent)', replace('website_pages', (d) => ({ ...d, export: { ...pagesInclude(d), columns: [...pagesInclude(d).columns, 'access_token'] } })), 'denied_column'],
      ['the child with a deny-listed column (E-3 on the child)', replace('website_blocks', (d) => ({ ...d, export: { ...be, columns: [...be.columns, 'api_key'] } })), 'denied_column'],
      ['the child without page_id', replace('website_blocks', (d) => ({ ...d, export: { ...be, columns: be.columns.filter((c) => c !== 'page_id') } })), 'invalid_via_parent'],
    ])('%s', async (_name, descriptors, code) => {
      const page = pageRow('a', 0);
      const { client, log } = fakeClient({ website_pages: [page], website_blocks: [blockRow('a', 0, page.id)] });
      const r = await readBlocks(client, { descriptors });
      expect(r.data).toBeNull();
      expect((r.error as unknown as { code?: string }).code).toBe(code);
      expect(log).toHaveLength(0);
    });
  });
});

describe('DE-7 D-10 no caller id reaches the parent-scoped read', () => {
  const SECTIONS_FILE = path.join(REPO_ROOT, 'lib', 'business-os', 'data-export', 'sections.ts');
  // QA-B1: any identifier ending in a page, parent or block id, singular or plural, snake or
  // camel, with or without a prefix (pageId, page_ids, parentIds, ownedPageIds, blockIDs...).
  const CALLER_ID = /\b\w*?(?:page|parent|block)_?ids?\b/gi;
  const callerIdHits = (code: string): string[] => codeOnly(code).match(CALLER_ID) ?? [];

  /**
   * The parts of the repository a caller's value can travel through: the public signature, the
   * `readThroughParent` parameter type and its one call. Scoped on purpose: the oracle's own local
   * `parentIds` (read by E-4 inside the `readThroughParent` body) is the legitimate name and is
   * not scanned. Each slice must be found, so the scan can never pass vacuously.
   */
  function callerFacingSlices(source: string): Record<string, string> {
    const code = codeOnly(source);
    const slice = (from: string, to: string): string => {
      const start = code.indexOf(from);
      const end = start < 0 ? -1 : code.indexOf(to, start + from.length);
      if (start < 0 || end < 0) throw new Error(`D-10 slice not found: ${from}`);
      return code.slice(start, end + to.length);
    };
    return {
      signature: slice('async listOwnedRowsForExport(', '): Promise<'),
      readThroughParentParams: slice('private async readThroughParent(args: {', '}): Promise<'),
      readThroughParentCall: slice('this.readThroughParent({', '});'),
    };
  }
  /** `opts.<key>` reads in the repository, other than the one declared key. */
  const undeclaredOptReads = (source: string): string[] =>
    (codeOnly(source).match(/\bopts\??\.\w+/g) ?? []).filter((m) => m.replace('?', '') !== 'opts.maxRows');

  it('the method takes (section id, session user id, budget) only; sections.ts passes no page id', () => {
    expect(BusinessDataExportRepository.prototype.listOwnedRowsForExport.length).toBe(3);
    expect(callerIdHits(fs.readFileSync(SECTIONS_FILE, 'utf-8'))).toEqual([]);
  });

  it('QA-B1: no page / parent / block id in the signature, the readThroughParent parameters or its call; opts is read for maxRows only', () => {
    const source = fs.readFileSync(REPO_FILE, 'utf-8');
    const slices = callerFacingSlices(source);
    for (const [name, code] of Object.entries(slices)) expect({ name, hits: callerIdHits(code) }).toEqual({ name, hits: [] });
    expect(undeclaredOptReads(source)).toEqual([]);
    // Why the scan is scoped: the body holds the oracle's own `parentIds`, which is correct code.
    expect(callerIdHits(source)).toContain('parentIds');
  });

  it('negative control: a planted page id parameter is flagged', () => {
    expect(callerIdHits('listOwnedRowsForExport(id, ctx.userId, { maxRows, pageId: req.pageId })')).toEqual(['pageId', 'pageId']);
  });

  it('negative control (QA-B1): plurals, snake case, prefixes and the opts object are flagged', () => {
    expect(callerIdHits('f({ maxRows, parentIds: ctx.parentIds, page_ids: x, ownedPageIds, blockIDs, page_id })')).toEqual([
      'parentIds',
      'parentIds',
      'page_ids',
      'ownedPageIds',
      'blockIDs',
      'page_id',
    ]);
    // Legitimate names are not flagged.
    expect(callerIdHits('const { sectionId, table, parentTable, fk, userId, maxRows } = args; pages += 1;')).toEqual([]);
    const planted = fs
      .readFileSync(REPO_FILE, 'utf-8')
      .replace('opts: { maxRows: number }', 'opts: { maxRows: number; parentIds?: string[] }')
      .replace('this.readThroughParent({', 'this.readThroughParent({ callerParentIds: opts.parentIds,');
    const slices = callerFacingSlices(planted);
    expect(callerIdHits(slices.signature)).toEqual(['parentIds']);
    expect(callerIdHits(slices.readThroughParentCall)).toEqual(['callerParentIds', 'parentIds']);
    expect(undeclaredOptReads(planted)).toEqual(['opts.parentIds']);
  });

  it("QA-B1 runtime: B's page id slipped into the options object fails the section closed, no query, no B block", async () => {
    const aPage = pageRow('a', 0);
    const bPage = pageRow('b', 0);
    const db: Record<string, Row[]> = {
      website_pages: [aPage, bPage],
      website_blocks: [blockRow('a', 0, aPage.id), blockRow('b', 0, bPage.id, { content: { note: 'QA-B-BLOCK-NEVER' } })],
    };
    const { client, log } = fakeClient(db);
    const result = await new BusinessDataExportRepository(client).listOwnedRowsForExport('website_blocks', USER_A, {
      maxRows: 1_000,
      parentIds: [bPage.id],
      // Deliberately outside the declared type: the attack this test pins.
    } as unknown as { maxRows: number });
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(log).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('QA-B-BLOCK-NEVER');
    expect(JSON.stringify(result)).not.toContain(String(bPage.id));
  });

  it.each<[string, Record<string, unknown>]>([
    ['an unknown key in opts', { maxRows: 10, extra: true }],
    ['a pageId in opts', { maxRows: 10, pageId: 'x' }],
    ['a userId in opts', { maxRows: 10, userId: USER_B }],
  ])('ReadInputSchema is strict: %s fails closed with no query', async (_label, opts) => {
    const { client, log } = fakeClient({ crm_contacts: [rowFor('crm_contacts', 'a', 0)] });
    const result = await new BusinessDataExportRepository(client).listOwnedRowsForExport('clients', USER_A, opts as unknown as { maxRows: number });
    expect(result).toEqual({ data: null, error: expect.anything() });
    expect(log).toHaveLength(0);
  });

  it('control: the declared options object alone still reads', async () => {
    const { client } = fakeClient({ crm_contacts: [rowFor('crm_contacts', 'a', 0)] });
    const result = await new BusinessDataExportRepository(client).listOwnedRowsForExport('clients', USER_A, { maxRows: 10 });
    expect(result.error).toBeNull();
    expect(result.data?.rows).toHaveLength(1);
  });
});

describe('DE-7 D-14 all history: every status, hidden blocks, inactive links, every picture source', () => {
  it('draft, live and archived pages, landing pages, hidden blocks, inactive (system) links and every media source are exported', async () => {
    const pages = [
      pageRow('a', 0, { status: 'draft', page_type: 'homepage' }),
      pageRow('a', 1, { status: 'live', page_type: 'landing' }),
      pageRow('a', 2, { status: 'archived', page_type: 'landing' }),
    ];
    const db: Record<string, Row[]> = {
      website_pages: pages,
      website_blocks: [blockRow('a', 0, pages[0].id, { enabled: false }), blockRow('a', 1, pages[2].id, { enabled: true })],
      smart_links: [rowFor('smart_links', 'a', 0, { is_active: false, metadata: { journeyType: 'booking' } }), rowFor('smart_links', 'a', 1, { is_active: true })],
      user_media: ['stock', 'generated', 'upload'].map((source, n) => rowFor('user_media', 'a', n, { source })),
    };
    const { client, log } = fakeClient(db);
    const repo = new BusinessDataExportRepository(client);
    const read = async (section: ExportSectionId) => (await repo.listOwnedRowsForExport(section, USER_A, { maxRows: 100 })).data?.rows ?? [];
    expect((await read('website_pages')).map((r) => r.status).sort()).toEqual(['archived', 'draft', 'live']);
    expect((await read('website_blocks')).map((r) => r.enabled).sort()).toEqual([false, true]);
    expect((await read('smart_links')).map((r) => r.is_active).sort()).toEqual([false, true]);
    expect((await read('images')).map((r) => r.source).sort()).toEqual(['generated', 'stock', 'upload']);
    expect(log.flatMap((l) => l.calls).some((c) => c[0] === 'not')).toBe(false);
    // Out columns never selected, the owner id never in the rows.
    const all = JSON.stringify(await Promise.all((['website_pages', 'website_blocks', 'smart_links', 'images'] as ExportSectionId[]).map(read)));
    expect(all).not.toContain('EXCLUDED');
    expect(all).not.toContain(USER_A);
  });
});

describe('DE-7 C-2 the final sort is code-unit order, never locale order (source pin)', () => {
  it('the repository never calls localeCompare', () => {
    expect(codeOnly(fs.readFileSync(REPO_FILE, 'utf-8'))).not.toMatch(/localeCompare/);
  });

  it('negative control: a planted localeCompare is flagged; one in a comment is not', () => {
    expect(/localeCompare/.test(codeOnly('rows.sort((a, b) => a.id.localeCompare(b.id));'))).toBe(true);
    expect(/localeCompare/.test(codeOnly('// never localeCompare here'))).toBe(false);
  });
});
