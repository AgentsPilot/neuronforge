/**
 * Does a client actually receive an intake form?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three things have to be true, and every surface that draws a journey was
 * asking only the first:
 *
 *   is_enabled          the business collects intake at all
 *   send_after_booking  the form is emailed once a booking is confirmed
 *   hasPublishedForm    there is a form, and the owner has approved it
 *
 * Reading `is_enabled` alone put "intake form" on the end of every service's
 * journey strip for a business whose email toggle was off — describing a step
 * the client would never see. And the state that started all of this,
 * `is_enabled: true` with no form, drew the same promise while sending nothing.
 *
 * The journey strip is a picture of what happens to a client. So the question it
 * asks has to be "does a form reach them", not "is a setting on".
 *
 * WHY THE THIRD CONDITION IS PUBLISHED AND NOT MERELY PRESENT.
 *
 * A form is generated for the business before anyone has read it. Between
 * generation and approval it holds questions the owner has never seen, written
 * by a model from a business description — plausible, and not theirs. Sending
 * that to a client is worse than sending nothing, because the owner finds out
 * from the client. So the gate is the owner's approval, not the row's existence.
 *
 * The two predicates below are the only place that rule is written. Every
 * surface inherits it by asking one of them; nothing reads `is_enabled`
 * directly. That was the previous arrangement's real defect — three different
 * answers to one question, so the rule held in some places and not others.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/intakeReach
 */

export interface IntakeReachInput {
  is_enabled?: boolean | null;
  send_after_booking?: boolean | null;
  /**
   * Whether a PUBLISHED form exists — resolved by the caller from
   * `intakeFormRepository.getPublished`, never inferred from a settings row.
   *
   * A draft does not count and a generated-but-unapproved form does not count.
   */
  hasPublishedForm?: boolean | null;
}

/**
 * Use this for anything that promises the CLIENT something: the journey strip,
 * the confirmation email's mention of a form, the automatic send after booking.
 */
export function intakeReachesClient(settings: IntakeReachInput | null | undefined): boolean {
  if (!settings) return false;

  return (
    settings.is_enabled === true &&
    settings.send_after_booking === true &&
    settings.hasPublishedForm === true
  );
}

/**
 * Does the business collect intake at all?
 *
 * Deliberately does NOT ask whether the form is emailed automatically. That is
 * a separate decision — "send it for me" versus "I will send it myself" — and
 * conflating the two is what left the owner unable to send a form by hand.
 *
 * It DOES ask whether a form is published, because sending by hand still sends
 * the same unapproved questions to the same real client.
 *
 * Use this for anything the OWNER can do: showing the intake step on a booking,
 * offering "Send intake form", letting them fill the answers in themselves.
 * Use `intakeReachesClient` for anything that promises the CLIENT something.
 */
export function businessCollectsIntake(settings: IntakeReachInput | null | undefined): boolean {
  if (!settings) return false;
  return settings.is_enabled === true && settings.hasPublishedForm === true;
}

/**
 * Why the intake cannot be sent, for a message the owner can act on.
 *
 * "Nothing happened" is what every one of these used to look like from the
 * outside. A business that has generated a form and not published it is one
 * click from working, and deserves to be told that rather than told no.
 */
export type IntakeBlockReason = 'disabled' | 'not_published' | 'not_automatic';

export function intakeBlockReason(
  settings: IntakeReachInput | null | undefined,
  { forClient = false }: { forClient?: boolean } = {}
): IntakeBlockReason | null {
  if (!settings || settings.is_enabled !== true) return 'disabled';
  if (settings.hasPublishedForm !== true) return 'not_published';
  if (forClient && settings.send_after_booking !== true) return 'not_automatic';
  return null;
}
