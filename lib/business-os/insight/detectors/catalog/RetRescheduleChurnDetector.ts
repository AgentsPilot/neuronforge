/**
 * A Client Who Keeps Moving Their Appointment
 *
 * Somebody has rescheduled three or more times in the last three months. Each
 * move is reasonable on its own; together they are usually the shape of a
 * client on their way out, and they arrive before the cancellation does.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS AN INSIGHT AND NOT A CHASER
 *
 * The platform already has deterministic, card-activated chasers for the things
 * that are simply STUCK — an unanswered enquiry, an unreturned intake form, an
 * unpaid invoice. Each has a gap definition and an automation the owner
 * switches on, and putting the same fact behind a detector as well is how
 * invoice chasing ended up with two switches sending on the same day.
 *
 * This is the other kind of thing: a pattern in one client's behaviour, with no
 * single item to go and fix. Nothing is overdue. Nobody is waiting on a reply.
 * The finding is the repetition itself, which is exactly what the advisor is
 * for and exactly what a chaser cannot see.
 *
 * WHAT IT COSTS THE OWNER
 *
 * A held slot released late is a slot nobody else could book, and the
 * relationship is usually already fading by the third move. Told at three, the
 * owner can ask whether the time still suits them — which is a conversation,
 * not a message the platform can send, so this is advisory.
 *
 * READ FROM `crm_activities`, NOT FROM BOOKINGS
 *
 * A rescheduled booking carries its NEW time; the old one is gone. Only the
 * activity log remembers that a move happened at all, which is why the count
 * comes from `activity_type = 'booking_rescheduled'` rather than from anything
 * on `scheduling_bookings`.
 * ---------------------------------------------------------------------------
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

const WINDOW_DAYS = 90;

/**
 * Moves by one client before it is a pattern rather than life happening.
 *
 * Three. One is nothing, two is a bad month, and a detector that spoke at two
 * would be describing ordinary rescheduling back to the owner as a problem.
 */
const MIN_MOVES = 3;

interface ActivityRow {
  contact_id: string | null;
  activity_date: string | null;
}

interface Churner {
  contactId: string;
  moves: number;
  latest: string | null;
}

export class RetRescheduleChurnDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ret_reschedule_churn',
    name: 'A Client Who Keeps Moving Their Appointment',
    category: 'retention',
    description: 'Finds clients who have rescheduled repeatedly, which usually precedes them stopping',

    watchedMetrics: ['retention.clients_at_risk'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    /*
     * One such client is the finding. The floor that matters is `MIN_MOVES` —
     * how many times ONE person moved — not how many people did it, and a
     * business with four clients should still hear that one of them has
     * rescheduled four times.
     */
    minSamples: 1,

    severityFn: (people: number, moves: number): InsightSeverity => {
      // The repetition is the signal. Six moves by one client says more than
      // three moves each by two.
      if (moves >= 6 || people >= 3) return 'high';
      if (moves >= 4 || people >= 2) return 'medium';
      return 'low';
    },

    /*
     * Advisory. The action is asking whether the time still suits them, which
     * is a conversation — and `send_followup_nudge`, the only contact-shaped
     * process available, sends a generic follow-up that would read as a chase
     * for somebody who has done nothing wrong.
     */
    pairedProcessId: undefined,
    /*
     * A named client who moved four appointments is a fact about that client,
     * not a rate. The retention vector needs 60 days and 10 clients, and a
     * business with four would never hear this.
     */
    ignoresVectorMaturity: true,

    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 336,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    const { data, error } = await this.supabase
      .from('crm_activities')
      .select('contact_id, activity_date')
      .eq('user_id', userId)
      .eq('activity_type', 'booking_rescheduled')
      .gte('activity_date', from);

    if (error) throw error;

    const rows = (data ?? []) as unknown as ActivityRow[];

    const byContact = new Map<string, Churner>();
    for (const row of rows) {
      if (!row.contact_id) continue;
      const entry = byContact.get(row.contact_id) ?? { contactId: row.contact_id, moves: 0, latest: null };
      entry.moves += 1;
      const at = row.activity_date;
      if (at && (!entry.latest || at > entry.latest)) entry.latest = at;
      byContact.set(row.contact_id, entry);
    }

    const churners = [...byContact.values()]
      .filter(c => c.moves >= MIN_MOVES)
      .sort((a, b) => b.moves - a.moves);

    if (churners.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const totalMoves = churners.reduce((sum, c) => sum + c.moves, 0);
    const severity = this.definition.severityFn(churners.length, Math.max(...churners.map(c => c.moves)));

    const names = await this.namesFor(userId, churners.map(c => c.contactId));

    const result = this.createDetectionResult({
      severity,
      metricKey: 'retention.clients_at_risk',
      currentValue: churners.length,
      baselineValue: 0,
      thresholdValue: MIN_MOVES,
      // A count, with nothing to have changed from. See BaseDetector.honest.
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'contact',
      affectedEntityIds: churners.map(c => c.contactId),
      affectedCount: churners.length,
      /*
       * No money. A rescheduled appointment was not lost — it moved, and was
       * very often kept. Pricing the moves would be inventing a cancellation
       * that has not happened, which is the class of figure this module spent
       * two phases removing.
       */
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        window_days: WINDOW_DAYS,
        total_moves: totalMoves,
        clients: churners.slice(0, 5).map(c => ({
          contact_id: c.contactId,
          client: names[c.contactId] ?? null,
          moves: c.moves,
          last_moved: c.latest,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  /** Names, so the card can say who rather than how many. */
  private async namesFor(userId: string, contactIds: string[]): Promise<Record<string, string>> {
    if (contactIds.length === 0) return {};

    const { data } = await this.supabase
      .from('crm_contacts')
      .select('id, first_name, last_name')
      // Scoped: `.in('id', …)` alone is a cross-tenant read under service role.
      .eq('user_id', userId)
      .in('id', contactIds);

    const names: Record<string, string> = {};
    for (const row of (data ?? []) as Array<{ id: string; first_name?: string; last_name?: string }>) {
      const full = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
      if (full) names[row.id] = full;
    }
    return names;
  }
}
