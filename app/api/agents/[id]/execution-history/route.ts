// /app/api/agents/[id]/execution-history/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getLatestExecution, getRunningExecutions } from '@/lib/database/executionHelpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');

    // Use your existing supabase setup
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get execution history
    const { data: history, error } = await supabase
      .from('agent_executions')
      .select('id, status, started_at, completed_at, execution_duration_ms, error_message, result, progress')
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching execution history:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch execution history'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      history: history || []
    });

  } catch (error) {
    console.error('Error in execution history route:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}