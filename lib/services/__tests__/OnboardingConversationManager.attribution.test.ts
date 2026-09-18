/**
 * Onboarding conversation attribution (Layer 1.5 FR-1 to FR-5, AC-1 to AC-4).
 *
 * The provider is mocked: these tests read the context each LLM call is given,
 * which is exactly what the tracker writes to the ledger. The `@ts-expect-error`
 * cases are enforced by `npm run typecheck:bos-llm` (this file's name puts it in
 * the gate's scope); Jest itself runs transpile-only.
 */

const mockComplete = jest.fn();
jest.mock('@/lib/ai/providerFactory', () => ({
  getProviderFactory: () => ({ complete: (...args: unknown[]) => mockComplete(...args) }),
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  OnboardingConversationManager,
  type OnboardingState,
} from '../OnboardingConversationManager';
import { BOS_LEGACY_HELPER_LABEL, isUuid, type BosLlmOwner } from '@/lib/business-os/llm/callCatalog';
import { ALL_ZERO_UUID } from '@/lib/platformAccount';

const OWNER_ID = '2f734ed5-3681-4049-880d-3de7b096bea3';
const GROUP = '33333333-3333-4333-8333-333333333333';
const OWNER: BosLlmOwner = { userId: OWNER_ID, groupId: GROUP };

/** The private extractors, reached directly so the unreachable one is covered too (KI-D). */
type Extractors = {
  extractBusinessStory(message: string, owner: BosLlmOwner): Promise<unknown>;
  extractClientWorkflow(message: string, owner: BosLlmOwner): Promise<unknown>;
  extractClientTracking(message: string, owner: BosLlmOwner): Promise<unknown>;
  extractAdjustmentIntent(message: string, owner: BosLlmOwner): Promise<unknown>;
};

function extractorsOf(manager: OnboardingConversationManager): Extractors {
  // Private methods: the cast is the only way to call them from a test, and the
  // shape above is checked against every call below.
  return manager as unknown as Extractors;
}

type CompleteCall = [
  { model: string; messages: Array<{ role: string; content: string }>; response_format?: { type: string } },
  { userId: string; feature: string; component: string; sessionId?: string } | undefined,
];

function calls(): CompleteCall[] {
  return mockComplete.mock.calls as CompleteCall[];
}

function state(step: OnboardingState['currentStep'], extra: Partial<OnboardingState> = {}): OnboardingState {
  return { currentStep: step, collectedData: {}, language: 'en', attributionGroupId: GROUP, ...extra };
}

beforeEach(() => {
  mockComplete.mockReset();
  mockComplete.mockResolvedValue({ content: '{}' });
});

describe('each extractor records against the owner (AC-1)', () => {
  const cases: Array<[keyof Extractors, string]> = [
    ['extractBusinessStory', 'business_story_extraction'],
    ['extractClientWorkflow', 'client_workflow_extraction'],
    ['extractClientTracking', 'client_tracking_extraction'], // unreachable live (KI-D), proven here
    ['extractAdjustmentIntent', 'adjustment_intent_extraction'],
  ];

  it.each(cases)('%s → business-os-onboarding / %s on the owner', async (method, callName) => {
    const manager = new OnboardingConversationManager();
    await extractorsOf(manager)[method]('We run a small yoga studio in town', OWNER);

    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [, context] = calls()[0];
    expect(context).toEqual({
      userId: OWNER_ID,
      feature: 'business-os-onboarding',
      component: callName,
      sessionId: GROUP,
    });
    expect(context?.userId).not.toBe(ALL_ZERO_UUID);
    expect(context?.userId).not.toBe('system');
    expect(context?.feature).not.toBe(BOS_LEGACY_HELPER_LABEL.feature);
    expect(context?.component).not.toBe(BOS_LEGACY_HELPER_LABEL.component);
  });
});

describe('the attribution is required on the public boundary (AC-2)', () => {
  it('rejects a call with no owner or no grouping id at compile time', async () => {
    const manager = new OnboardingConversationManager();
    const noop = async () => {
      // @ts-expect-error: a bare user id is no longer accepted; the owner carries the group
      await manager.processUserMessage(OWNER_ID, 'hi', state('language_selection'));
      // @ts-expect-error: the grouping id is required
      await manager.processUserMessage({ userId: OWNER_ID }, 'hi', state('language_selection'));
    };
    expect(typeof noop).toBe('function');
  });
});

describe('one grouping id per onboarding conversation (AC-3)', () => {
  it('mints a UUID in getInitialState, and a different one each time (restart = new group)', () => {
    const manager = new OnboardingConversationManager();
    const a = manager.getInitialState('en');
    const b = manager.getInitialState('he');
    expect(isUuid(a.attributionGroupId)).toBe(true);
    expect(isUuid(b.attributionGroupId)).toBe(true);
    expect(a.attributionGroupId).not.toBe(b.attributionGroupId);
  });

  it('backfills a pre-Layer-1.5 snapshot and keeps an existing group (idempotent, pure)', () => {
    const manager = new OnboardingConversationManager();
    const legacy: OnboardingState = { currentStep: 'business_story', collectedData: {}, language: 'en' };

    const backfilled = manager.ensureAttributionGroupId(legacy);
    expect(isUuid(backfilled.attributionGroupId)).toBe(true);
    expect(legacy.attributionGroupId).toBeUndefined(); // the input is not mutated

    expect(manager.ensureAttributionGroupId(backfilled).attributionGroupId).toBe(backfilled.attributionGroupId);
    expect(manager.ensureAttributionGroupId(state('business_story')).attributionGroupId).toBe(GROUP);
  });

  it.each([['not-a-uuid'], [''], ['   '], ['33333333-3333-4333-8333-33333333333']])(
    'replaces a stored group that is not a UUID (%j) with a fresh one (CR-3)',
    (bad) => {
      const manager = new OnboardingConversationManager();
      const restored = manager.ensureAttributionGroupId(state('business_story', { attributionGroupId: bad }));
      expect(isUuid(restored.attributionGroupId)).toBe(true);
      expect(restored.attributionGroupId).not.toBe(bad);
    }
  );

  it('shares one group across turns, including client_workflow_extraction fired twice', async () => {
    const manager = new OnboardingConversationManager();
    const owner = { userId: OWNER_ID, groupId: GROUP };

    // Turn 1: the workflow answer names no services, so the flow asks for them.
    mockComplete.mockResolvedValueOnce({ content: JSON.stringify({ services: [] }) });
    const turn1 = await manager.processUserMessage(owner, 'Fixed prices', state('client_workflow'));
    expect(turn1.updatedState.currentStep).toBe('service_details');
    expect(turn1.updatedState.attributionGroupId).toBe(GROUP);

    // Turn 2: typed (not form) service details are extracted with the same call.
    mockComplete.mockResolvedValueOnce({ content: JSON.stringify({ services: [{ name: 'Haircut', price: 50 }] }) });
    await manager.processUserMessage(owner, 'I do haircuts for 50', turn1.updatedState);

    const workflowCalls = calls().filter(([, c]) => c?.component === 'client_workflow_extraction');
    expect(workflowCalls).toHaveLength(2);
    for (const [, context] of workflowCalls) expect(context?.sessionId).toBe(GROUP);
  });

  it('records the call that detects a restart under the ending group, and returns a fresh one', async () => {
    const manager = new OnboardingConversationManager();
    mockComplete.mockResolvedValueOnce({ content: JSON.stringify({ intent: 'restart', details: '' }) });

    const result = await manager.processUserMessage(OWNER, 'start over', state('preview_adjustment'));

    const [, context] = calls()[0];
    expect(context?.component).toBe('adjustment_intent_extraction');
    expect(context?.sessionId).toBe(GROUP);
    expect(isUuid(result.updatedState.attributionGroupId)).toBe(true);
    expect(result.updatedState.attributionGroupId).not.toBe(GROUP);
  });

  it('puts the calls of a reset (unknown step) under the fresh group, not the old one', async () => {
    const manager = new OnboardingConversationManager();
    const stale = { ...state('language_selection'), currentStep: 'retired_step' } as unknown as OnboardingState;

    const result = await manager.processUserMessage(OWNER, 'hello', stale);

    expect(isUuid(result.updatedState.attributionGroupId)).toBe(true);
    expect(result.updatedState.attributionGroupId).not.toBe(GROUP);
    for (const [, context] of calls()) expect(context?.sessionId).toBe(result.updatedState.attributionGroupId);
  });
});

describe('behaviour is unchanged (AC-4)', () => {
  it('sends the same model, prompt shape and JSON response format', async () => {
    const manager = new OnboardingConversationManager();
    await extractorsOf(manager).extractBusinessStory('We are a physio clinic', OWNER);

    const [params] = calls()[0];
    expect(params.model).toBe('gpt-4o'); // carried unchanged (KI-C)
    expect(params.response_format).toEqual({ type: 'json_object' });
    expect(params.messages).toHaveLength(2);
    expect(params.messages[0].role).toBe('system');
    expect(params.messages[1]).toEqual({ role: 'user', content: 'We are a physio clinic' });
  });

  it('parses the extraction as before', async () => {
    const manager = new OnboardingConversationManager();
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({ vertical: 'wellness', goals: ['grow'], company_name: 'Calm' }),
    });
    const story = await extractorsOf(manager).extractBusinessStory('We are Calm', OWNER);
    expect(story).toMatchObject({ vertical: 'wellness', goals: ['grow'], company_name: 'Calm', pain_points: [] });
  });

  it('keeps each documented fallback when the call fails', async () => {
    const manager = new OnboardingConversationManager();
    mockComplete.mockRejectedValue(new Error('provider down'));
    const extractors = extractorsOf(manager);

    await expect(extractors.extractBusinessStory('x', OWNER)).resolves.toEqual({
      vertical: 'other',
      pain_points: [],
      goals: [],
      tools: [],
      target_audience: [],
    });
    await expect(extractors.extractAdjustmentIntent('x', OWNER)).resolves.toEqual(
      expect.objectContaining({ intent: expect.any(String) })
    );
    await expect(extractors.extractClientWorkflow('x', OWNER)).resolves.toBeDefined();
    await expect(extractors.extractClientTracking('x', OWNER)).resolves.toBeDefined();
  });
});
