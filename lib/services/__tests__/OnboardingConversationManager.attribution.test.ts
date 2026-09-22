/**
 * Onboarding conversation attribution (Layer 1.5 FR-1 to FR-5, AC-1 to AC-4).
 *
 * The provider is mocked: these tests read the context each LLM call is given,
 * which is exactly what the tracker writes to the ledger. The `@ts-expect-error`
 * cases are enforced by `npm run typecheck:bos-llm` (this file's name puts it in
 * the gate's scope); Jest itself runs transpile-only.
 */

const mockComplete = jest.fn();
/*
 * Layer 2 (Step 2): the call sites take their model, temperature and on/off
 * switch from `resolveBosLlmSettings`. Pinned to the CODE DEFAULTS — today's
 * values — so this file keeps asserting exactly what it asserted before, with
 * no configuration read and no I/O.
 */
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return {
    ...actual,
    resolveBosLlmSettings: async (area: string, callName: string) => actual.bosLlmCodeDefaults(area, callName),
  };
});

jest.mock('@/lib/ai/providerFactory', () => ({
  getProviderFactory: () => ({ complete: (...args: unknown[]) => mockComplete(...args) }),
}));

/**
 * Every log call, as Pino would have serialized it AT CALL TIME. The copy
 * matters: the manager mutates objects after logging them (the business story's
 * description is overwritten with the owner's own words), and a stored reference
 * would show text the real log line never contained.
 */
const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        // Errors keep their name and message, as Pino's `err` serializer does;
        // plain JSON would reduce them to `{}` and hide what they carry.
        const fields =
          typeof first === 'object' && first !== null
            ? JSON.parse(JSON.stringify(first, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v)))
            : {};
        const msg = typeof first === 'string' ? first : String(second ?? '');
        mockLogged.push({ level, fields, msg });
      };
    }
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

/*
 * OI-7 and OI-8 (logging clean-up workplan, WC-3): the owner's raw text never
 * reaches a logger at any level, and text DERIVED from it (the model's
 * extractions) reaches debug only. Production runs at `info`
 * (`lib/logger.ts:16`), so debug lines show locally and never in production.
 *
 * Which case reaches which raw-text line (OnboardingConversationManager.ts):
 *   'Processing user message'                every case below
 *   'Business name given'                    business_name
 *   'Extracting business story from message' business_story
 *   'Could not extract price from message'   service_details, unparseable price
 *   'Extracted client acquisition from …'    client_acquisition
 *   'Extracted price from message'           service_details, parseable price
 *   'Could not extract numeric price …'      service_details, unparseable price
 * Derived text, debug only (OI-8): the business story (twice), the client
 * workflow, the adjustment and its details.
 */
