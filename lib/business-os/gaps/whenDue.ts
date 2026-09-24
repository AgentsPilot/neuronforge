/**
 * When a piece of queued work is due.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Its own module, beside the registry whose fields it reads, because it is pure
 * arithmetic over two plain objects and belongs nowhere near a mail transport.
 * It used to live inside `LeadResponseDispatchService`, which imports the
 * invoice delivery service, which imports the PDF renderer — so a test of this
 * function could not load without the whole send path behind it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/gaps/whenDue
 */

import type { OPERATIONAL_AUTOMATIONS } from './automations';

/**
 * When this piece of work is due, on whichever clock the automation runs.
 *
 * `after_gap` counts forward from the moment something got stuck; the delay is
 * the owner's chance to handle it first. `before_event` counts BACKWARD from
 * the appointment, by the owner's own lead time — a reminder is not "wait, then
 * act" but "be ready by", and the two cannot share arithmetic.
 *
 * Null when the clock cannot be read: an appointment with no start, or a lead
 * time missing from the profile. Saying nothing beats scheduling a reminder at
 * a time nobody chose.
 */
export function whenDue(
  automation: (typeof OPERATIONAL_AUTOMATIONS)[number],
  item: { since: string; eventAt?: string },
  profile: Record<string, unknown>
): Date | null {
  if (automation.timing === 'before_event') {
    const eventAt = item.eventAt ? Date.parse(item.eventAt) : NaN;
    if (Number.isNaN(eventAt)) return null;

    const column = automation.leadHoursColumn;
    const hours = column ? Number(profile[column]) : NaN;
    if (!Number.isFinite(hours) || hours <= 0) return null;

    return new Date(eventAt - hours * 60 * 60 * 1000);
  }

  const stuckSince = Date.parse(item.since);
  return Number.isNaN(stuckSince)
    ? new Date()
    : new Date(stuckSince + automation.delayHours * 60 * 60 * 1000);
}
