// app/api/test/notification/route.ts
// TEST-ONLY route for the plugin test page's "Notification Service" tab.
// Sends a system email through the PRODUCTION transport (Resend → env Gmail →
// owner's google-mail plugin connection → console) so we can verify the
// environment email settings and see which provider actually delivered.
//
// Follows the test-page auth model: accepts userId in the body (no cookie auth).
// Not for production user flows.

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'TestNotificationAPI', service: 'test' });

export async function POST(req: NextRequest) {
  try {
    const { userId, to, subject, body } = await req.json().catch(() => ({}));

    // Default recipient: the explicit `to`, else the server-side test email.
    const recipient = (typeof to === 'string' && to.trim()) || process.env.SIMULATOR_USER_EMAIL;
    if (!recipient) {
      return NextResponse.json(
        { success: false, error: 'No recipient — provide "to" or set SIMULATOR_USER_EMAIL in the environment.' },
        { status: 400 }
      );
    }

    const result = await sendEmail({
      to: [recipient],
      subject: (typeof subject === 'string' && subject.length > 0) ? subject : 'NeuronForge — Notification Service test',
      html: (typeof body === 'string' && body.length > 0)
        ? body
        : '<p>This is a test email sent from the Notification Service test tab to verify environment email settings.</p>',
      ownerUserId: (typeof userId === 'string' && userId) ? userId : undefined,
    });

    logger.info({ to: recipient, provider: result.provider, sent: result.sent }, 'Test notification dispatched');

    return NextResponse.json({ success: true, to: recipient, ...result });
  } catch (error: any) {
    logger.error({ err: error }, 'Test notification failed');
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 });
  }
}
