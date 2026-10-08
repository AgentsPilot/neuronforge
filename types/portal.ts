// types/portal.ts

import type { PublicBookingSummary } from '@/components/public/AppointmentCard';

/**
 * What `GET /api/book/manage/[token]` returns, declared once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT LEFT TO EACH SIDE
 *
 * The route built this shape and the portal page re-declared it by hand, and
 * the two had already drifted in both directions:
 *
 *   · the route emits `plan.periods[].label` — the milestone's NAME, the thing
 *     that lets a client tell which payment a refund came off — and the page
 *     RENDERS it, but the page's own copy of the type never declared it. The
 *     field worked only because the value arrives at runtime regardless of
 *     what the type says.
 *   · the route emits `refundedAt`, and nothing renders it at all.
 *
 * Neither is a crash, which is the problem: a hand-copied type is wrong
 * silently, and the next person to add a field has no reason to believe the
 * other side knows about it.
 *
 * Type-only and isomorphic — no server imports, no repository imports — for
 * the same reason `lib/i18n/public-pages.ts` is: the page that consumes it is
 * a client component.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * One meeting of a package, as the portal lists it.
 *
 * Each row carries its OWN signed token, so Cancel and Reschedule reach the
 * same routes as a single booking and are judged by the same rule. `canModify`
 * is the server's answer and `tooSoon` is why it said no, so the page never
 * offers an action that is about to be refused.
 */
export interface PortalPackageMeeting {
  id: string;
  /** The agreement's own numbering — never derived from an instalment count. */
  occurrenceNumber: number | null;
  startTime: string | null;
  endTime: string | null;
  status: string;
  canModify: boolean;
  tooSoon: boolean;
  token: string;
  isCurrent: boolean;
}

/**
 * Where the quote stands, for a booking that produced one.
 *
 * Absent entirely when none was raised. Looked up on existence rather than on
 * `sale_mode`, because an owner can raise a quote against an ordinary booking
 * and the client must still see it.
 */
export interface PortalQuote {
  status: string;
  total: number | null;
  currency: string | null;
  /** Null while the quote is a draft: a link would show unfinished work. */
  token: string | null;
}

/**
 * One payment of a plan.
 *
 * Ordered by `installment_number`, the agreement's own order — sorting by due
 * date put a milestone (which has no due date) first and attached a refund to
 * the wrong row.
 */
export interface PortalPlanPeriod {
  number: number;
  /**
   * The milestone's NAME. "1." and "2." cannot tell a client which payment a
   * refund came off; "on completion" can. Null on a uniform instalment plan,
   * where the number is the whole name.
   *
   * This is the field the page rendered while its local type denied it.
   */
  label?: string | null;
  amount: number;
  /**
   * `pending | billed | paid | overdue | cancelled`
   * (`lib/repositories/PaymentPlanRepository.ts:55`). Left as a string because
   * the column is plain TEXT with no CHECK and has carried values the union
   * did not know about.
   */
  status: string;
  /** Null for a milestone: it falls due when the work is done. */
  dueDate: string | null;
  refunded?: number | null;
}

/** What is owed or has been paid, however this booking was sold. */
export interface PortalPayment {
  /** `refunded` is checked FIRST: money that went back is the latest fact. */
  state: 'paid' | 'due' | 'refunded' | 'none';
  amount: number | null;
  currency: string | null;
  /** The soonest deadline across everything owing; null when none has one. */
  dueDate: string | null;
  overdue: boolean;
  /** Set on a PARTIAL refund too, which leaves `state` at 'paid'. */
  refunded?: number | null;
  refundedAt?: string | null;
  plan: {
    paid: number;
    total: number;
    periods?: PortalPlanPeriod[] | null;
  } | null;
  /**
   * Only where money is genuinely outstanding AND an invoice exists to pay
   * against. An agreed-but-unbilled quote stage counts toward the balance and
   * correctly yields no link.
   */
  payUrl?: string | null;
}

/** Whether there is a form to fill in, and whether it is done. */
export interface PortalIntake {
  required: boolean;
  completed: boolean;
}

/** The booking itself. Extends the shape `AppointmentCard` already defines. */
export interface PortalBooking extends PublicBookingSummary {
  id: string;
  clientName: string;
  clientEmail: string;
  status: string;
  paymentStatus: string;
  notes: string | null;
  canReschedule: boolean;
  canCancel: boolean;
  /** Null for a product purchase — no appointment to count down to. */
  hoursUntilBooking: number | null;
  /** False for a product purchase: nothing about it is scheduled. */
  isScheduled?: boolean;
}

/** The whole successful response. */
export interface PortalResponse {
  success: true;
  booking: PortalBooking;
  /** Absent, not null, when no quote was raised. */
  quote?: PortalQuote;
  /** True only when the service promises one and none exists yet. */
  awaitingQuote: boolean;
  payment: PortalPayment;
  intake: PortalIntake;
  /** Empty for an ordinary booking; the siblings when this is a package. */
  meetings: PortalPackageMeeting[];
}
