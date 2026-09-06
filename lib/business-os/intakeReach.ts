/**
 * Does a client actually receive an intake form?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three things have to be true, and every surface that draws a journey was
 * asking only the first:
 *
 *   is_enabled          the business collects intake at all
 *   send_after_booking  the form is emailed once a booking is confirmed
 *   template_id         there is a form to send
 *
 * Reading `is_enabled` alone put "intake form" on the end of every service's
 * journey strip for a business whose email toggle was off — describing a step
 * the client would never see. And the state that started all of this,
 * `is_enabled: true` with no template, drew the same promise while sending
 * nothing at all.
 *
 * The journey strip is a picture of what happens to a client. So the question it
 * asks has to be "does a form reach them", not "is a setting on".
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/intakeReach
 */

export interface IntakeReachInput {
  is_enabled?: boolean | null;
  send_after_booking?: boolean | null;
  template_id?: string | null;
}

export function intakeReachesClient(settings: IntakeReachInput | null | undefined): boolean {
  if (!settings) return false;

  return (
    settings.is_enabled === true &&
    settings.send_after_booking === true &&
    !!settings.template_id
  );
}

/**
 * Does the business collect intake at all?
 *
 * Deliberately does NOT ask whether the form is emailed automatically. That is
 * a separate decision — "send it for me" versus "I will send it myself" — and
 * conflating the two is what left the owner unable to send a form by hand.
 *
 * Use this for anything the OWNER can do: showing the intake step on a booking,
 * offering "Send intake form", letting them fill the answers in themselves.
 * Use `intakeReachesClient` for anything that promises the CLIENT something.
 */
export function businessCollectsIntake(settings: IntakeReachInput | null | undefined): boolean {
  if (!settings) return false;
  return settings.is_enabled === true && !!settings.template_id;
}
