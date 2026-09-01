/**
 * Tenant isolation tests for the BizQL compiler.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THESE ARE THE MOST IMPORTANT TESTS IN THE BUSINESS OS.
 *
 * Every repository uses `supabaseServer`, the service-role client, which
 * BYPASSES row-level security. `.eq('user_id', …)` is the only thing separating
 * one business's data from another's. If the compiler ever emits a query without
 * it, the product leaks across tenants and RLS will not save us.
 *
 * So rather than trusting review, these tests record every filter the compiler
 * applies — against a fake client, with no database and no network — and assert
 * that user scoping is present on the outer query AND on every sub-query the
 * anti-join path generates.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { compileAndRunFind, compileAndRunCompute } from '../compiler';
import { BizQLValidationError } from '../types';
import type { FindQuery } from '../types';

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER_USER = '22222222-2222-2222-2222-222222222222';

interface RecordedQuery {
  table: string;
  select: string;
  filters: Array<{ method: string; args: unknown[] }>;
}

/**
 * Minimal PostgREST double.
 *
 * Deliberately NOT a thenable-returning chain built with promises: the real
 * builder is a thenable, which is what makes `await` execute a query. The
 * compiler must therefore never await a bare builder, and this double
 * reproduces that shape (awaitable, chainable) so the test exercises it.
 */
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

    // The builder itself is awaitable, exactly like the real one.
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

/** Every recorded query must carry an equality filter on its scope column. */
function expectAllQueriesScoped(queries: RecordedQuery[], userId: string) {
  expect(queries.length).toBeGreaterThan(0);

  for (const query of queries) {
    const scoped = query.filters.some(
      (f) => f.method === 'eq' && f.args[0] === 'user_id' && f.args[1] === userId
    );

    expect({ table: query.table, scoped }).toEqual({ table: query.table, scoped: true });
  }
}

