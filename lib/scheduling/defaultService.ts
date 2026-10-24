/**
 * Which service a new booking starts on: only one the CALLER named.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A NEW BOOKING STARTS ON NONE
 *
 * The dialog opened on `activeServices[0]` — the first row of an alphabetical
 * list — and that is a guess presented as an answer. With every section
 * expanded it was at least a VISIBLE guess: the picker sat right there showing
 * what had been chosen for you. Now that an answered step collapses to a line,
 * the same guess reads as a decision the owner made, and the picker that would
 * have corrected it is closed.
 *
 * The price and duration on that line belong to whichever service sorted
 * first, so an owner skimming the dialog and pressing Save books the wrong
 * thing at the wrong price, and nothing on screen ever asked them.
 *
 * So the rule is: a new booking has no service until somebody chooses one.
 *
 *   · the caller named one   — the drawer opening a known service, a package
 *                              slot, a smart link
 *   · otherwise              — undefined, and step 1 asks
 *
 * Not even "there is only one active service, so fill it in": that is still
 * the dialog answering its own first question, and a business with one service
 * today has two tomorrow. `undefined` is a deliberate, load-bearing value — it
 * is what makes the dialog open on its first question instead of on a default.
 */

interface ServiceLike {
  id: string;
  status?: string | null;
}

/**
 * @param services   every service the dialog was handed, active or not
 * @param namedId    the caller's own choice, where it named one
 */
export function defaultServiceFor<T extends ServiceLike>(
  services: T[],
  namedId?: string | null
): T | undefined {
  if (!namedId) return undefined;

  /*
   * Searched across ALL of them, not only the active ones: a caller may name a
   * service since retired, and opening a booking taken on it must still show
   * that service rather than silently showing another.
   */
  return services.find(service => service.id === namedId);
}
