/**
 * Insights Settings API
 * PATCH /api/agents/{id}/insights
 *
 * Endpoint for toggling insights_enabled flag on an agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;

    // Authenticate user
    const authSupabase = await createAuthenticatedServerClient();
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { insights_enabled } = body;

    if (typeof insights_enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'insights_enabled must be a boolean' },
        { status: 400 }
      );
    }

    // Create service role client for update
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify ownership
    const { data: agent, error: fetchError } = await supabase
      .from('agents')
      .select('id, user_id')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !agent) {
      return NextResponse.json(
        { error: 'Agent not found or access denied' },
        { status: 404 }
      );
    }

    // Update insights_enabled flag
    const { error: updateError } = await supabase
      .from('agents')
      .update({ insights_enabled })
      .eq('id', agentId);

    if (updateError) {
      console.error('[InsightsAPI] Failed to update insights_enabled:', updateError);
      return NextResponse.json(
        { error: 'Failed to update insights setting' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      insights_enabled,
    });
  } catch (error) {
    console.error('[InsightsAPI] PATCH error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
