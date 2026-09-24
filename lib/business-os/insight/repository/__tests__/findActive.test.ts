/**
 * Reading an insight is not dealing with it.
 *
 * `findActive` asked for `status = 'new'` alone while the advisor card stamps
 * whatever it renders as `viewed`. So an insight left the dashboard the first
 * time the owner looked at it, permanently: nothing resets the status, and
 * re-detection finds the row by `('new','viewed')` and updates it in place
 * rather than creating a new one.
 *
 * On the live account a card reporting a genuinely broken booking link had
 * already gone this way.
 */

import { InsightRepository } from '../InsightRepository';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

interface Row { id: string; status: string; snoozed_until?: string | null; resolved_at?: string | null }

/** Captures the status filter each half of the query asked for. */
function mockSupabase(rows: Row[], captured: { statuses: string[][] }) {
  return {
    from() {
      let wanted: string[] = [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === 'status') { wanted = [val]; captured.statuses.push(wanted); }
          return chain;
        },
        in: (col: string, vals: string[]) => {
          if (col === 'status') { wanted = [...vals]; captured.statuses.push(wanted); }
          return chain;
        },
        or: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: async () => ({ data: rows.filter(r => wanted.includes(r.status)), error: null }),
      };
      return chain;
    },
  };
}

function findActive(rows: Row[]) {
  const captured = { statuses: [] as string[][] };
  const repository = new InsightRepository(mockSupabase(rows, captured) as never);
  return repository.findActive('user-1').then(result => ({ result, captured }));
}

describe('findActive', () => {
  it('still returns an insight the owner has looked at', async () => {
    // The regression, stated directly.
    const { result } = await findActive([{ id: 'i1', status: 'viewed' }]);

    expect(result.data?.map(r => r.id)).toContain('i1');
  });

  it('returns new and viewed together', async () => {
    const { result } = await findActive([
      { id: 'i1', status: 'new' },
      { id: 'i2', status: 'viewed' },
    ]);

    expect(result.data?.map(r => r.id).sort()).toEqual(['i1', 'i2']);
  });

  it('asks for both statuses in one query rather than filtering after', async () => {
    const { captured } = await findActive([]);

    expect(captured.statuses).toContainEqual(['new', 'viewed']);
  });

  it('does not return what a person closed', async () => {
    const { result } = await findActive([
      { id: 'i1', status: 'dismissed' },
      { id: 'i2', status: 'acted' },
      { id: 'i3', status: 'automated' },
    ]);

    expect(result.data).toEqual([]);
  });

  it('still returns a recently resolved insight so it can say so', async () => {
    const { result } = await findActive([{ id: 'i1', status: 'resolved', resolved_at: new Date().toISOString() }]);

    expect(result.data?.map(r => r.id)).toContain('i1');
  });
});
