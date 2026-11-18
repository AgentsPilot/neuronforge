/**
 * What THIS service needs before a client can complete it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SERVICE IS THE SPINE.
 *
 * Every requirement in this product is a consequence of something a business
 * sells. Working hours exist because a service holds a time. A card processor
 * exists because a service takes a card. Invoice details exist because a
 * service bills. None of them is a property of the business in the abstract,
 * and asking for them up front — during onboarding, in a settings screen, as a
 * checklist — asks an owner to sequence a dependency graph in their head.
 *
 * So the question is asked of the service, at the moment its own attributes
 * create the need, in the editor where that choice is made.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS DECIDES NOTHING. IT MIRRORS DECISIONS MADE ELSEWHERE.
 *
 * Three gates already refuse a service that is short of these, and they stay
 * the authority:
 *
 *   `app/api/scheduling/services/[id]/publish/route.ts`
 *       `duration_required` for a scheduled service with no length,
 *       `processor_required` for a priced card service with no processor,
 *       and `not_ready` for the blocking journey gaps.
 *   `lib/business-os/journeyReadiness.ts`
 *       which of those gaps BLOCK — hours, timezone and invoicing do;
 *       the processor deliberately does not, because a card service with no
 *       Stripe falls back to an invoice and goes on trading.
 *   `lib/business-os/setup/setupGraph.ts`
 *       `applies` and `mandatory` per step, for the whole business.
 *
 * What this adds is the per-service view those three cannot give: not "does
 * this business owe invoice details" but "does THIS service, the one open in
 * the editor, owe them, and why". Every rule below is a restatement of one of
 * theirs, with the source named, so a drift is visible as a disagreement
 * rather than hiding as a second opinion.
 *
 * @module lib/business-os/setup
 */

/** The three things a service can ask of the business behind it. */
export type ServiceRequirementId = 'hours' | 'processor' | 'invoice';

/** Only the columns that decide a requirement. The row carries far more. */
export interface ServiceShape {
  /** A client picks a time for this one. */
  is_scheduled?: boolean | null;
  /** `null` is "not priced yet", `0` is "free". They are different answers. */
  price?: number | string | null;
  /** How the money arrives, once there is any. */
  collection?: 'online' | 'invoice' | null;
  /** `proposal` settles its amount in a quote that has not been written yet. */
  sale_mode?: string | null;
}

/** A quote prices itself later, so an absent price is not "free" for one. */
const isQuoted = (service: ServiceShape): boolean => service.sale_mode === 'proposal';

/**
 * Does money move through this service?
 *
 * The single-service twin of `moneyMoves` in `setupGraph`, which asks the same
 * thing of a whole catalogue. A quote counts: `ProposalAcceptanceService`
 * writes a `payment_invoices` row on acceptance, so acceptance is a bill, and
 * `theGatesDoNotContradict` pins that pairing from the other side.
 *
 * A free service does NOT count, and that is the one shape asking for nothing:
 * hours maybe, money never.
 */
export function serviceCollectsMoney(service: ServiceShape): boolean {
  if (isQuoted(service)) return true;
  return Number(service.price) > 0;
}

/**
 * Everything this service needs, in the order an owner meets the decisions.
 *
 * `hours` first because the appointment question is asked first in the editor,
 * and the money questions follow it.
 */
export function serviceRequirements(service: ServiceShape): ServiceRequirementId[] {
  const needs: ServiceRequirementId[] = [];

  /*
   * A client picks a time, so there has to be a time to pick.
   *
   * `!== false` rather than `=== true`: rows written before the column existed
   * carry null and those WERE appointments. The publish gate reads the same
   * column before demanding a duration.
   */
  if (service.is_scheduled !== false) needs.push('hours');

  if (!serviceCollectsMoney(service)) return needs;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE INVOICE DETAILS FIRST, FOR EVERY SHAPE THAT COLLECTS. INCLUDING CARD.
   *
   * BEFORE the processor, deliberately, and the order is the argument:
   *
   *   with no Stripe, a card service IS invoiced. `journeyReadiness` keeps the
   *   processor gap non-blocking for exactly that reason, and every public
   *   surface trades on it — the client books, the booking stands, and the
   *   money arrives by invoice instead. So the invoice details are what makes
   *   a card service work AT ALL, and the processor is the upgrade on top.
   *
   * Asking for Stripe first would put a five-minute account application in
   * front of the two-minute thing that is actually required, and leave an
   * owner who abandons it with a card service whose fallback cannot issue a
   * document either.
   *
   * This is the rule that surprises people, and it is the graph's own:
   *
   *   `invoicing.applies`    is `moneyMoves` — card, invoice and quote alike
   *   `invoicing.mandatory`  returns true when `isComplete('payments')`, so
   *                          connecting Stripe makes the paperwork compulsory
   *                          rather than optional
   *
   * Two independent reasons, either one sufficient. A card business still
   * issues receipts, and those are built from the same fields. And with no
   * processor connected, every priced service falls back to being invoiced
   * whatever it was set to collect — so the paperwork stops being a preference
   * and becomes the only way the business gets paid.
   *
   * A quote reaches it by the shortest route of all: acceptance raises an
   * invoice, and an invoice with no company name, no tax id and nowhere to
   * send the money is not a document anybody can pay.
   * ───────────────────────────────────────────────────────────────────────────
   */
  needs.push('invoice');

  /*
   * A card cannot be CHARGED without a processor.
   *
   * Only for a direct card sale: a quote carries `collection: null` on purpose
   * — `serviceShapeFields` clears it — because what a quote collects is decided
   * in the quote. Publishing refuses this exact pair with `processor_required`.
   */
  if (!isQuoted(service) && service.collection === 'online') needs.push('processor');

  return needs;
}
