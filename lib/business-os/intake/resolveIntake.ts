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
 * TWO AUDIENCES, TWO ANSWERS.
 *
 * `forClient: true` is for anything that happens TO a client — the automatic
 * email after booking, the journey strip promising them a form. It additionally
 * requires the business to have asked us to send it.
 *
 * The default is for anything the OWNER does — pressing Send on a booking,
 * filling the answers in themselves. A business that sends by hand should be
 * able to; that distinction is why there are two predicates rather than one.
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
  { forClient = false }: { forClient?: boolean } = {}
): Promise<ResolvedIntake> {
  const [settings, published] = await Promise.all([
    intakeRepository.getSettings(userId),
    intakeFormRepository.getPublished(userId),
  ]);

  const reach = {
    is_enabled: settings.data?.is_enabled ?? false,
    send_after_booking: settings.data?.send_after_booking ?? false,
    hasPublishedForm: !!published.data,
  };

  const blocked = intakeBlockReason(reach, { forClient });

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
    case 'not_automatic':
      return 'intake.blocked.not_automatic';
  }
}
