/**
 * A small in-memory database for the MK5B-FU-1 first-payment tests
 * (workplan docs/workplans/FINANCE_PAYING_FIRST_PAYMENT_SCALE_WORKPLAN.md §9.4,
 * SA-WP-M5F M5F-13: a dedicated fake, so `fakePostgrest.ts` stays untouched).
 *
 * Two relations:
 *   - `business_os_billing_events`: the raw rows, as seeded;
 *   - `business_os_first_plan_payments`: the REFERENCE view, computed from the
 *     same rows with the migration's rule (kind `invoice_paid`, amount above
 *     zero, `paid_at` present, `user_id` present; the earliest `paid_at` per
 *     account and mode, ties by the smaller id). Its correctness on the real
 *     database is checked by the migration checker (C-6, C-7).
 *
 * The query builder REALLY applies `eq`, `gt`, `gte`, `lt`, `not(col, 'is',
 * null)`, `in`, `order` (one column, ascending) and `limit`, so a reader that
 * forgets a filter gets the wrong rows, not a mocked answer. Time columns
 * (`paid_at`, `first_payment_at`) compare as instants; everything else as text
 * or numbers. Every query is recorded.
 *
 * Test-only. Lives outside `__tests__` so Jest does not collect it as a suite.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface FakeBillingEvent {
  id: string;
  user_id: string | null;
  livemode: boolean;
  kind: string;
  amount_minor: number | null;
  paid_at: string | null;
}

export interface FirstPaymentViewRow {
  user_id: string;
  livemode: boolean;
  first_payment_at: string;
}

export interface RecordedFakeQuery {
  table: string;
  select: string;
  filters: Array<{ op: string; column: string; value: unknown }>;
  order: string | null;
  limit: number | null;
  rows: number;
}

export const EVENTS_TABLE = 'business_os_billing_events';
export const FIRST_PAYMENTS_VIEW = 'business_os_first_plan_payments';

const TIME_COLUMNS = new Set(['paid_at', 'first_payment_at']);

/** The migration's rule, in TypeScript: the reference the reads are measured against. */
export function referenceFirstPayments(events: readonly FakeBillingEvent[]): FirstPaymentViewRow[] {
  const best = new Map<string, FakeBillingEvent>();
  for (const e of events) {
    if (e.kind !== 'invoice_paid' || e.amount_minor === null || !(e.amount_minor > 0) || e.paid_at === null || e.user_id === null) continue;
    const key = `${e.user_id}|${e.livemode}`;
    const seen = best.get(key);
    const at = Date.parse(e.paid_at);
    if (!seen) {
      best.set(key, e);
      continue;
    }
    const seenAt = Date.parse(seen.paid_at as string);
    if (at < seenAt || (at === seenAt && e.id < seen.id)) best.set(key, e);
  }
  return [...best.values()].map((e) => ({ user_id: e.user_id as string, livemode: e.livemode, first_payment_at: e.paid_at as string }));
}

/** Parsed instants, memoised: the scale tests compare the same few hundred thousand texts many times. */
const instants = new Map<string, number>();
function instant(text: string): number {
  let at = instants.get(text);
  if (at === undefined) {
    at = Date.parse(text);
    if (instants.size > 500_000) instants.clear();
    instants.set(text, at);
  }
  return at;
}

