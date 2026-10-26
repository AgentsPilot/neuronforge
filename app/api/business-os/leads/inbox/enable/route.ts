/**
 * Switch the channel on: create this owner's agent from the shipped plan.
 *
 * The last step of setup, and the first thing that writes anything. Everything
 * before it reads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { enableInboxChannel } from '@/lib/business-os/leads/inboxChannelSetup';
import { inboxChannelStatus } from '@/lib/business-os/leads/inboxChannel';

const logger = createLogger({ module: 'InboxEnableAPI' });
const auditTrail = AuditTrailService.getInstance();

const Body = z.object({
  provider: z.enum(['google-mail', 'outlook']),
  /*
   * The measured rule as FACTS, not as one provider's query string.
   *
   * It was a `mailQuery` string, which only Gmail can read: Outlook takes the
   * same three facts as separate OData filters and cannot accept a free-text
   * query beside them at all. Sending the facts means the server phrases them
   * for whichever mailbox this channel is for.
   */
  rule: z.object({
    from: z.string().min(3).max(320),
    subjectPrefix: z.string().max(400),
    since: z.string().datetime(),
  }),
  watching: z.string().min(1),
  template: z.object({
    subjectPrefix: z.string(),
    nameFollowsSubject: z.boolean(),
    labels: z.array(z.string()),
    learnedFrom: z.number(),
  }),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Finish the setup steps before switching this on' },
        { status: 400 }
      );
    }

    /*
     * The mailbox must still be connected. Between the picker and this call an
     * owner can revoke access in another tab, and an agent reading a mailbox it
     * cannot open would fail every five minutes with nothing to show for it.
     */
    const before = await inboxChannelStatus(user.id);
    const alreadySetUp = before.channels.some(c => c.provider === parsed.data.provider);

    /*
     * `connectable` holds mailboxes with NO channel yet, so a provider being
     * absent from it means one of two different things: the mailbox is gone,
     * or it is already set up and this is a re-point. Only the first is a
     * refusal — rejecting the second would make "change which emails"
     * impossible for a channel that is working.
     */
    if (!before.connectable.includes(parsed.data.provider) && !alreadySetUp) {
      return NextResponse.json(
        { success: false, error: 'That mailbox is not connected any more. Reconnect it and try again.' },
        { status: 400 }
      );
    }

    const { agentId } = await enableInboxChannel({ userId: user.id, ...parsed.data });

    auditTrail
      .log({
        action: 'INBOX_CHANNEL_ENABLED',
        entityType: 'agent',
        entityId: agentId,
        userId: user.id,
        resourceName: parsed.data.watching,
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ userId: user.id, agentId }, 'Inbox channel enabled');

    return NextResponse.json({ success: true, data: await inboxChannelStatus(user.id) });
  } catch (error) {
    requestLogger.error({ err: error }, 'Could not enable the inbox channel');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not switch the channel on. Nothing was changed.',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
