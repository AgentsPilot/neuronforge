/**
 * Where this owner's inbox channel stands.
 *
 * Read by every surface that shows the channel — the Channels tile, My Day,
 * the onboarding build page, readiness — so that none of them works it out
 * for itself. The reasoning lives in `inboxChannelStatus`; this is the door.
 *
 * GET only. Nothing here changes anything.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { inboxChannelStatus } from '@/lib/business-os/leads/inboxChannel';

const logger = createLogger({ module: 'InboxChannelStatusAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const status = await inboxChannelStatus(user.id);

    requestLogger.debug(
      { userId: user.id, state: status.state, problems: status.problems.length },
      'Inbox channel status read'
    );

    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    requestLogger.error({ err: error }, 'Could not read the inbox channel status');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not read the inbox channel',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
