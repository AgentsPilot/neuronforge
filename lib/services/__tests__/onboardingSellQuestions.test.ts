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
import { shapeFromServices } from '@/lib/business-os/businessShape';

/**
 * Recording, not throwing.
 *
 * This mock threw on any call, asserting that the selling questions cost no
 * model at all. That is still true of every CHIP: a button press is read by a
 * deterministic reader, and the tests below assert the mock stays untouched.
 *
 * One call now legitimately belongs here. Once the count is known, the
 * placeholder services are NAMED from what the owner already said, because a
 * count on its own produced rows called "Service 1", "Service 2". So the guard
 * becomes sharper rather than weaker: it is now "the chips make no call", which
 * is the claim that was actually worth making.
 */
const complete = jest.fn(async () => ({ content: JSON.stringify({ services: [] }) }));

jest.mock('@/lib/ai/providerFactory', () => ({
  getProviderFactory: () => ({ complete: (...args: unknown[]) => complete(...(args as [])) }),
}));

beforeEach(() => complete.mockClear());

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
    ['I sell without appointments: no calendar needed', false],
    ['הלקוחות קובעים איתי זמן', true],
    ['אני מוכר בלי תורים: אין צורך בלוח זמנים', false],
    ['Los clientes reservan una hora conmigo', true],
    ['Vendo sin turnos: no hace falta agenda', false],
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
    ['The client pays online by card: needs a payment gateway', 'card_online'],
    ['I collect the money myself: invoice, transfer or cash', 'invoice'],
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
  ])('reads %j as %s and asks how they sell next', async (reply, expected) => {
    /*
     * The count is asked FIRST, so a real number opens the two questions that
     * are about a catalogue. This used to assert `'intake'`, because the count
     * came last.
     */
    const result = await manager().processUserMessage(OWNER, reply, state('service_count'));
    expect(result.updatedState.collectedData.clientWorkflow?.service_count).toBe(expected);
    expect(result.updatedState.currentStep).toBe('service_details');
    expect(result.updatedState.pendingQuestion).toBe('sell_scheduled');
  });

  /*
   * The whole point of putting the count first.
   *
   * "How do you sell them" and "how do they pay you" are both questions ABOUT
   * a catalogue. Asked of someone who has just said there is none, they are
   * not merely redundant: the answers are stored, and `shapeFromProfile` reads
   * business-wide answers across precisely when no services exist to outrank
   * them — which is how "none" produced a business that takes appointments and
   * moves money.
   */
  it('asks nothing further about selling when there is nothing to sell', async () => {
    const result = await manager().processUserMessage(OWNER, '0', state('service_count'));

    expect(result.updatedState.pendingQuestion).toBeUndefined();
    expect(result.updatedState.currentStep).toBe('client_acquisition');
    expect(result.updatedState.collectedData.clientWorkflow?.collection_method).toBeUndefined();
    expect(result.updatedState.collectedData.clientWorkflow?.needs_intake).toBeUndefined();
  });

  it('skips intake for a business that sells without appointments', async () => {
    /*
     * A form "before the appointment" has no meaning where there is none, and
     * that decision now sits at the END of the three questions rather than
     * after the count — the money question is last, so it is what moves the
     * step on.
     */
    const result = await manager().processUserMessage(
      OWNER,
      'I collect the money myself',
      state('sell_collection', { collectedData: { clientWorkflow: { sells_scheduled: false, service_count: 3 } } })
    );

    expect(result.updatedState.currentStep).toBe('client_acquisition');
    expect(result.updatedState.pendingQuestion).toBeUndefined();
    expect(result.updatedState.collectedData.clientWorkflow?.needs_intake).toBeUndefined();
  });

  it('asks intake after the money question when the business does book', async () => {
    const result = await manager().processUserMessage(
      OWNER,
      'I collect the money myself',
      state('sell_collection', { collectedData: { clientWorkflow: { sells_scheduled: true, service_count: 3 } } })
    );

    expect(result.updatedState.pendingQuestion).toBe('intake');
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
    /*
     * And asks nothing further about meetings.
     *
     * This asserted `'intake'`, which was a recording of what happened rather
     * than a decision: the intake gate read `sells_scheduled !== false`, and
     * the appointments question is asked two steps BEFORE the count — so an
     * owner said "yes I book people in", then "I sell nothing", and was asked
     * what their clients fill in beforehand. The gate now also requires
     * something to sell, which is the same rule the step already states.
     */
    expect(result.updatedState.pendingQuestion).toBeUndefined();
  });

  it('names nothing when there is nothing to name', async () => {
    // Zero services, so no naming call: the guard is that we do not spend one.
    await manager().processUserMessage(OWNER, '0', state('service_count'));
    expect(complete).not.toHaveBeenCalled();
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

      /*
       * The count chips too, and the last one is the reason this block grew.
       *
       * "None yet" is offered as WORDS, because a bare "0" beside 1/2/3/5 reads
       * as a mis-tap. Words mean `readServiceCount` has to recognise it: the
       * digit branch cannot, and an unreadable chip falls through to "ask
       * again", so the owner taps an offered answer and the chat repeats the
       * question at them. Asserting the exact values in chip order means a
       * label translated on one side only fails here rather than in the chat.
       */
      const countChips = templates.service_count_options as string[];
      const countReads = await Promise.all(
        countChips.map(chip =>
          manager()
            .processUserMessage(OWNER, chip, state('service_count', { language }))
            .then(r => r.updatedState.collectedData.clientWorkflow?.service_count)
        )
      );
      expect(countReads).toEqual([1, 2, 3, 5, 0]);
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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE MONEY ANSWER REACHES `payment_mode`, WHICH IT NEVER DID.
   *
   * `computePaymentMode` opened on `services.some(s => s.price > 0)`. The
   * interview asks for a count and no prices — `draftServices` never returns
   * one and a guard test pins that — so the test was false on every ordinary
   * conversation and EVERY account built through the chat stored `'none'`.
   * An owner who tapped "the client pays online by card" was recorded as
   * taking no payments at all.
   *
   * Every case below reads `'none'` before the fix, which is what makes them
   * worth writing: they fail loudly on the old code and cannot pass by luck.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('records how the money arrives, from the answer rather than from a price', () => {
    expect(configFor({ service_count: 2, collection_method: 'card_online' }).payment_mode).toBe('upfront');
    expect(configFor({ service_count: 2, collection_method: 'mixed' }).payment_mode).toBe('upfront');
    expect(configFor({ service_count: 2, collection_method: 'invoice' }).payment_mode).toBe('invoicing');
    expect(configFor({ service_count: 2, collection_method: 'in_person' }).payment_mode).toBe('invoicing');
  });

  it('still records none for a business that charges for nothing', () => {
    /* Both ways of saying it: no catalogue at all, and a catalogue sold free. */
    expect(configFor({ service_count: 0, collection_method: 'invoice' }).payment_mode).toBe('none');
    expect(configFor({ service_count: 2, collection_method: 'none' }).payment_mode).toBe('none');
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE BLOCKS, NOT THE CAPABILITY LIST — and the distinction is the point.
   *
   * WHICH capabilities an account gets is no longer decided here: the list is
   * unioned with `capabilityKeysFromShape`, and on the chat's path the shape is
   * built from an empty catalogue, so it cannot tell and deliberately grants
   * everything rather than cutting the navigation down while setup is still in
   * progress. Asserting `payments` is absent would therefore be asserting
   * something the product does not do, and does not want to do.
   *
   * The BLOCKS are a different matter. `online_payments` and `invoicing` say
   * what kind of money this business takes, and they were gated on the same
   * dead `price > 0` filter — so they were empty for every account, whatever
   * the owner answered.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('names the kind of money from the answer, not from a price', () => {
    expect(
      configFor({ service_count: 2, collection_method: 'card_online' }).building_blocks?.payments
    ).toContain('online_payments');

    expect(
      configFor({ service_count: 2, collection_method: 'invoice' }).building_blocks?.payments
    ).toContain('invoicing');

    /* Both, for a business that said it does both. */
    const mixed = configFor({ service_count: 2, collection_method: 'mixed' }).building_blocks?.payments;
    expect(mixed).toContain('online_payments');
    expect(mixed).toContain('invoicing');
  });

  it('names no kind of money where none is taken', () => {
    expect(configFor({ service_count: 2, collection_method: 'none' }).building_blocks?.payments)
      .toBeUndefined();
    expect(configFor({ service_count: 0, collection_method: 'invoice' }).building_blocks?.payments)
      .toBeUndefined();
  });

  it('lets a real catalogue outrank the business-wide answer for the blocks too', () => {
    /* The same precedence the rest of this file asserts: rows first, word second. */
    const config = configFor({
      collection_method: 'invoice',
      services: [{ name: 'Session', price: 100, collection: 'online' }],
    } as Partial<ExtractedData>);

    expect(config.building_blocks?.payments).toContain('online_payments');
    expect(config.building_blocks?.payments).not.toContain('invoicing');
  });

  it('lets a real catalogue outrank the business-wide answer', () => {
    const config = configFor({
      collection_method: 'invoice',
      services: [{ name: 'Session', price: 100, collection: 'online' }],
    } as Partial<ExtractedData>);
    expect(config.needs_stripe_connect).toBe(true);
  });
});

/**
 * Selling nothing is an answer, and it has to survive the two questions that
 * come before it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The interview asks how you take appointments, then how you collect money,
 * then how many things you sell. So by the time an owner says "none", they have
 * already answered two questions about a catalogue that is about to not exist.
 *
 * `shapeFromProfile` reads those business-wide answers across whenever there
 * are no services — that is deliberate, and it is what makes the drafts case
 * above work. The cost was that "none" came out as `full_website` + `invoice`,
 * which resolves to appointments AND money moving: a scheduling tab, an
 * availability tab, an intake tab and invoice settings, for a business that
 * sells nothing and wanted a website and a contact form.
 *
 * Measured through the real pipeline before the fix, not reasoned about.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a business that sells nothing', () => {
  const sellingNothing = () =>
    onboardingConfigurationService.computeConfiguration(
      {
        company_name: 'Website Only Ltd',
        vertical: 'coach',
        services: [],
        service_count: 0,
        // Both already answered, both about to be moot.
        sells_scheduled: true,
        needs_booking: true,
        collection_method: 'invoice',
        clientAcquisition: { needs_website: true },
      } as unknown as ExtractedData,
      'en'
    );

  it('keeps the website and drops the booking', () => {
    // `full_website` would mean "takes appointments" with nothing to book.
    expect(sellingNothing().online_presence_mode).toBe('website_only');
  });

  it('collects nothing, whatever the money question was answered', () => {
    expect(sellingNothing().collection_method).toBe('none');
    expect(sellingNothing().needs_stripe_connect).toBe(false);
  });

  it('resolves to a website and a CRM, and nothing it cannot use', () => {
    const config = sellingNothing();
    const shape = shapeFromProfile({
      online_presence_mode: config.online_presence_mode,
      collection_method: config.collection_method,
      payment_mode: config.payment_mode,
      activeServices: 0,
    });

    expect(takesAppointments(shape)).toBe(false);
    expect(moneyMoves(shape)).toBe(false);
  });

  /*
   * The regression this is most likely to cause.
   *
   * The override keys off `service_count === 0` STRICTLY, so the ordinary
   * flow — a count with drafts still to be written — must be untouched. An
   * `!data.service_count` here would have swallowed it.
   */
  it('leaves every other count exactly as it was', () => {
    const drafts = onboardingConfigurationService.computeConfiguration(
      {
        company_name: 'Test',
        vertical: 'coach',
        services: [],
        service_count: 3,
        needs_booking: true,
        collection_method: 'invoice',
        clientAcquisition: { needs_website: true },
      } as unknown as ExtractedData,
      'en'
    );

    expect(drafts.collection_method).toBe('invoice');
    expect(drafts.online_presence_mode).toBe('full_website');
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * SELLING NOTHING IS ZERO SERVICES, NEVER ZERO PRICE.
   *
   * The two are easy to conflate and mean opposite things. A free consultation
   * is a full service: it is booked against a time, it needs working hours, a
   * timezone, reminders, no-show follow-up and a bookable surface — it just
   * never raises an invoice. Reading "free" as "sells nothing" would take the
   * calendar away from the one business most likely to live on it.
   *
   * `sellsNothing` therefore keys on the COUNT, and the shape's money half is
   * decided separately by price. The two must be able to disagree.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('does not fire for a business whose only service is free', () => {
    const freeOnly = onboardingConfigurationService.computeConfiguration(
      {
        company_name: 'Free Consults Ltd',
        vertical: 'coach',
        service_count: 1,
        services: [{ name: 'Intro call', price: 0, is_scheduled: true }],
        needs_booking: true,
        collection_method: 'none',
        clientAcquisition: { needs_website: true },
      } as unknown as ExtractedData,
      'en'
    );

    // A catalogue exists, so the booking half survives...
    expect(freeOnly.online_presence_mode).toBe('full_website');

    const shape = shapeFromProfile({
      online_presence_mode: freeOnly.online_presence_mode,
      collection_method: freeOnly.collection_method,
      activeServices: 1,
      scheduledServices: 1,
      onlineServices: 0,
      invoicedServices: 0,
      hasPricedServices: false,
    });
    expect(takesAppointments(shape)).toBe(true);
    // ...and only the money half is off.
    expect(moneyMoves(shape)).toBe(false);
  });

  /*
   * And a flow that never asks the question at all. `service_count` is
   * undefined there, which must NOT read as "sells nothing".
   */
  it('does not fire when the count was never asked', () => {
    const unasked = onboardingConfigurationService.computeConfiguration(
      {
        company_name: 'Test',
        vertical: 'coach',
        services: [],
        needs_booking: true,
        collection_method: 'invoice',
        clientAcquisition: { needs_website: true },
      } as unknown as ExtractedData,
      'en'
    );

    expect(unasked.collection_method).toBe('invoice');
    expect(unasked.online_presence_mode).toBe('full_website');
  });
});

/**
 * A catalogue may hold a booked session AND a course that is never booked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The interview asks once, for the whole business, whether clients book a time
 * — and that one answer used to be stamped on every drafted row. The owner's
 * own example could not be expressed: "a user that just sells courses, no
 * meeting, no schedule needed, and it can be sold as card payment or invoice."
 *
 * The product is built for a mixed catalogue: `shapeFromServices` counts
 * scheduled rows, `journeySteps` reads each service's own answer, and the
 * availability and timezone setup steps apply only where something is booked.
 * All of that had one answer to read, repeated.
 *
 * These assert the OUTCOME rather than the source, because the source already
 * has guards and the outcome is what the owner sees: whether they are asked to
 * set working hours.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a catalogue can hold both kinds of service', () => {
  const shapeOf = (services: Array<{ is_scheduled: boolean; price?: number | null }>) =>
    shapeFromServices(
      services.map(service => ({
        status: 'active',
        is_scheduled: service.is_scheduled,
        collection: 'invoice',
        price: service.price ?? 100,
        sale_mode: 'direct',
        payment_type: 'full',
        installment_count: 1,
      })) as never,
      { online_presence_mode: 'full_website' }
    );

  it('asks for no working hours when nothing is booked', () => {
    /* The course seller. Today every row carried the business-wide answer, so
       this business was handed a calendar it has no use for. */
    const courses = shapeOf([{ is_scheduled: false }, { is_scheduled: false }]);

    expect(takesAppointments(courses)).toBe(false);
  });

  it('asks for them when one service out of two needs them', () => {
    /* The mixed catalogue. One booked service is enough: the hours exist for
       that service, and the course is unaffected by their existing. */
    const mixed = shapeOf([{ is_scheduled: true }, { is_scheduled: false }]);

    expect(takesAppointments(mixed)).toBe(true);
  });

  it('still asks for them when everything is booked', () => {
    expect(takesAppointments(shapeOf([{ is_scheduled: true }]))).toBe(true);
  });

  it('keeps the money question separate from the booking one', () => {
    /*
     * A course is sold by card or by invoice exactly as a session is — which
     * is why how the money arrives stays a question for the business and is
     * never inferred from whether something is booked.
     */
    const courses = shapeOf([{ is_scheduled: false }]);

    expect(takesAppointments(courses)).toBe(false);
    expect(moneyMoves(courses)).toBe(true);
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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THIS USED TO COUNT THE KINDS. IT NOW GUARDS THE THING THE COUNT STOOD FOR.
   *
   * A fifth kind, `catalogue`, was added deliberately: a booking smart link
   * whose services are all drafts offers an EMPTY catalogue, which returned no
   * gaps and so went live over nothing bookable. That is a real gap and it
   * needed a name.
   *
   * But the danger this block was written about is unchanged and specific: it
   * is not that a fifth kind exists, it is that `journeyGaps` — the function
   * `LeadBookingLinkService` calls, refusing on `gaps.length > 0` with no
   * `isBlockingGap` filter — must never emit one derived from an empty
   * catalogue. If it did, one unfinished draft would silently stop every lead
   * booking email.
   *
   * So `catalogue` lives only in `journeyGapsForSmartLink`, which is asked
   * about a LINK rather than a list of services and is the one caller that can
   * tell "no services were passed" from "this link sells nothing". Pinning the
   * count would now fail for a correct change; pinning where the kind may
   * appear keeps the actual protection.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('journeyGaps cannot emit a catalogue gap, so lead emails cannot be stopped by a draft', () => {
    const source = readFileSync(join(root, 'lib/business-os/journeyReadiness.ts'), 'utf8');

    const start = source.indexOf('export async function journeyGaps(');
    const end = source.indexOf('export async function journeyGapsForSmartLink(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    // Not vacuous: the body really is the gap-building function.
    const journeyGapsBody = source.slice(start, end);
    expect(journeyGapsBody).toContain("kind: 'invoicing'");
    expect(journeyGapsBody).not.toContain("kind: 'catalogue'");
  });

  it('every kind the shared Fix button can be handed has a destination', () => {
    /*
     * `gapFixAction` is a switch with NO default, so a kind added to
     * `JourneyGapKind` without a case there returns `undefined` and the button
     * falls through to the caller's own label. That is exactly what happened
     * when `catalogue` arrived: an owner whose hours were already set was shown
     * "Set working hours" under a sentence about unpublished services.
     */
    /*
     * Read from `journeyGapKinds.ts`, which is where the roster lives.
     *
     * It moved out of `journeyReadiness.ts` because that module imports
     * `supabaseServer`: a client component needed the VALUE for a type guard,
     * and importing it from there dragged the service-role client into the
     * browser bundle and stopped the platform loading. A type import had always
     * been safe, which is why nothing complained before.
     *
     * Matched on the ARRAY rather than the type, since the kinds are a value
     * now — and a missing match here throws on the `!` rather than failing with
     * a readable message, which is how this test reported that move.
     */
    const rosterSource = readFileSync(join(root, 'lib/business-os/journeyGapKinds.ts'), 'utf8');
    const roster = rosterSource.match(/export const JOURNEY_GAP_KINDS = \[([\s\S]*?)\] as const;/);
    expect(roster).not.toBeNull();

    const kinds = roster![1].match(/'[a-z_]+'/g)!.map(k => k.replace(/'/g, ''));
    expect(kinds.length).toBeGreaterThan(0);

    const fixSource = readFileSync(join(root, 'lib/business-os/journeyGapFix.ts'), 'utf8');
    for (const kind of kinds) expect(fixSource).toContain(`case '${kind}':`);
  });

  it('the lead booking link gate still refuses on any gap, which is why', () => {
    const source = readFileSync(join(root, 'lib/services/LeadBookingLinkService.ts'), 'utf8');
    // If this ever starts filtering, the reasoning above is worth revisiting —
    // but it must be a deliberate change, not a surprise.
    expect(source).toContain('if (gaps.length > 0)');
    expect(source).not.toContain('gaps.filter(isBlockingGap)');
  });
});


/**
 * The last question, once the chat has concluded the owner wants a website.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The website half used to be decided by the tick ALONE, and the question
 * invites tapping past it. So an owner who had plainly said they wanted a site
 * — and was told so, one line above, with their own words quoted back — got no
 * site for tapping past it.
 *
 * Honouring the conclusion only on an EMPTY answer was tried first and was
 * worse: ticking "connect Facebook" to ADD insights would have cancelled the
 * site the owner had just been promised. A chip that adds one thing must never
 * remove another. So the conclusion holds until it is REFUSED, and the refusal
 * is a chip on the screen.
 *
 * The two halves of that bargain are what these tests pin: the conclusion
 * survives everything except the refusal, and the refusal always works.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a website conclusion the chat has already stated', () => {
  const SAID = 'I run a small physio clinic and I have nowhere for people to find me online';
  const QUOTE = 'nowhere for people to find me online';

  const asking = (facts: unknown[]) =>
    state('', {
      currentStep: 'client_acquisition',
      collectedData: { businessDescription: SAID, inferredFacts: facts as never },
    });

  const stated = (over: Record<string, unknown> = {}) => [
    { key: 'needs_website', value: true, confidence: 'stated', quote: QUOTE, ...over },
  ];

  const answer = (message: string, facts: unknown[] = stated()) =>
    manager()
      .processUserMessage(OWNER, message, asking(facts))
      .then(result => result.updatedState.collectedData.clientAcquisition);

  it('survives an owner who taps straight past the question', async () => {
    expect((await answer(''))?.needs_website).toBe(true);
  });

  /* The trap the first version of this fix walked into. */
  it('survives a chip that adds something else', async () => {
    const result = await answer('Connect Facebook, Instagram or Google: see where clients come from');
    expect(result?.needs_website).toBe(true);
    expect(result?.needs_channel_insights).toBe(true);
    expect(result?.acquisition_channels).toEqual(['website', 'channel_insights']);
  });

  it('is dropped the moment the owner says to skip it', async () => {
    const result = await answer('Skip the website for now');
    expect(result?.needs_website).toBe(false);
    expect(result?.acquisition_channels).not.toContain('website');
  });

  it('is dropped by the skip in every language the chat speaks', async () => {
    for (const skip of ['Skip the website for now', 'לדלג על האתר בשלב זה', 'Omitir la web por ahora']) {
      expect((await answer(skip))?.needs_website).toBe(false);
    }
  });

  /*
   * A refusal beside an addition. The skip wins over the word "website" that
   * every option on this question contains, including the skip itself — which
   * is why the reader matches one distinctive verb rather than hunting for a
   * negation.
   */
  it('is dropped even when the owner skips it and asks for something else', async () => {
    const result = await answer('Skip the website for now, Connect Facebook, Instagram or Google');
    expect(result?.needs_website).toBe(false);
    expect(result?.needs_channel_insights).toBe(true);
    expect(result?.primary_channel).toBe('social_media');
  });
});

/**
 * And what does NOT get this treatment, which is most of it.
 *
 * Only the `apply` route survives an unanswered question: a plainly stated
 * fact whose quote was found in the owner's own words. A conclusion that was
 * only ever PROPOSED is a conclusion nobody accepted, and it has no business
 * holding by default.
 */
describe('a website conclusion that was never settled', () => {
  const SAID = 'I run a small physio clinic and I have nowhere for people to find me online';

  const answer = (facts: unknown[]) =>
    manager()
      .processUserMessage(OWNER, '', state('', {
        currentStep: 'client_acquisition',
        collectedData: { businessDescription: SAID, inferredFacts: facts as never },
      }))
      .then(result => result.updatedState.collectedData.clientAcquisition);

  it('builds nothing when the chat concluded nothing', async () => {
    expect((await answer([]))?.needs_website).toBe(false);
  });

  it('builds nothing from a conclusion that was only implied', async () => {
    const implied = [{
      key: 'needs_website',
      value: true,
      confidence: 'implied',
      quote: 'nowhere for people to find me online',
    }];
    expect((await answer(implied))?.needs_website).toBe(false);
  });

  it('builds nothing from words the owner never said', async () => {
    const invented = [{
      key: 'needs_website',
      value: true,
      confidence: 'stated',
      quote: 'I would really like a beautiful website please',
    }];
    expect((await answer(invented))?.needs_website).toBe(false);
  });
});

/**
 * The copy and the reader have to agree, and nothing else checks that.
 *
 * `saysSkipWebsite` matches one distinctive verb per language. If the chip is
 * ever reworded without that verb, the refusal stops working silently and the
 * owner is given a website they just declined.
 */
describe('the skip chip and the reader that reads it', () => {
  it('offers a skip whose wording the reader can actually recognise', () => {
    const source = readFileSync(
      join(__dirname, '..', 'OnboardingConversationManager.ts'),
      'utf8'
    );

    const chips = [...source.matchAll(/website_skip_option: '([^']+)'/g)].map(m => m[1]);
    expect(chips).toHaveLength(3);

    const verbs = source.match(/private saysSkipWebsite[\s\S]*?\n  \}/)![0];
    for (const chip of chips) {
      const recognised = [...verbs.matchAll(/includes\('([^']+)'\)/g)]
        .some(m => chip.toLowerCase().includes(m[1]));
      expect(recognised).toBe(true);
    }
  });
});

/**
 * The business name is a name, not whatever was typed into that turn.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported from a real run. Asked to confirm "David KPMG", the owner answered
 * the question he was expecting instead of the one on screen:
 *
 *   > I'm an ADHD coach assisting kids ages 8-18 with their ADHD straggling
 *     in school and socilialization with their peers
 *
 * The confirmation reads yes, no, or "they retyped the name", and that third
 * branch accepted anything. So 134 characters were stored as the company name
 * and read back for confirmation, which made it look intentional. He said no,
 * retyped the same description, and confirmed it. His business was then called
 * a paragraph, on every invoice and every email the platform sends for him.
 *
 * The retype branch is right and stays: somebody who spots their own typo
 * retypes rather than tapping "no". What it needed was to notice when the
 * thing typed cannot be a name.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a description typed where the name was asked for', () => {
  const THE_REPORTED_ANSWER =
    "I'm an ADHD coach assisting kids ages 8-18 with their ADHD straggling in school "
    + 'and socilialization with their peers';

  const atConfirm = (name = 'David KPMG') =>
    state('name_confirm', {
      currentStep: 'business_name',
      collectedData: { businessProfile: { company_name: name } },
    });

  const nameAfter = async (reply: string, from = atConfirm()) => {
    const result = await manager().processUserMessage(OWNER, reply, from);
    return {
      name: result.updatedState.collectedData.businessProfile?.company_name,
      pending: result.updatedState.pendingQuestion,
    };
  };

  it('does not become the business name', async () => {
    const { name, pending } = await nameAfter(THE_REPORTED_ANSWER);
    expect(name).toBe('David KPMG');
    expect(pending).toBe('name_not_a_name');
  });

  it('asks again rather than guessing a name out of the sentence', async () => {
    /*
     * Trimming it to "I'm an ADHD coach" would be a guess about the one string
     * that represents them to their clients. The owner says what it is.
     */
    const { name } = await nameAfter(THE_REPORTED_ANSWER);
    expect(name).not.toContain('ADHD');
  });

  it('catches the same thing in Hebrew and Spanish', async () => {
    for (const said of [
      'אני מאמן ADHD שעוזר לילדים בבית הספר ובחברה',
      'Soy un coach de TDAH que ayuda a niños en la escuela y con sus amigos',
    ]) {
      const { pending } = await nameAfter(said);
      expect(pending).toBe('name_not_a_name');
    }
  });

  it('still takes a real retyped name, which is what the branch is for', async () => {
    const { name, pending } = await nameAfter('David KPMG Coaching');
    expect(name).toBe('David KPMG Coaching');
    expect(pending).toBe('name_confirm');
  });

  it('still takes a long but plausible name', async () => {
    /*
     * The thresholds sit just above the longest plausible real name, so this
     * has to pass or the guard is costing legitimate businesses their own.
     */
    const { name } = await nameAfter('Smith & Sons Plumbing and Heating Ltd');
    expect(name).toBe('Smith & Sons Plumbing and Heating Ltd');
  });

  it('still reads yes and no as themselves', async () => {
    expect((await nameAfter("Yes, that's right")).pending).toBeUndefined();
    expect((await nameAfter('No, let me fix it')).pending).toBe('name_again');
  });

  it('guards the retype after "no" as well, which is the same trap', async () => {
    /*
     * The reported run hit this path too: he tapped "no", was asked what it
     * should be, and typed the description again.
     */
    const { name, pending } = await nameAfter(
      THE_REPORTED_ANSWER,
      state('name_again', {
        currentStep: 'business_name',
        collectedData: { businessProfile: { company_name: 'David KPMG' } },
      })
    );
    expect(name).toBe('David KPMG');
    expect(pending).toBe('name_not_a_name');
  });
});
