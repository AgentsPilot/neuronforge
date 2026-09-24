/**
 * May we send this business's intake, and what is in it?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ANSWER, ONE PLACE.
 *
 * The arrangement this replaces had three: `intakeReachesClient`,
 * `businessCollectsIntake`, and a bare `is_enabled` read in two surfaces that
 * never heard about either. Predicates alone were not enough, because each
 * caller still had to fetch the settings, fetch the form, and remember to
 * combine them the same way — and the resolver they used for that was marked
 * deprecated while remaining the only one the public surfaces called.
 *
 * So this function does the fetching too. A caller asks one question and gets
 * back the form, the reason it cannot be sent, or both.
 *
 * ONE ANSWER, WHOEVER IS ASKING.
 *
 * This said there were two: that `forClient: true` "additionally requires the
 * business to have asked us to send it", and that the default was the laxer
 * answer for the owner. Neither has been true since `send_after_booking`
 * stopped being a gate — `intakeReachesClient` and `businessCollectsIntake`
 * now resolve to the same pair of conditions, and `intakeBlockReason` never
 * read the flag at all. The parameter was accepted and ignored.
 *
 * A comment describing removed behaviour is not merely stale, it is an
 * instruction: the next reader restores the gate to make the code match, and
 * the bug the removal fixed comes back — `send_after_booking` defaults to
 * false, so every account that never found that switch had its automatic sends
 * silently off.
 *
 * What DOES still vary is the occasion, and that is a fact about the SERVICE,
 * not about the audience: a quote request and a product have nothing to
 * prepare for. See `intakeAppliesToService`.
 *
 * WHEN a form is sent still differs — automatically for a booking a client
 * makes, and on the owner's say-so for one they enter themselves, which is what
 * the toggle in the booking dialog decides. That is a question of trigger, not
 * of permission, and it is answered by the caller rather than here.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/intake/resolveIntake
 */

import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { intakeFormRepository } from '@/lib/repositories/IntakeFormRepository';
import { intakeBlockReason, type IntakeBlockReason } from '@/lib/business-os/intakeReach';
import type { IntakeForm } from './types';

export interface ResolvedIntake {
  /** The published form, or null when there is nothing sendable. */
  form: IntakeForm | null;
  /** Why not, or null when nothing is in the way. */
  blocked: IntakeBlockReason | null;
}

export async function resolveIntakeForSending(
  userId: string,
  {
    service,
  }: {
    /**
     * The service being booked, when the caller knows it.
     *
     * Some bookings have no occasion for a form — a quote request, a product —
     * and that is a fact about the SERVICE, not about the business's settings.
     * Omitted, the question is not asked and only the settings decide.
     */
    service?: { sale_mode?: string | null; is_scheduled?: boolean | null } | null;
  } = {}
): Promise<ResolvedIntake> {
  const [settings, published] = await Promise.all([
    intakeRepository.getSettings(userId),
    intakeFormRepository.getPublished(userId),
  ]);

  const reach = {
    is_enabled: settings.data?.is_enabled ?? false,
    hasPublishedForm: !!published.data,
  };

  const blocked = intakeBlockReason(reach, { service });

  // The form is withheld when anything blocks it, rather than returned with a
  // flag beside it. A caller holding the questions is one `if` away from
  // sending them, and this is the boundary where that mistake is cheap to
  // prevent and expensive to make.
  return { form: blocked ? null : published.data, blocked };
}

/**
 * A message for the owner, in their language, saying what to do about it.
 *
 * Returned as a translation key rather than a sentence: this runs server-side,
 * where the reader's language is not always known, and every caller already has
 * a `t`.
 */
export function intakeBlockMessageKey(reason: IntakeBlockReason): string {
  switch (reason) {
    case 'disabled':
      return 'intake.blocked.disabled';
    case 'not_published':
      return 'intake.blocked.not_published';
    case 'not_applicable':
      return 'intake.blocked.not_applicable';
  }
}
