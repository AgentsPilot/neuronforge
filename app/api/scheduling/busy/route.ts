/**
 * GET /api/scheduling/busy — the hours already committed, for the owner's own diary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `busyMeetings` is what the public booking page, `free-slots`, the booking
 * time step, the reschedule route and quote acceptance all read to decide
 * whether an hour is free. It was reachable from the server and from no owner
 * surface, so the one owner screen that needed it — the quote builder, warning
 * before a package is offered — read `/api/scheduling/bookings` instead.
 *
 * That answered correctly while a package was a container plus N CHILD
 * BOOKINGS. Once a package became one booking with N MEETINGS, its sessions
 * left `scheduling_bookings` entirely and the container kept `start_time:
 * null`, so a date filter dropped it. The check stayed in place, kept catching
 * clashes with ordinary appointments, and went blind to every package — the
 * thing most likely to collide with a package.
 *
 * Measured: a quote offering 8, 15 and 22 November at 08:00 was sent and
 * accepted while another package had held 15 and 22 since two hours earlier.
 * One of three sessions was created; the database's overlap constraint refused
 * the rest, after the client had agreed and paid.
 *
 * So this exposes the SAME function rather than a second opinion. A quote and
 * a booking page that disagree about a free hour is the bug class this closes.
 *
 * ── WHAT IT IS NOT ──
 *
 * Not a free-slot finder: it applies no working hours, no closed days and no
 * service duration, and so it cannot say what to OFFER a client — that is
 * `free-slots`. It answers only "is this hour already committed", which is the
 * question a screen holding specific chosen times has.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { busyMeetings } from '@/lib/scheduling/busyMeetings';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'SchedulingBusyAPI' });

const querySchema = z
  .object({
    from: z
      .string()
      .refine(value => !Number.isNaN(Date.parse(value)), { message: 'Invalid from date' }),
    to: z.string().refine(value => !Number.isNaN(Date.parse(value)), { message: 'Invalid to date' }),
    /*
     * One booking's own hours, left out of the answer.
     *
     * The caller editing a package must not be told its own sessions are a
     * clash — see `busyMeetings`, which takes this for the same reason and
     * deliberately refuses a general ignore-list, since anything wider is a way
     * to hide a real clash.
     */
    exclude_booking_id: z.string().uuid().optional(),
  })
  .refine(value => Date.parse(value.from) < Date.parse(value.to), {
    message: 'from must be before to',
  });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const params = new URL(request.url).searchParams;
    const validated = querySchema.safeParse({
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      exclude_booking_id: params.get('exclude_booking_id') || undefined,
    });

    if (!validated.success) {
      return NextResponse.json(
        { success: false, error: validated.error.issues[0]?.message ?? 'Invalid range' },
        { status: 400 }
      );
    }

    /*
     * `supabaseServer`, scoped by `user.id` inside `busyMeetings`.
     *
     * The service role is deliberate and is what every other caller passes: a
     * committed hour belongs to the BUSINESS, and the owner asking is the
     * business. RLS would answer the same here; the function filters on the id
     * this route resolved from the session, never from the query string, so no
     * caller can ask about another tenant's diary.
     */
    const busy = await busyMeetings(
      supabaseServer,
      user.id,
      new Date(validated.data.from).toISOString(),
      new Date(validated.data.to).toISOString(),
      validated.data.exclude_booking_id ?? null
    );

    requestLogger.debug(
      { userId: user.id, from: validated.data.from, to: validated.data.to, busy: busy.length },
      'Busy hours read'
    );

    /*
     * `busyMeetings` returns `[]` on a failed read and logs it — deliberate at
     * that layer, and deliberately not the whole safety story: an empty answer
     * makes every hour look free, and both write paths re-check under the
     * database's overlap constraint. This route keeps that contract rather than
     * inventing a 500 the callers have no better answer for.
     */
    return NextResponse.json({ success: true, data: { busy } });
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