function compare(column: string, a: unknown, b: unknown): number {
  if (TIME_COLUMNS.has(column)) return instant(String(a)) - instant(String(b));
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function fakeFirstPaymentDb(events: readonly FakeBillingEvent[], opts: { failOn?: (q: RecordedFakeQuery) => boolean } = {}) {
  const view = referenceFirstPayments(events);
  const tables: Record<string, ReadonlyArray<Record<string, unknown>>> = {
    [EVENTS_TABLE]: events as unknown as Array<Record<string, unknown>>,
    [FIRST_PAYMENTS_VIEW]: view as unknown as Array<Record<string, unknown>>,
  };
  // An index on user_id per relation, so an `in('user_id', …)` read does not scan everything.
  const byUser = new Map<string, Map<string, Array<Record<string, unknown>>>>();
  for (const [name, rows] of Object.entries(tables)) {
    const index = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) {
      const key = String(row.user_id);
      const list = index.get(key);
      if (list) list.push(row);
      else index.set(key, [row]);
    }
    byUser.set(name, index);
  }

  // Each relation sorted once per order column, so a paged read does not re-sort the whole relation.
  const sortedBy = new Map<string, ReadonlyArray<Record<string, unknown>>>();
  const sorted = (table: string, column: string) => {
    const key = `${table}|${column}`;
    let rows = sortedBy.get(key);
    if (!rows) {
      rows = [...tables[table]].sort((x, y) => compare(column, x[column], y[column]));
      sortedBy.set(key, rows);
    }
    return rows;
  };

  const queries: RecordedFakeQuery[] = [];
  const client = {
    from: (table: string) => {
      if (!(table in tables)) throw new Error(`fake: unknown relation ${table}`);
      const q: RecordedFakeQuery = { table, select: '', filters: [], order: null, limit: null, rows: 0 };
      const builder: Record<string, unknown> = {
        select: (cols: string) => ((q.select = cols), builder),
        eq: (column: string, value: unknown) => (q.filters.push({ op: 'eq', column, value }), builder),
        gt: (column: string, value: unknown) => (q.filters.push({ op: 'gt', column, value }), builder),
        gte: (column: string, value: unknown) => (q.filters.push({ op: 'gte', column, value }), builder),
        lt: (column: string, value: unknown) => (q.filters.push({ op: 'lt', column, value }), builder),
        not: (column: string, op: string, value: unknown) => {
          if (op !== 'is' || value !== null) throw new Error('fake: only not(col, is, null)');
          q.filters.push({ op: 'notnull', column, value: null });
          return builder;
        },
        in: (column: string, value: unknown[]) => (q.filters.push({ op: 'in', column, value }), builder),
        order: (column: string, o?: { ascending?: boolean }) => {
          if (o && o.ascending === false) throw new Error('fake: ascending order only');
          q.order = column;
          return builder;
        },
        limit: (n: number) => ((q.limit = n), builder),
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          try {
            queries.push(q);
            if (opts.failOn?.(q)) return resolve({ data: null, error: new Error('fake: read failed') });
            const inUser = q.filters.find((f) => f.op === 'in' && f.column === 'user_id');
            let candidates: ReadonlyArray<Record<string, unknown>>;
            if (inUser) {
              const index = byUser.get(table) as Map<string, Array<Record<string, unknown>>>;
              candidates = [...new Set(inUser.value as string[])].flatMap((id) => index.get(id) ?? []);
            } else {
              candidates = q.order ? sorted(table, q.order) : tables[table];
            }
            const tests = q.filters.map((f) => {
              switch (f.op) {
                case 'eq':
                  return (row: Record<string, unknown>) => row[f.column] === f.value;
                case 'gt':
                  return (row: Record<string, unknown>) => row[f.column] !== null && compare(f.column, row[f.column], f.value) > 0;
                case 'gte':
                  return (row: Record<string, unknown>) => row[f.column] !== null && compare(f.column, row[f.column], f.value) >= 0;
                case 'lt':
                  return (row: Record<string, unknown>) => row[f.column] !== null && compare(f.column, row[f.column], f.value) < 0;
                case 'notnull':
                  return (row: Record<string, unknown>) => row[f.column] !== null && row[f.column] !== undefined;
                case 'in': {
                  const set = new Set(f.value as unknown[]);
                  return (row: Record<string, unknown>) => set.has(row[f.column]);
                }
                default:
                  throw new Error(`fake: unsupported ${f.op}`);
              }
            });
            let rows: Array<Record<string, unknown>>;
            if (!inUser && q.order) {
              // Already in order: start after a keyset bound on the order column (binary search) and stop at the limit.
              const column = q.order;
              const bound = q.filters.find((f) => f.op === 'gt' && f.column === column);
              let lo = 0;
              if (bound) {
                let hi = candidates.length;
                while (lo < hi) {
                  const mid = (lo + hi) >> 1;
                  if (compare(column, candidates[mid][column], bound.value) > 0) hi = mid;
                  else lo = mid + 1;
                }
              }
              rows = [];
              const cap = q.limit ?? Infinity;
              for (let i = lo; i < candidates.length && rows.length < cap; i += 1) {
                if (tests.every((t) => t(candidates[i]))) rows.push(candidates[i]);
              }
            } else {
              rows = candidates.filter((row) => tests.every((t) => t(row)));
              if (q.order) {
                const column = q.order;
                rows.sort((a, b) => compare(column, a[column], b[column]));
              }
              if (q.limit !== null) rows = rows.slice(0, q.limit);
            }
            const columns = q.select.split(',').map((c) => c.trim()).filter(Boolean);
            const data = rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]])));
            q.rows = data.length;
            return resolve({ data, error: null });
          } catch (error) {
            if (reject) return reject(error);
            throw error;
          }
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, queries, view };
}
