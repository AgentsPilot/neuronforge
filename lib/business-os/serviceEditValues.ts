/**
 * The money shape of a service, as an editor should load it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This exists because the inline row editor did not do it. It hardcoded
 * `is_scheduled: true` and `collection: 'invoice'` when opening a row, and the
 * save wrote those values straight back — so editing a service's NAME turned a
 * card-collected service into an invoiced one, and turned a product into an
 * appointment. Nothing announced it; the owner changed a duration and their
 * payment configuration quietly changed underneath them.
 *
 * The intent was a fallback for rows that predate these columns. A fallback and
 * an override look almost identical in a literal object, and only one of them is
 * safe, so the rule now lives in a function that can be tested rather than in
 * two object literals that cannot.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** What the editor needs to know about a service's shape. */
export interface ServiceShapeSource {
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
  sale_mode?: 'direct' | 'proposal' | null;
  price?: number | null;
}

export interface ServiceShapeValues {
  is_scheduled: boolean;
  collection: 'online' | 'invoice';
  sale_mode: 'direct' | 'proposal';
}

/**
 * How an editor should be populated from an existing service.
 *
 * Stored values always win. The fallbacks apply only to a row that has never
 * carried these columns:
 *
 * - `is_scheduled` defaults to an appointment, which is what every row was
 *   before products existed.
 * - `collection` defaults to `invoice`, never `online` — assuming a business
 *   collects by card commits it to connecting a processor, and being wrong in
 *   that direction puts a card form in front of a client the business cannot
 *   charge. Wrong in the other direction merely bills them.
 */
export function serviceShapeValues(service: ServiceShapeSource): ServiceShapeValues {
  return {
    // `!== false` rather than `?? true`: both null and undefined mean "never
    // said", and only an explicit false makes it a product.
    is_scheduled: service.is_scheduled !== false,
    collection: service.collection ?? 'invoice',
    /*
     * Direct unless the row says otherwise — the same "stored value wins,
     * fallback only for rows that predate the column" rule as the two above.
     *
     * The fallback direction matters for the same reason `collection` defaults
     * to invoice: assuming a service is quoted would strip its price and its
     * payment step from every public surface, which is a far louder wrong than
     * leaving a quoted service looking buyable until its owner says so.
     */
    sale_mode: service.sale_mode ?? 'direct',
  };
}

/**
 * What to persist for `collection`, given the price in the editor.
 *
 * A free service collects nothing, so it carries no collection method — the
 * column is nullable for exactly that. Keeping a stale `'online'` on a service
 * whose price was just cleared would make it count towards "this business needs
 * a payment processor".
 */
export function collectionToPersist(
  collection: 'online' | 'invoice',
  price: number | null | undefined
): 'online' | 'invoice' | null {
  return (price ?? 0) > 0 ? collection : null;
}
