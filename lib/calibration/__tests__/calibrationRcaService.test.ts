/**
 * Unit tests for the calibration RCA service (FR-11–FR-16, AC-3/4/6/7/8).
 * The service never throws — every path returns a typed discriminated result.
 * All evidence reads + the provider are mocked; no real DB / LLM.
 */

const mockAgentFindById = jest.fn();
const mockSessionFindById = jest.fn();
const mockExecFindById = jest.fn();
const mockChatCompletion = jest.fn();
const mockGetProvider = jest.fn(() => ({ chatCompletion: mockChatCompletion }));
const mockGetConfig = jest.fn();

jest.mock('@/lib/repositories/AgentRepository', () => ({
  AgentRepository: jest.fn().mockImplementation(() => ({ findById: mockAgentFindById })),
}));
jest.mock('@/lib/repositories/CalibrationSessionRepository', () => ({
  CalibrationSessionRepository: jest.fn().mockImplementation(() => ({ findById: mockSessionFindById })),
}));
jest.mock('@/lib/repositories/ExecutionRepository', () => ({
  ExecutionRepository: jest.fn().mockImplementation(() => ({ findById: mockExecFindById })),
}));
jest.mock('@/lib/ai/providerFactory', () => ({
  ProviderFactory: { getProvider: (...args: unknown[]) => mockGetProvider(...(args as [])) },
  PROVIDERS: { OPENAI: 'openai', ANTHROPIC: 'anthropic', KIMI: 'kimi' },
}));
jest.mock('../calibrationRcaConfig', () => ({
  getCalibrationRcaConfig: () => mockGetConfig(),
}));

import {
  generateCalibrationRca,
  buildRcaAttemptMetadata,
  type CalibrationRcaResult,
} from '../calibrationRcaService';
import type { CalibrationHistoryRecord } from '@/lib/repositories/CalibrationHistoryRepository';

const AGENT = {
  agent_name: 'Leads',
  pilot_steps: [{ id: 'step_2', action: 'sheets.read_range' }],
  input_schema: [{ name: 'range' }],
  enhanced_prompt: 'Read the sheet',
  user_prompt: 'read my sheet',
  agent_config: { ai_context: { intent_contract: {} } },
};

const LATEST: CalibrationHistoryRecord = {
  id: 'hist-1',
  agent_id: 'a1',
  user_id: 'u1',
  workflow_hash: 'wh1',
  workflow_step_count: 3,
  status: 'needs_review',
  iterations: 2,
  auto_fixes_applied: 1,
  issues_found: [],
  issues_fixed: [],
  issues_remaining: [{ category: 'parameter_error', message: 'bad range' }],
  steps_completed: 3,
  steps_failed: 1,
  steps_skipped: 0,
};

const VALID_RCA = {
  symptom: 'needs_review with 1 remaining issue',
  evidence: 'issues_remaining + pilot_steps',
  earliestFailingStep: 'step_2 failed; step_3 cascaded',
  rootCauseLayer: 'V6 generation',
  rootCause: 'range hardcoded to Sheet1',
  fixOwner: 'v6-pipeline',
  suggestedSolutions: ['Derive the tab name from the gid'],
  remediationPath: 'full cycle',
};

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'a1',
    userId: 'u1',
    sessionId: 'sess-1',
    executionId: 'exec-1',
    latest: LATEST,
    inputValues: { range: 'Sheet1', api_key: 'sk-secret1234567890abcdef' },
    correlationId: 'corr-1',
    supabase: {} as never,
    maxBudgetMs: 25000,
    ...overrides,
  };
}

function chatResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('generateCalibrationRca', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0,
      timeoutMs: 25000,
      maxTokens: 4000,
    });
    mockAgentFindById.mockResolvedValue({ data: AGENT, error: null });
    mockSessionFindById.mockResolvedValue({ data: { user_id: 'u1', issues: [], execution_summary: {} }, error: null });
    mockExecFindById.mockResolvedValue({ data: { user_id: 'u1', error_message: 'boom' }, error: null });
    mockGetProvider.mockReturnValue({ chatCompletion: mockChatCompletion });
  });

  it('happy path — returns ok:true with a validated RCA + model/provider recorded', async () => {
    mockChatCompletion.mockResolvedValue(chatResponse(JSON.stringify(VALID_RCA)));
    const result = await generateCalibrationRca(baseParams());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rca.rootCauseLayer).toBe('V6 generation');
      expect(result.modelUsed).toBe('claude-sonnet-4-6');
      expect(result.providerUsed).toBe('anthropic');
      expect(typeof result.generatedAt).toBe('string');
    }
  });

  it('strips a markdown code fence before parsing', async () => {
    mockChatCompletion.mockResolvedValue(chatResponse('```json\n' + JSON.stringify(VALID_RCA) + '\n```'));
    const result = await generateCalibrationRca(baseParams());
    expect(result.ok).toBe(true);
  });

  it('redacts secret input values before the LLM sees them', async () => {
    mockChatCompletion.mockResolvedValue(chatResponse(JSON.stringify(VALID_RCA)));
    await generateCalibrationRca(baseParams());
    const [params] = mockChatCompletion.mock.calls[0];
    const userMsg = params.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(userMsg).toContain('***MASKED***');
    expect(userMsg).not.toContain('sk-secret1234567890abcdef');
  });

  it('evidence_error — workflow definition unreadable', async () => {
    mockAgentFindById.mockResolvedValue({ data: null, error: new Error('not found') });
    const result = await generateCalibrationRca(baseParams());
    expect(result).toEqual({ ok: false, reason: 'evidence_error' });
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it('llm_error — provider throws', async () => {
    mockChatCompletion.mockRejectedValue(new Error('api down'));
    const result = await generateCalibrationRca(baseParams());
    expect(result).toEqual({ ok: false, reason: 'llm_error' });
  });

  it('invalid_output — non-JSON content', async () => {
    mockChatCompletion.mockResolvedValue(chatResponse('this is not json'));
    const result = await generateCalibrationRca(baseParams());
    expect(result).toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('invalid_output — JSON that fails Zod (bad layer)', async () => {
    mockChatCompletion.mockResolvedValue(chatResponse(JSON.stringify({ ...VALID_RCA, rootCauseLayer: 'network' })));
    const result = await generateCalibrationRca(baseParams());
    expect(result).toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('timeout — call exceeds the budget-aware deadline', async () => {
    mockChatCompletion.mockReturnValue(new Promise(() => {})); // never resolves
    const result = await generateCalibrationRca(baseParams({ maxBudgetMs: 40 }));
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('hard-aborts the in-flight LLM request on timeout (Item 4 / Q4)', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockChatCompletion.mockImplementation((params: { signal?: AbortSignal }) => {
      capturedSignal = params.signal;
      return new Promise(() => {}); // never resolves — must be actively cancelled
    });
    const result = await generateCalibrationRca(baseParams({ maxBudgetMs: 30 }));
    expect(result).toEqual({ ok: false, reason: 'timeout' });
    // The provider received an AbortSignal and it was actually aborted when the
    // budget-aware deadline elapsed (true cancellation, not just abandonment).
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('passes an un-aborted signal on the happy path (no spurious cancel)', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockChatCompletion.mockImplementation((params: { signal?: AbortSignal }) => {
      capturedSignal = params.signal;
      return Promise.resolve(chatResponse(JSON.stringify(VALID_RCA)));
    });
    const result = await generateCalibrationRca(baseParams());
    expect(result.ok).toBe(true);
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
  });

  it('degrades (still generates) when session/execution sub-reads fail', async () => {
    mockSessionFindById.mockRejectedValue(new Error('session read failed'));
    mockExecFindById.mockResolvedValue({ data: null, error: new Error('exec read failed') });
    mockChatCompletion.mockResolvedValue(chatResponse(JSON.stringify(VALID_RCA)));
    const result = await generateCalibrationRca(baseParams());
    expect(result.ok).toBe(true);
  });

  it('drops session evidence on user_id mismatch (ownership guard)', async () => {
    mockSessionFindById.mockResolvedValue({ data: { user_id: 'someone-else', issues: [{ x: 1 }] }, error: null });
    mockChatCompletion.mockResolvedValue(chatResponse(JSON.stringify(VALID_RCA)));
    const result = await generateCalibrationRca(baseParams());
    expect(result.ok).toBe(true);
    const [params] = mockChatCompletion.mock.calls[0];
    const userMsg = params.messages.find((m: { role: string }) => m.role === 'user').content;
    // The other user's session issues must not have leaked into the prompt.
    expect(userMsg).not.toContain('someone-else');
  });

  it('passes the DB-config model to the provider (no hardcoded literal)', async () => {
    mockGetConfig.mockResolvedValue({
      provider: 'anthropic', model: 'claude-opus-4-6', temperature: 0, timeoutMs: 25000, maxTokens: 4000,
    });
    mockChatCompletion.mockResolvedValue(chatResponse(JSON.stringify(VALID_RCA)));
    const result = await generateCalibrationRca(baseParams());
    const [params] = mockChatCompletion.mock.calls[0];
    expect(params.model).toBe('claude-opus-4-6');
    if (result.ok) expect(result.modelUsed).toBe('claude-opus-4-6');
  });
});

describe('buildRcaAttemptMetadata (Item 3 / Q3 — durable RCA attempt status)', () => {
  const AT = '2026-07-05T00:00:00.000Z';

  const successResult = {
    ok: true,
    rca: VALID_RCA,
    modelUsed: 'claude-sonnet-4-6',
    providerUsed: 'anthropic',
    generatedAt: AT,
  } as unknown as CalibrationRcaResult;

  it('flag OFF → returns null (writes NOTHING — AC-9)', () => {
    expect(buildRcaAttemptMetadata(false, { kind: 'skipped_budget' }, AT)).toBeNull();
    expect(
      buildRcaAttemptMetadata(false, { kind: 'result', result: { ok: false, reason: 'timeout' } }, AT)
    ).toBeNull();
    expect(buildRcaAttemptMetadata(false, { kind: 'result', result: successResult }, AT)).toBeNull();
  });

  it('flag ON + success → status "success" + full RCA payload persisted', () => {
    const patch = buildRcaAttemptMetadata(true, { kind: 'result', result: successResult }, AT);
    expect(patch).toMatchObject({
      auto_rca_status: 'success',
      auto_rca_attempted_at: AT,
      auto_rca: VALID_RCA,
      auto_rca_generated_at: AT,
      auto_rca_model: 'claude-sonnet-4-6',
      auto_rca_provider: 'anthropic',
    });
  });

  it('flag ON + timeout → status "timeout", no RCA payload', () => {
    const patch = buildRcaAttemptMetadata(true, { kind: 'result', result: { ok: false, reason: 'timeout' } }, AT);
    expect(patch).toEqual({ auto_rca_status: 'timeout', auto_rca_attempted_at: AT });
    expect(patch).not.toHaveProperty('auto_rca');
  });

  it('flag ON + budget-skip → status "skipped_budget"', () => {
    const patch = buildRcaAttemptMetadata(true, { kind: 'skipped_budget' }, AT);
    expect(patch).toEqual({ auto_rca_status: 'skipped_budget', auto_rca_attempted_at: AT });
  });

  it('flag ON + every ok:false reason → status echoes the reason', () => {
    for (const reason of ['llm_error', 'invalid_output', 'evidence_error'] as const) {
      const patch = buildRcaAttemptMetadata(true, { kind: 'result', result: { ok: false, reason } }, AT);
      expect(patch).toEqual({ auto_rca_status: reason, auto_rca_attempted_at: AT });
    }
  });
});
