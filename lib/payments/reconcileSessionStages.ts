/**
 * Give every live session of a pay-as-you-go package the stage it is owed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A RECONCILER AND NOT A FIX AT EACH CALL SITE
 *
 * `sessionStages` documents the invariant and what breaking it costs. The
 * reason it kept breaking is that a session can be added or re-outcomed from
 * several places — the package-meetings route, a make-up booking, a
 * replacement booked from the cancel dialog — and each decides for itself
 * whether to write a stage. Measured across the platform, two of four packages
 * had drifted, one of them on a session already HELD: delivered work that
 * nothing could bill.
 *
 * Patching the path that happened to be at fault fixes one of them and leaves
 * the next one to be found by an owner reading a figure that is too small. So
 * the check runs AFTER the change instead, wherever the change came from, and
 * repairs what it finds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT WILL AND WILL NOT DO
 *
 * It CREATES a missing stage. That is additive, it is the agreement the client
 * already made, and its absence is money nobody is counting.
 *
 * It does NOT void an orphaned one. A stage standing against a called-off
 * session is money over-reported, which is a real fault — but voiding is how
 * money disappears, the client may already have been asked for it, and the
 * cancel paths void deliberately with rules of their own. Orphans are reported
 * so somebody can look.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER FATAL
 *
 * Every caller has already done the thing the client cares about: the session
 * exists, the hour is booked, the mail has gone. A stage that failed to write
 * is money not yet billed, which an owner can see and raise. Refusing the
 * booking over it would leave the client with no appointment at all.
 *
 * @module lib/payments/reconcileSessionStages
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { stageDrift, nextStageLabel } from '@/lib/payments/sessionStages';

const logger = createLogger({ module: 'ReconcileSessionStages' });

export interface ReconcileResult {
  /** Stages written for live sessions that had none. */
  created: number;
  /** Stages still standing against a settled session. Reported, never voided. */
  orphaned: number;
  /** False where this is not a per-session package, so nothing applied. */
  applies: boolean;
}

const NOTHING: ReconcileResult = { created: 0, orphaned: 0, applies: false };

/**
 * Bring one package's stages back in step with its sessions.
 *
 * `containerId` is the booking the sessions hang off — the purchase row a
 * quote's acceptance writes, which is what `payment_plan_installments.booking_id`
 * points at for this shape.
 */
export async function reconcileSessionStages(args: {
  userId: string;
  containerId: string;
}): Promise<ReconcileResult> {
  const { userId, containerId } = args;

  try {
    const { data: proposal } = await supabaseServer
      .from('proposals')
      .select('id, title, sessions, created_plan_id, currency')
      .eq('user_id', userId)
      .eq('package_booking_id', containerId)
      .maybeSingle();

    const perSession =
      (proposal?.sessions as { bill_per_session?: boolean } | null)?.bill_per_session === true;

    /* Not a per-session package, or sold without a plan to hang stages on.
       Either way there is no invariant here to keep. */
    if (!proposal || !perSession || !proposal.created_plan_id) return NOTHING;

    const [{ data: sessions }, { data: stages }] = await Promise.all([
      supabaseServer
        .from('scheduling_meetings')
        .select('id, meeting_status, replaces_meeting_id, billable')
        .eq('booking_id', containerId)
        .eq('user_id', userId),
      supabaseServer
        .from('payment_plan_installments')
        .select('id, meeting_id, status, invoice_id, amount, currency, installment_number, label, contact_id')
        .eq('payment_plan_id', proposal.created_plan_id)
        .eq('user_id', userId)
        .order('installment_number', { ascending: true }),
    ]);

    const drift = stageDrift(
      (sessions ?? []).map(row => ({
        id: String(row.id),
        meetingStatus: row.meeting_status as string | null,
        /* So a make-up of an hour already paid for is not handed a second
           charge — see "PAID UP THE CHAIN" in `stageDrift`. */
        replacesMeetingId: (row.replaces_meeting_id as string | null) ?? null,
        /* The owner's answer outranks every inference — see `owed`. */
        billable: typeof row.billable === 'boolean' ? row.billable : null,
      })),
      (stages ?? []).map(row => ({
        id: String(row.id),
        meetingId: (row.meeting_id as string | null) ?? null,
        status: String(row.status),
        invoiceId: (row.invoice_id as string | null) ?? null,
      }))
    );

    if (drift.orphaned.length) {
      /* Said out loud and left alone — see the note at the top. */
      logger.warn(
        { userId, containerId, orphaned: drift.orphaned.map(stage => stage.id) },
        'Stages still standing against a settled session'
      );
    }

    if (!drift.missing.length) {
      return { created: 0, orphaned: drift.orphaned.length, applies: true };
    }

    /*
     * The newest stage is the model: its amount is what a session of this
     * package costs, its currency is what the client agreed to pay in, and its
     * label carries the owner's own naming.
     *
     * No stages at all means nothing to model on, and inventing a price here
     * would be this module deciding what a session costs — which belongs to
     * the quote. Reported rather than guessed.
     */
    const model = (stages ?? [])[(stages ?? []).length - 1];

    if (!model) {
      logger.warn(
        { userId, containerId, missing: drift.missing.length },
        'Sessions have no stage and the plan has none to model one on'
      );
      return { created: 0, orphaned: drift.orphaned.length, applies: true };
    }

    let number = Number(model.installment_number ?? 0);
    const rows = drift.missing.map(session => {
      number += 1;

      return {
        user_id: userId,
        payment_plan_id: proposal.created_plan_id,
        contact_id: model.contact_id,
        proposal_id: proposal.id,
        booking_id: containerId,
        meeting_id: session.id,
        installment_number: number,
        amount: Number(model.amount ?? 0),
        currency: String(model.currency ?? proposal.currency ?? 'USD'),
        label: nextStageLabel(
          (model.label as string | null) ?? null,
          number,
          String(proposal.title ?? '')
        ),
        /* `manual`, like every other per-session stage: it becomes billable
           when the owner says the session happened, never on a date. */
        trigger: 'manual',
        due_date: null,
        status: 'pending',
      };
    });

    const { error } = await supabaseServer.from('payment_plan_installments').insert(rows);

    if (error) {
      logger.error({ err: error, userId, containerId }, 'Could not write the missing session stages');
      return { created: 0, orphaned: drift.orphaned.length, applies: true };
    }

    logger.info(
      { userId, containerId, created: rows.length },
      'Wrote stages for sessions that had none'
    );

    return { created: rows.length, orphaned: drift.orphaned.length, applies: true };
  } catch (error) {
    /* See NEVER FATAL. The caller's own work is already done and committed. */
    logger.error({ err: error, userId, containerId }, 'Session stage reconciliation failed');
    return NOTHING;
  }
}
