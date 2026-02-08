/**
 * Insights API - Apply Recommendation Endpoint
 * POST /api/v6/insights/{id}/apply
 *
 * Applies the insight's recommendation by creating a behavior rule
 * (Future feature - for now just marks as applied)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { InsightRepository } from '@/lib/repositories/InsightRepository';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createAuthenticatedServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repository = new InsightRepository(supabase);

    // Verify ownership
    const insight = await repository.findById(id);
    if (!insight) {
      return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
    }
    if (insight.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // TODO: Create behavior rule based on insight type
    // For now, just mark as applied
    await repository.updateStatus(id, 'applied');

    // Future implementation:
    // switch (insight.insight_type) {
    //   case 'automation_opportunity':
    //     // Create auto-approval rule
    //     break;
    //   case 'reliability_risk':
    //     // Add fallback mechanism
    //     break;
    //   case 'cost_optimization':
    //     // Enable caching
    //     break;
    //   // etc.
    // }

    return NextResponse.json({
      success: true,
      message: 'Insight recommendation applied (marked as applied)',
      note: 'Automatic rule creation coming soon',
    });
  } catch (error) {
    console.error('[InsightsAPI] POST apply error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply insight',
      },
      { status: 500 }
    );
  }
}
