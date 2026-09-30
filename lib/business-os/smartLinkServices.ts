/**
 * Which services a booking link offers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE: a link follows the catalogue.
 *
 * A smart link is made once and lives for months on a bio page, a WhatsApp
 * message, a printed card. The catalogue behind it does not hold still: prices
 * change, services are added, services are retired. So the only correct default
 * for a service the business sells today is that the link sells it too.
 *
 * That is not how links were written. The wizard enumerated the chosen services
 * into the URL, which froze the catalogue on the day the link was made. A real
 * one on the account where this was found pinned five ids: two named services
 * that no longer existed, and the newest service — added weeks later — was not
 * among them and could never appear. The link was NAMED "5 services" and served
 * three.
 *
 * So the question a link answers is "what do I leave OFF", never "what do I
 * include". Exclusions are stable: they name something that exists, and a
 * service nobody has excluded is on the link by default, whenever it was made.
 *
 * `services=` is still read, because links written the old way are out there
 * and have to keep working. It narrows, and two rules keep it from becoming a
 * dead end: an id that no longer resolves is dropped, and if NOTHING resolves
 * the whole catalogue is shown rather than an empty page.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/smartLinkServices
 */

/** Just the id — the caller keeps whatever else its own rows carry. */
export interface LinkService {
  id: string;
}

export interface LinkServiceParams {
  /** `exclude=` — the services this link leaves off. How links are written now. */
  excludeParam?: string | null;
  /** `services=` — the frozen inclusion list. Legacy links only. */
  servicesParam?: string | null;
}

/** A comma-separated id list from a URL, as a set. Blanks and spaces survive it. */
function idSet(param: string | null | undefined): Set<string> {
  return new Set(
    (param ?? '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
  );
}

export function servicesForLink<T extends LinkService>(
  services: T[],
  { excludeParam, servicesParam }: LinkServiceParams
): T[] {
  const excluded = idSet(excludeParam);
  if (excluded.size > 0) {
    return services.filter(service => !excluded.has(service.id));
  }

  const pinnedIds = idSet(servicesParam);
  if (pinnedIds.size === 0) return services;

  const pinned = services.filter(service => pinnedIds.has(service.id));

  /*
   * Every pinned service is gone. Showing the whole catalogue is the lesser
   * wrong: an empty booking page tells the visitor nothing and tells the
   * business nothing either, and the link goes on being shared.
   */
  return pinned.length > 0 ? pinned : services;
}
