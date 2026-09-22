/**
 * A small in-memory stand-in for the supabase-js query builder, with REAL
 * PostgREST semantics for the parts Business OS usage code relies on.
 *
 * Why not hand-set mock return values: a test whose mock returns whatever the
 * code under test happens to expect proves nothing about equivalence. Here the
 * rows are fixtures and every filter, order, range and terminal is applied to
 * them, so `.single()` and `.maybeSingle()` (for example) behave the way
 * PostgREST does for 0, 1 and many rows (Layer 1.1 workplan WC-1).
 *
 * Supported: from/select (projection, `{ count: 'exact', head: true }`), eq,
 * gte, lte, in, ilike (with `\` escapes), or (`col.like.x*` and
 * `col.in.("a","b")` clauses), order, range, limit, single, maybeSingle,
 * await; rpc via a handler. Every query is recorded for assertions.
 *
 * Lives outside `__tests__` so Jest does not collect it as a suite.
 */

export type Row = Record<string, unknown>;

export interface RecordedFilter {
  op: 'eq' | 'gte' | 'lte' | 'in' | 'ilike' | 'or';
  column: string;
  value: unknown;
}

export interface RecordedQuery {
  table: string;
  select: string | null;
  selectOptions: { count?: string; head?: boolean } | null;
  filters: RecordedFilter[];
  order: Array<{ column: string; ascending: boolean }>;
  range: [number, number] | null;
  limit: number | null;
  terminal: 'many' | 'single' | 'maybeSingle' | null;
}

export interface FakeDbOptions {
  tables?: Record<string, Row[]>;
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
  /** Make a query reject (a thrown client/network error) when it matches. */
  throwWhen?: (query: RecordedQuery) => boolean;
  /** Make a query resolve with a PostgREST error when it matches. */
  errorWhen?: (query: RecordedQuery) => { message: string; code?: string } | null;
}

interface Result {
  data: unknown;
  error: unknown;
  count?: number | null;
}

function likeToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      source += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    } else if (ch === '%' || ch === '*') {
      // PostgREST accepts `*` as `%` in like/ilike values.
      source += '.*';
    } else if (ch === '_') {
      source += '.';
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, caseInsensitive ? 'is' : 's');
}

function parseInList(raw: string): string[] {
  // ("a","b") or (a,b)
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  if (!inner) return [];
  return inner.split(',').map((v) => v.trim().replace(/^"(.*)"$/, '$1'));
}

function orMatches(row: Row, expression: string): boolean {
  // Split on commas that are not inside parentheses.
  const clauses: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expression) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      clauses.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) clauses.push(current);

  return clauses.some((clause) => {
    const [column, op, ...rest] = clause.split('.');
    const value = rest.join('.');
    const cell = row[column];
    if (op === 'like') return typeof cell === 'string' && likeToRegExp(value, false).test(cell);
    if (op === 'in') return parseInList(value).includes(String(cell));
    if (op === 'eq') return String(cell) === value;
    throw new Error(`fakePostgrest: unsupported or-operator ${op}`);
  });
}

function applyFilters(rows: Row[], filters: RecordedFilter[]): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      const cell = row[f.column];
      switch (f.op) {
        case 'eq':
          return cell === f.value;
        case 'gte':
          return cell !== null && cell !== undefined && String(cell) >= String(f.value);
        case 'lte':
          return cell !== null && cell !== undefined && String(cell) <= String(f.value);
        case 'in':
          return (f.value as unknown[]).includes(cell);
        case 'ilike':
          return typeof cell === 'string' && likeToRegExp(String(f.value), true).test(cell);
        case 'or':
          return orMatches(row, String(f.value));
        default:
          return true;
      }
    })
  );
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function project(row: Row, select: string | null): Row {
  if (!select || select.trim() === '*') return { ...row };
  const out: Row = {};
  for (const column of select.split(',').map((c) => c.trim()).filter(Boolean)) {
    out[column] = row[column] === undefined ? null : row[column];
  }
  return out;
}

