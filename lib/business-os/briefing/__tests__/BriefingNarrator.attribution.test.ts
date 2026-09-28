/**
 * Briefing LLM attribution (row 10).
 *
 * The narration used to fall back to the account 'unknown'. The account is now
 * required, and the group is a deterministic id of (business, day). The
 * `@ts-expect-error` below is enforced by `tsc --noEmit`, not by Jest.
 */

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

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { bosBriefingGroupId } from '@/lib/business-os/llm/callCatalog';
import { narrateBriefing } from '../BriefingNarrator';
import type { BriefingFacts } from '../BriefingFactsService';

const U1 = '11111111-1111-4111-8111-111111111111';

const chatCompletion = jest.fn();

/**
 * Nested objects MERGE with the defaults rather than replacing them.
 *
 * A test that overrides one appointment field used to have to restate every
 * other, so adding a fact to `BriefingFacts` broke every fixture in the file at
 * once. Merging means a case says only what it is about.
 */
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

function facts(overrides: DeepPartial<BriefingFacts> = {}): BriefingFacts {
  const base = {
    day: {
      timezone: 'Asia/Jerusalem',
      date: '2026-09-08',
      startUtc: '2026-09-07T21:00:00.000Z',
      endUtc: '2026-09-08T21:00:00.000Z',
      localHour: 9,
    },
    appointments: {
      total: 6,
      completed: 0,
      ready: 5,
      awaitingIntake: [],
      awaitingPayment: [],
      first: { name: 'Michael', timeLocal: '09:00', serviceName: 'Assessment 1' },
      cancelled: [],
      noShows: [],
      syncFailures: 0,
    },
    money: {
      owed: [],
      totalOwed: 0,
      currency: 'USD',
      mixedCurrency: false,
      receivedToday: 0,
      receivedCount: 0,
      instalmentsDue: [],
      retrying: 0,
    },
    isQuiet: false,
    outlook: {
      unanswered: { count: 0, people: [] },
      refunded: { count: 0, people: [] },
      newLeads: { count: 0, people: [] },
      quotesWaiting: { count: 0, people: [] },
      quotesOut: { count: 0, people: [] },
    },
  };

  return {
    ...base,
    ...overrides,
    day: { ...base.day, ...overrides.day },
    appointments: { ...base.appointments, ...overrides.appointments },
    money: { ...base.money, ...overrides.money },
    outlook: { ...base.outlook, ...overrides.outlook },
  } as BriefingFacts;
}

beforeEach(() => {
  jest.clearAllMocks();
  chatCompletion.mockResolvedValue({
    choices: [{ message: { content: 'You have 6 appointments today. First is Michael at 09:00.' } }],
  });
  jest
    .spyOn(ProviderFactory, 'getProvider')
    .mockReturnValue({ chatCompletion } as unknown as BaseAIProvider);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('narrateBriefing attribution', () => {
  it('requires the account at compile time', async () => {
    // @ts-expect-error: userId is required
    await narrateBriefing(facts({ isQuiet: true }), 'en');
  });

  it('records the narration against the business, never unknown or the system user', async () => {
    await narrateBriefing(facts(), 'en', U1);

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    const context = chatCompletion.mock.calls[0][1];
    expect(context).toStrictEqual({
      userId: U1,
      feature: 'business-os-briefing',
      component: 'daily_narration',
      sessionId: bosBriefingGroupId(U1, '2026-09-08'),
      activity_type: 'narration',
    });
    expect(context.userId).not.toBe('unknown');
    expect(context.userId).not.toBe('00000000-0000-0000-0000-000000000000');
  });

  it('groups two narrations of the same business-local day together', async () => {
    await narrateBriefing(facts(), 'en', U1);
    await narrateBriefing(facts({ appointments: { ...facts().appointments, total: 7 } }), 'en', U1);

    const [first, second] = chatCompletion.mock.calls.map((call) => call[1]);
    expect(first.sessionId).toBe(second.sessionId);
  });

  it('makes no call on a quiet day', async () => {
    await narrateBriefing(facts({ isQuiet: true }), 'en', U1);

    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('makes no call on a day that produced no statements, quiet or not', async () => {
    /*
     * The stronger gate, and the cheaper one.
     *
     * `isQuiet` is the facts layer's own judgement about a day. This is
     * arithmetic: if the day produced no sentences there is nothing to send,
     * and the model would be asked to write a briefing out of an empty list.
     * Asserted on the MOCK rather than on the output, because the output looks
     * the same either way — the difference is whether it was paid for.
     */
    const empty = facts({
      isQuiet: false,
      appointments: { total: 0, completed: 0, ready: 0, first: undefined },
    });

    const result = await narrateBriefing(empty, 'en', U1);

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(result.source).toBe('fallback');
    expect(result.narrative).toBe('No activity we could see for today.');
  });
});
