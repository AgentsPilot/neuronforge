/**
 * Send a proposal to the client, and freeze its terms.
 *
 * The sequence itself lives in `ProposalSendService` — the chat can send a
 * quote too, and two copies of an eight-step ordered send would drift on the
 * first change either of them made. What stays here is what a route owns:
 * authentication, the audit entry, and the shape of the reply.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { sendProposal } from '@/lib/services/ProposalSendService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'ProposalSendAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id } = await params;

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const outcome = await sendProposal(id, user.id);

    if (!outcome.ok) {
      return outcome.reason === 'not_found'
        ? NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 })
        : NextResponse.json(
            { success: false, error: 'That client has no email address', code: 'no_client_email' },
            { status: 400 }
          );
    }

    if (outcome.alreadySent) {
      // Not an error: the claim is what guarantees one email, and a second
      // request simply returns the quote unchanged.
      return NextResponse.json({ success: true, proposal: outcome.proposal, alreadySent: true });
    }

    auditTrail
      .log({
        action: 'PROPOSAL_SENT',
        userId: user.id,
        entityType: 'proposal',
        entityId: outcome.proposal.id,
        resourceName: outcome.proposal.title,
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, proposal: outcome.proposal });
  } catch (error) {
    requestLogger.error({ err: error, proposalId: id }, 'Failed to send proposal');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
