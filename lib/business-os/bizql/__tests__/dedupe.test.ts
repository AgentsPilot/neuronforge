/**
 * Entity-level deduplication in the BizQL compiler.
 *
 * WHY THIS EXISTS
 *
 * Asked "יש משהו דחוף שאני צריך לשים לב?", the chat answered "you have 20 urgent
 * things" and listed the SAME finding twenty times. The chat was not wrong — the
 * `insights` table really did hold 994 rows for one `ops_utilization_low`
 * detection, because the insight engine appends a row per run instead of
 * updating the existing one. But an answer that repeats one problem twenty times
 * is useless to the owner, and the count is actively misleading.
 *
 * So an entity may declare `dedupeBy`, and the compiler collapses repeats on
 * that key after fetching and before applying the limit.
 *
 * The first attempt at this silently did nothing, and that is the failure these
 * tests are really guarding: the planner had not SELECTED `detector_id`, so every
 * dedupe key read as `undefined` and no two rows ever matched. `collapsed` was 0
 * and twenty duplicates still came back. A test that only checks "duplicates
 * collapse when the key is present" would have passed while the feature was dead
 * in production, so the select-projection case below is not optional coverage.
 */

import { compileAndRunFind } from '../compiler';
import { CATALOG } from '@/lib/business-os/catalog';
import { validatePlan } from '../planner/validatePlan';

const USER = '11111111-1111-1111-1111-111111111111';

interface RecordedQuery {
  table: string;
  select: string;
  filters: Array<{ method: string; args: unknown[] }>;
}

function makeFakeClient(rowsByTable: Record<string, unknown[]> = {}) {
  const queries: RecordedQuery[] = [];

  function makeBuilder(record: RecordedQuery) {
    const builder: Record<string, unknown> = {};

    const chain =
      (method: string) =>
      (...args: unknown[]) => {
        record.filters.push({ method, args });
        return builder;
      };

    for (const method of [
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'not',
      'ilike', 'like', 'contains', 'overlaps', 'or', 'order', 'range',
    ]) {
      builder[method] = chain(method);
    }

    builder.limit = (...args: unknown[]) => {
      record.filters.push({ method: 'limit', args });
      return Promise.resolve({ data: rowsByTable[record.table] ?? [], error: null });
    };

    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rowsByTable[record.table] ?? [], error: null });

    return builder;
  }

  const client = {
    from(table: string) {
      return {
        select(select: string) {
          const record: RecordedQuery = { table, select, filters: [] };
          queries.push(record);
          return makeBuilder(record);
        },
      };
    },
  };

  return { client: client as never, queries };
}

/** N rows spread across `detectors`, in the order the detectors are listed. */
function insightRows(detectors: string[], perDetector: number) {
  return detectors.flatMap((detector, d) =>
    Array.from({ length: perDetector }, (_, i) => ({
      id: `${d}${i}`.padStart(8, '0') + '-0000-0000-0000-000000000000',
      title: `${detector} finding`,
      detector_id: detector,
      severity: 'critical',
      status: 'new',
    }))
  );
}

