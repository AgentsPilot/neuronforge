/**
 * POST /api/scheduling/bookings/[id]/meetings
 *
 * Add a meeting to a package that is already running.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A block of six is agreed, approved and under way, and then the owner needs a
 * seventh date: the client missed one, or a course ran long, or they simply
 * want another. Without this the only way is a standalone booking, which lands
 * in the drawer as a separate job and belongs to no purchase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MONEY IS THE OWNER'S ANSWER, NOT AN INFERENCE
 *
 * `charge: false` — the meeting is part of what was already paid for. A make-up
 *   for a missed session, or goodwill. Nothing is billed, ever.
 *
 * `charge: true` — only meaningful on a package billed AFTER EACH MEETING,
 *   where the client is already paying session by session: a stage of its own
 *   is created, waiting, bound to this meeting, and billed when it is marked
 *   held like every other. The plan's total grows by that stage, because the
 *   plan is the record of what will be collected.
 *
 * On a package PAID UP FRONT a charge is refused. The client paid one agreed
 * sum for the block; billing them more for a seventh session is selling them
 * something else, and that is a quote, not a button.
 *
 * The accepted proposal is never touched. `accepted_snapshot` is what settles a
 * dispute and it records what was agreed on the day — see `recordAcceptance`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { paymentPlanRepository } from '@/lib/repositories/PaymentPlanRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import {
  createBooking,
  closedDayCheck,
  BookingSlotUnavailableError,
  BookingOnClosedDayError,
} from '@/lib/services/BookingLifecycleService';
import { isSlotTakenError } from '@/lib/business-os/bookingStatus';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';

/**
 * What to call the stage a newly added session bills.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Follows the wording already on the plan — "פגישה 6" becomes "פגישה 9" —
 * because a client reads these as one list, and the same thing named two ways
 * is the shape that gets misread. The label was the quote's entire title plus a
 * number, so the plan read "פגישה 1 … פגישה 6" and then "חבילת טיפולים לטיפול
 * לילד עם ADHD (9)": long enough to crowd the row, and clearly a different kind
 * of name from its neighbours.
 *
 * `sessionNumber` is the SESSION this stage bills, not the stage's own place in
 * the plan, and those diverge the moment a session is added without a charge:
 * the eighth payment on this plan bills the ninth session, because session
 * eight was goodwill. Numbering the label by the stage would read tidier beside
 * the row number and would be a lie about which meeting the client is paying
 * for. The row already carries its own ordinal; the label says what it is for.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function nextStageLabel(
  previousLabel: string | null,
  sessionNumber: number,
  quoteTitle: string
): string {
  if (!previousLabel) return `${quoteTitle} (${sessionNumber})`;

  /*
   * The last number in the label is the part that moves; whatever sits either
   * side of it is the name the owner chose and is kept exactly.
   *
   * The suffix group is not cosmetic. Labels written as "Package (13)" end in a
   * bracket, so a pattern anchored on the digits alone matches nothing — and
   * this function would hand back the previous label verbatim, putting the same
   * name on two stages, which is worse than the mismatch it set out to fix.
   */
  const trailing = previousLabel.match(/^(.*?)(\d+)(\D*)$/);
  if (trailing) return `${trailing[1]}${sessionNumber}${trailing[3]}`;

  /* Named without a number — "On completion" — so numbering it would invent a
     sequence that is not there. */
  return previousLabel;
}

const logger = createLogger({ module: 'PackageMeetingsAPI' });
const auditTrail = AuditTrailService.getInstance();

