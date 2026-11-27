/**
 * Start from what you sell.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS
 *
 * The screen in front of a NEW service's four questions: "what are you
 * selling?", five answers, each of which knows what the client will go through
 * and which of the wizard's answers it implies. Picking one fills those
 * answers in and opens the wizard as it always opens.
 *
 * Owners understood each wizard question and still did not know what they were
 * setting up, or that a course paid by card needs a card account before it can
 * go live — they met that at step 4. This puts the shape of the whole thing,
 * and what it will ask of them, before step 1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES NOT DO, ON PURPOSE
 *
 * It decides nothing the wizard decides. A template is only a set of starting
 * answers, applied through `applyCostShape` — the wizard's own transform — so a
 * shape can never be half-applied by a second copy of the rule. The steps, the
 * branch, what is stored and what blocks publishing are untouched; the owner
 * can change every pre-filled answer exactly as if they had typed it.
 *
 * It never fills in what only the owner knows: the name, the description, the
 * price. Those stay empty.
 *
 * A PACKAGE IS SOLD BY QUOTE. A service row holds no session count and no
 * rhythm; in this product the sessions of a package are written in the quote.
 * So the package card starts a scheduled service settled by quote, and says
 * where the sessions are set, rather than pretending to pre-fill "6 weekly".
 *
 * @module lib/business-os/serviceTemplates
 */

import { applyCostShape, costShapeOf, type WizardValues } from '@/lib/business-os/serviceWizard';
import {
  serviceRequirements,
  type ServiceRequirementId,
} from '@/lib/business-os/setup/serviceRequirements';

export type ServiceTemplateId = 'appointment' | 'package' | 'course' | 'quote' | 'intro_call';

export interface ServiceTemplate {
  id: ServiceTemplateId;
  /**
   * A client picks a time for it, so it needs working hours to exist.
   * Offered only to a business that has them — see `templatesFor`.
   */
  needsCalendar: boolean;
}

/** In the order the cards are shown. */
export const SERVICE_TEMPLATES: readonly ServiceTemplate[] = [
  { id: 'appointment', needsCalendar: true },
  { id: 'package', needsCalendar: true },
  { id: 'course', needsCalendar: false },
  { id: 'quote', needsCalendar: false },
  { id: 'intro_call', needsCalendar: true },
];

/**
 * The cards this business can actually use.
 *
 * Only what it can sell: a business with no working hours is not offered an
 * appointment it could never publish. `hasCalendar` null means "not known
 * yet" and offers everything, the same fail-open reading `requirementMet` gives
 * an unknown — hiding a card on a failed request would take a real option away.
 */
export function templatesFor(hasCalendar: boolean | null): ServiceTemplate[] {
  if (hasCalendar === false) return SERVICE_TEMPLATES.filter(template => !template.needsCalendar);
  return [...SERVICE_TEMPLATES];
}

/**
 * What a template's service will ask of the business, for the checklist.
 *
 * `serviceRequirements` on the template's values, with one adjustment: a
 * set-price template leaves the price EMPTY for the owner to type, and an
 * empty price reads as "collects nothing" — so a course paid by card would
 * list no invoice details and no card account, the two things it needs most.
 * The checklist is about the service once it is priced, so an unanswered
 * price is read as a price. Nothing else is reinterpreted.
 */
export function templateRequirements(values: WizardValues): ServiceRequirementId[] {
  const unansweredPrice = costShapeOf(values) === 'unanswered';
  const price = unansweredPrice ? 1 : parseFloat(values.price);

  return serviceRequirements({
    is_scheduled: values.is_scheduled,
    price,
    collection: values.collection,
    sale_mode: values.sale_mode,
  });
}

/**
 * The wizard's answers a template implies, applied on top of what is there.
 *
 * Generic over the caller's own value shape so fields the wizard does not know
 * (the services list also carries `currency`) pass through untouched.
 */
export function applyServiceTemplate<T extends WizardValues>(values: T, id: ServiceTemplateId): T {
  /* `as T`: a spread of a generic is typed as a plain object. Every field
     written here is a `WizardValues` field, so the caller's shape holds. */
  const shaped = (scheduled: boolean, cost: 'free' | 'priced' | 'quoted'): T =>
    ({
      ...values,
      ...applyCostShape({ ...values, is_scheduled: scheduled }, cost),
    }) as T;

  switch (id) {
    case 'appointment':
      return shaped(true, 'priced');

    case 'package':
      /* See the module note: the sessions live in the quote. */
      return shaped(true, 'quoted');

    case 'course': {
      /* Bought, not booked, and paid when bought. Card rather than the
         wizard's invoice default: a course nobody pays for up front is the
         owner chasing every buyer. Step 3 still offers invoice. */
      const priced = shaped(false, 'priced');
      return { ...priced, collection: 'online' } as T;
    }

    case 'quote':
      /* Priced after hearing what they need. No calendar step: the work is
         arranged in the quote, and a business with no hours can sell this. */
      return shaped(false, 'quoted');

    case 'intro_call':
      return shaped(true, 'free');
  }
}
