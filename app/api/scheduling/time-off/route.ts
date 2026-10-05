/**
 * GET  /api/scheduling/time-off — the days this business is closed or short
 * POST /api/scheduling/time-off — record one
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `scheduling_availability_exceptions` has existed since 20260722 with full RLS
 * and nothing ever wrote to it, so every business's list was empty and the
 * reading side had nothing to subtract. This is the half that fills it.
 *
 * The reading side is `windowsForDate` in lib/scheduling/availabilityWindows.ts,
 * which the public booking page, the smart-link page and the chat all go
 * through — so a day recorded here stops being offered everywhere at once.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingTimeOffAPI' });
const auditTrail = AuditTrailService.getInstance();

/** `YYYY-MM-DD`: a calendar day in the business's own reckoning, not an instant. */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const clock = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM');

/*
 * Validated as a whole rather than field by field, because two of the rules are
 * about the relationship between fields: a range cannot end before it starts,
 * and a short day without hours is not a short day. `windowsForDate` treats an
 * unreadable `custom_hours` as a CLOSED date — the conservative reading of a
 * recorded intention to restrict — so letting one through here would close a day
 * the owner meant to shorten.
 */
const createSchema = z
  .object({
    exception_type: z.enum(['unavailable', 'custom_hours']),
    start_date: dateKey,
    end_date: dateKey,
    custom_hours: z.object({ start: clock, end: clock }).nullable().optional(),
    reason: z.string().max(200).nullable().optional(),
  })
  .refine(value => value.end_date >= value.start_date, {
    message: 'The last day cannot be before the first',
    path: ['end_date'],
  })
  .refine(
    value =>
      value.exception_type !== 'custom_hours' ||
      (value.custom_hours && value.custom_hours.end > value.custom_hours.start),
    {
      message: 'Short hours need a start and an end, in that order',
      path: ['custom_hours'],
    }
  );

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    /*
     * Everything, not a window. This is the settings list, where an owner is
     * looking for the fortnight they booked off in December.
     */
    const result = await schedulingTimeOffRepository.list(user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to list time off');
      return NextResponse.json({ success: false, error: 'Failed to load time off' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: result.data ?? [] });
  } catch (error) {
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

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const validated = createSchema.parse(await request.json());

    const result = await schedulingTimeOffRepository.create({
      user_id: user.id,
      exception_type: validated.exception_type,
      start_date: validated.start_date,
      end_date: validated.end_date,
      custom_hours: validated.custom_hours ?? null,
      reason: validated.reason ?? null,
    });

    if (result.error || !result.data) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to record time off');
      return NextResponse.json({ success: false, error: 'Failed to save time off' }, { status: 500 });
    }

    auditTrail
      .log({
        action: 'SCHEDULING_TIME_OFF_ADDED',
        userId: user.id,
        entityType: 'scheduling_availability_exception',
        entityId: result.data.id,
        resourceName: `${validated.start_date} → ${validated.end_date}`,
        details: { type: validated.exception_type, reason: validated.reason ?? null },
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    requestLogger.info(
      { userId: user.id, from: validated.start_date, to: validated.end_date, type: validated.exception_type },
      'Time off recorded'
    );

    return NextResponse.json({ success: true, data: result.data }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.issues },
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