describe('BizQL tenant isolation', () => {
  it('scopes a simple find to the calling user', async () => {
    const { client, queries } = makeFakeClient();

    await compileAndRunFind(
      client,
      { op: 'find', entity: 'invoices', limit: 10 },
      { userId: USER }
    );

    expectAllQueriesScoped(queries, USER);
  });

  it('scopes BOTH passes of the anti-join used by derived fields', async () => {
    // `has_completed_intake = false` runs a sub-query over bookings and then
    // filters contacts. A missing scope on EITHER pass leaks data: an unscoped
    // sub-query would exclude this user's contacts based on other users' bookings.
    const { client, queries } = makeFakeClient({
      scheduling_bookings: [{ contact_id: 'aaaaaaaa-0000-0000-0000-000000000000' }],
    });

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'contacts',
        where: [{ field: 'has_completed_intake', op: 'eq', value: false }],
      },
      { userId: USER }
    );

    const tables = queries.map((q) => q.table);
    expect(tables).toContain('scheduling_bookings');
    expect(tables).toContain('crm_contacts');
    expect(queries.length).toBeGreaterThanOrEqual(2);

    expectAllQueriesScoped(queries, USER);
  });

  it('scopes the sub-query of an explicit relation predicate', async () => {
    const { client, queries } = makeFakeClient({
      scheduling_bookings: [{ contact_id: 'aaaaaaaa-0000-0000-0000-000000000000' }],
    });

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'contacts',
        where: [
          {
            relation: 'bookings',
            quantifier: 'any',
            where: [{ field: 'status', op: 'eq', value: 'completed' }],
          },
        ],
      },
      { userId: USER }
    );

    expectAllQueriesScoped(queries, USER);
  });

  it('scopes aggregates', async () => {
    const { client, queries } = makeFakeClient();

    await compileAndRunCompute(
      client,
      { op: 'compute', entity: 'invoices', agg: { fn: 'count' } },
      { userId: USER }
    );

    expectAllQueriesScoped(queries, USER);
  });

  it('scopes embedded relations through the parent row', async () => {
    const { client, queries } = makeFakeClient();

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'invoices',
        include: [{ relation: 'contact', select: ['first_name', 'email'] }],
      },
      { userId: USER }
    );

    expectAllQueriesScoped(queries, USER);

    // The FK column is named explicitly: two tables can be related by more than
    // one FK, and without the hint PostgREST cannot tell which is meant.
    expect(queries[0].select).toContain('contact:crm_contacts!contact_id(');

    // Belt and braces: the embedded rows are scoped too, not merely implied by
    // the join.
    const embedScope = queries[0].filters.find(
      (f) => f.method === 'eq' && f.args[0] === 'contact.user_id'
    );
    expect(embedScope!.args[1]).toBe(USER);
  });

  it('supports a one-to-many include, scoped on both sides', async () => {
    // "which clients have an unpaid invoice" reads naturally as: contacts, with
    // their invoices attached. Rejecting that shape was the single biggest
    // remaining planner failure.
    const { client, queries } = makeFakeClient();

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'contacts',
        include: [{ relation: 'invoices', select: ['invoice_number', 'amount'] }],
      },
      { userId: USER }
    );

    expect(queries[0].select).toContain('invoices:payment_invoices!contact_id(');
    expectAllQueriesScoped(queries, USER);

    const embedScope = queries[0].filters.find(
      (f) => f.method === 'eq' && f.args[0] === 'invoices.user_id'
    );
    expect(embedScope!.args[1]).toBe(USER);
  });

  it('uses the context user, never a user_id smuggled into the query', async () => {
    const { client, queries } = makeFakeClient();

    // A hostile or confused planner tries to filter by someone else's id.
    // `user_id` is not a catalog field, so this must be rejected outright
    // rather than silently ORed alongside the real scope.
    await expect(
      compileAndRunFind(
        client,
        {
          op: 'find',
          entity: 'invoices',
          where: [{ field: 'user_id', op: 'eq', value: OTHER_USER }],
        } as FindQuery,
        { userId: USER }
      )
    ).rejects.toThrow(BizQLValidationError);

    for (const query of queries) {
      const leaked = query.filters.some((f) => f.args.includes(OTHER_USER));
      expect(leaked).toBe(false);
    }
  });

  it('refuses to run without a userId', async () => {
    const { client } = makeFakeClient();
    const { runQuery } = await import('../compiler');

    await expect(
      runQuery(client, { op: 'find', entity: 'invoices' }, { userId: '' })
    ).rejects.toThrow(BizQLValidationError);
  });

  describe('an entity with no user_id of its own', () => {
    // `link_clicks` records a click against a link; only the link knows whose it
    // is. Ownership is one join away, which makes it the one entity where the
    // tenant boundary is not a column comparison — and therefore the one worth
    // asserting in detail.

    it('reaches ownership through an INNER join, not a bare embed', async () => {
      const { client, queries } = makeFakeClient({ smart_link_clicks: [] });

      await compileAndRunFind(client, { op: 'find', entity: 'link_clicks' }, { userId: USER });

      const query = queries.find((q) => q.table === 'smart_link_clicks');
      expect(query).toBeDefined();

      // `!inner` is the entire safety property. A plain embed is a LEFT join, so
      // the filter below would match every row in the table with a null link
      // attached — the whole table, for every tenant, wearing a filter that did
      // nothing.
      expect(query!.select).toContain('!inner');
      expect(query!.select).toContain('owner_scope:smart_links');

      // And the filter must reference the joined table, not the click table.
      const scoped = query!.filters.some(
        (f) => f.method === 'eq' && f.args[0] === 'owner_scope.user_id' && f.args[1] === USER
      );
      expect(scoped).toBe(true);
    });

    it('scopes the aggregate path too', async () => {
      const { client, queries } = makeFakeClient({ smart_link_clicks: [] });

      await compileAndRunCompute(
        client,
        { op: 'compute', entity: 'link_clicks', agg: { fn: 'count' } },
        { userId: USER }
      );

      const query = queries.find((q) => q.table === 'smart_link_clicks');
      expect(query!.select).toContain('!inner');
      expect(
        query!.filters.some((f) => f.args[0] === 'owner_scope.user_id' && f.args[1] === USER)
      ).toBe(true);
    });

    it('never joins under the relation name the select may also be using', async () => {
      // Both embeds under one alias made PostgREST join the same table twice as
      // itself and fail the query outright. The tenant filter must not depend on
      // what the caller happens to be displaying.
      const { client, queries } = makeFakeClient({ smart_link_clicks: [] });

      await compileAndRunFind(
        client,
        { op: 'find', entity: 'link_clicks', include: [{ relation: 'link' }] },
        { userId: USER }
      );

      const select = queries.find((q) => q.table === 'smart_link_clicks')!.select;
      expect(select).toContain('owner_scope:smart_links');
      expect(select).not.toMatch(/(^|,)link:smart_links[^,]*!inner/);
    });

    it('refuses an entity scoped through something that is not itself scoped', async () => {
      // One hop only. A chain of relation-scoped entities is a boundary nobody
      // can verify by reading a single definition.
      const { CATALOG } = await import('@/lib/business-os/catalog');
      const entity = CATALOG.entities.link_clicks;
      const original = entity.userScope;

      // Point the scope at a relation the entity does not declare.
      (entity as { userScope: unknown }).userScope = { kind: 'relation', relation: 'nope' };
      try {
        const { client } = makeFakeClient();
        await expect(
          compileAndRunFind(client, { op: 'find', entity: 'link_clicks' }, { userId: USER })
        ).rejects.toThrow(/Refusing to run an unscoped query/);
      } finally {
        (entity as { userScope: unknown }).userScope = original;
      }
    });
  });
});