export function createFakeSupabase(options: FakeDbOptions = {}) {
  const tables = options.tables ?? {};
  const queries: RecordedQuery[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  function execute(query: RecordedQuery): Promise<Result> {
    queries.push(query);
    if (options.throwWhen?.(query)) {
      return Promise.reject(new Error('fakePostgrest: simulated client failure'));
    }
    const forced = options.errorWhen?.(query);
    if (forced) return Promise.resolve({ data: null, error: forced, count: null });

    let rows = applyFilters(tables[query.table] ?? [], query.filters);

    if (query.order.length) {
      rows = [...rows].sort((a, b) => {
        for (const { column, ascending } of query.order) {
          const c = compare(a[column], b[column]);
          if (c !== 0) return ascending ? c : -c;
        }
        return 0;
      });
    }

    const count = query.selectOptions?.count === 'exact' ? rows.length : null;

    if (query.range) rows = rows.slice(query.range[0], query.range[1] + 1);
    if (query.limit !== null) rows = rows.slice(0, query.limit);

    if (query.selectOptions?.head) return Promise.resolve({ data: null, error: null, count });

    const projected = rows.map((r) => project(r, query.select));

    if (query.terminal === 'single') {
      if (projected.length === 1) return Promise.resolve({ data: projected[0], error: null });
      return Promise.resolve({
        data: null,
        error: {
          code: 'PGRST116',
          message: 'JSON object requested, multiple (or no) rows returned',
          details: `The result contains ${projected.length} rows`,
        },
      });
    }
    if (query.terminal === 'maybeSingle') {
      if (projected.length === 0) return Promise.resolve({ data: null, error: null });
      if (projected.length === 1) return Promise.resolve({ data: projected[0], error: null });
      return Promise.resolve({
        data: null,
        error: {
          code: 'PGRST116',
          message: 'JSON object requested, multiple (or no) rows returned',
          details: `The result contains ${projected.length} rows`,
        },
      });
    }
    return Promise.resolve({ data: projected, error: null, count });
  }

  function builder(table: string) {
    const query: RecordedQuery = {
      table,
      select: null,
      selectOptions: null,
      filters: [],
      order: [],
      range: null,
      limit: null,
      terminal: null,
    };

    const api = {
      select(columns = '*', opts?: { count?: string; head?: boolean }) {
        query.select = columns;
        query.selectOptions = opts ?? null;
        return api;
      },
      eq(column: string, value: unknown) {
        query.filters.push({ op: 'eq', column, value });
        return api;
      },
      gte(column: string, value: unknown) {
        query.filters.push({ op: 'gte', column, value });
        return api;
      },
      lte(column: string, value: unknown) {
        query.filters.push({ op: 'lte', column, value });
        return api;
      },
      in(column: string, value: unknown[]) {
        query.filters.push({ op: 'in', column, value });
        return api;
      },
      ilike(column: string, value: string) {
        query.filters.push({ op: 'ilike', column, value });
        return api;
      },
      or(expression: string) {
        query.filters.push({ op: 'or', column: '', value: expression });
        return api;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        query.order.push({ column, ascending: opts?.ascending ?? true });
        return api;
      },
      range(from: number, to: number) {
        query.range = [from, to];
        return api;
      },
      limit(n: number) {
        query.limit = n;
        return api;
      },
      single() {
        query.terminal = 'single';
        return execute(query);
      },
      maybeSingle() {
        query.terminal = 'maybeSingle';
        return execute(query);
      },
      then<T1 = Result, T2 = never>(
        onFulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
        onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
      ) {
        query.terminal = 'many';
        return execute(query).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (!options.rpc) {
        return Promise.resolve({ data: null, error: { message: 'function not found', code: 'PGRST202' } });
      }
      return Promise.resolve(options.rpc(name, args));
    },
  };

  return { client, queries, rpcCalls };
}
