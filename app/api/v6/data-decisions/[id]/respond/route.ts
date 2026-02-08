/**
 * Data Decision Response API
 *
 * POST /api/v6/data-decisions/{id}/respond
 *   - User responds to a data decision request
 *   - Body: { action: 'continue' | 'stop' | 'skip', remember: boolean }
 *   - Updates decision request status and stores user's choice
 *
 * @module app/api/v6/data-decisions/[id]/respond
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decisionId = params.id;

    // Parse request body
    const body = await request.json();

    // Validate action
    const validActions = ['continue', 'stop', 'skip'];
    if (!body.action || !validActions.includes(body.action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be: continue, stop, or skip' },
        { status: 400 }
      );
    }

    // Check that the decision request exists and belongs to this user
    const { data: existing, error: fetchError } = await supabase
      .from('data_decision_requests')
      .select('*')
      .eq('id', decisionId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Decision request not found' },
        { status: 404 }
      );
    }

    // Check if already responded
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: `Decision request already ${existing.status}` },
        { status: 400 }
      );
    }

    // Update decision request with user's response
    const { data, error } = await supabase
      .from('data_decision_requests')
      .update({
        status: 'responded',
        user_decision: {
          action: body.action,
          remember: body.remember || false,
        },
        responded_at: new Date().toISOString(),
      })
      .eq('id', decisionId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('[API] Error updating decision request:', error.message);
      return NextResponse.json(
        { error: 'Failed to update decision request' },
        { status: 500 }
      );
    }

    console.log(
      `[API] User ${user.id} responded to decision ${decisionId} with action: ${body.action}, remember: ${body.remember}`
    );

    return NextResponse.json({ data }, { status: 200 });
  } catch (err) {
    console.error('[API] POST /api/v6/data-decisions/[id]/respond error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
