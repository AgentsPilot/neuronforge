// app/api/audit/query/route.ts - Query audit trail logs
import { NextRequest, NextResponse } from 'next/server';
import { AuditTrail } from '@/lib/services/AuditTrailService';

// GET /api/audit/query - Query audit logs for current user
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action') || undefined;
    const entityType = searchParams.get('entityType') || undefined;
    const severity = searchParams.get('severity') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Query audit logs
    const result = await AuditTrail.query({
      userId,
      action: action as any,
      entityType: entityType as any,
      severity: severity as any,
      limit,
      offset,
      sortBy: 'created_at',
      sortOrder: 'desc'
    });

    return NextResponse.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Error in GET /api/audit/query:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
