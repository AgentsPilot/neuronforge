/**
 * The four questions a service is built from, and the one branch between them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A MODULE RATHER THAN MORE JSX
 *
 * The editor asked everything at once on one panel, and the panel then had to
 * decide what each field meant while half of them were unanswered. That is how
 * one screen came to say four contradicting things about a service nobody had
 * priced: "No price set yet" under the chips, "Free" beside the payment plan,
 * "Nothing is collected" in the summary, and a lit "They pay by card" chip. All
 * four were produced by the same cause — an empty price read as `unanswered` in
 * one place and as `free` in two others.
 *
 * So the order is written down, once, here, and the component only draws it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER, AND WHY IT IS THIS ORDER
 *
 *   1  what    a name, and whether a client books a time. Decides `hours`.
 *   2  cost    free · a set price · priced per job. THE ONLY BRANCH.
 *   3  money   how a set price arrives: card or invoice. Skipped by the
 *              other two answers, because neither has an amount to collect.
 *   4  publish what is still owed, read from the gates themselves.
 *
 * Step 2 is the branch because it is the question the other answers hang off:
 * a free service collects nothing, a quote settles its amount later, and only
 * a set price has a third question to ask. Two of the three paths end there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS DECIDES NO RULES. IT ORDERS EXISTING ONES.
 *
 * `serviceShapeFields` already owns what each shape means on the row — a quote
 * carries no price, a free service no collection, neither a payment plan — and
 * `serviceRequirements` already owns what each shape asks of the business, in
 * the order it asks. Both stay the authority; this maps them onto four screens.
 *
 * @module lib/business-os
 */

import type {
  ServiceCollection,
  ServiceSaleMode,
  PaymentType,
  InstallmentFrequency,
  FirstPaymentDue,
} from '@/lib/repositories/SchedulingRepository';

/** The four screens, in order. */
export type WizardStep = 'what' | 'cost' | 'money' | 'publish';

/**
 * The one branch.
 *
 * Not a column on the row: it is READ from `price` and `sale_mode`, which are
 * the columns that already exist. `unanswered` is a real fourth state and the
 * reason this type exists — a service the onboarding chat created has no price
 * and no sale mode anybody chose, and calling that "free" is the bug this
 * whole rework is built around.
 */
export type CostShape = 'free' | 'priced' | 'quoted' | 'unanswered';

/** Only the fields the four questions read or write. */
export interface WizardValues {
  name: string;
  description: string;
  duration: string;
  /**
   * The gap kept AFTER this service, before the next client can be offered a
   * time. `buffer_minutes` on the row.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A FIELD THE COLUMN HAD AND NO SCREEN DID.
   *
   * `buffer_minutes` has existed since the first scheduling migration, every
   * public booking surface honours it (`lib/scheduling/slotInterval` and the
   * widening of what counts as taken), and in Business OS there was nowhere to
   * set one: the chat stopped collecting it when the old services form was
   * retired — on the stated grounds that the editor "has a field for each" —
   * and the editor that replaced that form never had this one. The only
   * surviving control is the modal on the V2 scheduling page, outside Business
   * OS. Of 35 live services, 18 carried a gap from the old paths and 17 had
   * none that anybody could have chosen.
   *
   * Empty string means not answered, the same convention `price` uses, and it
   * is read as no gap. Unlike the length it NEVER blocks the step: plenty of
   * services genuinely need no gap, and `stepAnswered` would otherwise stop an
   * owner on a question they have already answered by leaving it alone.
   * ───────────────────────────────────────────────────────────────────────────
   */
  buffer: string;
  is_scheduled: boolean;
  /** Empty string means NOT ANSWERED. `'0'` means free. They are different. */
  price: string;
  /** `null` is "not chosen", which is a state the row genuinely holds. */
  collection: ServiceCollection | null;
  sale_mode: ServiceSaleMode;
  payment_type: PaymentType;
  /*
   * The schedule, which only exists for a plan.
   *
   * Carried in the wizard's own values rather than left on the row behind it:
   * choosing "in instalments" with nowhere to say how many is a chip that
   * changes a column and nothing an owner can see — reported as "instalments
   * is not working". `serviceShapeFields` already drops all three for a free
   * service and a quote, so they can never reach a row that has no amount.
   */
  installment_count: number;
  installment_frequency: InstallmentFrequency;
  first_payment_due: FirstPaymentDue;
  /** Only meaningful for `days_after`; `0` is what `on_booking` stores. */
  first_payment_days: number;
}

/**
 * Which of the three the current values describe.
 *
 * Order matters: a quote is a quote whatever the price field holds, because
 * `serviceShapeFields` clears the price for one. Then a typed `0` is free. An
 * empty box is nobody's answer and must stay distinguishable from both.
 */
export function costShapeOf(values: Pick<WizardValues, 'price' | 'sale_mode'>): CostShape {
  if (values.sale_mode === 'proposal') return 'quoted';

  const typed = values.price.trim();
  if (typed === '') return 'unanswered';

  const amount = Number(typed);
  if (!Number.isFinite(amount)) return 'unanswered';

  return amount > 0 ? 'priced' : 'free';
}

