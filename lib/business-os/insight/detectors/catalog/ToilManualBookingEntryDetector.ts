/**
 * Bookings the Owner Typed In Themselves
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIRST DETECTOR ABOUT THE OWNER RATHER THAN THE BUSINESS.
 *
 * Every other detector in this catalogue reasons about outcomes: a booking was
 * cancelled, an invoice went unpaid, a quote was declined. None of them can see
 * what the OWNER does. So the platform could report a cancelled appointment and
 * had no way to notice that the owner keyed in eighteen bookings by hand while
 * a booking page sat published, doing nothing.
 *
 * That is the job the product exists to take away, and nothing was watching it.
 *
 * WHY `booking_source` AND NOT THE AUDIT TRAIL
 *
 * `audit_trail` records that the owner performed an action, but
 * `scheduling_bookings.booking_source` records how the booking ACTUALLY arrived
 * -- 'manual', 'website', 'proposal', 'quote_request' -- which is the precise
 * question here and cannot drift from the booking it describes. Behaviour
 * detectors use the audit trail only where there is no module-table trace
 * (a chat question, a settings edit). Where the module table knows, it wins.
 *
 * WHAT MAKES THIS FAIR TO SAY
 *
 * Manual entry is not a mistake. An owner taking a booking over the phone has
 * to type it in, and always will. The claim is only worth making when a
 * SELF-SERVE ROUTE EXISTS and is going unused, so the detector stays silent
 * unless there is a published, bookable surface. Without that, a card would be
 * telling somebody off for the only option they have.
 *
 * On the reporting account at the time of writing: 18 of 33 bookings manual,
 * 6 from the website, with 5 bookable services and a smart link live.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { createLogger } from '@/lib/logger';
import { deadReason } from './WebLinkDeadDestinationDetector';

const logger = createLogger({ module: 'ToilManualBookingEntryDetector' });

/** How far back to judge. Long enough to smooth a quiet fortnight. */
const LOOKBACK_DAYS = 60;

/**
 * Below this many bookings the share is not a share.
 *
 * Three of four bookings being manual is 75% and means nothing. This is the
 * denominator guard the `rate` claim type requires, and it is passed as
 * `sampleSize` so `BaseDetector` enforces it rather than trusting this comment.
 */
const MIN_BOOKINGS = 8;

/** The sources that mean a human on this side of the screen did the typing. */
const MANUAL_SOURCES = new Set(['manual', 'admin', 'owner']);

interface BookingRow {
  id: string;
  booking_source: string | null;
  created_at: string;
}

