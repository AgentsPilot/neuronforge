/**
 * What a business IS, read off its own catalogue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ANSWER, FOUR SURFACES.
 *
 * Four screens used to answer "what does this business actually need", and each
 * answered differently:
 *
 *   readiness card    the shape predicates in setupGraph — mostly right
 *   settings dialog   nothing at all: six tabs, always, Stripe included
 *   navigation tabs   `user_capabilities` rows
 *   the v1 chat gate  the same rows, queried again
 *
 * So a consultancy that invoices for everything was shown a readiness card that
 * correctly never mentioned Stripe, beside a settings dialog whose second tab
 * asked it to hand Stripe an ID for an account it will never open.
 *
 * The rows were the least trustworthy of the four. `scheduling` was granted for
 * having ANY service, so a shop selling downloads got an availability calendar;
 * a sweep then added every capability whose `verticals` list was empty to every
 * account, overriding whatever onboarding had decided; and nothing anywhere
 * could switch one off again.
 *
 * WHAT REPLACES THEM
 *
 * The services. A business that sells three appointments takes appointments; one
 * whose every service is billed afterwards does not need a card processor; one
 * that charges for nothing needs no invoice details. None of these is a property
 * of the business — each is a property of its catalogue, which is why asking the
 * owner produced an answer that was wrong for half of what they sell.
 *
 * This module is PURE and has no database of its own, so the settings dialog can
 * resolve the same shape in the browser from the services it has already loaded.
 * `businessShape.server.ts` is the same rules against Supabase.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/businessShape
 */

import {
  shapeFromProfile,
  collectsOnline as shapeCollectsOnline,
  moneyMoves as shapeMoneyMoves,
  takesAppointments as shapeTakesAppointments,
  type BusinessShape,
  type PlanKind,
} from '@/lib/business-os/setup/setupGraph';

export type { BusinessShape };

/**
 * The little a service has to say for itself.
 *
 * Deliberately loose: this is fed from the repository type on the server and
 * from the settings dialog's own list in the browser, and neither should have
 * to be reshaped to ask a question about itself.
 */
export interface ServiceFacts {
  /** 'draft' | 'active' | 'inactive'. Only a published service counts. */
  status?: string | null;
  is_scheduled?: boolean | null;
  /** 'online' | 'invoice', null while the service is free. */
  collection?: string | null;
  price?: number | null;
  /** 'full' | 'installments'. */
  payment_type?: string | null;
  installment_count?: number | null;
}

/** What the catalogue adds up to, in the terms `shapeFromProfile` expects. */
export interface ServiceCounts {
  activeServices: number;
  scheduledServices: number;
  onlineServices: number;
  invoicedServices: number;
  hasPricedServices: boolean;
  plans: PlanKind;
}

/**
 * Only a PUBLISHED service counts.
 *
 * A draft is a sentence somebody is still writing. Letting one decide the shape
 * would move the settings tabs around under a half-finished thought — add a
 * product, and the availability tab you were about to use disappears.
 *
 * Matches the stats route, which has always counted `status = 'active'`.
 */
function isPublished(service: ServiceFacts): boolean {
  return service.status === 'active';
}

/**
 * Count the catalogue.
 *
 * The three interesting counts are deliberately not mutually exclusive: one
 * practice sells a card-paid session AND an invoiced programme, and the whole
 * point of reading the services is that it can say so.
 */
export function countServices(services: ServiceFacts[]): ServiceCounts {
  const published = (services || []).filter(isPublished);

  return {
    activeServices: published.length,
    // A service is booked against a time unless it says otherwise — the column
    // is NOT NULL DEFAULT true, and an older row that never heard the question
    // is an appointment.
    scheduledServices: published.filter(s => s.is_scheduled !== false).length,
    onlineServices: published.filter(s => s.collection === 'online' && (s.price || 0) > 0).length,
    invoicedServices: published.filter(s => s.collection === 'invoice' && (s.price || 0) > 0).length,
    hasPricedServices: published.some(s => (s.price || 0) > 0),
    /*
     * 'manual' rather than 'automatic', always.
     *
     * Whether the instalments are CHARGED automatically lives on the payment
     * plan, not the service, and the only thing either value decides here is
     * that money moves on a schedule — which both say. Guessing 'automatic'
     * from a service would make a card processor look compulsory for a business
     * that invoices each instalment, which is the mistake this whole module
     * exists to stop making.
     */
    plans: published.some(
      s => s.payment_type === 'installments' && (s.installment_count || 0) >= 2
    )
      ? 'manual'
      : 'none',
  };
}

/** What the profile still gets to say for itself. */
export interface ShapeProfileFacts {
  online_presence_mode?: string | null;
  /** Older business-wide summaries, read only where there are no services yet. */
  payment_mode?: string | null;
  collection_method?: string | null;
}

