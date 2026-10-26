/**
 * A conclusion must quote the owner, and some conclusions are never silent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The chat now works out what a business needs in order to sell, instead of
 * asking everyone the same five setup questions. Two things keep that honest,
 * and both are tested here rather than left to a prompt:
 *
 *   1. A fact carries the owner's OWN WORDS, and they are checked against what
 *      was actually typed. A model will label a guess "stated" without
 *      hesitating; it cannot quote words that were never said. So the quote is
 *      the evidence and `confidence` is only worth reading because of it.
 *
 *   2. Two facts are never settled silently, whatever the evidence. Intake is
 *      PROPOSED because being wrong puts a form in front of a stranger. Money
 *      is ASKED because nothing in a description says how money arrives, and
 *      guessing it has already caused one reverted bug.
 *
 * If the quote check is ever relaxed "because the model keeps paraphrasing",
 * what is left is a wizard that also guesses.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CONFIG_FACTS,
  configFact,
  configurationContract,
  configurationSystemPrompt,
  routeFact,
  verifyQuote,
  type ConfigFact,
  type FactRoute,
  type InferredFact,
} from '../configurationInference';

const TRANSCRIPT =
  'I train kids aged 8 to 18, we are training with weight and running etc. ' +
  'I collect the money myself, usually a transfer.';

const fact = (over: Partial<InferredFact>): InferredFact => ({
  key: 'needs_website',
  value: true,
  confidence: 'stated',
  quote: 'training with weight and running',
  ...over,
});

describe('the quote is checked, not trusted', () => {
  it('accepts the owner\'s words exactly as they typed them', () => {
    expect(verifyQuote('training with weight and running', TRANSCRIPT)).toBe(true);
  });

  it('accepts a difference that is not a difference', () => {
    /*
     * Case, punctuation and whitespace differ between what somebody types and
     * what a model copies back, and none of those make a quote invented.
     */
    expect(verifyQuote('Training with weight, and running!', TRANSCRIPT)).toBe(true);
    expect(verifyQuote('training   with weight and running', TRANSCRIPT)).toBe(true);
  });

  it('rejects a paraphrase, however faithful', () => {
    /* True of the business, and not something they said. That is the line. */
    expect(verifyQuote('they do strength and cardio work', TRANSCRIPT)).toBe(false);
  });

  it('rejects words that were never said at all', () => {
    expect(verifyQuote('I send them a health questionnaire first', TRANSCRIPT)).toBe(false);
  });

  it('rejects a quote too short to be evidence of anything', () => {
    /* "I" appears in every transcript ever written. */
    expect(verifyQuote('I', TRANSCRIPT)).toBe(false);
    expect(verifyQuote('kids', TRANSCRIPT)).toBe(false);
  });
});

describe('what happens to a fact once it is read', () => {
  const route = (over: Partial<InferredFact>, quoteVerified = true, declined: never[] = []) =>
    routeFact(fact(over), { quoteVerified, declined });

  it('settles a plainly stated fact that the owner can still change later', () => {
    expect(route({ key: 'needs_website', confidence: 'stated' })).toBe('apply');
    expect(route({ key: 'sells_scheduled', confidence: 'stated' })).toBe('apply');
  });

  it('puts a conclusion to them when it is reasoning rather than quoting', () => {
    expect(route({ key: 'needs_website', confidence: 'implied' })).toBe('propose');
  });

  it('asks outright when it is reasoning from the trade', () => {
    expect(route({ key: 'needs_website', confidence: 'guessed' })).toBe('ask');
  });

  /**
   * THE LINE THE WHOLE MECHANISM RESTS ON.
   *
   * An unverified quote may still be PUT to the owner — a conclusion they can
   * see and refuse is honest even when the reasoning is thin — but it may
   * never be applied over their head, whatever confidence the model claimed.
   */
  it('never settles a fact whose words are not in the transcript', () => {
    expect(route({ key: 'needs_website', confidence: 'stated' }, false)).toBe('propose');
    expect(route({ key: 'sells_scheduled', confidence: 'stated' }, false)).toBe('propose');
  });

  it('never settles intake silently, however well evidenced', () => {
    /* Being wrong here puts a form in front of somebody else's client. */
    for (const confidence of ['stated', 'implied'] as const) {
      expect(route({ key: 'needs_intake', confidence })).toBe('propose');
    }
    expect(route({ key: 'needs_intake', confidence: 'guessed' })).toBe('ask');
  });

  it('always asks how the money arrives', () => {
    /*
     * Not a question about mechanism but about evidence: a description does
     * not say how money reaches a business, and no routing table creates
     * words that were never written.
     */
    for (const confidence of ['stated', 'implied', 'guessed'] as const) {
      expect(route({ key: 'collection_method', value: 'invoice', confidence })).toBe('ask');
    }
  });

  it('does not put a refused conclusion a second time', () => {
    /* A question asked is a question spent, the rule the brief already keeps. */
    expect(
      routeFact(fact({ key: 'needs_intake', confidence: 'stated' }), {
        quoteVerified: true,
        declined: ['needs_intake'],
      })
    ).toBe('ask');
  });

  it('asks rather than acting on a value of the wrong shape', () => {
    expect(route({ key: 'service_count', value: 'two' })).toBe('ask');
    expect(route({ key: 'service_count', value: -1 })).toBe('ask');
    expect(route({ key: 'service_count', value: 4000 })).toBe('ask');
    expect(route({ key: 'sells_scheduled', value: 'yes' })).toBe('ask');
    expect(route({ key: 'collection_method', value: 'bitcoin' })).toBe('ask');
  });

  it('asks about a key it does not recognise', () => {
    expect(routeFact(fact({ key: 'needs_a_pony' as never }), { quoteVerified: true, declined: [] }))
      .toBe('ask');
  });
});

