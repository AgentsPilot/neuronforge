/**
 * The onboarding chat's "how do you sell" questions, and the draft catalogue
 * they produce.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE QUESTIONS AND NOT MORE
 *
 * The chat used to collect every field of every service in a fifteen-column
 * grid before a single service existed. It now asks two chip questions and a
 * number, because exactly two service facts decide a capability:
 *
 *   is_scheduled   scheduling, availability, timezone, calendar, intake, and
 *                  both BLOCKING publish gaps
 *   collection     the payments capability, the processor step, invoice paperwork
 *
 * Everything else a service carries drives nothing and belongs in the services
 * editor. That was checked, not assumed, and these tests pin the checks so the
 * next person does not re-add a question for a field that changes no behaviour:
 * `shape.plans` is read in two places and both return early from
 * `collectsOnline`/`invoices`, and `hasPricedServices` is read by no predicate
 * at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  OnboardingConversationManager,
  SERVICE_COUNT_MAX,
  type OnboardingState,
} from '../OnboardingConversationManager';
import { onboardingConfigurationService, type ExtractedData } from '../OnboardingConfigurationService';
import { moneyMoves, collectsOnline, takesAppointments, shapeFromProfile } from '@/lib/business-os/setup/setupGraph';

jest.mock('@/lib/ai/providerFactory', () => ({
  getProviderFactory: () => ({
    complete: () => {
      throw new Error('No model call belongs in the sell questions');
    },
  }),
}));

const OWNER = { userId: '2f734ed5-3681-4049-880d-3de7b096bea3', groupId: '33333333-3333-4333-8333-333333333333' };

function state(pendingQuestion: string, extra: Partial<OnboardingState> = {}): OnboardingState {
  return {
    currentStep: 'service_details',
    collectedData: {},
    language: 'en',
    attributionGroupId: OWNER.groupId,
    pendingQuestion,
    ...extra,
  };
}

function manager() {
  return new OnboardingConversationManager();
}

describe('the appointments question', () => {
  it.each([
    ['Clients book a time with me', true],
    ['I sell without appointments — no calendar needed', false],
    ['הלקוחות קובעים איתי זמן', true],
    ['אני מוכר בלי תורים — אין צורך בלוח זמנים', false],
    ['Los clientes reservan una hora conmigo', true],
    ['Vendo sin turnos — no hace falta agenda', false],
  ])('reads the chip %j as %s', async (reply, expected) => {
    const result = await manager().processUserMessage(OWNER, reply, state('sell_scheduled'));
    expect(result.updatedState.collectedData.clientWorkflow?.sells_scheduled).toBe(expected);
  });

  it('reads typed denials, however many times "appointment" appears', async () => {
    const result = await manager().processUserMessage(
      OWNER,
      'no appointments at all, I just sell downloads',
      state('sell_scheduled')
    );
    expect(result.updatedState.collectedData.clientWorkflow?.sells_scheduled).toBe(false);
  });

  /*
   * The safe direction is TRUE.
   *
   * A wrong `true` is caught by the publish gate — no working hours blocks
   * publishing until the owner sets them. A wrong `false` silently removes the
   * datetime step and the owner finds out when a client books nothing.
   */
  it('defaults to scheduled when the answer says neither', async () => {
    const result = await manager().processUserMessage(OWNER, 'hmm, depends really', state('sell_scheduled'));
    expect(result.updatedState.collectedData.clientWorkflow?.sells_scheduled).toBe(true);
  });
});

describe('the money question', () => {
  it.each([
    ['The client pays online by card — needs a payment gateway', 'card_online'],
    ['I collect the money myself — invoice, transfer or cash', 'invoice'],
    ['Nothing I sell is paid for', 'none'],
    ['אני לא גובה כסף על מה שאני מוכר', 'none'],
    ['No cobro por nada de lo que ofrezco', 'none'],
  ])('reads the chip %j as %s', async (reply, expected) => {
    const result = await manager().processUserMessage(OWNER, reply, state('sell_collection'));
    expect(result.updatedState.collectedData.clientWorkflow?.collection_method).toBe(expected);
  });

  /*
   * The fallback at the bottom of `readCollectionMethod` is `invoice`, so a free
   * business used to be told it owed bank details. None of the invoice keywords
   * appears in "I don't charge for any of it".
   */
  it.each([['I do not charge for any of it'], ["it's free, all of it"], ['הכל בחינם']])(
    'reads a typed "free" (%j) as none rather than falling through to invoice',
    async (reply) => {
      const result = await manager().processUserMessage(OWNER, reply, state('sell_collection'));
      expect(result.updatedState.collectedData.clientWorkflow?.collection_method).toBe('none');
    }
  );

  it('still defaults to invoice when nothing is recognisable', async () => {
    const result = await manager().processUserMessage(OWNER, 'we sort it out somehow', state('sell_collection'));
    expect(result.updatedState.collectedData.clientWorkflow?.collection_method).toBe('invoice');
  });
});

