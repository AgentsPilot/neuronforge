/**
 * API Route: Respond to Approval Request
 *
 * POST /api/approvals/[id]/respond
 *
 * Records an approval or rejection response from a user
 *
 * Phase 6: Human-in-the-Loop
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ApprovalTracker } from '@/lib/pilot';
import { NextResponse } from 'next/server';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, decision, comment } = await request.json();

    // Validation
    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

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

    // Check if user is authorized
    if (!approvalRequest.approvers.includes(userId)) {
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

    // Log audit event
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

    return NextResponse.json({
      success: true,
      approval: {
        id: updatedApproval?.id,
        status: updatedApproval?.status,
        responses: updatedApproval?.responses,
      },
    });

  } catch (error: any) {
    console.error('[Approval API] Error:', error);

    return NextResponse.json(
      {
        error: error.message || 'Failed to record approval response',
        code: error.code
      },
      { status: 500 }
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
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

    return NextResponse.json({
      approval: approvalRequest,
    });

  } catch (error: any) {
    console.error('[Approval API] Error:', error);

    return NextResponse.json(
      { error: error.message || 'Failed to fetch approval request' },
      { status: 500 }
    );
  }
}
