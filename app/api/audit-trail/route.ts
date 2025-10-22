// app/api/audit-trail/route.ts
// API endpoint for audit trail operations

import { NextRequest, NextResponse } from 'next/server';
import { AuditTrail } from '@/lib/services/AuditTrailService';

// POST /api/audit-trail
// Log an audit trail event from client-side
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      action,
      entityType,
      entityId,
      resourceName,
      userId,
      details,
      severity,
      complianceFlags
    } = body;

    // Validate required fields
    if (!action || !entityType || !userId) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields',
        message: 'action, entityType, and userId are required'
      }, { status: 400 });
    }

    console.log(`DEBUG: Logging audit trail event: ${action} for user ${userId}`);

    // Log the audit trail event
    await AuditTrail.log({
      action,
      entityType,
      entityId,
      resourceName,
      userId,
      request, // Pass request for IP/user-agent extraction
      details,
      severity,
      complianceFlags
    });

    return NextResponse.json({
      success: true,
      message: 'Audit trail logged successfully'
    });

  } catch (error: any) {
    console.error('DEBUG: Error logging audit trail:', error);

    return NextResponse.json({
      success: false,
      error: 'Failed to log audit trail',
      message: error.message
    }, { status: 500 });
  }
}

// GET /api/audit-trail?userId={userId}&limit={limit}&offset={offset}
// Retrieve audit trail events for a user
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const action = searchParams.get('action');
    const entityType = searchParams.get('entityType');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'Missing required parameters',
        message: 'userId is required'
      }, { status: 400 });
    }

    console.log(`DEBUG: Fetching audit trail for user ${userId}`);

    // Build query filters
    const filters: any = { userId };
    if (action) filters.action = action;
    if (entityType) filters.entityType = entityType;

    // Get audit trail events
    const events = await AuditTrail.query(filters, { limit, offset });

    return NextResponse.json({
      success: true,
      events,
      count: events.length,
      limit,
      offset
    });

  } catch (error: any) {
    console.error('DEBUG: Error fetching audit trail:', error);

    return NextResponse.json({
      success: false,
      error: 'Failed to fetch audit trail',
      message: error.message
    }, { status: 500 });
  }
}
