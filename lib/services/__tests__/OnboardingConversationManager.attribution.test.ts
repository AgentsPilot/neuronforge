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

  it('shares one group across turns, and across call types', async () => {
    /*
     * Was driven through `client_workflow` and then the legacy free-text
     * service loop, because those were the only two turns that each made a
     * model call. Both are gone: the selling questions are chips read without
     * a model, and the free-text loop was unreachable and has been removed.
     *
     * The brief interview is the better demonstration anyway. It spends one
     * call to CHOOSE the question and another to READ the answer, so a single
     * group has to hold several calls of DIFFERENT kinds across consecutive
     * turns, which is what this file is about.
     */
    const manager = new OnboardingConversationManager();
    const owner = { userId: OWNER_ID, groupId: GROUP };

    // Turn 1: the story is read, then a follow-up is chosen.
    mockComplete
      .mockResolvedValueOnce({ content: JSON.stringify({ vertical: 'beauty' }) })
      .mockResolvedValueOnce({
        content: JSON.stringify({ field: 'audience', question: 'Who comes to you?', skip: [] }),
      });

    const turn1 = await manager.processUserMessage(
      owner,
      'I run a hair salon mostly for children',
      state('business_story')
    );
    expect(turn1.updatedState.currentStep).toBe('business_deepening');
    expect(turn1.updatedState.attributionGroupId).toBe(GROUP);

    // Turn 2: the answer is read, then the next follow-up is chosen.
    mockComplete
      .mockResolvedValueOnce({ content: JSON.stringify({ audience: ['children'] }) })
      .mockResolvedValueOnce({
        content: JSON.stringify({ field: 'outcome', question: 'What changes for them?', skip: [] }),
      });

    await manager.processUserMessage(owner, 'mainly kids', turn1.updatedState);

    const all = calls();
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const [, context] of all) expect(context?.sessionId).toBe(GROUP);

    /* More than one KIND of call under one group, which a repeat of the same
       component could not show. */
    const components = new Set(all.map(([, c]) => c?.component));
    expect(components.has('business_story_extraction')).toBe(true);
    expect(components.has('business_deepening')).toBe(true);
  });

  it('reads the chips with no llm call, and spends exactly one naming the drafts', async () => {
    const manager = new OnboardingConversationManager();
    const owner = { userId: OWNER_ID, groupId: GROUP };

    const scheduled = await manager.processUserMessage(
      owner,
      'Clients book a time with me',
      state('service_details', { pendingQuestion: 'sell_scheduled' })
    );
    expect(scheduled.updatedState.pendingQuestion).toBe('sell_collection');
    expect(scheduled.updatedState.collectedData.clientWorkflow?.sells_scheduled).toBe(true);

    const collected = await manager.processUserMessage(
      owner,
      'Nothing I sell is paid for',
      scheduled.updatedState
    );
    expect(collected.updatedState.pendingQuestion).toBe('service_count');
    expect(collected.updatedState.collectedData.clientWorkflow?.collection_method).toBe('none');

    /* The point: a capability answer costs nothing. Two turns, no model. */
    expect(calls()).toHaveLength(0);

    /*
     * The count turn is different, and deliberately so. It is the one place
     * the interview spends a call on something other than understanding the
     * business: naming the placeholder rows the build is about to create, so
     * they are not "Service 1", "Service 2", "Service 3".
     */
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({
        services: [
          { name: 'Kids haircut', description: 'A cut for children, with a parent in the room.' },
          { name: 'Colour', description: 'Colour, booked as its own appointment.' },
          { name: 'Styling', description: 'Styling for an occasion.' },
        ],
      }),
    });

    const counted = await manager.processUserMessage(owner, '3', collected.updatedState);
    expect(counted.updatedState.collectedData.clientWorkflow?.service_count).toBe(3);

    const named = counted.updatedState.collectedData.clientWorkflow?.services ?? [];
    expect(named.map(service => service.name)).toEqual(['Kids haircut', 'Colour', 'Styling']);
    /* The owner's answers, carried onto the placeholder: without them the
       catalogue INVERTS the Stripe and scheduling decisions. */
    expect(named.every(service => service.is_scheduled === true)).toBe(true);
    expect(named.every(service => service.collection === null)).toBe(true);

    /* One call, under this conversation's group — the subject of this file. */
    const naming = calls().filter(([, c]) => c?.component === 'service_drafting');
    expect(naming).toHaveLength(1);
    for (const [, context] of naming) expect(context?.sessionId).toBe(GROUP);

    /*
     * And it does not fall through to the plan: a business that books now gets
     * asked whether its clients fill in a form first, which was asked of
     * nobody and set for nobody before.
     */
    expect(counted.updatedState.currentStep).toBe('service_details');
    expect(counted.updatedState.pendingQuestion).toBe('intake');

    const intake = await manager.processUserMessage(
      owner,
      'Yes, they fill in a form first',
      counted.updatedState
    );
    expect(intake.updatedState.collectedData.clientWorkflow?.needs_intake).toBe(true);
    expect(intake.updatedState.currentStep).toBe('client_acquisition');
    expect(intake.updatedState.pendingQuestion).toBeUndefined();

    /* The intake answer is a chip too: still no further model call. */
    expect(calls().filter(([, c]) => c?.component !== 'service_drafting')).toHaveLength(0);
  });

  it('re-asks the count rather than inventing one, and never reopens the services form', async () => {
    const manager = new OnboardingConversationManager();
    const owner = { userId: OWNER_ID, groupId: GROUP };

    const vague = await manager.processUserMessage(
      owner,
      'hard to say really',
      state('service_details', { pendingQuestion: 'service_count' })
    );

    expect(vague.updatedState.collectedData.clientWorkflow?.service_count).toBeUndefined();
    expect(vague.updatedState.currentStep).toBe('service_details');
    /*
     * Still `service_count`, and that is what keeps the grid shut.
     *
     * The page opens the services form on `service_details` with NO pending
     * question (`page.tsx`'s `askingForDetails`). Any new branch here that
     * cleared it without moving the step would put the fifteen-column grid
     * back on screen, which is the thing this whole change removes.
     */
    expect(vague.updatedState.pendingQuestion).toBe('service_count');
    expect(calls()).toHaveLength(0);
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

  it('keeps only the fields that decide something', async () => {
    /*
     * Was "parses the extraction as before", asserting `goals`, `company_name`
     * and `pain_points` survived the read. They no longer do, and the point of
     * the change is that they should not: `company_name` loses to the name the
     * owner typed when asked outright, and `goals` / `pain_points` / `tools` /
     * `clients_per_week` / `target_audience` had no question feeding them and
     * no consumer deciding anything from them.
     *
     * A model still volunteering them is ignored here rather than stored, so a
     * stale prompt cannot put them back by accident.
     */
    const manager = new OnboardingConversationManager();
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({
        vertical: 'wellness',
        sub_vertical: 'life_coach',
        needs_booking: true,
        needs_website: null,
        // Volunteered anyway. Must not be stored.
        goals: ['grow'],
        company_name: 'Calm',
        pain_points: ['no_shows'],
        clients_per_week: 15,
      }),
    });

    const story = await extractorsOf(manager).extractBusinessStory('We are Calm', OWNER);

    expect(story).toEqual({
      vertical: 'wellness',
      sub_vertical: 'life_coach',
      needs_booking: true,
      needs_website: undefined,
      /*
       * The fifth, added after an owner mistyped "I" and the interview moved
       * straight on. It decides whether the question is asked once more, and
       * the model judges it: a word or character count cannot tell "I" from
       * "מאמן כושר" and would be stricter in one script than another.
       *
       * Absent here, so it reads as `true` — our omission must never cost the
       * owner a repeated question.
       */
      describes_business: true,
    });
  });

  it('keeps each documented fallback when the call fails', async () => {
    const manager = new OnboardingConversationManager();
    mockComplete.mockRejectedValue(new Error('provider down'));
    const extractors = extractorsOf(manager);

    /*
     * `'default'`, not `'other'`. `other` is not a key of `PIPELINE_PRESETS`,
     * so it reached the default preset by falling through rather than by
     * saying so — and left the log reading `raw_vertical: other` for a
     * business that simply could not be read.
     */
    await expect(extractors.extractBusinessStory('x', OWNER)).resolves.toEqual({
      vertical: 'default',
      /* A provider error is not evidence that the owner said nothing. */
      describes_business: true,
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

    /*
     * This asserted the derived text WAS present at debug (D-OI8), by planting
     * a marker in the extraction's `description`.
     *
     * The extraction no longer returns any text: four values, each a fixed key
     * or a boolean, because the description is now always the owner's typed
     * words and the composed one is written later by `writeDescription`.
     *
     * So the OI-8 risk is gone from this call rather than confined to debug,
     * and the assertion inverts: nothing the owner wrote may appear in these
     * fields at any level. The D-OI8 allowance still covers the calls that do
     * return derived text, asserted below.
     */
    const storyFields = JSON.stringify(line('Business story extracted').fields);
    expect(storyFields).not.toContain(DERIVED);
    expect(storyFields).not.toContain(SENTINEL);
  });

  it('client_workflow: the extraction at debug only', async () => {
    /* Restored: removed by accident while dropping the price cases beside it.
       The extractor still exists, so the guard still applies. */
    await send(SENTINEL, state('client_workflow'));
    expect(line('Extracted client workflow').level).toBe('debug');
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

});
