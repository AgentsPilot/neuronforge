/**
 * Unit tests for AgentRepository calibration methods:
 *   - recordCalibrationPromptDecision (post-creation prompt decision + gate seed)
 *   - setCalibrationStatus (gate state from the background/manual run)
 *
 * Verifies the written payload, user-scoping (.eq('user_id', ...)), and error
 * propagation through the repository result shape.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AgentRepository } from '@/lib/repositories/AgentRepository';

/**
 * Mock the chained shape: .from(t).update(payload).eq('id',..).eq('user_id',..).select().single()
 * Captures the update payload and the .eq() filters for assertions.
 */
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

describe('AgentRepository.recordCalibrationPromptDecision', () => {
  it('accepted → writes decision + calibration_status=running, scoped by user', async () => {
    const { client, calls } = mockSupabase({ id: 'a1', calibration_status: 'running' });
    const repo = new AgentRepository(client);

    const { data, error } = await repo.recordCalibrationPromptDecision('a1', 'u1', 'accepted');

    expect(error).toBeNull();
    expect(data).toEqual({ id: 'a1', calibration_status: 'running' });
    expect(calls.update.calibration_prompt_decision).toBe('accepted');
    expect(calls.update.calibration_status).toBe('running');
    expect(typeof calls.update.calibration_prompt_decided_at).toBe('string');
    expect(calls.eqs).toEqual([['id', 'a1'], ['user_id', 'u1']]);
  });

  it('declined → writes decision + calibration_status=skipped', async () => {
    const { client, calls } = mockSupabase({ id: 'a1' });
    const repo = new AgentRepository(client);

    await repo.recordCalibrationPromptDecision('a1', 'u1', 'declined');

    expect(calls.update.calibration_prompt_decision).toBe('declined');
    expect(calls.update.calibration_status).toBe('skipped');
  });

  it('propagates a DB error as a result error (does not throw)', async () => {
    const { client } = mockSupabase(null, new Error('db down'));
    const repo = new AgentRepository(client);

    const { data, error } = await repo.recordCalibrationPromptDecision('a1', 'u1', 'accepted');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('AgentRepository.setCalibrationStatus', () => {
  it('writes calibration_status, scoped by user', async () => {
    const { client, calls } = mockSupabase({ id: 'a1', calibration_status: 'passed' });
    const repo = new AgentRepository(client);

    const { error } = await repo.setCalibrationStatus('a1', 'u1', 'passed');

    expect(error).toBeNull();
    expect(calls.update).toEqual({ calibration_status: 'passed' });
    expect(calls.eqs).toEqual([['id', 'a1'], ['user_id', 'u1']]);
  });

  it('supports the failed status', async () => {
    const { client, calls } = mockSupabase({ id: 'a1' });
    const repo = new AgentRepository(client);
    await repo.setCalibrationStatus('a1', 'u1', 'failed');
    expect(calls.update.calibration_status).toBe('failed');
  });
});