export class ToilManualBookingEntryDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'toil_manual_booking_entry',
    name: 'Bookings You Entered By Hand',
    category: 'operations',
    description:
      'The owner is keying in bookings that a published booking page could take for them',

    watchedMetrics: ['operations.manual_booking_share'],

    baselineWindow: 'month',
    /*
     * `absolute`, not `percentage` -- which is not a `ThresholdType` and never
     * was. The threshold below is a percentage VALUE (50% of bookings), but it
     * is compared absolutely: the share is over fifty or it is not. The three
     * legal kinds are `absolute`, `percent_change` and `std_deviation`, and the
     * middle one means "moved by N% from a baseline", which this does not do --
     * it has no baseline, deliberately.
     */
    thresholdType: 'absolute',
    /**
     * Half. Not a tuned number, a meaningful one: past this point the booking
     * page is doing less of the work than the owner is.
     */
    threshold: 50,
    direction: 'above',
    minSamples: MIN_BOOKINGS,

    severityFn: (share: number): InsightSeverity => {
      if (share >= 85) return 'high';
      if (share >= 65) return 'medium';
      return 'low';
    },

    /*
     * No `pairedProcessId`, deliberately.
     *
     * The four automations in `gaps/automations.ts` chase and remind; none of
     * them takes a booking. The answer here is for the owner to share the link
     * they already have, which is an instruction and not a job the platform can
     * run. Inventing a process id to satisfy the shape would produce a button
     * that does nothing.
     */
    claimType: 'rate',

    eligibleForAutomation: false,
    cooldownHours: 336, // Two weeks. Changing how you take bookings is not a daily fix.
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: bookings, error } = await this.supabase
      .from('scheduling_bookings')
      .select('id, booking_source, created_at')
      .eq('user_id', userId)
      .gte('created_at', since);

    if (error) throw error;

    const rows = (bookings ?? []) as BookingRow[];
    if (rows.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * Is there anywhere for a client to book themselves?
     *
     * Checked BEFORE the share is judged, because without it there is nothing to
     * say. An active service is the booking surface; a smart link is the other
     * route to the same thing, and either one is enough.
     */
    const [{ count: bookableServices }, { data: links }] = await Promise.all([
      this.supabase
        .from('scheduling_services')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_active', true),
      this.supabase
        .from('smart_links')
        .select('code, name, destination_url, is_active')
        .eq('user_id', userId)
        .eq('is_active', true),
    ]);

    /*
     * A link that does not open is not a route she can use.
     *
     * `deadReason` is the same check `WebLinkDeadDestinationDetector` applies,
     * imported rather than re-written so the two detectors cannot disagree.
     * Without it these two cards contradict each other on this very account:
     * her only smart link points at `http://localhost:3000/c/.../book` with 27
     * clicks against it, so one card says "your link does not open" while this
     * one says "share your link". Telling somebody to promote a broken address
     * is worse than saying nothing.
     */
    const usableLinks = (links ?? []).filter(
      l => deadReason((l as { destination_url?: string | null }).destination_url) === null
    );

    /*
     * Send her to the page, do NOT hand her a URL.
     *
     * Copyable chips were the obvious design and they are wrong here. A link is
     * only useful if it is published and working, and on this very account the
     * one smart link points at `http://localhost:3000/c/.../book` -- so a chip
     * would hand her a broken address to go and promote. Even a healthy link
     * often needs publishing or renaming first, which a chip cannot do.
     *
     * `/business-os/website` is where links and the booking page are managed,
     * so the card's action is a destination: she arrives where the thing can be
     * fixed, published and shared, rather than with a string she has to find a
     * use for.
     *
     * The counts still travel, because the card's SENTENCE changes with them --
     * "you have a link that does not work" is different advice from "you have
     * one, put it where people look".
     */
    const hasSelfServeRoute = (bookableServices ?? 0) > 0 || usableLinks.length > 0;
    if (!hasSelfServeRoute) {
      logger.debug(
        { userId, bookings: rows.length },
        'Manual entry not reported: the owner has no self-serve route to use instead'
      );
      this.logDetection(userId, null);
      return null;
    }

    const manual = rows.filter(r => MANUAL_SOURCES.has(String(r.booking_source)));
    const share = Math.round((manual.length / rows.length) * 1000) / 10;

    if (share < this.definition.threshold) {
      this.logDetection(userId, null);
      return null;
    }

    /** Distinct days the owner did this, which separates a routine from a backlog. */
    const days = new Set(manual.map(r => r.created_at.slice(0, 10)));

    const bySource = rows.reduce<Record<string, number>>((acc, r) => {
      const key = String(r.booking_source ?? 'unknown');
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return this.createDetectionResult({
      severity: this.definition.severityFn(share, 0),
      metricKey: 'operations.manual_booking_share',
      currentValue: share,
      currentValueUnit: 'percent',

      /*
       * No baseline and no percent change.
       *
       * There is nothing to compare this to yet: no metric definition records
       * the manual share over time, so a `percentChange` here would be invented.
       * `hasRealBaseline` in InsightRepository omits the change line when the
       * baseline is 0, which is exactly the behaviour wanted -- and is the guard
       * `cash_refund_pattern` defeated by passing a configured constant.
       */
      baselineValue: 0,
      thresholdValue: this.definition.threshold,
      percentChange: 0,
      direction: 'above',

      affectedEntityType: 'booking',
      affectedEntityIds: manual.slice(0, 20).map(r => r.id),
      affectedCount: manual.length,

      /*
       * No money. A manual booking is not a loss -- the booking happened and was
       * paid for. What it costs is the owner's time, which this module has no
       * honest way to price, so it says nothing rather than guessing an hourly
       * rate.
       */
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',

      narrationSubject: `${manual.length} of ${rows.length} bookings in the last ${LOOKBACK_DAYS} days were entered by hand, across ${days.size} different days`,

      processParameters: {
        manual_count: manual.length,
        total_bookings: rows.length,
        manual_share_percent: share,
        distinct_days: days.size,
        by_source: bySource,
        bookable_services: bookableServices ?? 0,
        /*
         * Only the links that WORK, and the name she knows one by -- so the
         * card can say "share 5 שירותים" rather than "share your booking link"
         * and leave her hunting for it.
         */
        usable_links: usableLinks.length,
        broken_links: (links ?? []).length - usableLinks.length,
        /*
         * Where the card's button goes. A route rather than a URL to copy: see
         * the note above -- a link she cannot publish is not an action.
         */
        fix_route: '/business-os/website',
      },

      // The denominator. `createDetectionResult` withholds the detection below
      // `minSamples`, so a small practice is never told what its share means.
      sampleSize: rows.length,
    });
  }
}