describe('BizQL field exposure', () => {
  it('refuses to select a field marked readable:false', async () => {
    const { client } = makeFakeClient();

    await expect(
      compileAndRunFind(
        client,
        { op: 'find', entity: 'invoices', select: ['internal_notes'] },
        { userId: USER }
      )
    ).rejects.toThrow(/not readable/);
  });

  it('refuses to filter on a real column that is not in the catalog', async () => {
    const { client } = makeFakeClient();

    await expect(
      compileAndRunFind(
        client,
        {
          op: 'find',
          entity: 'invoices',
          where: [{ field: 'stripe_invoice_id', op: 'is_not_null' }],
        },
        { userId: USER }
      )
    ).rejects.toThrow(/unknown field/);
  });

  it('refuses an undeclared semantic term instead of returning an empty set', async () => {
    // The dangerous failure mode: treating {$semantic:'banana'} as the literal
    // 'banana' returns zero rows, which reads as a legitimate "you have none".
    const { client } = makeFakeClient();

    await expect(
      compileAndRunFind(
        client,
        {
          op: 'find',
          entity: 'invoices',
          where: [{ field: 'status', op: 'eq', value: { $semantic: 'banana' } }],
        },
        { userId: USER }
      )
    ).rejects.toThrow(/not a declared semantic term/);
  });

  it('clamps limit to the entity maximum', async () => {
    const { client, queries } = makeFakeClient();

    await compileAndRunFind(
      client,
      { op: 'find', entity: 'invoices', limit: 999_999 },
      { userId: USER }
    );

    const limitCall = queries[0].filters.find((f) => f.method === 'limit');
    // maxLimit is 500 for invoices; the compiler fetches limit+1 to detect truncation.
    expect(limitCall!.args[0]).toBe(501);
  });
});

describe('BizQL relation filters — both directions', () => {
  /**
   * "Which invoices belong to Ofir" is an ordinary question, and rejecting it
   * (because contact is many-to-one, not a collection) forced the planner into
   * shapes that failed at query time. It was the third time the validator and
   * the compiler disagreed about what was legal.
   */
  it('filters a to-ONE relation by matching the parent, then the foreign key', async () => {
    const { client, queries } = makeFakeClient({
      crm_contacts: [{ id: 'contact-1' }],
    });

    await compileAndRunFind(
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

    // Pass 1 looks up contacts; pass 2 filters invoices by their FK.
    const contactQuery = queries.find((q) => q.table === 'crm_contacts')!;
    expect(contactQuery.select).toContain('id');

    const invoiceQuery = queries.find((q) => q.table === 'payment_invoices')!;
    const fkFilter = invoiceQuery.filters.find(
      (f) => f.method === 'in' && f.args[0] === 'contact_id'
    );
    expect(fkFilter!.args[1]).toEqual(['contact-1']);

    expectAllQueriesScoped(queries, USER);
  });

  it('filters a to-MANY relation by matching children, then the parent id', async () => {
    const { client, queries } = makeFakeClient({
      payment_invoices: [{ contact_id: 'contact-9' }],
    });

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'contacts',
        where: [{ relation: 'invoices', quantifier: 'any' }],
      },
      { userId: USER }
    );

    const contactQuery = queries.find((q) => q.table === 'crm_contacts')!;
    const idFilter = contactQuery.filters.find(
      (f) => f.method === 'in' && f.args[0] === 'id'
    );
    expect(idFilter!.args[1]).toEqual(['contact-9']);

    expectAllQueriesScoped(queries, USER);
  });

  it('scopes the parent lookup to the calling user', async () => {
    // The join must not be able to match another tenant's contact.
    const { client, queries } = makeFakeClient({ crm_contacts: [{ id: 'c1' }] });

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'invoices',
        where: [
          { relation: 'contact', quantifier: 'any', where: [{ field: 'first_name', op: 'eq', value: 'X' }] },
        ],
      },
      { userId: USER }
    );

    expectAllQueriesScoped(queries, USER);
  });
});