describe('BizQL entity deduplication', () => {
  it('collapses repeats on the entity dedupe key and reports the count', async () => {
    const { client } = makeFakeClient({
      insights: insightRows(['ops_utilization_low', 'cash_ar_overdue'], 10),
    });

    const result = await compileAndRunFind(
      client,
      { op: 'find', entity: 'insights', limit: 20 },
      { userId: USER }
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.detector_id)).toEqual([
      'ops_utilization_low',
      'cash_ar_overdue',
    ]);
    // 20 fetched, 2 kept.
    expect(result.collapsed).toBe(18);
  });

  it('fetches the dedupe column even when the caller did not select it', async () => {
    // The regression: without this, every key is `undefined`, nothing matches,
    // and dedup is a silent no-op.
    const { client, queries } = makeFakeClient({
      insights: insightRows(['ops_utilization_low'], 20),
    });

    const result = await compileAndRunFind(
      client,
      { op: 'find', entity: 'insights', select: ['title'], limit: 20 },
      { userId: USER }
    );

    expect(queries[0].select).toContain('detector_id');
    expect(result.rows).toHaveLength(1);
    expect(result.collapsed).toBe(19);
  });

  it('keeps the first row of each group, so ordering still decides what is shown', async () => {
    const { client } = makeFakeClient({
      insights: [
        { id: 'a', title: 'newest', detector_id: 'ops_utilization_low' },
        { id: 'b', title: 'older', detector_id: 'ops_utilization_low' },
      ],
    });

    const result = await compileAndRunFind(
      client,
      { op: 'find', entity: 'insights', limit: 10 },
      { userId: USER }
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].title).toBe('newest');
  });

  it('leaves entities that declare no dedupe key untouched', async () => {
    // Two invoices for one contact are two real invoices, not a duplicate.
    const { client } = makeFakeClient({
      payment_invoices: [
        { id: 'a', invoice_number: 'INV-1', contact_id: 'c1' },
        { id: 'b', invoice_number: 'INV-2', contact_id: 'c1' },
      ],
    });

    expect(CATALOG.entities.invoices.dedupeBy).toBeUndefined();

    const result = await compileAndRunFind(
      client,
      { op: 'find', entity: 'invoices', limit: 10 },
      { userId: USER }
    );

    expect(result.rows).toHaveLength(2);
    expect(result.collapsed ?? 0).toBe(0);
  });

  it('does not report a capped list as truncated once the repeats are gone', async () => {
    // 40 rows come back for a limit of 3, but they are 2 distinct findings.
    // Reporting "showing the first results only" here would be a lie.
    const { client } = makeFakeClient({
      insights: insightRows(['ops_utilization_low', 'cash_ar_overdue'], 20),
    });

    const result = await compileAndRunFind(
      client,
      { op: 'find', entity: 'insights', limit: 3 },
      { userId: USER }
    );

    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });
});

// =============================================================================
// Bare relation predicates — the validator and the compiler must agree
// =============================================================================

describe('bare relation predicates', () => {
  const bare = {
    op: 'find' as const,
    entity: 'invoices',
    where: [
      { field: 'status', op: 'in' as const, value: { $semantic: 'unpaid' } },
      { relation: 'contact', quantifier: 'none' as const },
    ],
  };

  it('the compiler refuses a quantifier with no inner filter on a to-one relation', async () => {
    // "מי חייב לי כסף?" planned exactly this. `contact` is to-one, so the
    // compiler collected every contact the user owns and excluded every invoice
    // pointing at one: 13 real answers became "nobody owes you anything".
    const { client } = makeFakeClient({
      crm_contacts: [{ id: 'c1' }],
      payment_invoices: [{ id: 'i1', invoice_number: 'INV-1', contact_id: 'c1' }],
    });

    await expect(compileAndRunFind(client, bare, { userId: USER })).rejects.toThrow(
      /DELETE this filter/
    );
  });

  it('the validator refuses the same shape, with the same reason', () => {
    const problems = validatePlan({ steps: [{ id: 's1', ...bare }] } as never);

    expect(problems.some((p) => /DELETE this filter/.test(p))).toBe(true);
    // The message must lead with the action to take. Naming replacement filters
    // FIRST made the model pick one and invent a predicate rather than remove it.
    expect(problems.some((p) => /contact_id/.test(p) && /is_null/.test(p))).toBe(true);
  });

  it('still allows a quantifier that carries an inner filter', async () => {
    const { client } = makeFakeClient({
      crm_contacts: [{ id: 'c1' }],
      payment_invoices: [{ id: 'i1', invoice_number: 'INV-1', contact_id: 'c1' }],
    });

    const result = await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'invoices',
        where: [
          {
            relation: 'contact',
            quantifier: 'any',
            where: [{ field: 'first_name', op: 'eq', value: 'Ofir' }],
          },
        ],
      },
      { userId: USER }
    );

    expect(result.rows).toHaveLength(1);
  });

  it('still allows a bare quantifier on a one-to-many relation', async () => {
    // "contacts with no bookings at all" is a real question, and there is no
    // field on contacts that expresses it.
    const { client } = makeFakeClient({
      scheduling_bookings: [{ contact_id: 'c1' }],
      crm_contacts: [{ id: 'c2', first_name: 'Dana' }],
    });

    const result = await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'contacts',
        where: [{ relation: 'bookings', quantifier: 'none' }],
      },
      { userId: USER }
    );

    expect(result.rows).toHaveLength(1);
  });
});
