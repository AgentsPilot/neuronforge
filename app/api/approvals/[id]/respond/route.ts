/**
 * API Route: Respond to Approval Request
 *
 * POST /api/approvals/[id]/respond — record an approve/reject
 * GET  /api/approvals/[id]/respond — read the approval request
 *
 * Phase 6: Human-in-the-Loop
 *
 * ── Identity is the authorization decision here ────────────────────────────
 * Until 2026-09-21 POST read `userId` from the request body and used it directly as the
 * authorization check (`approvalRequest.approvers.includes(userId)`), so naming any valid
 * approver passed it. An attacker could approve or reject any pending human-in-the-loop
 * gate — unblocking or killing another user's paused workflow run — and, because the same
 * value was passed to `auditLog`, the forged decision was attributed to the victim in the
 * audit trail.
 *
 * Both now come from the session (`getUser()`); the body `userId` is not read at all. GET
 * is gated too: it returned the full approval request (title, execution and step ids,
 * the approver list and every response recorded so far) to anonymous callers, which is
 * both a disclosure and the reconnaissance step for the POST forgery.
 *
 * Note for anyone re-reading the severity: this route builds an anon+cookie Supabase
 * client, so before the gate, RLS on `workflow_approval_requests` was the only remaining
 * obstacle — and that table has no migration in this repo (it was created in the
 * dashboard), so its RLS state is unmeasured. The gate makes that question moot for this
 * route, but it does not answer it.
 *
 * Middleware does not authenticate `/api/*` (middleware.ts:83).
 *
 * See docs/workplans/IDENTITY_SWEEP_WORKPLAN.md § Slice 0.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ApprovalTracker } from '@/lib/pilot';
import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'API', route: '/api/approvals/[id]/respond' });

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const requestLogger = logger.child({ approvalId: params.id });

  try {
    // Gate before the body is read: no session, no work, no parse.
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // The approver IS the session user. A `userId` in the body is ignored — it used to be
    // the whole vulnerability.
    const userId = user.id;

    const { decision, comment } = await request.json();

    if (!decision || !['approve', 'reject'].includes(decision)) {
      return NextResponse.json(
        { error: 'decision must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    const approvalId = params.id;

    // Initialize services
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );
    const approvalTracker = new ApprovalTracker(supabase);

    // Get approval request to verify user is authorized
    const approvalRequest = await approvalTracker.getApprovalRequest(approvalId);

    if (!approvalRequest) {
      return NextResponse.json(
        { error: 'Approval request not found' },
        { status: 404 }
      );
    }

    // Authorization: the SESSION user must be a named approver. `userId` is `user.id`
    // here — this line is the one the body value used to control.
    if (!approvalRequest.approvers.includes(userId)) {
      requestLogger.warn({ userId }, 'Non-approver attempted to respond to an approval');
      return NextResponse.json(
        { error: 'User not authorized to respond to this approval' },
        { status: 403 }
      );
    }

    // Check if approval is still pending
    if (approvalRequest.status !== 'pending') {
      return NextResponse.json(
        {
          error: 'Approval request is no longer pending',
          status: approvalRequest.status
        },
        { status: 400 }
      );
    }

    // Record the response
    await approvalTracker.recordApprovalResponse(
      approvalId,
      userId,
      decision,
      comment
    );

    // Get updated approval request
    const updatedApproval = await approvalTracker.getApprovalRequest(approvalId);

    // Log audit event. `userId` is the session user, so a decision can no longer be
    // attributed to someone who did not make it — the second half of the same bug.
    await auditLog({
      action: decision === 'approve' ? AUDIT_EVENTS.APPROVAL_APPROVED : AUDIT_EVENTS.APPROVAL_REJECTED,
      userId,
      entityType: 'execution',
      entityId: approvalId,
      resourceName: approvalRequest.title,
      details: {
        approvalId,
        executionId: approvalRequest.executionId,
        stepId: approvalRequest.stepId,
        title: approvalRequest.title,
        comment: comment || null,
        finalStatus: updatedApproval?.status,
        approvalType: approvalRequest.approvalType,
      },
    });

    requestLogger.info({ userId, decision }, 'Approval response recorded');

    return NextResponse.json({
      success: true,
      approval: {
        id: updatedApproval?.id,
        status: updatedApproval?.status,
        responses: updatedApproval?.responses,
      },
    });

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Failed to record approval response');

    return NextResponse.json(
      {
        error: 'Failed to record approval response',
        // Dev-guarded: the raw message and Postgres code describe internal schema.
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined,
        code: process.env.NODE_ENV === 'development' ? error?.code : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const requestLogger = logger.child({ approvalId: params.id });

  try {
    // Same gate as POST. This handler returns the approval's title, execution and step
    // ids, the full approver list and every response so far — the disclosure, and the
    // reconnaissance step for forging a POST. Only a named approver may read it.
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const approvalId = params.id;

    // Initialize services
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );
    const approvalTracker = new ApprovalTracker(supabase);

    // Get approval request
    const approvalRequest = await approvalTracker.getApprovalRequest(approvalId);

    if (!approvalRequest) {
      return NextResponse.json(
        { error: 'Approval request not found' },
        { status: 404 }
      );
    }

    // A session alone is not enough to READ someone else's approval either. 404 rather
    // than 403 on purpose: a non-approver should not learn that this id exists.
    if (!approvalRequest.approvers.includes(user.id)) {
      requestLogger.warn({ userId: user.id }, 'Non-approver attempted to read an approval');
      return NextResponse.json(
        { error: 'Approval request not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      approval: approvalRequest,
    });

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Failed to fetch approval request');

    return NextResponse.json(
      {
        error: 'Failed to fetch approval request',
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined,
      },
      { status: 500 }
    );
  }
}
