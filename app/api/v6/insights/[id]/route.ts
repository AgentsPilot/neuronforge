/**
 * Insights API - Individual Insight Endpoint
 * GET /api/v6/insights/{id} - Get specific insight
 * PATCH /api/v6/insights/{id} - Update insight status
 * DELETE /api/v6/insights/{id} - Delete insight
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { InsightRepository } from '@/lib/repositories/InsightRepository';

export async function GET(
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
    const insight = await repository.findById(id);

    if (!insight) {
      return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
    }

    // Verify ownership
    if (insight.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Mark as viewed if status is 'new'
    if (insight.status === 'new') {
      await repository.updateStatus(id, 'viewed');
      insight.status = 'viewed';
    }

    return NextResponse.json({
      success: true,
      data: insight,
    });
  } catch (error) {
    console.error('[InsightsAPI] GET error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch insight',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    const body = await request.json();
    const { status, snooze_days } = body;

    const repository = new InsightRepository(supabase);

    // Verify ownership
    const insight = await repository.findById(id);
    if (!insight) {
      return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
    }
    if (insight.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Handle snooze
    if (snooze_days) {
      await repository.snooze(params.id, snooze_days);
      return NextResponse.json({
        success: true,
        message: `Insight snoozed for ${snooze_days} days`,
      });
    }

    // Handle status update
    if (status) {
      const validStatuses = ['new', 'viewed', 'applied', 'dismissed', 'snoozed'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }

      await repository.updateStatus(params.id, status);
      return NextResponse.json({
        success: true,
        message: 'Insight status updated',
      });
    }

    return NextResponse.json({ error: 'No update specified' }, { status: 400 });
  } catch (error) {
    console.error('[InsightsAPI] PATCH error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update insight',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    await repository.delete(params.id);

    return NextResponse.json({
      success: true,
      message: 'Insight deleted',
    });
  } catch (error) {
    console.error('[InsightsAPI] DELETE error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete insight',
      },
      { status: 500 }
    );
  }
}
