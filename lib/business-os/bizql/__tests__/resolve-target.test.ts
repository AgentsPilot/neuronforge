/**
 * Resolving a described write target to exactly one row.
 *
 * A write must name its row by literal id — that is what keeps a generic
 * `UPDATE … WHERE` inexpressible. But it also meant "mark invoice INV-00002 as
 * paid" was refused outright, because nobody types a uuid and the planner is not
 * allowed to invent one. So a target may now be DESCRIBED, and resolved here.
 *
 * That widens the most dangerous surface in the system, so these tests are aimed
 * squarely at the property the widening could break: describing a row must never
 * become a way to write to a SET of rows. Several matches is a question. Zero
 * matches is an answer. Exactly one is the only thing that proceeds.
 */

import {
  needsTargetResolution,
  resolveDescribedReferences,
  resolveMutateTarget,
  withResolvedTarget,
} from '../mutate/resolveTarget';
import type { MutateQuery } from '../types';

const USER = '11111111-1111-1111-1111-111111111111';

const rows: Record<string, unknown[]> = {};

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

jest.mock('../compiler', () => ({
  compileAndRunFind: jest.fn(async (_client: unknown, query: { entity: string; limit?: number }) => ({
    op: 'find',
    entity: query.entity,
    rows: (rows[query.entity] ?? []).slice(0, query.limit ?? 50),
    truncated: false,
  })),
}));

const markPaid = (where: unknown[]): MutateQuery =>
  ({
    id: 's1',
    op: 'mutate',
    entity: 'invoices',
    action: 'mark_paid',
    target: { find: { where } },
  }) as MutateQuery;

beforeEach(() => {
  for (const key of Object.keys(rows)) delete rows[key];
});

describe('needsTargetResolution', () => {
  it('is true only for a described target', () => {
    expect(needsTargetResolution(markPaid([{ field: 'invoice_number', op: 'eq', value: 'X' }]))).toBe(true);
    expect(
      needsTargetResolution({
        id: 's1', op: 'mutate', entity: 'invoices', action: 'mark_paid', target: { id: 'abc' },
      } as MutateQuery)
    ).toBe(false);
    expect(
      needsTargetResolution({ id: 's1', op: 'mutate', entity: 'invoices', action: 'create' } as MutateQuery)
    ).toBe(false);
  });
});

