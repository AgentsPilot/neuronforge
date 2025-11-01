// app/api/admin/audit-trail/route.ts
// API for querying AIS audit trail with filters

import { NextResponse, NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize service role client for admin operations
const supabaseServiceRole = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - Fetch audit trail logs with filters
export async function GET(request: NextRequest) {
  try {
    // TODO: Add admin role check here
    const searchParams = request.nextUrl.searchParams;

    // Get filter parameters
    const action = searchParams.get('action');
    const severity = searchParams.get('severity');
    const entityType = searchParams.get('entity_type');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('page_size') || '50');

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;

    console.log('🔍 [Audit Trail] Fetching logs with filters:', {
      action,
      severity,
      entityType,
      dateFrom,
      dateTo,
      search,
      page,
      pageSize,
      offset
    });

    // Build query - get ALL audit records with count
    let query = supabaseServiceRole
      .from('audit_trail')
      .select('*', { count: 'exact' });

    // Apply filters
    if (action && action !== 'all') {
      query = query.eq('action', action);
    }

    if (severity && severity !== 'all') {
      query = query.eq('severity', severity);
    }

    if (entityType && entityType !== 'all') {
      query = query.eq('entity_type', entityType);
    }

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    // Order by most recent first
    query = query.order('created_at', { ascending: false });

    // Apply pagination with range
    if (search) {
      // When searching JSONB, fetch more records to filter in memory
      query = query.range(offset, offset + (pageSize * 5) - 1);
    } else {
      // Normal pagination
      query = query.range(offset, offset + pageSize - 1);
    }

    const { data: logs, error, count } = await query;

    if (error) {
      console.error('❌ [Audit Trail] Error fetching logs:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch audit logs: ' + error.message
      }, { status: 500 });
    }

    // If search term is provided, search within all fields including JSONB
    let filteredLogs = logs || [];
    if (search && logs) {
      const searchLower = search.toLowerCase();

      // Helper function to search within JSONB
      const searchInJSON = (obj: any): boolean => {
        if (!obj) return false;
        const jsonString = JSON.stringify(obj).toLowerCase();
        return jsonString.includes(searchLower);
      };

      // Filter to include records where search term appears anywhere
      filteredLogs = logs.filter((log: any) => {
        // Check text fields
        const matchedTextFields =
          log.resource_name?.toLowerCase().includes(searchLower) ||
          log.entity_id?.toLowerCase().includes(searchLower) ||
          log.user_email?.toLowerCase().includes(searchLower) ||
          log.action?.toLowerCase().includes(searchLower);

        // Check JSONB fields
        const matchedJSONFields =
          searchInJSON(log.details) ||
          searchInJSON(log.changes);

        return matchedTextFields || matchedJSONFields;
      });

      // Apply limit after JSONB filtering
      filteredLogs = filteredLogs.slice(0, pageSize);
    }

    // Get unique user IDs from filtered logs to fetch additional user info (full_name)
    const userIds = [...new Set(filteredLogs?.map((log: any) => log.user_id).filter(Boolean))];

    // Fetch user information for display purposes (full_name not in audit_trail)
    let usersMap: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: users, error: usersError } = await supabaseServiceRole
        .from('users')
        .select('id, email, full_name')
        .in('id', userIds);

      if (!usersError && users) {
        usersMap = Object.fromEntries(users.map(u => [u.id, u]));
      }
    }

    // Attach user information to filtered logs for display
    const logsWithUsers = filteredLogs.map((log: any) => ({
      ...log,
      users: log.user_id ? usersMap[log.user_id] : null
    }));

    console.log(`✅ [Audit Trail] Found ${logsWithUsers.length} logs on page ${page} (searched in JSONB: ${search ? 'yes' : 'no'})`);

    // Calculate pagination metadata
    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / pageSize);
    const hasMore = page < totalPages;

    return NextResponse.json({
      success: true,
      logs: logsWithUsers,
      pagination: {
        page,
        pageSize,
        total: totalCount,
        totalPages,
        hasMore,
        showing: logsWithUsers.length
      }
    });

  } catch (error: any) {
    console.error('❌ [Audit Trail] Exception:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
}
