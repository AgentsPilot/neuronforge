/**
 * QA-added (Phase 1.5, 2026-07-11) unit tests for the two NEW AgentRepository
 * methods introduced by the repository-pattern compliance fix:
 *   - updatePilotSteps      (Item 7 in-place field-fidelity corrector write)
 *   - setProductionReady    (Item 6a passing-verdict write)
 *
 * These were shipped without a dedicated test; CLAUDE.md requires a unit test for
 * each new repository method. Verifies the written payload, mandatory owner
 * scoping (.eq('id') + .eq('user_id')), the "omit when undefined" column
 * behaviour of setProductionReady, and error propagation via the result shape.
 * No product logic is altered.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AgentRepository } from '@/lib/repositories/AgentRepository';

/** Mock the chained shape .from(t).update(p).eq().eq().select().single(). */
function mockSupabase(record: any, error: any = null) {
  const calls: { update?: any; eqs: Array<[string, any]> } = { eqs: [] };
  const builder: any = {
    update: jest.fn((payload: any) => { calls.update = payload; return builder; }),
    eq: jest.fn((col: string, val: any) => { calls.eqs.push([col, val]); return builder; }),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: record, error }),
  };
  const client = { from: jest.fn().mockReturnValue(builder) } as unknown as SupabaseClient;
  return { client, calls };
}

describe('AgentRepository.updatePilotSteps', () => {
  it('writes pilot_steps + updated_at, scoped by id AND user_id', async () => {
    const { client, calls } = mockSupabase({ id: 'a1' });
    const repo = new AgentRepository(client);
    const steps = [{ step_id: 's1', type: 'transform' }];

    const { data, error } = await repo.updatePilotSteps('a1', 'u1', steps);

    expect(error).toBeNull();
    expect(data).toEqual({ id: 'a1' });
    expect(calls.update.pilot_steps).toBe(steps);
    expect(typeof calls.update.updated_at).toBe('string');
    // Mandatory owner scoping (Security Rule + Mandatory Rule #4).
    expect(calls.eqs).toEqual([['id', 'a1'], ['user_id', 'u1']]);
  });

  it('propagates a DB error as a result error (does not throw)', async () => {
    const { client } = mockSupabase(null, new Error('db down'));
    const repo = new AgentRepository(client);
    const { data, error } = await repo.updatePilotSteps('a1', 'u1', []);
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('AgentRepository.setProductionReady', () => {
  it('always sets is_calibrated + production_ready + updated_at, scoped by owner', async () => {
    const { client, calls } = mockSupabase({ id: 'a1', production_ready: true });
    const repo = new AgentRepository(client);

    const { error } = await repo.setProductionReady('a1', 'u1', {});

    expect(error).toBeNull();
    expect(calls.update.is_calibrated).toBe(true);
    expect(calls.update.production_ready).toBe(true);
    expect(typeof calls.update.updated_at).toBe('string');
    // Optional columns omitted when not supplied (preserves prior behaviour).
    expect('workflow_hash' in calls.update).toBe(false);
    expect('last_successful_calibration_id' in calls.update).toBe(false);
    expect(calls.eqs).toEqual([['id', 'a1'], ['user_id', 'u1']]);
  });

  it('includes workflow_hash + last_successful_calibration_id when supplied', async () => {
    const { client, calls } = mockSupabase({ id: 'a1' });
    const repo = new AgentRepository(client);

    await repo.setProductionReady('a1', 'u1', { workflowHash: 'hash123', lastSuccessfulCalibrationId: 'cal-9' });

    expect(calls.update.workflow_hash).toBe('hash123');
    expect(calls.update.last_successful_calibration_id).toBe('cal-9');
  });

  it('propagates a DB error as a result error (does not throw)', async () => {
    const { client } = mockSupabase(null, new Error('db down'));
    const repo = new AgentRepository(client);
    const { data, error } = await repo.setProductionReady('a1', 'u1', {});
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
