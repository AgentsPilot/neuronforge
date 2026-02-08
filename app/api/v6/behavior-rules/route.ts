/**
 * Behavior Rules API
 *
 * GET  /api/v6/behavior-rules?user_id={id}&agent_id={id}
 *   - Returns active behavior rules for a user/agent
 *   - Used by frontend to display user's saved preferences
 *
 * POST /api/v6/behavior-rules (internal — called by DataDecisionHandler)
 *   - Creates a new behavior rule
 *   - Returns the created rule
 *
 * @module app/api/v6/behavior-rules
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAuthenticatedServerClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query params
    const searchParams = request.nextUrl.searchParams;
    const agentId = searchParams.get('agent_id');

    // Build query
    let query = supabase
      .from('behavior_rules')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    // Filter by agent if provided (include global rules with null agent_id)
    if (agentId) {
      query = query.or(`agent_id.eq.${agentId},agent_id.is.null`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[API] Error fetching behavior rules:', error.message);
      return NextResponse.json(
        { error: 'Failed to fetch behavior rules' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: data || [] }, { status: 200 });
  } catch (err) {
    console.error('[API] GET /api/v6/behavior-rules error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAuthenticatedServerClient();

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
    const requiredFields = ['rule_type', 'trigger_condition', 'action'];

    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Create behavior rule
    const { data, error } = await supabase
      .from('behavior_rules')
      .insert({
        user_id: user.id,
        agent_id: body.agent_id || null,
        rule_type: body.rule_type,
        trigger_condition: body.trigger_condition,
        action: body.action,
        name: body.name,
        description: body.description,
        created_from_decision_id: body.created_from_decision_id,
        created_from_snapshot_id: body.created_from_snapshot_id,
        status: 'active',
        applied_count: 0,
      })
      .select()
      .single();

    if (error) {
      console.error('[API] Error creating behavior rule:', error.message);
      return NextResponse.json(
        { error: 'Failed to create behavior rule' },
        { status: 500 }
      );
    }

    console.log(`[API] Created behavior rule ${data.id} for user ${user.id}`);

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[API] POST /api/v6/behavior-rules error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
