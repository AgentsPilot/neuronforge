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
  BookingSlotUnavailableError,
  BookingOnClosedDayError,
} from '@/lib/services/BookingLifecycleService';

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

    if (!siblings?.length) {
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
    const nextNumber =
      Math.max(0, ...siblings.map(child => Number(child.occurrence_number ?? 0))) + 1;

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

    const meeting = created.data!.booking;

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

    if (input.charge && perSession && proposal?.created_plan_id) {
      const { data: existing } = await supabaseServer
        .from('payment_plan_installments')
        .select('amount, currency, installment_number')
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
            booking_id: meeting.id,
            installment_number: Number(existing?.installment_number ?? siblings.length) + 1,
            amount,
            currency: String(existing?.currency ?? proposal.currency ?? 'USD'),
            label: `${proposal.title} (${nextNumber})`,
            trigger: 'manual',
            due_date: null,
            status: 'pending',
          },
        ] as Parameters<typeof paymentPlanRepository.createInstallments>[0]);

        if (stageError) {
          requestLogger.error(
            { err: stageError, containerId, meetingId: meeting.id },
            'Meeting added but its stage could not be created'
          );
        } else {
          stageId = rows?.[0]?.id ?? null;

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
                installment_count: Number(plan.installment_count ?? siblings.length) + 1,
              })
              .eq('id', proposal.created_plan_id)
              .eq('user_id', user.id);
          }
        }
      }
    }

    auditTrail
      .log({
        action: 'SCHEDULING_PACKAGE_MEETING_ADDED',
        userId: user.id,
        entityType: 'scheduling_booking',
        entityId: meeting.id,
        resourceName: `Meeting ${nextNumber} of ${proposal?.title ?? 'a package'}`,
        details: { containerId, charged: Boolean(stageId), occurrenceNumber: nextNumber },
        request,
      })
      .catch(err => requestLogger.warn({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info(
      { containerId, meetingId: meeting.id, occurrenceNumber: nextNumber, charged: Boolean(stageId) },
      'Meeting added to a package'
    );

    return NextResponse.json({
      success: true,
      meeting,
      charged: Boolean(stageId),
      client_notified: created.data!.clientNotified,
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