describe('BizQL per-user vocabulary', () => {
  /**
   * Values for `contacts.stage` live in crm_pipeline_stages, one record per
   * stage, configured per business. A tutor's stage `family_enrolled` is
   * labelled "לקוח" (client); a consultant's might be `closed_won`. Nothing may
   * be hardcoded about either.
   */
  const stageRows = [
    { stage_key: 'inquiry', stage_label: 'פנייה' },
    { stage_key: 'in_progress', stage_label: 'בתהליך' },
  ];

  it('accepts the label a business uses and filters by the stored key', async () => {
    const { client, queries } = makeFakeClient({ crm_pipeline_stages: stageRows });

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'contacts',
        where: [{ field: 'stage', op: 'eq', value: 'בתהליך' }],
      },
      { userId: USER }
    );

    const contactsQuery = queries.find((q) => q.table === 'crm_contacts')!;
    const stageFilter = contactsQuery.filters.find(
      (f) => f.method === 'eq' && f.args[0] === 'stage'
    );

    // The Hebrew label must have been translated to the stored key.
    expect(stageFilter!.args[1]).toBe('in_progress');
  });

  it('still accepts the stored key directly', async () => {
    const { client, queries } = makeFakeClient({ crm_pipeline_stages: stageRows });

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'contacts',
        where: [{ field: 'stage', op: 'eq', value: 'in_progress' }],
      },
      { userId: USER }
    );

    const contactsQuery = queries.find((q) => q.table === 'crm_contacts')!;
    expect(
      contactsQuery.filters.find((f) => f.method === 'eq' && f.args[0] === 'stage')!.args[1]
    ).toBe('in_progress');
  });

  it('REFUSES a stage this business does not have, rather than returning zero rows', async () => {
    // The failure mode this prevents: filtering on a non-existent stage matches
    // nothing, and "you have no clients" reads as a truthful answer.
    const { client } = makeFakeClient({ crm_pipeline_stages: stageRows });

    await expect(
      compileAndRunFind(
        client,
        {
          op: 'find',
          entity: 'contacts',
          where: [{ field: 'stage', op: 'eq', value: 'vip' }],
        },
        { userId: USER }
      )
    ).rejects.toThrow(/not one of this business's/);
  });

  it('scopes the pipeline lookup to the calling user', async () => {
    const { client, queries } = makeFakeClient({ crm_pipeline_stages: stageRows });

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'contacts',
        where: [{ field: 'stage', op: 'eq', value: 'inquiry' }],
      },
      { userId: USER }
    );

    expectAllQueriesScoped(queries, USER);
  });
});

describe('BizQL semantic resolution', () => {
  it('expands a semantic term to an IN filter over storage values', async () => {
    const { client, queries } = makeFakeClient();

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'invoices',
        where: [{ field: 'status', op: 'eq', value: { $semantic: 'unpaid' } }],
      },
      { userId: USER }
    );

    const inFilter = queries[0].filters.find((f) => f.method === 'in');
    expect(inFilter).toBeDefined();
    expect(inFilter!.args[0]).toBe('status');
    expect(inFilter!.args[1]).toEqual(['sent', 'overdue']);
  });

  it('applies numeric comparison operators that no previous layer supported', async () => {
    const { client, queries } = makeFakeClient();

    await compileAndRunFind(
      client,
      {
        op: 'find',
        entity: 'invoices',
        where: [{ field: 'amount', op: 'gt', value: 100 }],
      },
      { userId: USER }
    );

    const gt = queries[0].filters.find((f) => f.method === 'gt');
    expect(gt!.args).toEqual(['amount', 100]);
  });
});