describe('resolveMutateTarget', () => {
  it('resolves a unique match to its concrete id', async () => {
    rows.invoices = [{ id: 'aaaaaaaa-0000-0000-0000-000000000000', invoice_number: 'INV-00002' }];

    const outcome = await resolveMutateTarget(
      markPaid([{ field: 'invoice_number', op: 'eq', value: 'INV-00002' }]),
      { userId: USER, consumer: 'test' }
    );

    expect(outcome.status).toBe('resolved');
    if (outcome.status === 'resolved') {
      expect(outcome.id).toBe('aaaaaaaa-0000-0000-0000-000000000000');
    }
  });

  it('reports NO match rather than writing to nothing', async () => {
    rows.invoices = [];

    const outcome = await resolveMutateTarget(
      markPaid([{ field: 'invoice_number', op: 'eq', value: 'INV-99999' }]),
      { userId: USER, consumer: 'test' }
    );

    expect(outcome.status).toBe('none');
  });

  it('ASKS when several rows match — never picks one, never writes to all', async () => {
    // The property this whole module could have broken. "mark the invoice for
    // Ofir as paid" when Ofir has three unpaid invoices must be a question.
    rows.invoices = [
      { id: 'a0000000-0000-0000-0000-000000000000', invoice_number: 'INV-1' },
      { id: 'b0000000-0000-0000-0000-000000000000', invoice_number: 'INV-2' },
      { id: 'c0000000-0000-0000-0000-000000000000', invoice_number: 'INV-3' },
    ];

    const outcome = await resolveMutateTarget(
      markPaid([{ field: 'contact_id', op: 'eq', value: 'someone' }]),
      { userId: USER, consumer: 'test' }
    );

    expect(outcome.status).toBe('ambiguous');
    if (outcome.status === 'ambiguous') {
      expect(outcome.rows).toHaveLength(3);
      expect(outcome.total).toBe(3);
    }
  });

  it('refuses a target with no filter — it would match every row', async () => {
    rows.invoices = [{ id: 'a0000000-0000-0000-0000-000000000000' }];

    await expect(
      resolveMutateTarget(markPaid([]), { userId: USER, consumer: 'test' })
    ).rejects.toThrow(/would match every/);
  });

  it('caps the candidate list but still reports there were more', async () => {
    // Saying "5 matches" when there are forty sends the user looking for a row
    // that is not on screen.
    rows.invoices = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`.padStart(8, '0') + '-0000-0000-0000-000000000000',
      invoice_number: `INV-${i}`,
    }));

    const outcome = await resolveMutateTarget(
      markPaid([{ field: 'status', op: 'eq', value: 'sent' }]),
      { userId: USER, consumer: 'test' }
    );

    expect(outcome.status).toBe('ambiguous');
    if (outcome.status === 'ambiguous') {
      expect(outcome.rows.length).toBeLessThanOrEqual(5);
      expect(outcome.total).toBeGreaterThan(outcome.rows.length);
    }
  });
});

describe('withResolvedTarget', () => {
  it('produces a literal-id target and leaves the original untouched', async () => {
    // The un-resolved plan is still cached and logged. Rewriting it in place
    // would put one user's row id into a shared cache entry — exactly what the
    // cache's parameterisation rules exist to prevent.
    const original = markPaid([{ field: 'invoice_number', op: 'eq', value: 'INV-00002' }]);
    const pinned = withResolvedTarget(original, 'aaaaaaaa-0000-0000-0000-000000000000');

    expect(pinned.target).toEqual({ id: 'aaaaaaaa-0000-0000-0000-000000000000' });
    expect((original.target as { find?: unknown }).find).toBeDefined();
    expect(needsTargetResolution(pinned)).toBe(false);
  });
});

// =============================================================================
// Described foreign keys — "an invoice FOR Ofir"
// =============================================================================

describe('resolveDescribedReferences', () => {
  const invoiceFor = (ref: unknown): MutateQuery =>
    ({
      id: 's1',
      op: 'mutate',
      entity: 'invoices',
      action: 'create',
      data: { amount: 300, currency: 'ILS', contact_id: ref },
    }) as MutateQuery;

  it('replaces a described reference with the resolved id', async () => {
    rows.contacts = [{ id: 'c0000000-0000-0000-0000-000000000000', first_name: 'Ofir' }];

    const outcome = await resolveDescribedReferences(
      invoiceFor({ $find: { where: [{ field: 'first_name', op: 'eq', value: 'Ofir' }] } }),
      { userId: USER, consumer: 'test' }
    );

    expect(outcome.status).toBe('resolved');
    if (outcome.status === 'resolved') {
      expect(outcome.data.contact_id).toBe('c0000000-0000-0000-0000-000000000000');
      // Untouched fields must survive the rewrite.
      expect(outcome.data.amount).toBe(300);
    }
  });

  it('asks when the name matches several people', async () => {
    // Two contacts called Ofir must not silently become "the first Ofir".
    rows.contacts = [
      { id: 'c1000000-0000-0000-0000-000000000000', first_name: 'Ofir' },
      { id: 'c2000000-0000-0000-0000-000000000000', first_name: 'Ofir' },
    ];

    const outcome = await resolveDescribedReferences(
      invoiceFor({ $find: { where: [{ field: 'first_name', op: 'eq', value: 'Ofir' }] } }),
      { userId: USER, consumer: 'test' }
    );

    expect(outcome.status).toBe('ambiguous');
    if (outcome.status === 'ambiguous') {
      expect(outcome.field).toBe('contact_id');
      expect(outcome.entity).toBe('contacts');
    }
  });

  it('reports when nobody matches instead of creating an unattached record', async () => {
    rows.contacts = [];

    const outcome = await resolveDescribedReferences(
      invoiceFor({ $find: { where: [{ field: 'first_name', op: 'eq', value: 'Nobody' }] } }),
      { userId: USER, consumer: 'test' }
    );

    expect(outcome.status).toBe('none');
  });

  it('refuses to describe a field that is not a reference', async () => {
    await expect(
      resolveDescribedReferences(
        {
          id: 's1', op: 'mutate', entity: 'invoices', action: 'create',
          data: { amount: { $find: { where: [{ field: 'x', op: 'eq', value: 1 }] } } },
        } as unknown as MutateQuery,
        { userId: USER, consumer: 'test' }
      )
    ).rejects.toThrow(/not a reference/);
  });

  it('refuses an unfiltered reference — it would match everyone', async () => {
    await expect(
      resolveDescribedReferences(invoiceFor({ $find: { where: [] } }), {
        userId: USER,
        consumer: 'test',
      })
    ).rejects.toThrow(/would match every/);
  });

  it('leaves a literal id alone', async () => {
    const outcome = await resolveDescribedReferences(
      invoiceFor('c0000000-0000-0000-0000-000000000000'),
      { userId: USER, consumer: 'test' }
    );

    expect(outcome.status).toBe('resolved');
    if (outcome.status === 'resolved') {
      expect(outcome.data.contact_id).toBe('c0000000-0000-0000-0000-000000000000');
    }
  });
});
