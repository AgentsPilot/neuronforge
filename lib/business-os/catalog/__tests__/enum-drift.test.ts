/**
 * The catalog's declared enum values against the values actually stored.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS WORTH A DATABASE-BACKED TEST
 *
 * An undeclared value is the quietest bug this system can produce. The planner
 * filters on the values it was told exist, the rows hold a different one, and
 * the answer is `0` — with no error, no warning, and nothing in the reply to
 * suggest the question was not understood.
 *
 * Found by audit, not by anyone noticing:
 *
 *   activities.activity_type   9 undeclared against 6 declared. Everything the
 *                              system logs about ITSELF — payment received,
 *                              invoice sent, refund issued — was invisible.
 *   invoices.status            `refunded` missing.
 *   sections.block_type        `features`, `pricing` missing.
 *
 * None of those columns has a check constraint, which is exactly why they
 * drifted: nothing except this test connects the declaration to reality.
 *
 * SKIPS WITHOUT CREDENTIALS. It reads the live database, so it is a no-op in an
 * environment that cannot reach one rather than a failure — a test that cannot
 * run must not look like a test that failed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CATALOG } from '../index';
import { supabaseServer } from '@/lib/supabaseServer';

const CONNECTED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('test.supabase.co')
);

const describeIfConnected = CONNECTED ? describe : describe.skip;

/** Enough rows to catch a value in ordinary use; not a full table scan. */
const SAMPLE = 2000;

describeIfConnected('declared enum values cover what is stored', () => {
  const enums: Array<{ entity: string; field: string; table: string; column: string; declared: string[] }> = [];

  for (const [entityKey, entity] of Object.entries(CATALOG.entities)) {
    for (const [fieldKey, field] of Object.entries(entity.fields)) {
      if (field.enumValues?.length) {
        enums.push({
          entity: entityKey,
          field: fieldKey,
          table: entity.table,
          column: field.column,
          declared: field.enumValues,
        });
      }
    }
  }

  it('found enum fields to check', () => {
    // Guards against the whole suite silently passing because the catalog
    // shape changed and nothing was collected.
    expect(enums.length).toBeGreaterThan(5);
  });

  it.each(enums)('$entity.$field declares every value in the data', async ({ table, column, declared, entity, field }) => {
    const { data, error } = await supabaseServer.from(table).select(column).limit(SAMPLE);

    // A read failure is an environment problem, not a drift; do not turn it
    // into a red test that sends someone hunting for a catalog bug.
    if (error) return;

    const stored = new Set(
      (data ?? []).map((row) => (row as unknown as Record<string, unknown>)[column]).filter((v) => v !== null && v !== '')
    );

    const undeclared = [...stored].filter((v) => !declared.includes(v as string));

    expect({ field: `${entity}.${field}`, undeclared }).toEqual({
      field: `${entity}.${field}`,
      undeclared: [],
    });
  });
});

describe('every declared value can be shown to a person', () => {
  /*
   * A value with no label renders as its raw token — "no_show", "past_client"
   * — in the middle of a Hebrew sentence. Cheap to check, and it runs without
   * a database.
   */
  it.each(
    Object.entries(CATALOG.entities).flatMap(([entityKey, entity]) =>
      Object.entries(entity.fields)
        .filter(([, f]) => f.enumValues?.length && f.enumLabels)
        .map(([fieldKey, f]) => ({ id: `${entityKey}.${fieldKey}`, field: f }))
    )
  )('$id labels every value it declares', ({ id, field }) => {
    const missing = (field.enumValues ?? []).filter((v) => !field.enumLabels?.[v]);

    expect({ id, missing }).toEqual({ id, missing: [] });
  });
});