describe('owner text never reaches a logger (OI-7), derived text only at debug (OI-8)', () => {
  // No digit and none of the "free" words, so the price parser reads it as text.
  const SENTINEL = 'OWNER-SENTINEL-kqxz private words the owner typed';
  const DERIVED = 'DERIVED-MARKER-wvpj';

  /** Model output per call name: fixed, and never an echo of the input. */
  const RESPONSES: Record<string, string> = {
    business_story_extraction: JSON.stringify({ vertical: 'wellness', description: `${DERIVED} story`, goals: [DERIVED] }),
    client_workflow_extraction: JSON.stringify({ services: [{ name: `${DERIVED} service`, price: 80 }], pricing_model: 'fixed' }),
    adjustment_intent_extraction: JSON.stringify({ intent: 'modify_services', details: `${DERIVED} details` }),
  };

  beforeEach(() => {
    mockLogged.length = 0;
    mockComplete.mockImplementation(async (_params: unknown, context?: { component: string }) => ({
      content: RESPONSES[context?.component ?? ''] ?? '{}',
    }));
  });

  afterEach(async () => {
    // What makes this a proof about RAW text: the model never handed it back.
    for (const result of mockComplete.mock.results) {
      // A rejected call (a provider-error case) returned nothing to echo.
      const value = await Promise.resolve(result.value).catch(() => null);
      expect(JSON.stringify(value)).not.toContain(SENTINEL);
    }
    // No level ever sees the raw text.
    expect(JSON.stringify(mockLogged)).not.toContain(SENTINEL);
    // Derived text: debug (or trace) only.
    const visible = mockLogged.filter((l) => !['debug', 'trace'].includes(l.level));
    expect(JSON.stringify(visible)).not.toContain(DERIVED);
    // 'Processing user message' on every path, with the length instead of the text.
    const processing = mockLogged.find((l) => l.msg === 'Processing user message');
    expect(processing?.fields).toMatchObject({ messageLength: expect.any(Number) });
  });

  function line(msg: string) {
    const found = mockLogged.find((l) => l.msg === msg);
    expect(found).toBeDefined();
    return found!;
  }

  async function send(message: string, s: OnboardingState, submittedServices?: Array<{ name: string; price: number | null }>) {
    return new OnboardingConversationManager().processUserMessage(OWNER, message, s, submittedServices);
  }

  it('business_name: the typed name is logged by length only', async () => {
    await send(SENTINEL, state('business_name'));
    expect(line('Business name given').fields).toMatchObject({ nameLength: SENTINEL.length });
  });

  it('business_story: the length at info, the extraction at debug only', async () => {
    await send(SENTINEL, state('business_story'));
    expect(line('Extracting business story from message')).toMatchObject({
      level: 'info',
      fields: { messageLength: SENTINEL.length, userId: OWNER_ID, groupId: GROUP },
    });
    expect(line('Business story extracted').level).toBe('debug');
    expect(line('Extracted business story').level).toBe('debug');
    // The derived text IS kept, at debug, for local debugging (D-OI8).
    expect(JSON.stringify(line('Business story extracted').fields)).toContain(DERIVED);
  });

  it('client_workflow: the extraction at debug only', async () => {
    await send(SENTINEL, state('client_workflow'));
    expect(line('Extracted client workflow').level).toBe('debug');
  });

  const pricing = () =>
    state('service_details', {
      pendingQuestion: 'need_price',
      collectedData: { clientWorkflow: { services: [{ name: 'Class', price: null }], pricing_model: 'fixed' } },
    });

  it('a parseable price: the number and the length, not the text', async () => {
    // 175, not 100 or 150: the parser's "free" check matches any reply containing '0'.
    await send(`${SENTINEL} 175`, pricing());
    expect(line('Extracted price from message').fields).toEqual({ extracted: 175, messageLength: SENTINEL.length + 4 });
  });

  it('an unparseable price: lengths only, on both warnings', async () => {
    await send(SENTINEL, pricing());
    expect(line('Could not extract numeric price from message')).toMatchObject({
      level: 'warn',
      fields: { messageLength: SENTINEL.length },
    });
    expect(line('Could not extract price from message')).toMatchObject({
      level: 'warn',
      fields: { messageLength: SENTINEL.length, userId: OWNER_ID, groupId: GROUP },
    });
  });

  it('client_acquisition: the derived chips and the length, not the text', async () => {
    await send(`${SENTINEL} website`, state('client_acquisition'));
    expect(line('Extracted client acquisition from multi-select').fields).toMatchObject({
      messageLength: SENTINEL.length + 8,
      result: expect.objectContaining({ needs_website: true }),
    });
  });

  it('preview_adjustment: the intent at info, the details at debug only', async () => {
    await send(SENTINEL, state('preview_adjustment'));
    expect(line('Adjustment intent extracted')).toEqual({
      level: 'info',
      fields: { intent: 'modify_services' },
      msg: 'Adjustment intent extracted',
    });
    expect(line('Adjustment intent extracted: details').level).toBe('debug');
    expect(line('Service modification requested (not yet implemented)').level).toBe('debug');
  });

  it('an unknown adjustment intent (CR-3): only lengths at info; the model-returned value at debug', async () => {
    const saved = RESPONSES.adjustment_intent_extraction;
    const unknownIntent = `${DERIVED}-rename-everything`;
    RESPONSES.adjustment_intent_extraction = JSON.stringify({ intent: unknownIntent, details: `${DERIVED} details` });
    try {
      await send(SENTINEL, state('preview_adjustment'));
    } finally {
      RESPONSES.adjustment_intent_extraction = saved;
    }
    expect(line('Adjustment intent extracted')).toEqual({
      level: 'info',
      fields: { intentLength: unknownIntent.length },
      msg: 'Adjustment intent extracted',
    });
    expect(line('Unknown adjustment intent')).toMatchObject({
      level: 'info',
      fields: { intentLength: unknownIntent.length, detailsLength: expect.any(Number) },
    });
    expect(line('Unknown adjustment intent').fields).not.toHaveProperty('intent');
    // The value is kept for local debugging only.
    expect(JSON.stringify(line('Unknown adjustment intent: details'))).toContain(unknownIntent);
    expect(line('Unknown adjustment intent: details').level).toBe('debug');
  });

  it('services from the form missing a price (CR-1): a count at info, the typed names at no level', async () => {
    await send(
      SENTINEL,
      state('service_details', { collectedData: { clientWorkflow: { pricing_model: 'fixed' } } }),
      [
        { name: `${SENTINEL} one`, price: null },
        { name: `${SENTINEL} two`, price: null },
      ]
    );
    expect(line('Services missing price')).toEqual({
      level: 'info',
      fields: { servicesMissingPriceCount: 2 },
      msg: 'Services missing price',
    });
  });

  describe('an extractor failure (CR-2)', () => {
    const cases: Array<[string, OnboardingState, string]> = [
      ['business story', state('business_story'), 'Business story extraction failed'],
      ['client workflow', state('client_workflow'), 'Client workflow extraction failed'],
      ['adjustment intent', state('preview_adjustment'), 'Adjustment intent extraction failed'],
    ];

    it.each(cases)('%s, unparseable model output: only the error name at error, the detail at debug', async (_n, s, msg) => {
      mockComplete.mockImplementation(async () => ({ content: `${DERIVED} — not JSON` }));
      await send(SENTINEL, s);
      expect(line(msg)).toEqual({ level: 'error', fields: { errName: 'SyntaxError' }, msg });
      // A SyntaxError's message quotes the model output; it is kept at debug only.
      const detail = line(`${msg}: parse error detail`);
      expect(detail.level).toBe('debug');
      expect(JSON.stringify(detail.fields)).toContain('DERIVED-MA');
    });

    it.each(cases)('%s, a provider error: full detail kept at error', async (_n, s, msg) => {
      mockComplete.mockRejectedValue(new Error('provider down'));
      await send(SENTINEL, s);
      expect(line(msg)).toMatchObject({ level: 'error', fields: { err: { name: 'Error', message: 'provider down' } } });
    });

    it('client tracking (unreachable, KI-D), unparseable model output: the same shape', async () => {
      mockComplete.mockImplementation(async () => ({ content: `${DERIVED} — not JSON` }));
      await extractorsOf(new OnboardingConversationManager()).extractClientTracking(SENTINEL, OWNER);
      expect(line('Client tracking extraction failed')).toMatchObject({ level: 'error', fields: { errName: 'SyntaxError' } });
      // `afterEach` expects the per-message line; this case calls the extractor directly.
      mockLogged.push({ level: 'debug', fields: { messageLength: SENTINEL.length }, msg: 'Processing user message' });
    });
  });
});
