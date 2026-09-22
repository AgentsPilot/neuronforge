/**
 * Turning a detection into queued work.
 *
 * The seam between "something is true about this business" and "the platform
 * will write to somebody about it". Everything upstream of here is analysis;
 * everything downstream is a message in the owner's name.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REPLACES KernelTrigger
 *
 * `KernelTrigger.trigger()` ends at a throw — 'Kernel process is not
 * implemented; refusing rather than reporting fabricated work'. It is correct
 * to refuse, but the consequence was that every automation the dashboard
 * offered was inert. This enqueues onto the queue pattern that already works
 * in three other places rather than finishing the kernel, which would mean
 * wiring BizQL through all 33 detectors first.
 *
 * WHAT IT REFUSES TO ENQUEUE
 *
 * A detection whose entity type does not match the process's target. A
 * follow-up nudge needs a CONTACT to write to; a chase needs an INVOICE. A
 * detector reporting `payment` or `page` ids has nothing this can send to, and
 * enqueuing its ids into the contact column would mean writing to whoever
 * happened to share that id shape — or, more likely, to nobody while the row
 * failed five times and dead-lettered.
 *
 * This is the check that would have caught the package-ending detector pointing
 * at `send_followup_nudge` for a plan that had already been paid.
 * ---------------------------------------------------------------------------
 *
 * @see lib/services/InsightActionDispatchService.ts
 * @see supabase/migrations/20260917_insight_actions.sql
 */

import { createLogger } from '@/lib/logger';
import {
  insightActionRepository,
  type InsightActionKind,
} from '@/lib/repositories/InsightActionRepository';
import type { DetectionResult } from '../detectors/types';

const logger = createLogger({ module: 'InsightActionEnqueuer' });

/**
 * Which process produces which effect, and what it must be pointed at.
 *
 * `draft_reply_templates` is deliberately absent. It generates suggestions for
 * the OWNER rather than sending anything to a client, so it has no place in a
 * send queue; wiring it here would put drafts in front of clients.
 */
const PROCESS_EFFECTS: Record<string, { kind: InsightActionKind; entityTypes: string[] }> = {
  chase_overdue_invoices: { kind: 'chase_invoice', entityTypes: ['invoice'] },
  send_followup_nudge: { kind: 'followup_nudge', entityTypes: ['contact'] },
  send_reminder_sequence: { kind: 'booking_reminder', entityTypes: ['booking', 'session'] },
};

/**
 * Why each detector is asking for a nudge.
 *
 * Seven detectors share `send_followup_nudge`, and the right opening differs:
 * somebody who enquired and never replied is not the same person as a client
 * of two years who has not been back. Without this they all received the
 * identical letter, which is how an automation starts reading like a mailing
 * list.
 *
 * Anything unlisted falls to 'unspecified', which is the neutral version — a
 * new detector gets a sensible message rather than a wrong one.
 */
const NUDGE_REASONS: Record<string, 'new_enquiry' | 'stalled' | 'past_client' | 'after_intro'> = {
  crm_cold_leads: 'new_enquiry',
  conv_no_next_step: 'new_enquiry',
  conv_pipeline_stuck: 'stalled',
  conv_stage_dropoff: 'stalled',
  conv_service_rate_drop: 'stalled',
  crm_engagement_decay: 'past_client',
  ret_repeat_booking_low: 'past_client',
  pricing_intro_offer_stuck: 'after_intro',
};

/** Which column an entity type belongs in. */
const TARGET_COLUMN: Record<string, 'contact_id' | 'invoice_id' | 'booking_id'> = {
  contact: 'contact_id',
  invoice: 'invoice_id',
  booking: 'booking_id',
  session: 'booking_id',
};

export interface EnqueueInput {
  userId: string;
  processId: string;
  detection: DetectionResult;
  detectorId: string;
  insightId?: string | null;
  automationId?: string | null;
  /** Owner-chosen settings, frozen onto each row at enqueue. */
  parameters?: Record<string, unknown>;
  /** Cap on how many rows one detection may produce. */
  maxItems?: number;
  /** Not before this instant, e.g. a deliberate delay after the owner is told. */
  notBefore?: string | null;
}

export interface EnqueueResult {
  queued: number;
  duplicates: number;
  skipped: string | null;
}

export async function enqueueInsightActions(input: EnqueueInput): Promise<EnqueueResult> {
  const { userId, processId, detection, detectorId } = input;

  const effect = PROCESS_EFFECTS[processId];
  if (!effect) {
    // Not a refusal to be logged as an error: three of the four processes send,
    // and one legitimately does not.
    logger.debug({ processId, detectorId }, 'Process has no send effect; nothing queued');
    return { queued: 0, duplicates: 0, skipped: `no send effect for ${processId}` };
  }

  const entityType = detection.affectedEntityType ?? '';
  if (!effect.entityTypes.includes(entityType)) {
    /*
     * Loud, because this is a wiring mistake rather than a quiet day.
     *
     * A detector mapped to a process it cannot feed will never send anything,
     * and without this line the symptom is silence — which looks exactly like
     * "the business had no problems this week".
     */
    logger.warn(
      { processId, detectorId, entityType, expected: effect.entityTypes },
      'Detector is wired to a process it cannot target; nothing queued'
    );
    return {
      queued: 0,
      duplicates: 0,
      skipped: `${detectorId} reports ${entityType || 'nothing'}, ${processId} needs ${effect.entityTypes.join(' or ')}`,
    };
  }

  const column = TARGET_COLUMN[entityType];
  const ids = (detection.affectedEntityIds ?? []).filter(Boolean).slice(0, input.maxItems ?? 25);

  if (ids.length === 0) {
    return { queued: 0, duplicates: 0, skipped: 'detection named no entities' };
  }

  /*
   * The period the dedupe key is scoped to.
   *
   * A whole day. "Chase invoice X today" must collide with itself — the
   * detector runs on a cron, the owner can press the button, and a retry can
   * replay — but it must NOT collide with chasing the same invoice next week,
   * which is a second reminder the owner is entitled to send.
   */
  const period = new Date().toISOString().slice(0, 10);

  let queued = 0;
  let duplicates = 0;

  for (const id of ids) {
    const { data, error } = await insightActionRepository.enqueue({
      user_id: userId,
      process_id: processId,
      kind: effect.kind,
      detector_id: detectorId,
      insight_id: input.insightId ?? null,
      automation_id: input.automationId ?? null,
      [column]: id,
      payload: {
        ...(input.parameters ?? {}),
        // Only meaningful for a nudge; harmless on the other two kinds.
        ...(effect.kind === 'followup_nudge'
          ? { reason: NUDGE_REASONS[detectorId] ?? 'unspecified' }
          : {}),
      },
      next_attempt_at: input.notBefore ?? null,
      dedupe_key: `${effect.kind}:${id}:${period}`,
    } as never);

    if (error) continue;
    // `enqueue` returns null without an error when the dedupe key already
    // exists, which is a success: somebody already queued this.
    if (data) queued += 1;
    else duplicates += 1;
  }

  logger.info(
    { userId, processId, detectorId, queued, duplicates },
    'Queued insight actions'
  );

  return { queued, duplicates, skipped: null };
}
