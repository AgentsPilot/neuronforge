/**
 * Tests for AgentRepository.findAllForAdmin — the cross-user admin agent list
 * that backs the calibration test picker. Verifies it does NOT scope by user_id
 * (cross-user by design), applies search + limit, and surfaces errors.
 */

import { AgentRepository } from '../AgentRepository';

function makeSupabase(result: { data: any; error: any }) {
  const builder: any = {
    select: jest.fn(() => builder),
    neq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    or: jest.fn(() => builder),
    eq: jest.fn(() => builder), // present so we can assert it's NEVER used
    limit: jest.fn(() => builder),
    then: (resolve: (r: any) => void) => resolve(result),
  };
  const supabase: any = { from: jest.fn(() => builder) };
  return { supabase, builder };
}

describe('AgentRepository.findAllForAdmin', () => {
  it('lists across all users (no user_id filter) with the default limit', async () => {
    const rows = [{ id: 'a1', agent_name: 'X', user_id: 'u1' }];
    const { supabase, builder } = makeSupabase({ data: rows, error: null });
    const repo = new AgentRepository(supabase);

    const { data, error } = await repo.findAllForAdmin();

    expect(error).toBeNull();
    expect(data).toEqual(rows);
    expect(supabase.from).toHaveBeenCalledWith('agents');
    expect(builder.neq).toHaveBeenCalledWith('status', 'deleted');
    expect(builder.eq).not.toHaveBeenCalled();      // cross-user by design
    expect(builder.or).not.toHaveBeenCalled();      // no search
    expect(builder.limit).toHaveBeenCalledWith(100); // default
  });

  it('applies a search filter across name / agent id / owner id', async () => {
    const { supabase, builder } = makeSupabase({ data: [], error: null });
    const repo = new AgentRepository(supabase);

    await repo.findAllForAdmin({ search: 'leads', limit: 5 });

    expect(builder.or).toHaveBeenCalledTimes(1);
    const orArg = builder.or.mock.calls[0][0] as string;
    expect(orArg).toContain('leads');
    expect(orArg).toContain('agent_name.ilike');
    expect(orArg).toContain('user_id.ilike');
    expect(builder.limit).toHaveBeenCalledWith(5);
  });

  it('surfaces a query error', async () => {
    const boom = new Error('db down');
    const { supabase } = makeSupabase({ data: null, error: boom });
    const repo = new AgentRepository(supabase);

    const { data, error } = await repo.findAllForAdmin();
    expect(data).toBeNull();
    expect(error).toBe(boom);
  });
});
