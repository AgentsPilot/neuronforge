/**
 * Onboarding price parser — the reply to "what does X cost?".
 *
 * Regression: '0' sat in the list of "free" words and was matched as a
 * substring, so every price containing a zero ("100", "250 ILS", "₪1,200") was
 * recorded as free. 'free' had the same flaw ("freelance rate 90").
 */

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
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
  createLogger: () => ({ ...mockLogger, child: () => mockLogger }),
}));
jest.mock('@/lib/ai/providerFactory', () => ({
  getProviderFactory: () => ({ complete: jest.fn() }),
}));

import { OnboardingConversationManager, type OnboardingState } from '../OnboardingConversationManager';

type PriceParser = { extractPriceFromMessage(message: string): number | null };

function parse(message: string): number | null {
  // Private method: the cast is the only way to reach it from a test.
  return (new OnboardingConversationManager() as unknown as PriceParser).extractPriceFromMessage(message);
}

describe('extractPriceFromMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each<[string, number | null]>([
    // Prices containing a zero — all read as free before the fix.
    ['100', 100],
    ['150', 150],
    ['250 ILS', 250],
    ['₪1,200', 1200],
    ['1,000', 1000],
    ['200 שקל', 200],
    ['€80.50', 80.5],
    ['it costs 300 per session', 300],
    // Worked before, still works.
    ['175', 175],
    // A zero that is the whole reply is free.
    ['0', 0],
    ['$0', 0],
    ['0 ₪', 0],
    ['0 ILS', 0],
    ['0.00', 0],
    // Free words, whole words only.
    ['free', 0],
    ['Free', 0],
    ["it's free", 0],
    ['free of charge', 0],
    ['no charge', 0],
    ['חינם', 0],
    ['זה בחינם', 0],
    ['ללא תשלום', 0],
    ['בלי תשלום', 0],
    ['gratis', 0],
    ['Es gratis', 0],
    ['gratuito', 0],
    ['nothing', 0],
    ['Nada.', 0],
    // Hedged "nothing" is not a price at all.
    ['nothing fixed yet', null],
    // Documented: the first number wins, and an explicit leading 0 is a 0.
    ['0 for kids, 100 for adults', 0],
    // "free" inside another word is not free.
    ['freelance rate 90', 90],
    ['freestyle class 120', 120],
    // No price at all.
    ['I am not sure yet', null],
    ['', null],
  ])('%j → %p', (message, expected) => {
    expect(parse(message)).toBe(expected);
  });

  it('never logs the owner\'s text — only its length and the parsed value (OI-7)', () => {
    parse('Secret 250 ILS');
    parse('free');
    parse('no idea');

    const logged = [...mockLogger.info.mock.calls, ...mockLogger.warn.mock.calls];
    expect(logged.length).toBeGreaterThan(0);
    for (const [fields] of logged) {
      expect(fields).not.toHaveProperty('message');
      expect(JSON.stringify(fields)).not.toMatch(/Secret|free|no idea/);
      expect(fields).toHaveProperty('messageLength');
    }
  });
});

describe('the need_price reply through processUserMessage', () => {
  const OWNER = { userId: '2f734ed5-3681-4049-880d-3de7b096bea3', groupId: '33333333-3333-4333-8333-333333333333' };

  it.each<[string, number]>([['250 ILS', 250], ['free', 0]])(
    '%j prices only the services asked about; a quoted service stays unpriced',
    async (reply, expected) => {
      const state: OnboardingState = {
        currentStep: 'service_details',
        pendingQuestion: 'need_price',
        language: 'en',
        attributionGroupId: OWNER.groupId,
        collectedData: {
          clientWorkflow: {
            services: [
              { name: 'Haircut', duration_minutes: 30, sale_mode: 'direct' },
              { name: 'Bespoke programme', duration_minutes: 90, sale_mode: 'proposal' },
              { name: 'Wash', duration_minutes: 10, price: 40, sale_mode: 'direct' },
            ],
          } as OnboardingState['collectedData']['clientWorkflow'],
        },
      };

      const { updatedState } = await new OnboardingConversationManager().processUserMessage(OWNER, reply, state);

      const [haircut, bespoke, wash] = updatedState.collectedData.clientWorkflow?.services ?? [];
      expect(haircut.price).toBe(expected);
      expect(bespoke.price).toBeUndefined();
      expect(wash.price).toBe(40);
      expect(updatedState.pendingQuestion).toBe('more_services');
    },
  );
});
