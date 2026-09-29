/**
 * How a client cancellation is written into `cancellation_reason`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONLY RECORD OF WHO CANCELLED.
 *
 * There is no column for it, so this prefix is what separates "the client could
 * not make it" from "the business called it off" — and two surfaces read it to
 * decide what to say: the `booking_cancelled` gap, which stays quiet about an
 * owner's own cancellation, and the unrefunded-money detector, which does not,
 * because a client is owed either way.
 *
 * Shared so every reader matches the SAME string the cancel route writes. It
 * was two literals in two files for one turn and they already disagreed: the
 * route wrote "Client cancelled: …" where the query looked for "Cancelled by
 * client", so every cancellation that came with a reason — the ones a client
 * bothered to explain — would have been silently invisible.
 *
 * ITS OWN MODULE, rather than living on `BookingLifecycleService`.
 *
 * Two constants and a template string have no dependencies, and the service
 * that used to hold them pulls in the email transport, the calendar sync and
 * the payment settlement path. Importing them from an insight detector dragged
 * all of that into a cron that only wanted to compare a prefix — one test file
 * took twenty-five seconds and left a handle open. The service re-exports both
 * names, so nothing that imports them today has to change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const CLIENT_CANCELLED_PREFIX = 'Cancelled by client';

/** The reason text for a client cancellation, with whatever they said. */
export function clientCancellationReason(reason?: string | null): string {
  return reason ? `${CLIENT_CANCELLED_PREFIX}: ${reason}` : CLIENT_CANCELLED_PREFIX;
}

/**
 * Split a stored cancellation reason into "was it the client" and what they said.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A DISPLAY CONCERN AND NOT A TRANSLATION ONE
 *
 * `CLIENT_CANCELLED_PREFIX` is stored English, and it must stay stored English:
 * the `booking_cancelled` gap matches it with `.ilike('Cancelled by client%')`
 * and `CashCancelledUnrefundedDetector` with `.startsWith`. Writing it in the
 * client's language would silently break both — and every row already stored
 * carries the English.
 *
 * So it is translated where it is READ. This splits the stored string; the
 * caller supplies the label in whatever language its reader speaks, and keeps
 * the note exactly as it was typed.
 *
 * A Hebrew-speaking client was being emailed "Cancelled by client: ..." and a
 * Hebrew-speaking owner saw the same English on the booking badge, because the
 * prose was rendered raw in both places.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function splitClientCancellationReason(
  stored: string | null | undefined
): { byClient: boolean; note: string | null } {
  if (!stored) return { byClient: false, note: null };

  if (!stored.startsWith(CLIENT_CANCELLED_PREFIX)) {
    // Somebody else's wording — the owner's own note. Passed through untouched.
    return { byClient: false, note: stored };
  }

  /*
   * `clientCancellationReason` joins with ': ', so the remainder starts at the
   * prefix length. Trimmed of that separator only — never of the note's own
   * punctuation, which is the client's writing.
   */
  const rest = stored.slice(CLIENT_CANCELLED_PREFIX.length).replace(/^:\s*/, '');
  return { byClient: true, note: rest.length > 0 ? rest : null };
}
