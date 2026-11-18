/**
 * What the service wizard asks, and what each answer implies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE LIVE HERE AND NOT IN A RENDER TEST
 *
 * These rules used to be asserted through the DOM of the old one-page editor:
 * 26 cases in `SchedulingServicesList.editor.test.tsx` that found a label by
 * its English copy and read the sentence underneath it. They were testing this
 * model through two layers of markup, so a reworded heading failed a test about
 * money, and the model itself had no tests at all.
 *
 * The editor is a wizard now and the copy moved with it. The GUARANTEES did
 * not, so they are restated here against the functions that actually hold
 * them. Each one names the live defect it came from, because that is the part
 * worth keeping.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  applyCostShape,
  costShapeOf,
  nextStep,
  openingStep,
  previousStep,
  stepAnswered,
  stepsFor,
  type WizardValues,
} from '@/lib/business-os/serviceWizard';

/** A new row, as the editor opens it: nothing about money answered yet. */
const BLANK: WizardValues = {
  name: '',
  description: '',
  duration: '60',
  is_scheduled: true,
  price: '',
  collection: null,
  sale_mode: 'direct',
  payment_type: 'full',
  installment_count: 3,
  installment_frequency: 'monthly',
  first_payment_due: 'on_booking',
  first_payment_days: 0,
};

const values = (over: Partial<WizardValues> = {}): WizardValues => ({ ...BLANK, ...over });

describe('which of the two nothings this is', () => {
  /*
   * The defect, in the owner's words: an unpriced service showed "No price set
   * yet", "Free", "Nothing is collected" and a lit "They pay by card" chip all
   * at once. The cause was a model with three shapes, where an empty price and
   * a zero price were the same thing.
   */
  it('an empty price is unanswered, which is not free', () => {
    expect(costShapeOf(values({ price: '' }))).toBe('unanswered');
    expect(costShapeOf(values({ price: '   ' }))).toBe('unanswered');
  });

  it('a typed zero is an answer, and the answer is free', () => {
    expect(costShapeOf(values({ price: '0' }))).toBe('free');
    expect(costShapeOf(values({ price: '0.00' }))).toBe('free');
  });

  it('an amount above zero is priced', () => {
    expect(costShapeOf(values({ price: '250' }))).toBe('priced');
  });

  it('a quote is quoted whatever the price field holds', () => {
    expect(costShapeOf(values({ sale_mode: 'proposal', price: '' }))).toBe('quoted');
    expect(costShapeOf(values({ sale_mode: 'proposal', price: '250' }))).toBe('quoted');
  });

  it('something unreadable is unanswered rather than free', () => {
    /* `Number('abc')` is NaN, and NaN > 0 is false — so a careless read would
       have filed a typo as a free service. */
    expect(costShapeOf(values({ price: 'abc' }))).toBe('unanswered');
  });
});

describe('choosing a shape applies it whole', () => {
  it('free clears the arrangement, because nothing is collected', () => {
    const free = applyCostShape(values({ price: '250', collection: 'online' }), 'free');

    expect(free.price).toBe('0');
    expect(free.sale_mode).toBe('direct');
    expect(free.collection).toBeNull();
    expect(free.payment_type).toBe('full');
  });

  it('a quote takes the price away and says nothing about collecting it', () => {
    const quoted = applyCostShape(values({ price: '250', collection: 'online' }), 'quoted');

    expect(quoted.price).toBe('');
    expect(quoted.sale_mode).toBe('proposal');
    expect(quoted.collection).toBeNull();
  });

  it('a set price keeps a figure the owner already typed', () => {
    /* Clearing it would be the editor arguing with somebody who is mid-answer. */
    expect(applyCostShape(values({ price: '250' }), 'priced').price).toBe('250');
  });

  it('but lets go of a zero, which is the other shape', () => {
    /* Kept, the shape would flip straight back to free and the chip would not
       stay pressed — reported as "I charge a set price does nothing". */
    expect(applyCostShape(values({ price: '0' }), 'priced').price).toBe('');
  });

  it('defaults a set price to the arrangement that needs nothing connected', () => {
    /* Invoice, not card: a card arrangement needs a processor, and step three
       asks properly a moment later. */
    expect(applyCostShape(values({ price: '' }), 'priced').collection).toBe('invoice');
    /* An arrangement already chosen is left alone. */
    expect(applyCostShape(values({ collection: 'online' }), 'priced').collection).toBe('online');
  });
});

