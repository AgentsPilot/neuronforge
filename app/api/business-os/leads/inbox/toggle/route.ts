/**
 * Pause or resume one mailbox's lead channel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PAUSING IS A DECISION, NOT A FAULT, AND IT MUST BE REVERSIBLE IN ONE PRESS
 *
 * An owner going on holiday, or one whose form is being rebuilt, wants the
 * reading to stop without losing the template they measured, the rule they
 * checked, or the mailbox they connected. Deleting the agent would cost all
 * three and make them run setup again; a status change costs nothing and is
 * undone by the same control.
 *
 * Per MAILBOX, because a business can run two: pausing Gmail must leave
 * Outlook reading.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STATUS IS THE SWITCH
 *
 * The cron selects `status = 'active'`, so an inactive agent is simply not
 * run — there is nothing else to turn off and no second flag that could
 * disagree with this one. It goes through the repository's transition guard
 * rather than a raw update, so an illegal move is refused rather than written.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { agentRepository } from '@/lib/repositories/AgentRepository';
import { inboxChannelStatus, inboxChannelTag } from '@/lib/business-os/leads/inboxChannel';

const logger = createLogger({ module: 'InboxToggleAPI' });
const auditTrail = AuditTrailService.getInstance();

const Body = z.object({
  provider: z.enum(['google-mail', 'outlook']),
  /** True resumes, false pauses. Stated rather than toggled, so two clicks
      racing cannot land on the opposite of what the owner last pressed. */
  running: z.boolean(),
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
        { success: false, error: 'Say which mailbox, and whether it should run' },
        { status: 400 }
      );
    }
    const { provider, running } = parsed.data;

    const { data: agents } = await agentRepository.findAllByUser(user.id, {
      includeInactive: true,
      limit: 200,
    });
    const agent = (agents ?? []).find(a => (a.tags ?? []).includes(inboxChannelTag(provider)));

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'That mailbox has no channel to pause.' },
        { status: 404 }
      );
    }

    /* Already where it was asked to be: say so without writing. A repeated
       press is not an error, and the transition guard would refuse it. */
    const alreadyThere = running ? agent.status === 'active' : agent.status !== 'active';
    if (!alreadyThere) {
      const { error } = running
        ? await agentRepository.activate(agent.id, user.id)
        : await agentRepository.pause(agent.id, user.id, 'inbox_channel_paused_by_owner');

      if (error) {
        requestLogger.error({ err: error, agentId: agent.id }, 'Could not change the channel state');
        return NextResponse.json(
          { success: false, error: 'Could not change it. Nothing was altered.' },
          { status: 500 }
        );
      }

      auditTrail
        .log({
          action: running ? 'INBOX_CHANNEL_RESUMED' : 'INBOX_CHANNEL_PAUSED',
          entityType: 'agent',
          entityId: agent.id,
          userId: user.id,
          request,
        })
        .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));
    }

    requestLogger.info({ userId: user.id, provider, running }, 'Inbox channel state set');
    return NextResponse.json({ success: true, data: await inboxChannelStatus(user.id) });
  } catch (error) {
    requestLogger.error({ err: error }, 'Could not toggle the inbox channel');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not change it. Nothing was altered.',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
