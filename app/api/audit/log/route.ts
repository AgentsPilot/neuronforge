// app/api/audit/log/route.ts - Audit logging endpoint
import { NextRequest, NextResponse } from 'next/server';
import { auditLog } from '@/lib/services/AuditTrailService';
import { generateDiff } from '@/lib/audit/diff';
import { EntityType, AuditSeverity, ComplianceFlag } from '@/lib/audit/types';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// POST /api/audit/log - Log an audit event
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');

    // Allow anonymous logging for certain events like failed logins
    if (!userId || userId === 'anonymous') {
      // For anonymous events, we'll allow logging but with null user_id
    }

    const body = await request.json();
    const {
      action,
      entityType,
      entityId,
      resourceName,
      before,
      after,
      details,
      severity,
      complianceFlags
    } = body;

    // Validate required fields
    if (!action || !entityType) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: action, entityType' },
        { status: 400 }
      );
    }

    // Generate changes if before/after provided
    const changes = before && after ? generateDiff(before, after) : undefined;

    // Log the audit event
    await auditLog({
      action,
      entityType: entityType as EntityType,
      entityId: entityId || null,
      userId: userId === 'anonymous' ? null : userId,
      resourceName: resourceName || undefined,
      changes: changes || undefined,
      details: details || undefined,
      severity: (severity as AuditSeverity) || 'info',
      complianceFlags: complianceFlags as ComplianceFlag[] || undefined,
      request
    });

    return NextResponse.json({
      success: true,
      message: 'Audit log recorded'
    });

  } catch (error) {
    console.error('Error in POST /api/audit/log:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