/**
 * The shape of a business, from its catalogue and the one thing the catalogue
 * cannot answer.
 *
 * Being findable online is a genuine preference — nothing in the services says
 * whether the owner wants a website — so it stays a stored answer. Everything
 * else is counted.
 */
export function shapeFromServices(
  services: ServiceFacts[],
  profile: ShapeProfileFacts = {}
): BusinessShape {
  const counts = countServices(services);

  return shapeFromProfile({
    payment_mode: profile.payment_mode ?? null,
    collection_method: profile.collection_method ?? null,
    online_presence_mode: profile.online_presence_mode ?? null,
    hasPricedServices: counts.hasPricedServices,
    plans: counts.plans,
    activeServices: counts.activeServices,
    scheduledServices: counts.scheduledServices,
    onlineServices: counts.onlineServices,
    invoicedServices: counts.invoicedServices,
  });
}

/**
 * The capabilities the shape OWNS — it alone decides these, and a stored row can
 * neither add nor remove one.
 *
 * Anything outside this list (channel insights, integrations, campaigns) is a
 * question the catalogue cannot answer, and those stay exactly as they are
 * stored.
 */
export const SHAPE_OWNED_CAPABILITIES = [
  'crm',
  'scheduling',
  'payments',
  'website',
  'reports',
  'insights',
] as const;

/**
 * Which capabilities this business has, derived.
 *
 * `!== false` everywhere rather than `=== true`: a null means the shape cannot
 * tell yet — a brand-new account with no services — and an account in that state
 * should see everything rather than a navigation bar cut down to two tabs while
 * it is still being set up.
 *
 *   crm         ALWAYS. Not a choice: six tables carry a NOT NULL foreign key to
 *               `crm_contacts`, so a booking cannot exist without a contact. It
 *               was never optional, and offering it as one was a lie.
 *   scheduling  some published service is booked against a time.
 *   payments    money moves at all — by card, by invoice, or on a plan. NOT
 *               `collectsOnline`: a business that invoices for everything still
 *               has orders to look at, and needs the tab that shows them.
 *   website     they did not say they want no online presence.
 *   reports     ALWAYS. A business without Stripe still gets to see its numbers.
 *   insights    ALWAYS, and for the same reason.
 */
export function capabilityKeysFromShape(shape: BusinessShape): string[] {
  const keys: string[] = ['crm', 'reports', 'insights'];

  if (shapeTakesAppointments(shape) !== false) keys.push('scheduling');
  if (shapeMoneyMoves(shape) !== false) keys.push('payments');
  if (shape.presence !== 'none') keys.push('website');

  return keys;
}

/** The settings dialog's tabs, by key. */
export type ConfigTabKey =
  | 'business'
  | 'services'
  | 'availability'
  | 'intake'
  | 'payments'
  | 'invoice';

const ALL_CONFIG_TABS: ConfigTabKey[] = [
  'business',
  'services',
  'availability',
  'intake',
  'payments',
  'invoice',
];

export interface ConfigTabContext {
  /**
   * A Stripe account exists on this business, connected or half-connected.
   *
   * Keeps the payments tab reachable for a business that connected Stripe and
   * has since moved its whole catalogue onto invoices. Without it the tab
   * carrying the disconnect button would vanish the moment it became the one
   * thing they wanted to use it for.
   */
  hasProcessorAccount?: boolean;
}

/**
 * Which tabs this business has any use for.
 *
 * The two rules that matter are the ones the readiness card has always used, so
 * the card and the dialog can no longer disagree: a card processor is for a
 * business that takes cards, and invoice details are for one whose money moves.
 *
 *   business      always — its name, trade and public contact details.
 *   services      always — the catalogue holds products as well as appointments,
 *                 and it is the one place the shape itself is edited.
 *   availability  some service is booked against a time.
 *   intake        likewise: a form is something a client fills in BEFORE a
 *                 meeting, so a business with no meetings has nothing to ask
 *                 for. Deliberately not gated on intake being switched ON —
 *                 this tab is where it is switched on, and a gate on its own
 *                 setting is a door locked from the inside.
 *   payments      cards are taken at booking, or an account already exists.
 *   invoice       money moves at all.
 */
export function configTabsForShape(
  shape: BusinessShape,
  context: ConfigTabContext = {}
): ConfigTabKey[] {
  const appointments = shapeTakesAppointments(shape) !== false;

  const applies: Record<ConfigTabKey, boolean> = {
    business: true,
    services: true,
    availability: appointments,
    intake: appointments,
    payments: shapeCollectsOnline(shape) !== false || context.hasProcessorAccount === true,
    invoice: shapeMoneyMoves(shape) !== false,
  };

  return ALL_CONFIG_TABS.filter(tab => applies[tab]);
}
