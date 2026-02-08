/**
 * Insights API - List Endpoint
 * GET /api/v6/insights?agentId={id}&status={status}
 *
 * List insights for a user or specific agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { InsightRepository } from '@/lib/repositories/InsightRepository';

export async function GET(request: NextRequest) {
  try {
    // Use createAuthenticatedServerClient for consistent auth
    const supabase = await createAuthenticatedServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const agentId = searchParams.get('agentId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '10');

    const repository = new InsightRepository(supabase);

    let insights;

    if (agentId) {
      // Get insights for specific agent
      insights = await repository.findByAgent(agentId, status as any);
    } else {
      // Get top insights for user
      insights = await repository.getTopInsights(user.id, limit);
    }

    return NextResponse.json({
      success: true,
      data: insights,
      count: insights.length,
    });
  } catch (error) {
    console.error('[InsightsAPI] GET error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch insights',
      },
      { status: 500 }
    );
  }
}
