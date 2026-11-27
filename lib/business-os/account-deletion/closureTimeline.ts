/**
 * What happens after a deletion request: the dates and the future-bookings
 * count the pre-check shows in the drawer's "What happens next" section
 * (account deletion lifecycle DL-2b; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §6.1, T-1 to T-5,
 * D-11, D-12; SA W-13, W-14).
 *
 *   T-1  the billing row the pre-check already read → `classifyBillingRow`,
 *        the REQUEST's own classification (W-14): `refuse` → no timeline
 *   T-2  the owner's stored timezone; a read error → no timeline, no count
 *   T-3  free: `closureLockAt(now, zone)`; paid: `closureLockAt(period end,
 *        zone)`, the same projection the closure status view makes for the
 *        `pending` row the request will write (D-7). Paid with no usable
 *        period end → no timeline
 *   T-4  paid only: the plan ending view (display only) → `during` and
 *        `planName`; a throw or null → `unknown`, `null`. Never fails
 *   T-5  the bookings count from the lock date; an error → `{ count: null }`
 *
 * Nothing here decides anything: the request route re-classifies and
 * refuses on its own. Every port is injected, so this file does no I/O of
 * its own and never throws (each port failure maps to a "could not" value).
 * The production ports are `closureTimelineDeps.ts`, the only file in this
 * slice that imports from the entitlements module.
 *
 * @module lib/business-os/account-deletion/closureTimeline
 */

import type { StatementLanguage } from './acknowledgement';
import { closureLockAt } from './closureDates';
import { GRACE_DAYS } from './closureLifecycle';
import { classifyBillingRow, type BillingRowLike } from './closureRequest';
import type { TimezoneRead } from './closureStatusView';
import type { ClosureTimeline, FutureBookings } from './schemas';

/** What the plan ending view says the account is on between the plan end and the lock (display only). */
export interface PlanEndingFacts {
  kind: 'free_plan' | 'back_to_plan' | 'unknown';
  planName: string | null;
}

export interface ClosureTimelinePorts {
  /** `isPlanPriceRecognitionEnabled`, read only as `classifyBillingRow` reads it. */
  pricesEnabled: () => boolean;
  /** The session user's stored timezone; never throws. */
  readTimezone: (userId: string) => Promise<TimezoneRead>;
  /** The plan ending view for the session account; may throw or answer null. */
  readPlanEnding: (input: { userId: string; endsAt: string; locale: StatementLanguage }) => Promise<PlanEndingFacts | null>;
  /** `countUpcomingBookings(userId, fromIso)`; the error is returned, not thrown. */
  countUpcomingBookings: (userId: string, fromIso: string) => Promise<{ data: number | null; error: Error | null }>;
}

/** The plan side of the timeline, from the request's own classification (T-1, W-14). */
export type TimelinePlan =
  | { kind: 'refuse' }
  | { kind: 'free' }
  | { kind: 'paid'; planEndsAt: string | null; trialing: boolean };

export function timelinePlan(row: BillingRowLike | null, pricesEnabled: () => boolean, now: Date): TimelinePlan {
  const classified = classifyBillingRow(row, pricesEnabled, now);
  if (classified.path === 'refuse') return { kind: 'refuse' };
  if (classified.path === 'free') return { kind: 'free' };
  // W-13: a trial was never charged, so the drawer says so.
  return { kind: 'paid', planEndsAt: classified.planEndsAt, trialing: row?.subscriptionStatus === 'trialing' };
}

function isUsableInstant(value: string | null): value is string {
  return value !== null && !Number.isNaN(new Date(value).getTime());
}

/** Pure (T-3, T-4): the wire timeline, or null when it cannot be worked out. */
export function buildClosureTimeline(input: {
  plan: TimelinePlan;
  zone: TimezoneRead;
  now: Date;
  /** Paid only; null when the view threw or had nothing. */
  ending: PlanEndingFacts | null;
}): ClosureTimeline | null {
  const { plan, zone, now, ending } = input;
  if (plan.kind === 'refuse' || !zone.ok) return null;
  if (plan.kind === 'free') {
    const lock = closureLockAt(now, zone.stored);
    return { kind: 'free', lockAt: lock.lockAt, timezone: lock.lockTimezone, graceDays: GRACE_DAYS };
  }
  if (!isUsableInstant(plan.planEndsAt)) return null;
  const lock = closureLockAt(new Date(plan.planEndsAt), zone.stored);
  const during = ending?.kind ?? 'unknown';
  return {
    kind: 'paid',
    planEndsAt: plan.planEndsAt,
    lockAt: lock.lockAt,
    timezone: lock.lockTimezone,
    graceDays: GRACE_DAYS,
    during,
    // A name only with a plan to name: `unknown` never carries one.
    planName: during === 'unknown' ? null : ending?.planName ?? null,
    trialing: plan.trialing,
  };
}

/** Why a part could not be worked out, for the route's log line (codes only). */
export type ClosureTimelineNote =
  | 'plan_refused'
  | 'timezone_unreadable'
  | 'no_period_end'
  | 'ending_view_failed'
  | 'ending_view_empty'
  | 'bookings_count_failed'
  | 'unexpected';

export interface ClosureTimelineResult {
  timeline: ClosureTimeline | null;
  futureBookings: FutureBookings;
  notes: ClosureTimelineNote[];
}

/** T-1 to T-5 over the ports. Never throws. */
export async function readClosureTimeline(
  input: { subject: string; billingRow: BillingRowLike | null; locale: StatementLanguage; now: Date },
  ports: ClosureTimelinePorts
): Promise<ClosureTimelineResult> {
  const notes: ClosureTimelineNote[] = [];
  const unknownCount: FutureBookings = { count: null };
  try {
    const plan = timelinePlan(input.billingRow, ports.pricesEnabled, input.now);
    if (plan.kind === 'refuse') return { timeline: null, futureBookings: unknownCount, notes: ['plan_refused'] };

    const zone = await ports.readTimezone(input.subject);
    if (!zone.ok) return { timeline: null, futureBookings: unknownCount, notes: ['timezone_unreadable'] };

    // The lock date first (no ending view needed for it), so the count can run beside the view.
    const bare = buildClosureTimeline({ plan, zone, now: input.now, ending: null });
    if (!bare) return { timeline: null, futureBookings: unknownCount, notes: ['no_period_end'] };

    const endingRead =
      bare.kind === 'paid'
        ? ports.readPlanEnding({ userId: input.subject, endsAt: bare.planEndsAt, locale: input.locale }).then(
            (facts) => {
              if (!facts) notes.push('ending_view_empty');
              return facts;
            },
            () => {
              notes.push('ending_view_failed');
              return null;
            }
          )
        : Promise.resolve(null);
    const countRead = ports.countUpcomingBookings(input.subject, bare.lockAt).then(
      (read): FutureBookings => {
        if (read.error || typeof read.data !== 'number') {
          notes.push('bookings_count_failed');
          return unknownCount;
        }
        return { count: read.data };
      },
      (): FutureBookings => {
        notes.push('bookings_count_failed');
        return unknownCount;
      }
    );
    const [ending, futureBookings] = await Promise.all([endingRead, countRead]);
    const timeline = bare.kind === 'paid' ? buildClosureTimeline({ plan, zone, now: input.now, ending }) : bare;
    return { timeline, futureBookings, notes };
  } catch {
    return { timeline: null, futureBookings: unknownCount, notes: [...notes, 'unexpected'] };
  }
}
