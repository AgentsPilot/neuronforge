/**
 * The fallback path to confirming a subscription.
 *
 * Most people never reach this: clicking the link in the email confirms on
 * arrival, and the page renders the finished state. This exists for the
 * requests that did not look like a person clicking — an older browser that
 * sends no fetch metadata, a mail client that strips it — where the page shows
 * a button instead. This is what that button posts to.
 *
 * POST, never GET. A GET here would reintroduce the thing the page's own guard
 * is for: corporate gateways and Safe Links fetch every URL in an email, and an
 * endpoint that confirmed on fetch would manufacture consent for people who
 * never clicked anything.
 *
 * Public and unauthenticated: the person confirming has no account here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { confirmConsent } from '@/lib/consent/confirmConsent';
import { buildAttributionFromRequest } from '@/lib/utils/attribution';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ConsentConfirmAPI' });

const BodySchema = z.object({ token: z.string().min(1).max(4096) });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ success: false, reason: 'invalid' }, { status: 400 });
    }

    const attribution = buildAttributionFromRequest(request, {
      captureChannel: 'form',
      generateSessionId: false,
    });

    const outcome = await confirmConsent(parsed.data.token, {
      ipHash: attribution.ip_hash ?? null,
      userAgent: request.headers.get('user-agent'),
      via: 'confirm_button',
    });

    if (!outcome.ok) {
      /*
       * 200 with a reason, not an error status. An expired link is a normal
       * thing that happens to people rather than a fault, and the page turns
       * each reason into a sentence they can act on.
       */
      return NextResponse.json({ success: false, reason: outcome.reason });
    }

    return NextResponse.json({
      success: true,
      data: { alreadyConfirmed: outcome.alreadyConfirmed },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to confirm consent');
    return NextResponse.json({ success: false, reason: 'failed' }, { status: 500 });
  }
}
