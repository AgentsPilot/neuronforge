/**
 * Whether the business collects intake, and whether we send it for them.
 *
 *   GET  /api/intake/settings
 *   POST /api/intake/settings
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two switches, and a fact that is not a switch.
 *
 *   is_enabled          the business collects intake at all
 *   send_after_booking  we email it when a booking is made, or they send it
 *   hasPublishedForm    derived — there is an approved form to send
 *
 * The third is why this route exists in its current shape. Every caller feeds
 * this response into `intakeReachesClient` or `businessCollectsIntake`, and
 * both now require an approved form; returning the switches without it would
 * let a caller conclude intake is live while the only form is an unread draft.
 * So the join happens here, once, rather than at each surface.
 *
 * `template_id` and `collect_during_booking` are gone. The first pointed at a
 * shared catalogue that no longer exists; the second was accepted and silently
 * discarded by this route while a deprecated resolver still gated the public
 * form on it — so a business with it false received an intake email whose link
 * said there was no intake form.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module app/api/intake/settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { intakeFormRepository } from '@/lib/repositories/IntakeFormRepository';

const logger = createLogger({ module: 'IntakeSettingsAPI' });

const updateSettingsSchema = z.object({
  is_enabled: z.boolean().optional(),
  send_after_booking: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const [settings, published] = await Promise.all([
      intakeRepository.getSettings(user.id),
      intakeFormRepository.getPublished(user.id),
    ]);

    if (settings.error) throw settings.error;

    return NextResponse.json({
      success: true,
      settings: {
        is_enabled: settings.data?.is_enabled ?? false,
        // Defaults to false rather than true. A business with no row has not
        // said we may email their clients, and the switch is the saying.
        send_after_booking: settings.data?.send_after_booking ?? false,
        hasPublishedForm: !!published.data,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch intake settings');
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

    const validation = updateSettingsSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', details: validation.error.errors },
        { status: 400 }
      );
    }

    const updates = validation.data;

    const { data: settings, error } = await intakeRepository.upsertSettings(user.id, updates);
    if (error) throw error;

    const { data: published } = await intakeFormRepository.getPublished(user.id);

    requestLogger.info(
      { userId: user.id, ...updates, hasPublishedForm: !!published },
      'Intake settings saved'
    );

    /*
     * Switching intake on with nothing published is ALLOWED, and deliberately.
     *
     * The old route refused the equivalent state — enabled with no template —
     * because it stored cleanly and did nothing. That reasoning does not carry
     * over: turning the switch on is now the first step of a flow that
     * continues on the same screen, with the form written and waiting to be
     * read. Refusing it would mean refusing the owner's first click.
     *
     * Nothing is at risk, because the publish gate lives in `intakeReach` and
     * not in this switch: enabled with no published form sends nobody anything.
     */
    return NextResponse.json({
      success: true,
      settings: {
        is_enabled: settings?.is_enabled ?? false,
        send_after_booking: settings?.send_after_booking ?? false,
        hasPublishedForm: !!published,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to save intake settings');
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
