/**
 * Send a quote again, because the client cannot find it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ITS OWN ROUTE, NOT A FLAG ON `send` OR `remind`
 *
 * `send` claims the quote with a conditional `draft → sent` and returns
 * `alreadySent` for anything past that — the guarantee that one quote produces
 * one email, which a resend is asking to bypass. Adding a bypass flag to it
 * would put "do not enforce the thing this function exists to enforce" inside
 * the function.
 *
 * `remind` is a nudge with its own copy and a seven-day cooldown, meant for a
 * client who HAS read the quote and not answered. A client who never found the
 * email should not be chased, and should not be refused for a cooldown on a
 * reminder nobody sent them.
 *
 * So: a third verb, sharing the delivery with the first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { resendProposal } from '@/lib/services/ProposalSendService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'proposal-resend' });

/** What the dialog says for each refusal, keyed so the UI can translate it. */
const REFUSALS: Record<string, { status: number; code: string }> = {
  not_found: { status: 404, code: 'not_found' },
  not_sent_yet: { status: 409, code: 'not_sent_yet' },
  already_opened: { status: 409, code: 'already_opened' },
  already_answered: { status: 409, code: 'already_answered' },
  no_client_email: { status: 400, code: 'no_client_email' },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const outcome = await resendProposal(id, user.id);

    if (!outcome.ok) {
      const refusal = REFUSALS[outcome.reason] ?? { status: 400, code: outcome.reason };
      requestLogger.info({ proposalId: id, reason: outcome.reason }, 'Resend refused');
      return NextResponse.json(
        { success: false, code: refusal.code },
        { status: refusal.status }
      );
    }

    /* Non-blocking, per CLAUDE.md: an audit failure must not fail the send the
       client has already received. */
    AuditTrailService.getInstance()
      .log({
        action: 'PROPOSAL_RESENT',
        entityType: 'proposal',
        entityId: id,
        userId: user.id,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, proposal: outcome.proposal });
  } catch (error) {
    requestLogger.error({ err: error, proposalId: id }, 'Resend failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not resend the quote',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
