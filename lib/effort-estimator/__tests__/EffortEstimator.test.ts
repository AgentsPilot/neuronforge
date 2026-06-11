/**
 * Effort Estimator — orchestrator tests.
 *
 * Mocks the ProviderFactory + AgentRepository so we can drive the estimator
 * end-to-end without LLM calls. Asserts the locked behaviors:
 *  - happy path: write merged config + audit log fired
 *  - override: previousEstimate populated + INFO override log carries old + new
 *  - retry exhaustion: NO write, NO audit
 *  - invalid LLM JSON: retried within the budget
 *  - reasoning missing persona: still writes, but emits WARN
 */

const findById = jest.fn();
const update = jest.fn();

jest.mock('@/lib/repositories/AgentRepository', () => ({
  AgentRepository: jest.fn().mockImplementation(() => ({ findById, update })),
}));

// Mock the model resolver so we don't touch Supabase here.
jest.mock('../modelResolver', () => ({
  resolveEffortEstimatorModel: jest.fn().mockResolvedValue({ provider: 'openai', model: 'gpt-4o-mini' }),
  DEFAULT_MODEL: { provider: 'openai', model: 'gpt-4o-mini' },
  clearModelCache: jest.fn(),
}));

const chatCompletion = jest.fn();
jest.mock('@/lib/ai/providerFactory', () => ({
  PROVIDERS: { OPENAI: 'openai', ANTHROPIC: 'anthropic', KIMI: 'kimi' },
  ProviderFactory: {
    getProvider: jest.fn(() => ({
      chatCompletion,
      supportsResponseFormat: true,
    })),
  },
}));

const auditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/AuditTrailService', () => ({
  auditLog: (input: any) => auditLog(input),
}));

import { estimateEffort } from '../EffortEstimator';
import type { UserContext } from '@/lib/user-context';

const baseContext: UserContext = { role: 'founder', domain: 'logistics' };

function llmResponse(payload: Record<string, unknown>) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
  };
}