describe('the count question', () => {
  it.each([
    ['3', 3],
    ['about 6', 6],
    ['just one', 1],
    ['שלוש', 3],
    ['tres', 3],
  ])('reads %j as %s and moves on', async (reply, expected) => {
    const result = await manager().processUserMessage(OWNER, reply, state('service_count'));
    expect(result.updatedState.collectedData.clientWorkflow?.service_count).toBe(expected);
    expect(result.updatedState.currentStep).toBe('client_acquisition');
    expect(result.updatedState.pendingQuestion).toBeUndefined();
  });

  it('prefers digits over words, so "3 or 4" is 3', async () => {
    const result = await manager().processUserMessage(OWNER, '3 or 4', state('service_count'));
    expect(result.updatedState.collectedData.clientWorkflow?.service_count).toBe(3);
  });

  it(`clamps to ${SERVICE_COUNT_MAX} so a shop cannot write hundreds of rows`, async () => {
    const result = await manager().processUserMessage(OWNER, 'around 200', state('service_count'));
    expect(result.updatedState.collectedData.clientWorkflow?.service_count).toBe(SERVICE_COUNT_MAX);
  });

  it('treats an explicit zero as an answer, not a parse failure', async () => {
    const result = await manager().processUserMessage(OWNER, '0', state('service_count'));
    expect(result.updatedState.collectedData.clientWorkflow?.service_count).toBe(0);
    expect(result.updatedState.currentStep).toBe('client_acquisition');
  });

  /*
   * The grid opens on `service_details` with NO pending question
   * (`app/onboarding-chat/page.tsx`). Clearing it here without moving the step
   * would put the fifteen-column form back on screen.
   */
  it('keeps the question pending when there is no number, so the grid stays shut', async () => {
    const result = await manager().processUserMessage(OWNER, 'hard to say', state('service_count'));
    expect(result.updatedState.collectedData.clientWorkflow?.service_count).toBeUndefined();
    expect(result.updatedState.currentStep).toBe('service_details');
    expect(result.updatedState.pendingQuestion).toBe('service_count');
  });
});

