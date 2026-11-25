/**
 * The refund-decline draft is attributed, settings-driven, and quiet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SUITE EXISTS
 *
 * The Business OS LLM failure mode is silent: the call works, the owner gets
 * their draft, and the cost lands on the platform account, or outside the
 * action that caused it, or the client's own words end up in a production log.
 * Nothing breaks, so nothing surfaces it. The `bos-llm-call-standards` skill
 * Standard 7 asks for exactly these assertions per call site.
 *
 * Four things, then:
 *
 *  1. ATTRIBUTION — area `business-os-payments`, call name
 *     `refund_decline_draft`, the account the caller resolved server-side, and
 *     the action's own grouping id. Not one of them is derivable from the
 *     request, which is the point.
 *  2. SETTINGS — the model and temperature come from the `payments` area row
 *     through `resolveBosLlmSettings`, and the request is built INSIDE the
 *     retry so a refused model is not re-sent.
 *  3. THE KILL SWITCH MEANS SILENCE — `enabled: false` makes no call at all
 *     and returns null. The decline still works; the client is simply told
 *     nothing, exactly as before this feature existed. That is the honest
 *     meaning of `templateFallback: 'missing'` in the catalog.
 *  4. PRIVACY — the client's note is the most sensitive text in the whole
 *     flow, and the draft is written FROM it. A sentinel proves neither
 *     reaches a logger at any level above debug.
 *
 * And one behavioural pin the caller depends on: this function NEVER throws.
 * It is called while a decision about somebody's money is being recorded.
 */

const mockChatCompletion = jest.fn();
const mockResolveSettings = jest.fn();
const mockLogged: Array<{ level: string; payload: string }> = [];

jest.mock('@/lib/ai/providerFactory', () => ({
  ProviderFactory: {
    getProvider: () => ({ chatCompletion: (...args: unknown[]) => mockChatCompletion(...args) }),
  },
}));

jest.mock('@/lib/business-os/llm/modelSettings', () => ({
  resolveBosLlmSettings: (...args: unknown[]) => mockResolveSettings(...args),
}));

jest.mock('@/lib/logger', () => {
  const record = (level: string) => (context: unknown, message?: string) =>
    mockLogged.push({ level, payload: JSON.stringify({ context, message }) });
  const instance = {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    child: () => instance,
  };
  return { createLogger: () => instance };
});

import { draftRefundDecline, type RefundDeclineFacts } from '../draftRefundDecline';
import { __resetModelFallbackForTests } from '@/lib/business-os/llm/modelFallback';
import { BOS_LLM_CALL_POLICY } from '@/lib/business-os/llm/modelSettingsPolicy';
import type { ResolvedBosLlmSettings } from '@/lib/business-os/llm/modelSettings';

const OWNER = '08456106-aa50-4810-b12c-7ca84102da31';
const GROUP = 'c3a1f9d2-7e64-4b18-9f52-6a0d4e7b2c81';

/* The two strings that must never be logged: what the client typed, and what
   the model wrote back from it. */
const CLIENT_NOTE = 'SENTINEL_NOTE my mother was in hospital and I could not come';
const MODEL_DRAFT = 'SENTINEL_DRAFT I have looked at this and cannot refund it.';

const facts: RefundDeclineFacts = {
  businessName: 'Studio Nine',
  clientName: 'Tal',
  amountAsked: '40 USD',
  reason: 'changed_mind',
  note: CLIENT_NOTE,
  serviceName: 'Deep tissue',
  language: 'English',
};

const reply = (content: string) => ({ choices: [{ message: { content } }] });

/*
 * The model the policy would run with no row at all, read from the policy
 * rather than typed out — it is the thing the fallback retries on, so a
 * literal here would quietly stop testing the fallback the day it changes.
 */
const CODE_DEFAULT = BOS_LLM_CALL_POLICY.payments.refund_decline_draft.default.model;

/*
 * The only error shape `isModelUnavailableError` accepts. It reads `status`,
 * `code` and `param` and never the message text — so an error that merely
 * SAYS "model not found" does not trigger the retry, and a test built on one
 * passes while proving nothing.
 */
const modelNotFound = () =>
  Object.assign(new Error('The model does not exist'), { status: 404, code: 'model_not_found' });

/** A model an operator set in the row, different from the code default. */
const CONFIGURED = 'configured-model';

/*
 * A WHOLE resolved-settings object, typed, because a partial one silently
 * disables the thing being tested. The first version of this suite returned
 * `{ enabled, provider, model, temperature }` and left out `defaultModel` —
 * so `withModelFallback` retried on `undefined`, and the fallback case
 * "passed" while proving nothing. Typing it is what makes that impossible.
 */
const settingsOf = (overrides: Partial<ResolvedBosLlmSettings> = {}): ResolvedBosLlmSettings => ({
  area: 'payments',
  callName: 'refund_decline_draft',
  enabled: true,
  provider: 'openai',
  model: CONFIGURED,
  temperature: 0.6,
  defaultModel: CODE_DEFAULT,
  ...overrides,
});


