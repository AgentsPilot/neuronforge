/**
 * Work the Platform Could Already Be Doing
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CARD THE WHOLE BEHAVIOUR EXERCISE WAS FOR.
 *
 * An automation-coverage measurement across all six accounts on 2026-10-06
 * found the platform able to perform 0.4% of what owners actually do. The
 * instinct was that owners had not switched things on -- and that was wrong:
 * all four automations were already enabled on the reporting account, and two
 * were demonstrably working (3 meeting reminders, 18 invoice reminders sent).
 *
 * So this is NOT a nag about settings. It fires only when all three are true:
 *
 *   1. an automation exists that could do the work
 *   2. the owner has never answered the question (not on, and NOT declined)
 *   3. there is work waiting for it right now
 *
 * Condition 3 is what keeps it honest. "You could switch this on" with nothing
 * for it to do is a settings tour, and this module has spent a lot of effort
 * removing cards that state a fact with no consequence.
 *
 * DECLINED IS RESPECTED, PERMANENTLY.
 *
 * `business_profiles.automations_declined` exists precisely because a boolean
 * cannot tell "said no" from "never asked" -- the gap route's own comment says
 * so. An owner who answered no has answered; asking again is how a helpful
 * product becomes an irritating one. There is a test for this.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { OPERATIONAL_AUTOMATIONS } from '@/lib/business-os/gaps/automations';
import { applicableAutomations } from '@/lib/business-os/gaps/automationApplies';
import { findGaps } from '@/lib/business-os/gaps/findGaps';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SysAutomationUnadoptedDetector' });

/** One automation the owner has never answered about, with work waiting. */
interface Candidate {
  automationId: string;
  labelKey: string;
  gapId: string;
  waiting: number;
}

export class SysAutomationUnadoptedDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'sys_automation_unadopted',
    name: 'Work The Platform Could Take',
    category: 'operations',
    description:
      'An automation exists for work the owner is still doing by hand, and they have never been asked',

    watchedMetrics: [],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    /** One piece of waiting work is enough. There is no rate here. */
    threshold: 0,
    direction: 'above',
    minSamples: 1,

    severityFn: (waiting: number): InsightSeverity => {
      /*
       * Never higher than medium. Nothing is broken and no money is at risk --
       * the owner is simply doing something themselves that they need not. A
       * card that shouts about an unticked box earns the whole advisor a
       * reputation for crying wolf.
       */
      if (waiting >= 10) return 'medium';
      return 'low';
    },

    /*
     * `claimType: 'instance'`. This names specific automations with a specific
     * count of waiting work, which is true however little history the account
     * has -- and it is most useful EARLY, when a new owner is doing everything
     * by hand. Gating it behind a lit vector would silence it for exactly the
     * businesses it helps most.
     */
    claimType: 'instance',

    eligibleForAutomation: false,
    /*
     * A week. Long enough not to badger somebody who has seen the card and not
     * got round to it; short enough that work piling up is raised again.
     */
    cooldownHours: 168,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    /*
     * The three states, read from the one place that stores them.
     *
     * `automations_declined` is an array of ids and the enabled flags are
     * per-automation columns. Both come off `business_profiles`, and the column
     * list is built from the registry so a fifth automation cannot be missed
     * here -- the failure mode would be silence, which looks like success.
     */
    const columns = [
      ...OPERATIONAL_AUTOMATIONS.map(a => a.column),
      'automations_declined',
    ].join(', ');

    const { data: profile, error } = await this.supabase
      .from('business_profiles')
      .select(columns)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    const row = (profile ?? {}) as unknown as Record<string, unknown>;

    const declined = new Set(
      Array.isArray(row.automations_declined) ? (row.automations_declined as string[]) : []
    );

    /*
     * Never asked: not enabled AND not declined.
     *
     * An unreadable profile row leaves every flag undefined, which would read
     * as "nothing is on" and offer everything. `profile` being null is handled
     * by the `requires` check below returning nothing applicable, but the
     * explicit `=== true` keeps a missing column from being mistaken for off.
     */
    const unanswered = OPERATIONAL_AUTOMATIONS.filter(
      automation => row[automation.column] !== true && !declined.has(automation.id)
    );

    if (unanswered.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * And only the ones this business could actually use.
     *
     * `applicableAutomations` is the existing resolver for the `requires`
     * clause -- it is what stops an invoicing practice being offered a meeting
     * reminder, and what checks that intake actually reaches a client. Asking
     * it rather than re-deriving those rules keeps the card and the settings
     * screen offering the same set.
     */
    const applicable = await applicableAutomations(userId, unanswered);
    if (applicable.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * Is there anything waiting?
     *
     * The condition that separates this from a settings tour. `findGaps` is
     * asked only for the gaps these automations clear, so the cost is bounded
     * by what is actually on offer.
     */
    const gapIds = [...new Set(applicable.map(a => a.gapId))];
    const gaps = await findGaps(userId, { only: gapIds as never });
    const waitingByGap = new Map(gaps.map(g => [g.id, g.items?.length ?? 0]));

    const candidates: Candidate[] = applicable
      .map(automation => ({
        automationId: automation.id,
        labelKey: automation.labelKey,
        gapId: automation.gapId,
        waiting: waitingByGap.get(automation.gapId) ?? 0,
      }))
      .filter(c => c.waiting > 0)
      .sort((a, b) => b.waiting - a.waiting);

    if (candidates.length === 0) {
      logger.debug(
        { userId, offered: applicable.map(a => a.id) },
        'Automations unanswered but nothing waiting for them; staying quiet'
      );
      this.logDetection(userId, null);
      return null;
    }

    const totalWaiting = candidates.reduce((n, c) => n + c.waiting, 0);
    const lead = candidates[0];

    return this.createDetectionResult({
      severity: this.definition.severityFn(totalWaiting, 0),
      metricKey: 'operations.active_services',
      currentValue: totalWaiting,
      currentValueUnit: 'count',

      /*
       * No baseline and no percent change: there is nothing to compare an
       * unticked box to. `hasRealBaseline` omits the change line when the
       * baseline is 0, which is the behaviour wanted here.
       */
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 0,
      direction: 'above',

      affectedEntityType: 'service',
      affectedEntityIds: [],
      affectedCount: totalWaiting,

      /*
       * No money. Switching an automation on does not recover a sum -- it saves
       * the owner's time, which this module has no honest way to price. Saying
       * nothing beats inventing an hourly rate.
       */
      impactDirection: 'opportunity',
      impactPeriod: 'weekly',

      narrationSubject: `${totalWaiting} ${totalWaiting === 1 ? 'thing is' : 'things are'} waiting that the platform could handle without being asked, the largest being ${lead.waiting} for ${lead.automationId}`,

      processParameters: {
        total_waiting: totalWaiting,
        // The card renders the label from this key, so it is translated rather
        // than shipping an English automation name to a Hebrew dashboard.
        lead_automation: lead.automationId,
        lead_label_key: lead.labelKey,
        lead_waiting: lead.waiting,
        candidates: candidates.map(c => ({
          automation: c.automationId,
          label_key: c.labelKey,
          waiting: c.waiting,
        })),
      },
    });
  }
}