describe('every prompt exists in every language', () => {
  const KEYS = [
    'sell_scheduled_prompt',
    'sell_scheduled_options',
    'payment_collection_prompt',
    'payment_collection_options',
    'service_count_prompt',
    'service_count_options',
  ];

  it.each([['en'], ['he'], ['es']])('%s has all of them, and they are not keys', (language) => {
    // The private template reader, which is what `getStepResponse` uses.
    const templates = (manager() as unknown as {
      getResponseTemplates(l: string): Record<string, unknown>;
    }).getResponseTemplates(language);

    for (const key of KEYS) {
      const value = templates[key];
      expect(value).toBeDefined();
      // A missing translation renders as the key itself, which is the bug this
      // catches: `t('x') || 'fallback'` can never fire because a key is truthy.
      expect(value).not.toBe(key);
      if (Array.isArray(value)) {
        expect(value.length).toBeGreaterThan(0);
        for (const option of value) expect(String(option).trim().length).toBeGreaterThan(0);
      } else {
        expect(String(value).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('offers three money answers, including one for charging nothing', () => {
    for (const language of ['en', 'he', 'es']) {
      const templates = (manager() as unknown as {
        getResponseTemplates(l: string): Record<string, unknown>;
      }).getResponseTemplates(language);
      expect(templates.payment_collection_options as string[]).toHaveLength(3);
    }
  });

  /*
   * Every chip must be readable by the method that reads it. A label edited on
   * one side only falls through to the keyword branch, and for the money
   * question that lands on `invoice` — the misclassification the chips-first
   * ordering exists to prevent.
   */
  it('every offered chip is understood by its reader', async () => {
    for (const language of ['en', 'he', 'es'] as const) {
      const templates = (manager() as unknown as {
        getResponseTemplates(l: string): Record<string, unknown>;
      }).getResponseTemplates(language);

      const scheduledChips = templates.sell_scheduled_options as string[];
      const scheduledReads = await Promise.all(
        scheduledChips.map(chip =>
          manager()
            .processUserMessage(OWNER, chip, state('sell_scheduled', { language }))
            .then(r => r.updatedState.collectedData.clientWorkflow?.sells_scheduled)
        )
      );
      /*
       * Exact values in chip order, not just "two different answers".
       *
       * `size === 2` passed even with a broken label: the no-appointments chip
       * contains "בלי תורים", so it fell through to the keyword branch and
       * still came out false. Asserting the order means a label edited on one
       * side only actually fails here.
       */
      expect(scheduledReads).toEqual([true, false]);

      const moneyChips = templates.payment_collection_options as string[];
      const moneyReads = await Promise.all(
        moneyChips.map(chip =>
          manager()
            .processUserMessage(OWNER, chip, state('sell_collection', { language }))
            .then(r => r.updatedState.collectedData.clientWorkflow?.collection_method)
        )
      );
      expect(moneyReads).toEqual(['card_online', 'invoice', 'none']);
    }
  });
});

describe('the answers reach the build', () => {
  function configFor(extra: Partial<ExtractedData>) {
    return onboardingConfigurationService.computeConfiguration(
      { company_name: 'Test', vertical: 'coach', services: [], ...extra } as ExtractedData,
      'en'
    );
  }

  it('carries the count and the appointments answer through to the configuration', () => {
    const config = configFor({ service_count: 4, sells_scheduled: false, collection_method: 'invoice' });
    expect(config.service_count).toBe(4);
    expect(config.sells_scheduled).toBe(false);
  });

  /*
   * `needs_stripe_connect` read `services.some(s => s.collection === 'online')`,
   * which is FALSE when the chat collected a count instead of a catalogue — so
   * an owner who had just said "the client pays online by card" got no Stripe
   * account, and the one thing they said about money was the thing dropped.
   */
  it('still needs Stripe when the only answer is business-wide', () => {
    expect(configFor({ service_count: 3, collection_method: 'card_online' }).needs_stripe_connect).toBe(true);
    expect(configFor({ service_count: 3, collection_method: 'mixed' }).needs_stripe_connect).toBe(true);
    expect(configFor({ service_count: 3, collection_method: 'invoice' }).needs_stripe_connect).toBe(false);
    expect(configFor({ service_count: 3, collection_method: 'none' }).needs_stripe_connect).toBe(false);
  });

  it('lets a real catalogue outrank the business-wide answer', () => {
    const config = configFor({
      collection_method: 'invoice',
      services: [{ name: 'Session', price: 100, collection: 'online' }],
    } as Partial<ExtractedData>);
    expect(config.needs_stripe_connect).toBe(true);
  });
});

describe('what the two answers actually turn on', () => {
  /** The shape of a business whose services are all still drafts. */
  const draftsOnly = (collection_method: string) =>
    shapeFromProfile({ collection_method, online_presence_mode: 'full_website', activeServices: 0 });

  it('card means money moves and a processor is wanted', () => {
    const shape = draftsOnly('card_online');
    expect(moneyMoves(shape)).toBe(true);
    expect(collectsOnline(shape)).toBe(true);
  });

  it('invoice means money moves with no processor', () => {
    const shape = draftsOnly('invoice');
    expect(moneyMoves(shape)).toBe(true);
    expect(collectsOnline(shape)).toBe(false);
  });

  it('charging nothing drops the money half entirely', () => {
    const shape = draftsOnly('none');
    expect(moneyMoves(shape)).toBe(false);
    expect(collectsOnline(shape)).toBe(false);
  });

  /*
   * Drafts must not blank the capability graph.
   *
   * `businessShape.isPublished` counts only `status = 'active'`, so a catalogue
   * of drafts leaves `activeServices` at 0 and the shape falls back to the
   * profile. `capabilityKeysFromShape` tests `!== false`, so the fallback
   * returning NULL is safe and nothing is hidden — but the money answer has to
   * survive, which is what the assertions above hold.
   */
  it('still knows the business takes appointments with nothing published', () => {
    expect(takesAppointments(draftsOnly('invoice'))).toBe(true);
  });
});

/**
 * A fifth journey gap kind would stop every lead booking link email.
 *
 * `journeyGaps(userId, services)` is given only the services a surface SELLS,
 * and every public surface resolves them through `listBookable`, which excludes
 * drafts — so a "finish your drafts" gap could not be derived from its own
 * input. Worse, `LeadBookingLinkService` refuses on `gaps.length > 0` WITHOUT
 * filtering `isBlockingGap`, so adding a kind would silently stop lead emails
 * for any business holding one unfinished draft.
 *
 * The readiness home is `setup-status`, which already counts only
 * `status = 'active'` and therefore already treats drafts as outstanding work.
 */
describe('guard: the draft catalogue must not become a journey gap', () => {
  const root = join(__dirname, '..', '..', '..');

  it('JourneyGapKind still has exactly the four surface-level kinds', () => {
    const source = readFileSync(join(root, 'lib/business-os/journeyReadiness.ts'), 'utf8');
    const match = source.match(/export type JourneyGapKind =([^;]+);/);
    expect(match).toBeTruthy();

    const kinds = (match![1].match(/'[a-z_]+'/g) || []).map(k => k.replace(/'/g, '')).sort();
    expect(kinds).toEqual(['hours', 'invoicing', 'processor', 'timezone']);
  });

  it('the lead booking link gate still refuses on any gap, which is why', () => {
    const source = readFileSync(join(root, 'lib/services/LeadBookingLinkService.ts'), 'utf8');
    // If this ever starts filtering, the reasoning above is worth revisiting —
    // but it must be a deliberate change, not a surprise.
    expect(source).toContain('if (gaps.length > 0)');
    expect(source).not.toContain('gaps.filter(isBlockingGap)');
  });
});
