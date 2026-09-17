/**
 * The database's own account of itself: tables, columns, NOT NULLs, primary
 * keys and FOREIGN KEYS — read from PostgREST's OpenAPI document.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT information_schema
 *
 * There is no SQL runner on this project (`exec_sql` does not exist), and
 * PostgREST exposes only the `public` schema's tables, not the catalogue. But
 * its OpenAPI document already carries everything needed: each column's type
 * and default, which columns are required, and — annotated into the column
 * description as `<fk table='x' column='y'/>` — every foreign key.
 *
 * WHY IT MATTERS HERE
 *
 * Two scripts were guessing at things this knows for certain:
 *
 *   - the fixture restored tables in an arbitrary order and retried whatever
 *     failed, which works but cannot say WHY something failed, and silently
 *     gives up when a whole pass fails.
 *   - the coverage audit built its list of tables by scraping CREATE TABLE out
 *     of migrations and `.from('…')` out of the source — which missed every
 *     table created outside this repo and invented several that do not exist.
 *
 * This replaces both guesses with the schema as the database actually reports
 * it. It is also, usefully, a source INDEPENDENT of any list in the repo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ForeignKey {
  column: string;
  refTable: string;
  refColumn: string;
}

export interface TableSchema {
  name: string;
  columns: string[];
  /** NOT NULL with no default — an insert missing one of these is rejected. */
  required: string[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  defaults: Record<string, unknown>;
  /** varchar(n) limits, so a generated replacement value still fits. */
  maxLengths: Record<string, number>;
  /** Column formats ('uuid', 'text', 'integer', …) as Postgres reports them. */
  formats: Record<string, string>;
}

const FK_PATTERN = /<fk table='([^']+)' column='([^']+)'\/>/;
const PK_MARKER = '<pk/>';

let cache: Map<string, TableSchema> | null = null;

export async function loadSchema(
  url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY!
): Promise<Map<string, TableSchema>> {
  if (cache) return cache;

  const response = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/openapi+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Could not read the schema: HTTP ${response.status}`);
  }

  const document = (await response.json()) as {
    definitions?: Record<string, any>;
    components?: { schemas?: Record<string, any> };
  };

  const definitions = document.definitions ?? document.components?.schemas ?? {};
  const schema = new Map<string, TableSchema>();

  for (const [name, definition] of Object.entries(definitions)) {
    const properties: Record<string, any> = definition.properties ?? {};
    const table: TableSchema = {
      name,
      columns: Object.keys(properties),
      required: definition.required ?? [],
      primaryKey: [],
      foreignKeys: [],
      defaults: {},
      maxLengths: {},
      formats: {},
    };

    for (const [column, spec] of Object.entries(properties)) {
      const description: string = spec?.description ?? '';

      if (description.includes(PK_MARKER)) table.primaryKey.push(column);
      if (spec?.default !== undefined) table.defaults[column] = spec.default;
      if (typeof spec?.maxLength === 'number') table.maxLengths[column] = spec.maxLength;
      if (typeof spec?.format === 'string') table.formats[column] = spec.format;

      const fk = FK_PATTERN.exec(description);
      if (fk) table.foreignKeys.push({ column, refTable: fk[1], refColumn: fk[2] });
    }

    schema.set(name, table);
  }

  cache = schema;
  return schema;
}

/**
 * Insert order: every table after the tables it points at.
 *
 * Kahn's algorithm over the foreign-key graph, so parents are always written
 * before their children and no retry loop is needed to discover an order the
 * database already knows.
 *
 * Self-references are ignored as edges — a row pointing at its own table
 * (a parent booking, a threaded message) cannot be ordered away, and is
 * handled by inserting that table's rows together.
 *
 * A CYCLE between tables is returned rather than thrown: the caller still has
 * to insert them, and a stable order with a named cycle is more useful than a
 * crash. Cycles are reported so they can be deferred deliberately.
 */
export function insertOrder(
  tables: string[],
  schema: Map<string, TableSchema>
): { order: string[]; cycles: string[] } {
  const wanted = new Set(tables);
  const dependsOn = new Map<string, Set<string>>();

  for (const table of tables) {
    const deps = new Set<string>();
    for (const fk of schema.get(table)?.foreignKeys ?? []) {
      // Only dependencies inside the set being inserted, and never on itself.
      if (fk.refTable !== table && wanted.has(fk.refTable)) deps.add(fk.refTable);
    }
    dependsOn.set(table, deps);
  }

  const order: string[] = [];
  const placed = new Set<string>();

  while (order.length < tables.length) {
    const ready = tables
      .filter(t => !placed.has(t))
      .filter(t => [...(dependsOn.get(t) ?? [])].every(d => placed.has(d)));

    if (ready.length === 0) break; // everything left is in a cycle

    // Sorted for a stable, reproducible order between runs.
    for (const table of ready.sort()) {
      order.push(table);
      placed.add(table);
    }
  }

  const cycles = tables.filter(t => !placed.has(t)).sort();
  return { order: [...order, ...cycles], cycles };
}

/** Required columns a row does not supply — the insert would be rejected. */
export function missingRequired(
  table: string,
  row: Record<string, unknown>,
  schema: Map<string, TableSchema>
): string[] {
  const spec = schema.get(table);
  if (!spec) return [];

  return spec.required.filter(column => {
    const value = row[column];
    // A default covers an absent value; it does not cover an explicit null.
    if (value === undefined) return spec.defaults[column] === undefined;
    return value === null;
  });
}

/** Columns this table uses to point at another table's rows. */
export function referencesTo(
  table: string,
  refTable: string,
  schema: Map<string, TableSchema>
): ForeignKey[] {
  return (schema.get(table)?.foreignKeys ?? []).filter(fk => fk.refTable === refTable);
}
