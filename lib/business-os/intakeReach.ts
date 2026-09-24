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
  /**
   * Kept on the row and no longer a gate.
   *
   * It used to be required before a client could be emailed a form, which made
   * "I collect intake" and "send it for me" two switches where the owner only
   * ever meant one. A business that turns intake ON means clients should
   * receive it; the exceptions are about the SERVICE, not about a preference —
   * see `intakeAppliesToService`.
   *
   * The column defaults to false, so every account that never found the second
   * switch had its automatic sends silently off.
   */
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

  return settings.is_enabled === true && settings.hasPublishedForm === true;
}

/**
 * Does this particular service ask its client anything?
 *
 * Intake is for work that is about to happen with a person. Two kinds of
 * booking are not that, and sending a form for either is a question with no
 * occasion behind it:
 *
 *   a QUOTE REQUEST — nothing has been agreed. The next thing the client should
 *     receive is a price, not a questionnaire.
 *   a PRODUCT — bought outright, with no appointment to prepare for.
 *
 * Everything else gets the form: a paid session, a free consultation, a course
 * with a date. The owner switched intake on; this is what they meant by it.
 */
export function intakeAppliesToService(
  service: { sale_mode?: string | null; is_scheduled?: boolean | null } | null | undefined
): boolean {
  if (!service) return true;
  if (service.sale_mode === 'proposal') return false;
  if (service.is_scheduled === false) return false;
  return true;
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
export type IntakeBlockReason = 'disabled' | 'not_published' | 'not_applicable';

export function intakeBlockReason(
  settings: IntakeReachInput | null | undefined,
  /*
   * `forClient` USED TO BE ACCEPTED HERE AND WAS NEVER READ.
   *
   * It stayed in the signature after `send_after_booking` stopped being a gate,
   * so four call sites passed it believing it narrowed the answer — and one of
   * them documented behaviour it no longer had. A parameter that is accepted
   * and ignored is worse than none: it reads as a decision being made.
   *
   * Audience is no longer a factor. Whether a form may be sent depends on the
   * business having one published and enabled, and on the SERVICE having an
   * occasion for it. Neither of those changes with who pressed send.
   */
  {
    service,
  }: { service?: { sale_mode?: string | null; is_scheduled?: boolean | null } | null } = {}
): IntakeBlockReason | null {
  if (!settings || settings.is_enabled !== true) return 'disabled';
  if (settings.hasPublishedForm !== true) return 'not_published';
  if (service !== undefined && !intakeAppliesToService(service)) return 'not_applicable';
  return null;
}
