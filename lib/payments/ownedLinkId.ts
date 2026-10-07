/**
 * Vetting a link id that arrived from someone else.
 *
 * The Stripe webhook is handed row ids (`booking_id`, `service_id`,
 * `payment_plan_id`, …) in metadata written by a connected account. A row id is
 * only safe to store once it is proved to belong to the business the event was
 * signed for, because later service-role writes and an unscoped trigger follow
 * whatever id is stored. This is the one place that rule lives, so the route
 * and `bindPlanSubscription` cannot drift apart.
 *
 * No logging and no I/O of its own: the ownership read is passed in (a
 * repository `findOwnedId`), and each caller writes its own log line from the
 * returned `reason`.
 *
 * @module lib/payments/ownedLinkId
 */

/**
 * The canonical form our own code writes: 8-4-4-4-12 hex, either case.
 *
 * Deliberately narrower than what Postgres accepts (braces, no hyphens). No
 * legitimate path produces those, and nothing is trimmed: untrusted input is
 * never "repaired" into an id.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShaped(value: string): boolean {
  return UUID_SHAPE.test(value);
}

/** Why a link was dropped. `null` when it was kept or simply absent. */
export type LinkDropReason = 'malformed' | 'not_owned' | 'read_failed';

export interface VettedLink {
  /** The id the repository returned when owned, else null. */
  id: string | null;
  reason: LinkDropReason | null;
}

/**
 * Keep `rawId` only if `ownerId` owns the row it names.
 *
 * - absent / empty → `{ null, null }`, nothing read
 * - not UUID-shaped → `{ null, 'malformed' }`, nothing read (it cannot name a
 *   row, and reading it would only put the raw value in an error log)
 * - not owned → `{ null, 'not_owned' }`
 * - read error → `{ null, 'read_failed' }` (fails closed)
 */
export async function vetLinkId(
  rawId: string | null | undefined,
  ownerId: string,
  findOwnedId: (id: string, userId: string) => Promise<{ data: string | null; error: Error | null }>
): Promise<VettedLink> {
  if (!rawId) return { id: null, reason: null };
  if (!isUuidShaped(rawId)) return { id: null, reason: 'malformed' };

  const { data, error } = await findOwnedId(rawId, ownerId);
  if (data) return { id: data, reason: null };

  return { id: null, reason: error ? 'read_failed' : 'not_owned' };
}
