/**
 * Your clients as a group have changed how they treat you.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OTHER HALF OF THE CLIENT QUESTION
 *
 * `client_needs_a_word` names ONE person whose record has slipped against both
 * their own history and their peers. It deliberately says nothing when the
 * whole cohort slips together — because then the clients are not the story.
 * Measured: with every client sliding from 10% missed to 50%, that card flags
 * nobody, which is correct and also leaves the most important thing on the
 * account unsaid.
 *
 * This is where it gets said. Not about a person: about a business whose
 * clients, collectively, started turning up less or paying later than they did
 * — which is almost never about the clients.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT RECOMMENDS; IT DOES NOT ACT
 *
 * `eligibleForAutomation: false`, and no paired process. What moves a cohort is
 * a change the owner made — a new time of day, a different room, reminders that
 * stopped sending, a price rise, an assistant who left. No button can undo any
 * of that, and offering one would be the card pretending to understand a
 * business it is only measuring. The sentence says what moved, by how much, and
 * what to go and look at.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT WILL NOT FIRE ON
 *
 * A quiet account. Both halves of the window need real volume — a business with
 * four sessions in each is not a trend, it is four sessions — and the movement
 * has to be big enough to act on. Everything below that is noise an owner
 * cannot do anything with, and a dashboard that reports noise teaches people to
 * stop reading it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { computeClientStandings } from '@/lib/business-os/clients/clientStandingStore';
import { businessNorm } from '@/lib/business-os/clients/clientScore';

import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/** Rate points. Ten is the smallest move an owner could act on. */
const MATERIAL = 0.1;

/** Settled sessions (or instalments) needed in EACH half before it is a trend. */
const MIN_EVIDENCE_PER_HALF = 12;

export class ClientBaseDriftDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ret_client_base_drift',
    name: 'Your Clients Have Changed How They Treat You',
    category: 'retention',
    description:
      'Finds the whole client base turning up less, or paying later, than it did — which points at the business rather than at any client',

    watchedMetrics: ['retention.no_show_rate'],
    documentsEventTypes: [],

    baselineWindow: 'month',
    /* `ThresholdType` has no 'percentage' member — the three are 'absolute',
       'percent_change' and 'std_deviation'. This detector compares one half of
       the window against the other, so the change is what it measures. */
    thresholdType: 'percent_change',
    threshold: MATERIAL * 100,
    direction: 'above',
    minSamples: MIN_EVIDENCE_PER_HALF,
    /*
     * A rate across a population, which is the strict side of the gate on
     * purpose: this claim is only as good as the client base behind it, and a
     * business with three clients has no cohort to speak of.
     */
    claimType: 'rate',

    severityFn: (points: number): InsightSeverity => {
      if (points >= 25) return 'high';
      if (points >= 15) return 'medium';
      return 'low';
    },

    eligibleForAutomation: false,
    /* Fortnightly: a cohort does not move in a week, and saying so every night
       would turn the one card about the whole business into wallpaper. */
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

    const standings = await computeClientStandings(this.supabase, userId);
    if (standings.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const profiles = standings.map(entry => entry.profile);
    const norm = businessNorm(profiles);

    /* Pooled volume per half: the question is about the business, so one
       client with forty sessions counts for forty, not for one. */
    const sum = (pick: (profile: (typeof profiles)[number]) => number) =>
      profiles.reduce((total, profile) => total + pick(profile), 0);

    const sessionsThen = sum(p => p.earlier.sessionsSettled);
    const sessionsNow = sum(p => p.recent.sessionsSettled);
    const duesThen = sum(p => p.earlier.instalmentsDue);
    const duesNow = sum(p => p.recent.instalmentsDue);

    const attendanceReadable =
      sessionsThen >= MIN_EVIDENCE_PER_HALF && sessionsNow >= MIN_EVIDENCE_PER_HALF;
    const latenessReadable = duesThen >= MIN_EVIDENCE_PER_HALF && duesNow >= MIN_EVIDENCE_PER_HALF;

    /* Deterioration only. A cohort that improved is good news nobody has to
       act on, and this card costs the owner attention it should not spend. */
    const moved: Array<{ key: 'attendance' | 'lateness'; points: number }> = [];
    if (attendanceReadable && norm.attendanceDrift >= MATERIAL) {
      moved.push({ key: 'attendance', points: norm.attendanceDrift * 100 });
    }
    if (latenessReadable && norm.latenessDrift >= MATERIAL) {
      moved.push({ key: 'lateness', points: norm.latenessDrift * 100 });
    }

    if (moved.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const worst = moved.reduce((a, b) => (b.points > a.points ? b : a));
    const clientsInvolved = profiles.filter(
      profile =>
        (profile.earlier.sessionsSettled > 0 && profile.recent.sessionsSettled > 0) ||
        (profile.earlier.instalmentsDue > 0 && profile.recent.instalmentsDue > 0)
    ).length;

    const rounded = Math.round(worst.points);
    const where =
      worst.key === 'attendance'
        ? `missed sessions across your clients are up ${rounded} points in the last three months`
        : `late payments across your clients are up ${rounded} points in the last three months`;

    /*
     * The recommendation, and the reason it is a recommendation rather than a
     * button: what moves a whole cohort is something the owner changed, and
     * only they know what that was. The sentence names the places worth
     * looking rather than guessing which one it is.
     */
    const advice =
      worst.key === 'attendance'
        ? 'This is your whole client base, not one person — so look at what changed around them: the times you offer, reminders going out, who is taking the bookings, how far ahead people book.'
        : 'This is your whole client base, not one person — so look at what changed around the money: when invoices go out, how long they give people, whether the payment link still works, whether a price rise landed badly.';

    const result = this.createDetectionResult({
      severity: this.definition.severityFn(rounded, 0),
      metricKey: 'retention.no_show_rate',
      currentValue: rounded,
      currentValueUnit: 'percent',
      /*
       * No baseline figure, for the reason `CashRefundPatternDetector` records:
       * a configured constant masquerading as a previous value is what produced
       * "275% refund rate" on a live card. The movement IS the figure here.
       */
      baselineValue: 0,
      thresholdValue: this.definition.threshold,
      /*
       * H15: the denominator behind the rate.
       *
       * This claim is "a rate across your clients moved", and a rate without
       * its population is the shape of claim that produced a figure nobody
       * could check. The population is the clients measurable in BOTH halves
       * of the window, which is the same count the narration quotes and the
       * same one `minSamples` gates on.
       */
      sampleSize: clientsInvolved,
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'contact',
      /*
       * Everyone measurable, not the worst few: the finding is explicitly that
       * this is not about particular people, and listing some would invite the
       * owner to go and talk to them about it.
       */
      affectedEntityIds: standings.map(entry => entry.contactId),
      affectedCount: clientsInvolved,
      narrationSubject: `${where}. ${advice}`,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        attendance_drift_points: Math.round(norm.attendanceDrift * 100),
        lateness_drift_points: Math.round(norm.latenessDrift * 100),
        sessions_before: sessionsThen,
        sessions_after: sessionsNow,
        instalments_before: duesThen,
        instalments_after: duesNow,
        clients_measured: clientsInvolved,
        /* So a reader can tell "everyone slipped" from "we cannot tell". */
        attendance_readable: attendanceReadable,
        lateness_readable: latenessReadable,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