beforeEach(() => {
  /*
   * `mockReset`, not `clearAllMocks`: the latter clears recorded calls but
   * LEAVES queued `…Once` implementations behind. An unconsumed one from the
   * fallback case leaked into a later test and answered with the wrong value
   * there — the failure looked like a bug in the code under test.
   */
  mockChatCompletion.mockReset();
  mockResolveSettings.mockReset();
  mockLogged.length = 0;
  /* The fallback negatively caches a refused model process-wide. */
  __resetModelFallbackForTests();
  mockResolveSettings.mockResolvedValue(settingsOf());
  mockChatCompletion.mockResolvedValue(reply(MODEL_DRAFT));
});

describe('draftRefundDecline — attribution', () => {
  it('books the call to the owner, the payments area and the action’s group', async () => {
    await draftRefundDecline(facts, { userId: OWNER, groupId: GROUP });

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    const context = mockChatCompletion.mock.calls[0][1];

    expect(context.userId).toBe(OWNER);
    expect(context.feature).toBe('business-os-payments');
    expect(context.component).toBe('refund_decline_draft');
    /* The group is the session id, so every call in one press groups together. */
    expect(context.sessionId).toBe(GROUP);
  });

  it('reads its model and temperature from the payments area row', async () => {
    await draftRefundDecline(facts, { userId: OWNER, groupId: GROUP });

    expect(mockResolveSettings).toHaveBeenCalledWith('payments', 'refund_decline_draft');

    const request = mockChatCompletion.mock.calls[0][0];
    expect(request.model).toBe(CONFIGURED);
    expect(request.temperature).toBe(0.6);
  });

  it('retries on the code default rather than re-sending the refused model', async () => {
    mockChatCompletion
      .mockRejectedValueOnce(modelNotFound())
      .mockResolvedValueOnce(reply(MODEL_DRAFT));

    const draft = await draftRefundDecline(facts, { userId: OWNER, groupId: GROUP });

    expect(draft).toBe(MODEL_DRAFT);
    /*
     * Two calls, and the second on a DIFFERENT model. This is what building
     * the request inside the callback buys: built outside it, the retry
     * re-sends the model the provider has just refused and the owner loses
     * their draft to a setting nobody can see.
     */
    const models = mockChatCompletion.mock.calls.map((call) => call[0].model);
    expect(models).toEqual([CONFIGURED, CODE_DEFAULT]);
    /* And the retry is still the same owner, area and action. */
    expect(mockChatCompletion.mock.calls[1][1].userId).toBe(OWNER);
    expect(mockChatCompletion.mock.calls[1][1].sessionId).toBe(GROUP);
    expect(mockChatCompletion.mock.calls[1][1].component).toBe('refund_decline_draft');
  });
});

describe('draftRefundDecline — degrading', () => {
  it('makes no call and returns null when the area is switched off', async () => {
    mockResolveSettings.mockResolvedValue(settingsOf({ enabled: false }));

    const draft = await draftRefundDecline(facts, { userId: OWNER, groupId: GROUP });

    expect(draft).toBeNull();
    /* No provider call means no ledger row and no charge. Silence costs
       nothing, which is why the switch is safe to use. */
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it('never throws, whatever the provider does', async () => {
    mockChatCompletion.mockRejectedValue(new Error('upstream exploded'));
    await expect(draftRefundDecline(facts, { userId: OWNER, groupId: GROUP })).resolves.toBeNull();

    /* An empty reply is a failure too: an empty draft in the review box reads
       as "the feature is broken" rather than "write it yourself". */
    mockChatCompletion.mockResolvedValue(reply('   '));
    await expect(draftRefundDecline(facts, { userId: OWNER, groupId: GROUP })).resolves.toBeNull();
  });
});

describe('draftRefundDecline — privacy', () => {
  it('logs no client words and no draft above debug', async () => {
    await draftRefundDecline(facts, { userId: OWNER, groupId: GROUP });

    const aboveDebug = mockLogged.filter((entry) => entry.level !== 'debug');
    expect(aboveDebug.length).toBeGreaterThan(0);

    for (const entry of aboveDebug) {
      expect(entry.payload).not.toContain('SENTINEL_NOTE');
      expect(entry.payload).not.toContain('SENTINEL_DRAFT');
      expect(entry.payload).not.toContain('hospital');
    }

    /* What it does log is the length, which is what makes a short or empty
       draft diagnosable without reading anybody's message. */
    expect(aboveDebug.some((entry) => entry.payload.includes(`"length":${MODEL_DRAFT.length}`))).toBe(true);
  });

  it('keeps the client’s note out of the failure log as well', async () => {
    /* A thrown error can quote the text it failed on — a JSON SyntaxError is
       the classic case — so the catch logs the error NAME, never the error. */
    mockChatCompletion.mockRejectedValue(new Error(`bad request near "${CLIENT_NOTE}"`));

    await draftRefundDecline(facts, { userId: OWNER, groupId: GROUP });

    for (const entry of mockLogged.filter((e) => e.level !== 'debug')) {
      expect(entry.payload).not.toContain('SENTINEL_NOTE');
    }
  });
});
