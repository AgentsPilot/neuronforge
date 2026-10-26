/**
 * Recent messages, for the owner to point at one enquiry.
 *
 * Metadata only — sender, subject, date. The body of a message they have not
 * chosen is none of the platform's business, and the connect screen promises
 * exactly that.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { listRecentMessages } from '@/lib/business-os/leads/inboxChannelSetup';

const logger = createLogger({ module: 'InboxSamplesAPI' });

const Query = z.object({ provider: z.enum(['google-mail', 'outlook']) });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const parsed = Query.safeParse({
      provider: request.nextUrl.searchParams.get('provider'),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Choose a connected mailbox: google-mail or outlook' },
        { status: 400 }
      );
    }

    const messages = await listRecentMessages(user.id, parsed.data.provider);

    /* Count only. Subjects and senders are the owner's own mail and have no
       place in a log line. */
    requestLogger.info(
      { userId: user.id, provider: parsed.data.provider, count: messages.length },
      'Listed recent messages for the inbox picker'
    );

    return NextResponse.json({ success: true, data: messages });
  } catch (error) {
    requestLogger.error({ err: error }, 'Could not list recent messages');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not read your mailbox. Check the connection and try again.',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