/**
 * The values a chosen shape implies, applied the moment it is chosen.
 *
 * Written as a whole-values transform rather than three setters so a shape can
 * never be half-applied — the state that produced "free, and they pay by card"
 * on one screen.
 *
 * `price` is deliberately LEFT ALONE when switching to `priced`: an owner who
 * picks it is about to type, and clearing a figure they already had would be
 * the editor arguing with them. The other two shapes do clear it, because both
 * mean "there is no set amount" and a stale figure is what reaches a client.
 */
export function applyCostShape(values: WizardValues, shape: Exclude<CostShape, 'unanswered'>): WizardValues {
  if (shape === 'free') {
    return { ...values, price: '0', sale_mode: 'direct', collection: null, payment_type: 'full' };
  }

  if (shape === 'quoted') {
    return { ...values, price: '', sale_mode: 'proposal', collection: null, payment_type: 'full' };
  }

  return {
    ...values,
    sale_mode: 'direct',
    /* A price of 0 is the free answer, so moving to `priced` has to let go of
       it or the shape would flip straight back. */
    price: values.price.trim() === '0' ? '' : values.price,
    /* Invoice, not card: it is the arrangement that needs nothing connected,
       and step 3 asks properly a moment later. */
    collection: values.collection ?? 'invoice',
  };
}

/**
 * The steps this service actually has.
 *
 * `money` is dropped for every shape but `priced`, which is the whole point of
 * asking cost first: a free service and a quote are four questions shorter.
 * It is KEPT while the cost is unanswered, so the stepper does not shorten
 * under the owner's hand as they read it.
 */
export function stepsFor(values: Pick<WizardValues, 'price' | 'sale_mode'>): WizardStep[] {
  const shape = costShapeOf(values);
  const asksHowItArrives = shape === 'priced' || shape === 'unanswered';

  return asksHowItArrives
    ? ['what', 'cost', 'money', 'publish']
    : ['what', 'cost', 'publish'];
}

/**
 * Has this step been answered?
 *
 * Answered, NOT valid. The publish gates decide what is good enough to go live
 * — `publishBlockers` reads the stored row and `journeyReadiness` owns the
 * blocking set — and a second opinion here would eventually disagree with
 * them. This only says whether the owner has given the answer the step exists
 * to collect, which is what the stepper draws and what Continue needs.
 */
export function stepAnswered(step: WizardStep, values: WizardValues): boolean {
  if (step === 'what') {
    if (!values.name.trim()) return false;
    /* A booked service needs a length; one that books nothing does not.
       The GAP is deliberately not tested: no gap is a real answer, and the
       commonest one. See `WizardValues.buffer`. */
    return values.is_scheduled ? values.duration.trim() !== '' : true;
  }

  if (step === 'cost') {
    if (costShapeOf(values) === 'unanswered') return false;
    /* A plan needs at least two payments; one is the same as paying in full,
       and saving it would store a schedule that means nothing. */
    return values.payment_type !== 'installments' || values.installment_count >= 2;
  }

  if (step === 'money') {
    /* Only ever asked of a set price, and then it is a straight choice. */
    return costShapeOf(values) !== 'priced' || values.collection !== null;
  }

  /* `publish` is the review. It has nothing of its own to answer. */
  return true;
}

/** The step after this one, or null at the end. */
export function nextStep(step: WizardStep, values: WizardValues): WizardStep | null {
  const steps = stepsFor(values);
  const at = steps.indexOf(step);
  if (at < 0) return steps[0] ?? null;
  return steps[at + 1] ?? null;
}

/** The step before this one, or null at the start. */
export function previousStep(step: WizardStep, values: WizardValues): WizardStep | null {
  const steps = stepsFor(values);
  const at = steps.indexOf(step);
  if (at <= 0) return null;
  return steps[at - 1] ?? null;
}

/**
 * Where to open an EXISTING service: at the beginning, always.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This used to jump to the first UNANSWERED step, which for the services the
 * onboarding chat writes — a name, a length, no price — meant opening on
 * `cost`. The reasoning was that it saves a press on the one question nobody
 * has answered.
 *
 * It costs more than it saves. An owner opening a service during setup is
 * usually there to look at the whole thing before publishing it, and the name
 * is the first thing they want to change: the chat's names are a guess from
 * their own words, and "Initial Consultation Phase" is not what most people
 * would call it. Landing on the money question put the one field they came to
 * edit behind a Back press they had no reason to expect.
 *
 * The stepper still shows what is answered and what is not, so nothing is
 * hidden by starting at the front. Reported from the configuration dialog:
 * "when we click on the service to update and publish it needs to be in the
 * first step so we can change the service name if needed".
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function openingStep(values: WizardValues): WizardStep {
  return stepsFor(values)[0] ?? 'what';
}
