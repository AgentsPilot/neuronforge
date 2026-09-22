/**
 * Mobile Visitors Convert Far Less Than Desktop
 *
 * Of the people who reached the site on a phone, the share who got in touch,
 * against the same share for desktop.
 *
 * A gap here almost always means the site is harder to use on a phone than the
 * owner realises, because the owner builds and checks it on a laptop. It is one
 * of the few website findings where the fix is obvious once the number is
 * visible, and invisible until then.
 *
 * ---------------------------------------------------------------------------
 * COMPARED WITHIN ONE WINDOW, NEVER AGAINST HISTORY
 *
 * The mix of devices moves for reasons that are not a defect: a campaign on
 * Instagram is overwhelmingly mobile, a post on LinkedIn is not. Comparing this
 * month's mobile rate against last month's would report the campaign, not the
 * site. Mobile and desktop are measured over the SAME days and compared to each
 * other.
 *
 * BOTH ARMS NEED A FLOOR
 *
 * "0 of 3 mobile visitors got in touch" is not a finding, it is three people.
 * The floor applies to mobile AND desktop, because a desktop rate computed from
 * two visitors is no better a yardstick than a mobile one.
 *
 * THE OWNER IS NOT AN AUDIENCE
 *
 * `is_owner_view` rows are excluded. The owner previews their own site far more
 * than any customer visits it, almost always on a laptop, and counting those
 * would inflate the desktop arm — the exact arm this detector measures mobile
 * against.
 *
 * Advisory. The platform cannot redesign a page, so offering an automation here
 * would be a button that does nothing.
 * ---------------------------------------------------------------------------
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

const WINDOW_DAYS = 30;

/** Unique visitors needed on EACH side before a rate means anything. */
const MIN_VISITORS_PER_DEVICE = 25;

/** How many percentage points mobile must trail desktop by. */
const GAP_THRESHOLD_POINTS = 15;

interface ViewRow {
  session_id: string | null;
  device_type: string | null;
}

interface ContactRow {
  id: string;
}

export class WebMobileConversionGapDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'web_mobile_conversion_gap',
    name: 'Mobile Visitors Convert Far Less Than Desktop',
    category: 'acquisition',
    description: 'Finds mobile visitors getting in touch at a much lower rate than desktop visitors',

    watchedMetrics: ['acquisition.mobile_conversion_gap'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: GAP_THRESHOLD_POINTS,
    direction: 'above',
    minSamples: MIN_VISITORS_PER_DEVICE,

    severityFn: (gapPoints: number, mobileVisitors: number): InsightSeverity => {
      // Volume raises the stakes: a 20-point gap over 500 phone visitors is a
      // different problem from the same gap over 30.
      if (gapPoints >= 30 && mobileVisitors >= 100) return 'high';
      if (gapPoints >= 25 || mobileVisitors >= 200) return 'medium';
      return 'low';
    },

    pairedProcessId: undefined,
    ignoresVectorMaturity: false,

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

    const { data: viewData, error: viewError } = await this.supabase
      .from('website_page_views')
      .select('session_id, device_type')
      .eq('user_id', userId)
      // The owner checking their own site is not a customer.
      .eq('is_owner_view', false)
      .gte('viewed_at', from);

    if (viewError) throw viewError;

    const views = (viewData ?? []) as unknown as ViewRow[];

    /*
     * Counted as unique SESSIONS, not as rows.
     *
     * One person reading four pages is one visitor. Counting rows would make
     * whichever device browses more deeply look like it converts less, which is
     * the opposite of the finding.
     *
     * A view with no session is dropped rather than counted as its own visitor:
     * `session_id` was null on every row recorded before the tracker was fixed,
     * and treating those as unique people would invent a visitor per page view.
     */
    const mobileVisitors = uniqueSessions(views, 'mobile');
    const desktopVisitors = uniqueSessions(views, 'desktop');

    if (mobileVisitors < MIN_VISITORS_PER_DEVICE || desktopVisitors < MIN_VISITORS_PER_DEVICE) {
      this.logDetection(userId, null);
      return null;
    }

    const [mobileContacts, desktopContacts] = await Promise.all([
      this.contactsFrom(userId, 'mobile', from),
      this.contactsFrom(userId, 'desktop', from),
    ]);

    const mobileRate = Math.round((mobileContacts / mobileVisitors) * 100);
    const desktopRate = Math.round((desktopContacts / desktopVisitors) * 100);
    const gapPoints = desktopRate - mobileRate;

    if (gapPoints < GAP_THRESHOLD_POINTS) {
      this.logDetection(userId, null);
      return null;
    }

    const severity = this.definition.severityFn(gapPoints, mobileVisitors);

    /*
     * How many enquiries the gap accounts for, at this month's traffic.
     *
     * Arithmetic on measured numbers, not a projection: if phone visitors had
     * converted at the desktop rate, this many more would have been in touch.
     * No money figure is attached — what an enquiry is worth is not something
     * this detector can know.
     */
    const missedContacts = Math.round((desktopRate - mobileRate) / 100 * mobileVisitors);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.mobile_conversion_gap',
      currentValue: mobileRate,
      baselineValue: desktopRate,
      thresholdValue: GAP_THRESHOLD_POINTS,
      percentChange: -gapPoints,
      direction: 'below',
      affectedEntityType: 'page',
      affectedEntityIds: [],
      affectedCount: mobileVisitors,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        window_days: WINDOW_DAYS,
        gap_points: gapPoints,
        mobile_rate: mobileRate,
        desktop_rate: desktopRate,
        mobile_visitors: mobileVisitors,
        desktop_visitors: desktopVisitors,
        mobile_contacts: mobileContacts,
        desktop_contacts: desktopContacts,
        missed_contacts: missedContacts,
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  /** People who got in touch from this kind of device, in the window. */
  private async contactsFrom(userId: string, device: string, from: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('crm_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      // Written by `buildAttributionFromRequest` on every public form and
      // booking, so it describes the device the CONVERSION happened on.
      .eq('source_metadata->>device_type', device)
      .gte('created_at', from);

    if (error) throw error;
    return count ?? 0;
  }
}

/** Distinct sessions on one kind of device. Views without a session are dropped. */
function uniqueSessions(views: ViewRow[], device: string): number {
  const seen = new Set<string>();
  for (const v of views) {
    if (v.device_type !== device) continue;
    if (!v.session_id) continue;
    seen.add(v.session_id);
  }
  return seen.size;
}
