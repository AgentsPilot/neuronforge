/**
 * Switch the channel on: create this owner's agent from the shipped plan.
 *
 * The last step of setup, and the first thing that writes anything. Everything
 * before it reads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { INBOX_STOP_AFTER_CHOICES } from '@/lib/business-os/leads/inboxProviders';
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
  /*
   * The owner's two choices: how often, and how far back.
   *
   * Validated against the offered lists here AND again in
   * `enableInboxChannel`, which is not belt-and-braces: this route is one
   * caller, and the setup module is where the stored value is decided. A
   * cadence nobody was offered must not be storable through either door.
   *
   * Optional, so a client that has not been updated still enables a channel
   * and gets the defaults the old constants were choosing silently.
   */
  cadence: z.enum(['every_5_minutes', 'every_15_minutes', 'every_30_minutes', 'hourly']).optional(),
  stopAfterDays: z.number().int().refine(d => INBOX_STOP_AFTER_CHOICES.includes(d), {
    message: 'not one of the offered windows',
  }).optional(),

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE SAME TWO ANSWERS AS A NUMBER AND A UNIT, WHICH SUPERSEDE THE PAIR
   * ABOVE.
   *
   * The named cadence could say only minutes or an hour, so "check it twice a
   * day" was unaskable here — while the adopted agents started at daily, so
   * "every four hours" was unaskable there. One control asks both now, and this
   * is what it sends.
   *
   * Validated as a SHAPE here and bounded in `enableInboxChannel`, which is the
   * same division the pair above uses: three units and a positive integer is
   * all this schema can honestly check, and which values the channel offers is
   * the setup module's fact. A list repeated here would be the second place to
   * change and the first one somebody forgot.
   *
   * Still not a cron string. A field that could say `* * * * *` is a mailshot
   * one keystroke away, and the enable would have no way to tell that from a
   * deliberate choice.
   */
  schedule: z
    .object({
      every: z.number().int().positive().max(1000),
      unit: z.enum(['minutes', 'hours', 'days']),
    })
    .optional(),

  /* How far back to keep looking, which this channel alone may answer in
     hours: its bound is an ISO instant handed to a mail search, not a whole
     number of days inside a BizQL `$date` offset. */
  stopAfter: z
    .object({
      every: z.number().int().positive().max(1000),
      unit: z.enum(['minutes', 'hours', 'days']),
    })
    .optional(),
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
