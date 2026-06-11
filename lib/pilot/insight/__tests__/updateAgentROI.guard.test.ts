/**
 * Deprecated `updateAgentROI` — guard tests (AC-4).
 *
 * Asserts the 2-line `existingROI` guard added 2026-06-10: the deprecated
 * path MUST skip the `agent_config.roi_estimate` write when a fresh estimate
 * (written by the new Effort Estimator) is already present.
 *
 * Control case: when both `manual_time_per_item_seconds` and
 * `agent_config.roi_estimate` are absent, the deprecated path writes both
 * (existing behavior preserved during the deprecation window).
 *
 * The method is `private` on the class so we invoke it via `as any` — this
 * is the established Jest convention for private members in this codebase.
 */
import { BusinessInsightGenerator } from '../BusinessInsightGenerator';

function makeSupabaseStub(agentRow: any) {
  const updateCalls: any[] = [];
  const single = jest.fn().mockResolvedValue({ data: agentRow, error: null });
  const eq = jest.fn(() => ({ single, eq, update: () => ({ eq: () => ({}) }) }));

  const stub: any = {
    from: jest.fn().mockImplementation(() => ({
      select: jest.fn().mockReturnValue({ eq }),
      update: (data: any) => {
        updateCalls.push(data);
        return {
          eq: jest.fn().mockReturnValue(Promise.resolve({ data: null, error: null })),
        };
      },
    })),
    _updateCalls: updateCalls,
  };
  return stub;
}

describe('BusinessInsightGenerator.updateAgentROI guard (AC-4)', () => {
  // The estimator instance is constructed against a stub Supabase client. The
  // class also instantiates an Anthropic SDK client in its constructor; that
  // is fine for this test because we never call the public `generate()` flow.
  function makeGenerator(stub: any) {
    return new BusinessInsightGenerator(stub as any);
  }

  it('AC-4: skips the agent_config write when a fresh roi_estimate already exists', async () => {
    const freshEstimate = {
      reasoning: 'Founder in logistics, ~5 min.',
      is_bulk_workflow: true,
      total_manual_time_seconds: 300,
      generated_at: '2026-06-10T00:00:00.000Z',
      model: 'gpt-4o-mini',
      version: '1',
    };

    const stub = makeSupabaseStub({
      manual_time_per_item_seconds: null,
      agent_config: { roi_estimate: freshEstimate, other: 'keep' },
    });
    const gen = makeGenerator(stub);

    await (gen as any).updateAgentROI('a1', {
      manual_time_per_item_seconds: 60,
      total_manual_time_seconds: 999, // deprecated path would normally write this
      reasoning: 'deprecated path estimate',
    });

    // The deprecated path may still update `manual_time_per_item_seconds`
    // (legacy guard at line 876 permits this when null/0/undefined), but
    // crucially it must NOT update `agent_config` — that would clobber the
    // fresh roi_estimate written by the new estimator.
    const writes = stub._updateCalls;
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w.agent_config).toBeUndefined();
    }
  });

  it('Control: writes BOTH columns when the agent has no manual_time and no roi_estimate', async () => {
    const stub = makeSupabaseStub({
      manual_time_per_item_seconds: null,
      agent_config: null,
    });
    const gen = makeGenerator(stub);

    await (gen as any).updateAgentROI('a2', {
      manual_time_per_item_seconds: 60,
      total_manual_time_seconds: 600,
      reasoning: 'deprecated path estimate',
    });

    const writes = stub._updateCalls;
    expect(writes.length).toBeGreaterThan(0);
    const merged = Object.assign({}, ...writes);
    expect(merged.manual_time_per_item_seconds).toBe(60);
    expect(merged.agent_config?.roi_estimate?.total_manual_time_seconds).toBe(600);
  });

  it('Legacy self-guard: when manual_time_per_item_seconds is already set, NEITHER column is touched', async () => {
    const stub = makeSupabaseStub({
      manual_time_per_item_seconds: 30, // user-provided — legacy guard prevents overwrite
      agent_config: null,
    });
    const gen = makeGenerator(stub);

    await (gen as any).updateAgentROI('a3', {
      manual_time_per_item_seconds: 60,
      total_manual_time_seconds: 600,
      reasoning: 'deprecated path estimate',
    });

    // The legacy guard at line 876 means we never enter the write branch at all.
    expect(stub._updateCalls.length).toBe(0);
  });
});
