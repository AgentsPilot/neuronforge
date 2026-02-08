/**
 * Data Decision Requests API
 *
 * GET  /api/v6/data-decisions?execution_id={id}
 *   - Returns pending decision requests for an execution
 *   - Used by frontend polling to detect paused executions
 *
 * POST /api/v6/data-decisions (internal — called by DataDecisionHandler)
 *   - Creates a new decision request
 *   - Returns the created request
 *
 * @module app/api/v6/data-decisions
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get execution_id from query params
    const searchParams = request.nextUrl.searchParams;
    const executionId = searchParams.get('execution_id');

    if (!executionId) {
      return NextResponse.json(
        { error: 'execution_id query parameter is required' },
        { status: 400 }
      );
    }

    // Fetch pending decision requests for this execution
    const { data, error } = await supabase
      .from('data_decision_requests')
      .select('*')
      .eq('execution_id', executionId)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[API] Error fetching decision requests:', error.message);
      return NextResponse.json(
        { error: 'Failed to fetch decision requests' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: data || [] }, { status: 200 });
  } catch (err) {
    console.error('[API] GET /api/v6/data-decisions error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();

    // Validate required fields
    const requiredFields = [
      'execution_id',
      'agent_id',
      'step_id',
      'step_name',
      'decision_context',
    ];

    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Create decision request
    const { data, error } = await supabase
      .from('data_decision_requests')
      .insert({
        execution_id: body.execution_id,
        agent_id: body.agent_id,
        user_id: user.id,
        step_id: body.step_id,
        step_name: body.step_name,
        failure_category: 'data_unavailable',
        decision_context: body.decision_context,
        status: 'pending',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
      })
      .select()
      .single();

    if (error) {
      console.error('[API] Error creating decision request:', error.message);
      return NextResponse.json(
        { error: 'Failed to create decision request' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[API] POST /api/v6/data-decisions error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