describe('the contract the model is given', () => {
  it('names every fact, with what it switches on and who sees it if it is wrong', () => {
    const contract = configurationContract();

    for (const definition of CONFIG_FACTS) {
      expect(contract).toContain(definition.key);
      expect(contract).toContain(definition.meaning);
      expect(contract).toContain(definition.whatItSwitchesOn);
    }
  });

  it('tells the model the cost of being wrong, which is how it weighs a guess', () => {
    expect(configurationContract()).toContain('a stranger');
  });

  it('is the same list the router enforces', () => {
    /* One source for what is described and what is allowed, for the reason
       `briefContract` exists: two descriptions of one thing drift silently. */
    for (const definition of CONFIG_FACTS) {
      expect(configFact(definition.key)).toBe(definition);
    }
    expect(configFact('not_a_fact')).toBeNull();
  });
});

/**
 * Every route a fact can take must have somewhere to go.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `sells_scheduled` routed `implied` to `propose` for a fortnight, and nothing
 * in the chat rendered a proposal for it. The route existed, the fact reached
 * it, and the owner was asked the question cold as though we had read nothing.
 * A gym trainer who wrote "I book a time with them" was asked whether clients
 * book a time with him.
 *
 * A routing table is a promise about what the owner will see. This checks the
 * promise is kept: every fact that can be PROPOSED has a proposal site, and
 * every one that can be APPLIED has something that reads it. Both are source
 * checks because the alternative is a live conversation per fact, and the thing
 * that broke was a missing call site rather than any function's return value.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('every route has somewhere to go', () => {
  const manager = readFileSync(
    join(__dirname, '..', '..', '..', 'services', 'OnboardingConversationManager.ts'),
    'utf8'
  );

  const canReach = (route: FactRoute) => (fact: ConfigFact) =>
    Object.values(fact.routing).includes(route);

  it('renders a proposal for every fact that can be proposed', () => {
    for (const fact of CONFIG_FACTS.filter(canReach('propose'))) {
      /* The chat reads a proposable fact by key; without this it cannot show one. */
      expect(manager).toContain(`proposableFact(state, '${fact.key}')`);
    }
  });

  it('reads every fact that can be applied, or applying it changes nothing', () => {
    for (const fact of CONFIG_FACTS.filter(canReach('apply'))) {
      expect(manager).toContain(`settledFact(`);
      expect(manager).toContain(fact.key);
    }
  });

  it('says what a value may be for every fact, so prose is not mistaken for one', () => {
    /*
     * The model returned `"value": "a card online"` — a phrase from this
     * fact's own `meaning`, where the options are written as a sentence. The
     * contract told a reader what the options were and never told the model
     * what a VALUE may be.
     */
    const contract = configurationContract();
    for (const fact of CONFIG_FACTS) {
      expect(fact.valueShape.length).toBeGreaterThan(0);
      expect(contract).toContain(fact.valueShape);
    }
  });
});

/**
 * The prompt lives next to the router it has to agree with.
 *
 * It was inline in a 3,900 line service, and the diagnostic script that
 * measures it was first written with its own pasted copy — two descriptions of
 * one thing, which is the drift `briefContract` exists to prevent.
 */
describe('the prompt the model is actually given', () => {
  it('describes every fact the router will accept', () => {
    const prompt = configurationSystemPrompt();
    for (const fact of CONFIG_FACTS) {
      expect(prompt).toContain(fact.key);
    }
  });

  it('demonstrates "stated" rather than only defining it', () => {
    /*
     * The three confidence words were defined and never shown, and the model
     * read `stated` as needing the fact's own phrasing — so a plain
     * description of the practice came back `implied`, which settles nothing.
     * An example is what moved it: measured, not stylistic.
     */
    const prompt = configurationSystemPrompt();
    expect(prompt).toContain('I book a time with them');
    expect(prompt).toMatch(/COMMON case/);
  });

  it('still refuses to read money out of a price', () => {
    /* The reverted bug this whole file is careful about. */
    expect(configurationSystemPrompt()).toMatch(/NEVER return collection_method/);
  });
});