describe('which steps a service has', () => {
  it('a set price is asked how the money arrives', () => {
    expect(stepsFor(values({ price: '250' }))).toEqual(['what', 'cost', 'money', 'publish']);
  });

  it('a free service and a quote are a step shorter', () => {
    expect(stepsFor(values({ price: '0' }))).toEqual(['what', 'cost', 'publish']);
    expect(stepsFor(values({ sale_mode: 'proposal' }))).toEqual(['what', 'cost', 'publish']);
  });

  it('an unanswered cost keeps the step, so the stepper does not shorten mid-read', () => {
    expect(stepsFor(values({ price: '' }))).toEqual(['what', 'cost', 'money', 'publish']);
  });
});

describe('what counts as answered', () => {
  it('the service needs a name', () => {
    expect(stepAnswered('what', values({ name: '' }))).toBe(false);
    expect(stepAnswered('what', values({ name: 'Deep tissue massage' }))).toBe(true);
  });

  it('a booked service needs a length, and one that books nothing does not', () => {
    expect(stepAnswered('what', values({ name: 'X', is_scheduled: true, duration: '' }))).toBe(false);
    expect(stepAnswered('what', values({ name: 'X', is_scheduled: false, duration: '' }))).toBe(true);
  });

  it('the cost step is unanswered until one of the three shapes is chosen', () => {
    expect(stepAnswered('cost', values({ price: '' }))).toBe(false);
    expect(stepAnswered('cost', values({ price: '0' }))).toBe(true);
    expect(stepAnswered('cost', values({ price: '250' }))).toBe(true);
    expect(stepAnswered('cost', values({ sale_mode: 'proposal' }))).toBe(true);
  });

  it('a plan needs at least two payments', () => {
    /* One instalment is the same as paying in full, and saving it would store
       a schedule that means nothing. */
    const plan = (count: number) =>
      stepAnswered('cost', values({ price: '250', payment_type: 'installments', installment_count: count }));

    expect(plan(1)).toBe(false);
    expect(plan(2)).toBe(true);
  });

  it('a set price must say how it arrives; the other shapes have nothing to say', () => {
    expect(stepAnswered('money', values({ price: '250', collection: null }))).toBe(false);
    expect(stepAnswered('money', values({ price: '250', collection: 'invoice' }))).toBe(true);
    /* Not asked at all for these two, so the step cannot block them. */
    expect(stepAnswered('money', values({ price: '0', collection: null }))).toBe(true);
    expect(stepAnswered('money', values({ sale_mode: 'proposal', collection: null }))).toBe(true);
  });

  it('publish is a review and has nothing of its own', () => {
    expect(stepAnswered('publish', BLANK)).toBe(true);
  });
});

describe('moving through the steps', () => {
  it('skips the money question for a shape that does not have it', () => {
    const quoted = values({ sale_mode: 'proposal' });

    expect(nextStep('cost', quoted)).toBe('publish');
    expect(previousStep('publish', quoted)).toBe('cost');
  });

  it('walks every step for a set price', () => {
    const priced = values({ price: '250' });

    expect(nextStep('what', priced)).toBe('cost');
    expect(nextStep('cost', priced)).toBe('money');
    expect(nextStep('money', priced)).toBe('publish');
    expect(nextStep('publish', priced)).toBeNull();
    expect(previousStep('what', priced)).toBeNull();
  });

  it('a quote never hides its own way back', () => {
    /*
     * The blocked case: choosing "by quote" dropped the money step, and with
     * it the only control that could return to the cost question — so the
     * owner could not change their mind.
     */
    expect(previousStep('publish', values({ sale_mode: 'proposal' }))).toBe('cost');
  });
});

describe('where it opens', () => {
  it('on the first thing not yet answered', () => {
    expect(openingStep(values({ name: '' }))).toBe('what');
    expect(openingStep(values({ name: 'X', price: '' }))).toBe('cost');
    expect(openingStep(values({ name: 'X', price: '250', collection: null }))).toBe('money');
  });

  it('on the first step when everything already has an answer', () => {
    /*
     * Not the review. A service with nothing outstanding opens where an owner
     * would start reading it, and `?? 'what'` is what says so — jumping a
     * finished service to the last step would answer a question nobody asked.
     */
    expect(openingStep(values({ name: 'X', price: '250', collection: 'invoice' }))).toBe('what');
    expect(openingStep(values({ name: 'X', sale_mode: 'proposal' }))).toBe('what');
  });

  it('never leaves the owner nowhere', () => {
    /* `?? 'what'` is the fallback, and it has to stay reachable: a values
       object every step calls answered still has to open on something. */
    expect(stepsFor(BLANK)).toContain(openingStep(BLANK));
  });
});