const addSchema = z.object({
  /** When the new meeting starts, as an instant. */
  start_time: z.string().refine(value => !Number.isNaN(Date.parse(value)), 'not a real date'),
  /** How long it runs. Defaults to the length of the meetings already sold. */
  duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
  /** Bill it like the others. Only valid on a per-session package. */
  charge: z.boolean().optional().default(false),
  /** The owner was told the day is closed and said add it anyway. */
  allow_closed_day: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const containerId = params.id;
    const input = addSchema.parse(await request.json());

    const { data: container, error: containerError } = await schedulingBookingRepository.findById(
      containerId,
      user.id
    );

    if (containerError || !container) {
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    /*
     * It has to BE a purchase. A meeting of a package cannot own meetings, and
     * hanging one off an ordinary appointment would make a package out of
     * something nobody sold as one.
     */
    if (container.parent_booking_id) {
      return NextResponse.json(
        { success: false, code: 'not_a_package', error: 'This is a meeting, not a purchase.' },
        { status: 400 }
      );
    }

    const { data: siblings } = await schedulingBookingRepository.findChildren(containerId, user.id);

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE NEW SHAPE: SESSIONS ARE MEETINGS ON THIS BOOKING.
     *
     * A package used to be a container plus one child BOOKING per date, which
     * `findChildren` returns. Since the split it is one booking with N rows in
     * `scheduling_meetings`.
     *
     * Reading both is not politeness here, it is a correctness requirement:
     * finding no children and carrying on would add a CHILD BOOKING to a
     * package made of meetings. The readers prefer children where they exist,
     * so that one added row would become the whole package on screen and hide
     * the six sessions the client actually holds.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { data: sessionMeetings } = await supabaseServer
      .from('scheduling_meetings')
      .select('id, session_number, meeting_status')
      .eq('booking_id', containerId)
      .eq('user_id', user.id)
      .not('session_number', 'is', null)
      .order('session_number', { ascending: false });

    const asMeetings = !siblings?.length && Boolean(sessionMeetings?.length);

    if (!siblings?.length && !asMeetings) {
      return NextResponse.json(
        { success: false, code: 'not_a_package', error: 'This booking has no meetings.' },
        { status: 400 }
      );
    }

    /*
     * The quote that sold it — for how long each meeting runs, how the block is
     * billed, and which plan a new stage would belong to.
     */
    const { data: proposal } = await supabaseServer
      .from('proposals')
      .select('id, title, sessions, created_plan_id, contact_id, currency')
      .eq('package_booking_id', containerId)
      .eq('user_id', user.id)
      .maybeSingle();

    const perSession = Boolean(
      (proposal?.sessions as { bill_per_session?: boolean } | null)?.bill_per_session
    );

    if (input.charge && !perSession) {
      /*
       * The client paid one agreed sum for the block. Billing more for an extra
       * session is selling them something else, which is a quote.
       */
      return NextResponse.json(
        {
          success: false,
          code: 'cannot_charge_upfront_package',
          error: 'This package was paid for in full. Send a quote to sell another session.',
        },
        { status: 400 }
      );
    }

    const minutes =
      input.duration_minutes ??
      (proposal?.sessions as { duration_minutes?: number } | null)?.duration_minutes ??
      60;

    const start = new Date(input.start_time);
    const end = new Date(start.getTime() + minutes * 60_000);

    /*
     * The highest number so far, not the count: a package whose third meeting
     * was deleted still has a sixth, and reusing its number would put two
     * meetings in the same place in the series.
     */
    const nextNumber = asMeetings
      ? Math.max(0, ...(sessionMeetings ?? []).map(row => Number(row.session_number ?? 0))) + 1
      : Math.max(0, ...(siblings ?? []).map(child => Number(child.occurrence_number ?? 0))) + 1;

    /** How many sessions the package had before this one, for the stage numbers. */
    const sessionsSoFar = asMeetings ? (sessionMeetings ?? []).length : (siblings ?? []).length;

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * A SESSION ADDED TO THE NEW SHAPE IS A MEETING, AND STILL GETS THE FOUR
     * THINGS `createBooking` WOULD HAVE GIVEN IT.
     *
     * Those are the reason this route went through `createBooking` at all: the
     * closed-day question, the overlap refusal, the calendar event, and the
     * client's confirmation. A session has no booking to create, so each is
     * done here against the meeting:
     *
     *   · closed day — `closedDayCheck`, the same function `createBooking`
     *     calls, so "the business is shut that day" is one answer not two;
     *   · overlap — `scheduling_meetings_no_overlap` (20261085) refuses it, and
     *     it is the ONLY constraint that can: the purchase carries no time, so
     *     the bookings constraint skips it entirely;
     *   · the calendar — recorded on the MEETING, or six sessions would
     *     overwrite one column and be re-created on the next sync;
     *   · the email — the purchase has no clock, so the session's own hour is
     *     passed in, or the client is told about 1970.
     * ───────────────────────────────────────────────────────────────────────────
     */
    /** The row that was added: a meeting in the new shape, a booking in the old. */
    let addedId: string;
    /** What it looks like, for the caller that has to draw it. */
    let addedRow: Record<string, unknown> | null = null;
    /** Whether the client was told, which only the branch that sent it knows. */
    let clientNotified = false;

    if (asMeetings) {
      if (!input.allow_closed_day) {
        const closed = await closedDayCheck(
          user.id,
          start.toISOString(),
          end.toISOString(),
          container.timezone,
          requestLogger
        );

        if (closed) {
          return NextResponse.json(
            {
              success: false,
              code: 'closed_day',
              error: closed.error.message,
              closed: {
                kind: closed.error.kind,
                date: closed.error.dateKey,
                reason: closed.error.closedReason,
                hours: closed.error.hours ?? null,
              },
            },
            { status: 409 }
          );
        }
      }

      const session = await schedulingBookingRepository.createMeeting({
        user_id: user.id,
        booking_id: containerId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        timezone: container.timezone,
        session_number: nextNumber,
        /* The first attempt at this new session. */
        occurrence_number: 1,
      });

      if (isSlotTakenError(session.error)) {
        return NextResponse.json(
          { success: false, code: 'slot_taken', error: 'That hour has been taken.' },
          { status: 409 }
        );
      }

      if (session.error || !session.data) {
        requestLogger.error({ err: session.error, containerId }, 'Could not add the session');
        return NextResponse.json(
          { success: false, error: 'Failed to add the meeting' },
          { status: 500 }
        );
      }

      addedId = session.data.id;
      addedRow = {
        id: addedId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        session_number: nextNumber,
        status: container.status,
        meeting_status: null,
      };

      /* The owner's diary, recorded on the session so the next sync knows it
         exists. Never fatal: the appointment is real either way. */
      try {
        const { CalendarSyncService } = await import('@/lib/services/CalendarSyncService');
        const { data: service } = await schedulingServiceRepository.findById(
          container.service_id,
          user.id
        );

        if (service) {
          await CalendarSyncService.syncBookingToCalendar(
            {
              ...container,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              /* Not the purchase's: borrowing it would update one event over
                 and over instead of creating this session's. */
              external_calendar_event_id: null,
            },
            service,
            user.id,
            addedId
          );
        }
      } catch (err) {
        requestLogger.error({ err, containerId, meetingId: addedId }, 'Session added but its calendar event failed');
      }

      /*
       * The client is told AFTER the money is settled, further down — not
       * here. The stage is created below, and whether this session is charged
       * is the one thing the mail has to say that the date does not: a client
       * who has already paid for a block by instalment should read about an
       * extra charge in the same message that gives them the hour, not from
       * an invoice arriving later.
       */
    } else {

    /*
     * Through `createBooking`, so an added meeting gets everything an ordinary
     * one does — the overlap check, the closed-day question, the calendar event,
     * the client's confirmation — with `createInvoice: false`, because a
     * package's money is the purchase's and is billed by a stage or not at all.
     */
    const created = await createBooking({
      userId: user.id,
      serviceId: container.service_id,
      contactId: container.contact_id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      timezone: container.timezone,
      status: container.status === 'pending' ? 'pending' : 'confirmed',
      parentBookingId: containerId,
      occurrenceNumber: nextNumber,
      bookingSource: 'proposal',
      createInvoice: false,
      allowClosedDay: input.allow_closed_day,
      request,
      logger: requestLogger,
    });

    if (created.error) {
      if (created.error instanceof BookingOnClosedDayError) {
        return NextResponse.json(
          {
            success: false,
            code: 'closed_day',
            error: created.error.message,
            closed: {
              kind: created.error.kind,
              date: created.error.dateKey,
              reason: created.error.closedReason,
              hours: created.error.hours ?? null,
            },
          },
          { status: 409 }
        );
      }

      if (created.error instanceof BookingSlotUnavailableError) {
        return NextResponse.json(
          { success: false, code: 'slot_taken', error: created.error.message },
          { status: 409 }
        );
      }

      requestLogger.error({ err: created.error, containerId }, 'Could not add the meeting');
      return NextResponse.json(
        { success: false, error: 'Failed to add the meeting' },
        { status: 500 }
      );
    }

      addedId = created.data!.booking.id;
      addedRow = created.data!.booking as unknown as Record<string, unknown>;
      clientNotified = Boolean(created.data!.clientNotified);
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * ITS OWN STAGE, when the owner said to bill it.
     *
     * The amount is COPIED from the stages already on this plan rather than
     * recomputed from the total: it is what the client has been paying per
     * session, and a seventh priced differently from the first six would be a
     * change to the deal nobody mentioned.
     *
     * Non-fatal. The meeting exists and is in the client's calendar; a stage
     * that failed is money not yet billed, which the owner can see and fix,
     * where failing the whole request would leave them re-adding a meeting that
     * is already there.
     * ─────────────────────────────────────────────────────────────────────────
     */
    let stageId: string | null = null;
    /** What this session costs the client, when the owner charged for it. */
    let chargedLabel: string | null = null;

    if (input.charge && perSession && proposal?.created_plan_id) {
      const { data: existing } = await supabaseServer
        .from('payment_plan_installments')
        .select('amount, currency, installment_number, label')
        .eq('payment_plan_id', proposal.created_plan_id)
        .eq('user_id', user.id)
        .order('installment_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const amount = Number(existing?.amount ?? 0);

      if (amount > 0) {
        const { data: rows, error: stageError } = await paymentPlanRepository.createInstallments([
          {
            user_id: user.id,
            payment_plan_id: proposal.created_plan_id,
            contact_id: container.contact_id,
            proposal_id: proposal.id,
            /*
             * The job the money belongs to, and WHICH session it bills.
             *
             * For the new shape the session has no booking of its own, so the
             * stage points at the purchase and names the meeting — otherwise
             * every added session's stage would share one `booking_id` with the
             * rest and `billSessionOnCompletion` could not tell them apart.
             */
            booking_id: asMeetings ? containerId : addedId,
            meeting_id: asMeetings ? addedId : null,
            installment_number: Number(existing?.installment_number ?? sessionsSoFar) + 1,
            amount,
            currency: String(existing?.currency ?? proposal.currency ?? 'USD'),
            /* Named like the stages beside it, after the session it bills —
               see `nextStageLabel`. */
            label: nextStageLabel(
              (existing?.label as string | null) ?? null,
              nextNumber,
              proposal.title as string
            ),
            trigger: 'manual',
            due_date: null,
            status: 'pending',
          },
        ] as Parameters<typeof paymentPlanRepository.createInstallments>[0]);

        if (stageError) {
          requestLogger.error(
            { err: stageError, containerId, meetingId: addedId },
            'Meeting added but its stage could not be created'
          );
        } else {
          stageId = rows?.[0]?.id ?? null;

          /*
           * Only when a stage actually exists. Announcing a charge the write
           * failed to create would promise the client an invoice nobody can
           * raise — and the owner would have no idea the two disagreed.
           */
          if (stageId) {
            chargedLabel = new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: String(existing?.currency ?? proposal.currency ?? 'USD'),
            }).format(amount);
          }

          /*
           * The plan's total follows its stages. Left behind, the plan would
           * say ₪500 while owing ₪583.33, and every total built from it would
           * disagree with the invoices it raises.
           */
          const { data: plan } = await supabaseServer
            .from('payment_plans')
            .select('total_amount, installment_count')
            .eq('id', proposal.created_plan_id)
            .eq('user_id', user.id)
            .maybeSingle();

          if (plan) {
            await supabaseServer
              .from('payment_plans')
              .update({
                total_amount: Number(plan.total_amount ?? 0) + amount,
                installment_count: Number(plan.installment_count ?? sessionsSoFar) + 1,
              })
              .eq('id', proposal.created_plan_id)
              .eq('user_id', user.id);
          }
        }
      }
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * AND NOW THE CLIENT IS TOLD, once everything about this session is true.
     *
     * The old shape sends its own confirmation from inside `createBooking`;
     * this is the new one, where there is no booking to confirm — the session
     * is a meeting on a purchase the client already holds.
     *
     * `addedSession` is what stops it reading as a brand-new appointment: a
     * client with six sessions was receiving a mail indistinguishable from the
     * one that confirms a standalone booking, with no sign it was a seventh
     * added to their block. The charge line appears only when a stage was
     * actually created.
     *
     * Never fatal. The session exists and is in the diary; mail that did not
     * go out is visible on the journey and re-sendable.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (asMeetings) {
      try {
        const { BookingEmailService } = await import('@/lib/services/BookingEmailService');
        const mail = await BookingEmailService.sendBookingConfirmation(containerId, user.id, {
          sessions: [{ start, end }],
          skipInvoice: true,
          addedSession: { chargedAmount: chargedLabel },
        });

        clientNotified = mail.sent;

        if (!mail.sent) {
          requestLogger.warn(
            { containerId, meetingId: addedId, error: mail.error },
            'Session added but the client was not told'
          );
        }
      } catch (err) {
        requestLogger.error({ err, containerId }, "A session's confirmation threw");
      }
    }

    auditTrail
      .log({
        action: 'SCHEDULING_PACKAGE_MEETING_ADDED',
        userId: user.id,
        entityType: asMeetings ? 'scheduling_meeting' : 'scheduling_booking',
        entityId: addedId,
        resourceName: `Meeting ${nextNumber} of ${proposal?.title ?? 'a package'}`,
        details: { containerId, charged: Boolean(stageId), occurrenceNumber: nextNumber },
        request,
      })
      .catch(err => requestLogger.warn({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info(
      { containerId, meetingId: addedId, occurrenceNumber: nextNumber, charged: Boolean(stageId) },
      'Meeting added to a package'
    );

    return NextResponse.json({
      success: true,
      /* The row that was added, whichever table it went to. */
      meeting: addedRow,
      charged: Boolean(stageId),
      client_notified: clientNotified,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined,
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