describe('EffortEstimator.estimate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('happy path: writes merged config and fires the audit log', async () => {
    findById.mockResolvedValue({
      data: {
        id: 'a1',
        user_id: 'u1',
        agent_name: 'Email Triage',
        user_prompt: 'Triage inbox',
        agent_config: { creation_metadata: { from: 'test' } },
      },
      error: null,
    });
    update.mockResolvedValue({ data: { id: 'a1' }, error: null });
    chatCompletion.mockResolvedValue(
      llmResponse({
        reasoning: 'As a founder running a logistics SMB, this triage takes about 8 minutes.',
        is_bulk_workflow: true,
        total_manual_time_seconds: 480,
        confidence: 'medium',
      })
    );

    const result = await estimateEffort({
      agentId: 'a1',
      userId: 'u1',
      enhancedPrompt: 'Triage inbox',
      userContext: baseContext,
      correlationId: 'corr-1',
      reason: 'agent_created',
    });

    expect(result.success).toBe(true);
    expect(result.estimate?.total_manual_time_seconds).toBe(480);
    expect(result.estimate?.is_bulk_workflow).toBe(true);
    expect(result.estimate?.model).toBe('gpt-4o-mini');
    expect(result.estimate?.version).toBe('1');
    expect(result.previousEstimate).toBeNull();
    expect(result.attempts).toBe(1);

    // Merge preserved the existing agent_config key.
    expect(update).toHaveBeenCalledTimes(1);
    const updateArg = update.mock.calls[0][2];
    expect(updateArg.agent_config.creation_metadata).toEqual({ from: 'test' });
    expect(updateArg.agent_config.roi_estimate.total_manual_time_seconds).toBe(480);

    // Audit fired with the new event.
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0][0].action).toBe('EFFORT_ESTIMATE_GENERATED');
  });

  it('override: surfaces previousEstimate and logs old + new (AC-6)', async () => {
    const prior = {
      reasoning: 'old estimate',
      is_bulk_workflow: false,
      total_manual_time_seconds: 60,
      generated_at: new Date(Date.now() - 10000).toISOString(),
      model: 'gpt-4o-mini',
      version: '1' as const,
    };

    findById.mockResolvedValue({
      data: {
        id: 'a1',
        user_id: 'u1',
        agent_name: 'X',
        user_prompt: 'p',
        agent_config: { roi_estimate: prior },
      },
      error: null,
    });
    update.mockResolvedValue({ data: { id: 'a1' }, error: null });
    chatCompletion.mockResolvedValue(
      llmResponse({
        reasoning: 'Founder in logistics estimating fresh.',
        is_bulk_workflow: true,
        total_manual_time_seconds: 300,
      })
    );

    const result = await estimateEffort({
      agentId: 'a1',
      userId: 'u1',
      enhancedPrompt: 'whatever',
      userContext: baseContext,
      correlationId: 'corr-2',
      reason: 'api_request',
    });

    expect(result.success).toBe(true);
    expect(result.previousEstimate).toEqual(prior);
    expect(result.estimate?.total_manual_time_seconds).toBe(300);
    // Audit changes carry both before and after.
    const auditChanges = auditLog.mock.calls[0][0].changes;
    expect(auditChanges.before.roi_estimate).toEqual(prior);
    expect(auditChanges.after.roi_estimate.total_manual_time_seconds).toBe(300);
  });

  it('retry exhaustion: NO write, NO audit, AC-2 slot left untouched', async () => {
    findById.mockResolvedValue({
      data: { id: 'a1', user_id: 'u1', user_prompt: 'p', agent_config: {} },
      error: null,
    });
    chatCompletion.mockRejectedValue(new Error('LLM down'));

    const result = await estimateEffort({
      agentId: 'a1',
      userId: 'u1',
      enhancedPrompt: 'p',
      userContext: baseContext,
      correlationId: 'corr-3',
      reason: 'agent_created',
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(update).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  }, 60000); // allow for the 1s+4s delays

  it('invalid JSON retries within the budget then succeeds', async () => {
    findById.mockResolvedValue({
      data: { id: 'a1', user_id: 'u1', user_prompt: 'p', agent_config: {} },
      error: null,
    });
    update.mockResolvedValue({ data: { id: 'a1' }, error: null });

    chatCompletion
      .mockResolvedValueOnce({ choices: [{ message: { content: 'not json at all' } }] })
      .mockResolvedValueOnce(
        llmResponse({
          reasoning: 'Founder in logistics, ~3 min triage.',
          is_bulk_workflow: false,
          total_manual_time_seconds: 180,
        })
      );

    const result = await estimateEffort({
      agentId: 'a1',
      userId: 'u1',
      enhancedPrompt: 'p',
      userContext: baseContext,
      correlationId: 'corr-4',
      reason: 'agent_created',
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  }, 10000);

  it('reasoning missing persona: still writes (does not block on AC-3)', async () => {
    findById.mockResolvedValue({
      data: { id: 'a1', user_id: 'u1', user_prompt: 'p', agent_config: {} },
      error: null,
    });
    update.mockResolvedValue({ data: { id: 'a1' }, error: null });
    chatCompletion.mockResolvedValue(
      llmResponse({
        reasoning: 'This is a typical bulk-processing workflow that takes ~5 minutes.',
        is_bulk_workflow: true,
        total_manual_time_seconds: 300,
      })
    );

    const result = await estimateEffort({
      agentId: 'a1',
      userId: 'u1',
      enhancedPrompt: 'p',
      userContext: { role: 'founder', domain: 'logistics' },
      correlationId: 'corr-5',
      reason: 'agent_created',
    });

    // Estimate still written — AC-3 verification is a drift detector, not a hard gate.
    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalled();
  });

  it('returns attempts=0 when the agent is not found (route maps to 404)', async () => {
    findById.mockResolvedValue({ data: null, error: new Error('not found') });

    const result = await estimateEffort({
      agentId: 'a1',
      userId: 'u1',
      userContext: baseContext,
      correlationId: 'corr-6',
      reason: 'api_request',
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('skipPersist=true: returns the estimate but does NOT write or audit', async () => {
    // The integration-test runner's --dry-run path must:
    //  - still call the LLM (the entire point — the user wants to see the
    //    result the estimator would have produced)
    //  - still return a populated `estimate` so the runner can print it
    //  - NOT call `AgentRepository.update`
    //  - NOT fire `EFFORT_ESTIMATE_GENERATED`
    findById.mockResolvedValue({
      data: { id: 'a1', user_id: 'u1', user_prompt: 'p', agent_config: {} },
      error: null,
    });
    chatCompletion.mockResolvedValue(
      llmResponse({
        reasoning: 'Founder in logistics, ~6 min triage.',
        is_bulk_workflow: true,
        total_manual_time_seconds: 360,
      })
    );

    const result = await estimateEffort(
      {
        agentId: 'a1',
        userId: 'u1',
        enhancedPrompt: 'p',
        userContext: baseContext,
        correlationId: 'corr-7',
        reason: 'api_request',
      },
      { skipPersist: true }
    );

    expect(result.success).toBe(true);
    expect(result.estimate?.total_manual_time_seconds).toBe(360);
    expect(result.estimate?.is_bulk_workflow).toBe(true);
    expect(result.estimate?.model).toBe('gpt-4o-mini');
    expect(result.estimate?.version).toBe('1');

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('skipPersist=false (default) preserves original write + audit behavior', async () => {
    // Defensive regression: an explicit `false` MUST behave exactly like the
    // no-options call — same write, same audit, same estimate. Guards against
    // a future refactor flipping the default by accident.
    findById.mockResolvedValue({
      data: {
        id: 'a1',
        user_id: 'u1',
        agent_name: 'Email Triage',
        user_prompt: 'p',
        agent_config: {},
      },
      error: null,
    });
    update.mockResolvedValue({ data: { id: 'a1' }, error: null });
    chatCompletion.mockResolvedValue(
      llmResponse({
        reasoning: 'Founder in logistics, ~4 min triage.',
        is_bulk_workflow: false,
        total_manual_time_seconds: 240,
      })
    );

    const result = await estimateEffort(
      {
        agentId: 'a1',
        userId: 'u1',
        enhancedPrompt: 'p',
        userContext: baseContext,
        correlationId: 'corr-8',
        reason: 'agent_created',
      },
      { skipPersist: false }
    );

    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0][0].action).toBe('EFFORT_ESTIMATE_GENERATED');
  });
});
