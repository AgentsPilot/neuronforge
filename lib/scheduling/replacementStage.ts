/**
 * Whether a replacement session will be billed, decided once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A MODULE AND NOT A CONDITION IN THE ROUTE
 *
 * The answer is needed in two places that must not disagree:
 *
 *   · the POST that adds the session, which acts on it
 *   · the GET the cancel dialog opens with, which has to SAY what will happen
 *
 * Until now only the POST knew. The dialog listed three consequences — the hour
 * goes back in the diary, the client is emailed, a replacement is booked — and
 * said nothing about money, so an owner cancelling a paid-for session could not
 * tell whether its replacement would be charged for, given away, or whether the
 * fee they had already collected simply moved across. Reported as "when
 * cancelling it doesn't add the session with payment?", which is a question the
 * screen should never have left anybody holding.
 *
 * Writing the rule out a second time in the GET would be the obvious way to
 * answer it, and would eventually produce a dialog that promises one thing
 * while the write does another. So the rule lives here and both ask it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES NOT DO
 *
 * It does not create the stage. The POST still builds that row — its number,
 * its label, the plan total that follows it — because that is writing, not
 * deciding, and moving it would be a refactor of a money path for no gain. This
 * returns the stage the new one is modelled on so the POST needs no second read.
 *
 * @module lib/scheduling/replacementStage
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { replacedHourAlreadyPaid, type ReplacedHourVerdict } from '@/lib/scheduling/replacementCharge';

/** Why a replacement carries no stage. `bills` is the only affirmative. */
export type ReplacementStageReason =
  /** It carries one. */
  | 'bills'
  /** An upfront block: one agreed sum, already paid. Billing again is a sale. */
  | 'upfront'
  /** An hour up the chain holds the money for this one. */
  | 'already_paid'
  /** No payment plan behind the package, so there is nothing to add a stage to. */
  | 'no_plan'
  /** The plan's stages carry no amount to model a new one on. */
  | 'no_amount';

export interface ReplacementStageOutlook {
  /** The replacement will carry a stage of its own. */
  bills: boolean;
  reason: ReplacementStageReason;
  /** What it will be billed, where it will be. */
  amount: number | null;
  currency: string | null;
  /** Present only for `already_paid`, and carries which hour holds the money. */
  alreadyPaid: ReplacedHourVerdict | null;
  /**
   * The newest stage on the plan, which the POST models the new one on — its
   * number, its label, its currency. Returned so the decision and the write
   * read the row once between them.
   */
  lastStage: {
    amount: number | null;
    currency: string | null;
    installment_number: number | null;
    label: string | null;
  } | null;
}

/**
 * Will the replacement for this hour be billed?
 *
 * The caller is assumed to WANT to charge — that is what the owner's dialog
 * sends for a per-session block. Everything below is a reason it cannot or must
 * not, in the order the POST applies them, which is the order that matters:
 * `already_paid` is answered before the plan is looked at, so an hour whose
 * money is already in never depends on a plan read succeeding.
 */
export async function replacementStageOutlook(args: {
  userId: string;
  /** `proposals.sessions.bill_per_session`. */
  perSession: boolean;
  /** `proposals.created_plan_id`. */
  planId: string | null | undefined;
  /** The hour being replaced. Null where this is an extra session, not a swap. */
  replacedMeetingId: string | null;
  /** The package's own currency, used only when no stage names one. */
  fallbackCurrency?: string | null;
  /** Injectable for tests; the service-role client by default. */
  client?: typeof supabaseServer;
}): Promise<ReplacementStageOutlook> {
  const db = args.client ?? supabaseServer;

  const none = (
    reason: ReplacementStageReason,
    extra: Partial<ReplacementStageOutlook> = {}
  ): ReplacementStageOutlook => ({
    bills: false,
    reason,
    amount: null,
    currency: null,
    alreadyPaid: null,
    lastStage: null,
    ...extra,
  });

  /* The money is already in and the portion moves across. The POST refuses a
     charge against one of these outright. */
  if (!args.perSession) return none('upfront');

  if (args.replacedMeetingId) {
    const verdict = await replacedHourAlreadyPaid({
      userId: args.userId,
      replacedMeetingId: args.replacedMeetingId,
      client: db,
    });

    if (verdict.alreadyPaid) return none('already_paid', { alreadyPaid: verdict });
  }

  if (!args.planId) return none('no_plan');

  const { data: existing } = await db
    .from('payment_plan_installments')
    .select('amount, currency, installment_number, label')
    .eq('payment_plan_id', args.planId)
    .eq('user_id', args.userId)
    .order('installment_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastStage = existing
    ? {
        amount: existing.amount === null || existing.amount === undefined ? null : Number(existing.amount),
        currency: (existing.currency as string | null) ?? null,
        installment_number:
          existing.installment_number === null || existing.installment_number === undefined
            ? null
            : Number(existing.installment_number),
        label: (existing.label as string | null) ?? null,
      }
    : null;

  const amount = Number(existing?.amount ?? 0);

  /* `> 0` and not merely present: a stage of zero would bill nothing while
     telling the owner it had, which is the half-truth this exists to remove. */
  if (!(amount > 0)) return none('no_amount', { lastStage });

  return {
    bills: true,
    reason: 'bills',
    amount,
    currency: lastStage?.currency ?? args.fallbackCurrency ?? 'USD',
    alreadyPaid: null,
    lastStage,
  };
}
