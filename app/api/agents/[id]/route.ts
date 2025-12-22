// app/api/agents/[id]/route.ts - FIXED with timezone-safe schedule updates
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auditLog } from '@/lib/services/AuditTrailService';
import { generateDiff } from '@/lib/audit/diff';
import { preparePluginTokens } from '@/lib/services/PluginTokenService';

// Initialize Supabase client with Service Role Key
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper function to extract user ID from request
function getUserIdFromRequest(request: NextRequest): string | null {
  const userIdHeader = request.headers.get('x-user-id');
  const authHeader = request.headers.get('authorization');
  
  if (userIdHeader) {
    return userIdHeader;
  }
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // JWT token handling would go here
  }
  
  return null;
}

// GET /api/agents/[id] - Retrieve a specific agent (unchanged)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log('GET /api/agents/[id] - Fetching agent:', id);
    
    const userId = getUserIdFromRequest(request);
    
    if (!userId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Unauthorized - Please provide user authentication',
          details: 'Missing x-user-id header or authorization token'
        },
        { status: 401 }
      );
    }

    const agentId = id;

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      );
    }

    console.log(`Fetching agent ${agentId} for user ${userId}`);

    // Query the agent from Supabase
    const { data: agent, error } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Supabase query error:', error);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Database query failed',
          details: process.env.NODE_ENV === 'development' ? {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code
          } : 'Database query failed'
        },
        { status: 500 }
      );
    }

    if (!agent) {
      console.log(`Agent ${agentId} not found for user ${userId}`);
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      );
    }

    // Auto-refresh plugin tokens for this agent's required plugins
    let pluginRefreshResults: {
      ready: string[];
      failed: string[];
    } | null = null;

    if (agent.plugins_required && Array.isArray(agent.plugins_required) && agent.plugins_required.length > 0) {
      console.log(`🔄 Preparing plugin tokens for agent: ${agent.plugins_required.join(', ')}`);

      try {
        pluginRefreshResults = await preparePluginTokens(userId, agent.plugins_required);
        console.log('Plugin preparation results:', pluginRefreshResults);
      } catch (refreshError) {
        console.error('⚠️ Plugin token preparation failed (non-blocking):', refreshError);
      }
    }

    console.log(`Agent fetched successfully: ${agent.agent_name || 'Unnamed Agent'} for user ${userId}`);

    return NextResponse.json({
      success: true,
      agent: agent,
      pluginRefresh: pluginRefreshResults
    });

  } catch (error) {
    console.error('Unexpected error in GET /api/agents/[id]:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        } : 'An unexpected error occurred'
      },
      { status: 500 }
    );
  }
}

// PUT /api/agents/[id] - Update a specific agent with TIMEZONE-SAFE schedule updates
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log('PUT /api/agents/[id] - Updating agent:', id);
    
    const userId = getUserIdFromRequest(request);
    
    if (!userId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Unauthorized - Please provide user authentication',
          details: 'Missing x-user-id header or authorization token'
        },
        { status: 401 }
      );
    }

    const agentId = id;
    const body = await request.json();
    const { agent: agentData } = body;

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      );
    }

    if (!agentData) {
      return NextResponse.json(
        { success: false, error: 'Agent data is required' },
        { status: 400 }
      );
    }

    console.log('=== SCHEDULE UPDATE DEBUG ===');
    console.log('Incoming schedule_cron:', agentData.schedule_cron);
    console.log('Incoming mode:', agentData.mode);
    console.log('===========================');

    console.log(`Updating agent ${agentId} for user ${userId}`);

    // Verify the agent exists and user owns it
    const { data: existingAgent, error: fetchError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .eq('user_id', userId)
      .maybeSingle();
    
    if (fetchError) {
      console.error('Error checking existing agent:', fetchError);
      return NextResponse.json(
        { success: false, error: 'Database error' },
        { status: 500 }
      );
    }

    if (!existingAgent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      );
    }

    // Convert ai_reasoning array to string if it exists
    const aiReasoning = agentData.ai_reasoning 
      ? Array.isArray(agentData.ai_reasoning) 
        ? agentData.ai_reasoning.join('\n')
        : agentData.ai_reasoning
      : null;

    // CRITICAL FIX: Handle schedule updates with timezone safety
    let scheduleUpdateResult = null;
    const hasScheduleChanges = (
      agentData.schedule_cron !== existingAgent.schedule_cron ||
      agentData.mode !== existingAgent.mode ||
      (agentData.timezone || 'UTC') !== (existingAgent.timezone || 'UTC')
    );

    if (hasScheduleChanges && agentData.mode === 'scheduled' && agentData.schedule_cron) {
      console.log('🕐 Schedule changes detected - using timezone-safe update');
      console.log('Old schedule:', existingAgent.schedule_cron, 'New:', agentData.schedule_cron);
      console.log('Old timezone:', existingAgent.timezone, 'New:', agentData.timezone || 'UTC');
      
      // Use our timezone-safe function for schedule updates
      const { data: scheduleResult, error: scheduleError } = await supabase
        .rpc('update_agent_schedule_safe', {
          agent_uuid: agentId,
          new_cron: agentData.schedule_cron,
          new_timezone: agentData.timezone || 'UTC'
        });

      if (scheduleError) {
        console.error('Schedule update failed:', scheduleError);
        return NextResponse.json(
          { 
            success: false, 
            error: 'Failed to update schedule with timezone conversion',
            details: scheduleError.message
          },
          { status: 500 }
        );
      }

      scheduleUpdateResult = scheduleResult;
      console.log('✅ Timezone-safe schedule update completed:', scheduleResult);
    }

    // Prepare update data for non-schedule fields
    const updateData: any = {
      agent_name: agentData.agent_name,
      description: agentData.description,
      system_prompt: agentData.system_prompt,
      user_prompt: agentData.user_prompt,
      input_schema: agentData.input_schema,
      output_schema: agentData.output_schema,
      connected_plugins: agentData.connected_plugins,
      plugins_required: agentData.plugins_required,
      workflow_steps: agentData.workflow_steps,
      generated_plan: agentData.generated_plan,
      detected_categories: agentData.detected_categories,
      trigger_conditions: agentData.trigger_conditions,
      ai_reasoning: aiReasoning,
      ai_confidence: agentData.ai_confidence,
      created_from_prompt: agentData.created_from_prompt,
      ai_generated_at: agentData.ai_generated_at ? new Date(agentData.ai_generated_at).toISOString() : null,
      status: agentData.status,
      agent_config: agentData.agent_config || null
    };

    // CRITICAL FIX: Always include mode field in updates
    // The timezone-safe function only updates schedule_cron, timezone, and next_run
    // We must separately update the mode field
    updateData.mode = agentData.mode || 'on_demand';

    // Only include schedule_cron and timezone if we didn't use the safe function
    // (because the safe function already updated those fields)
    if (!scheduleUpdateResult) {
      updateData.schedule_cron = agentData.schedule_cron || null;
      updateData.timezone = agentData.timezone || 'UTC';
    }

    // Remove undefined values to avoid Supabase errors
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    console.log('Update data prepared:', Object.keys(updateData));

    // Update the agent with non-schedule fields
    const { data: updatedAgent, error: updateError } = await supabase
      .from('agents')
      .update(updateData)
      .eq('id', agentId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (updateError) {
      console.error('Error updating agent:', updateError);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to update agent',
          details: process.env.NODE_ENV === 'development' ? {
            message: updateError.message,
            details: updateError.details,
            hint: updateError.hint,
            code: updateError.code
          } : 'Database update failed'
        },
        { status: 500 }
      );
    }

    console.log('=== FINAL SAVE RESULT ===');
    console.log('updatedAgent.schedule_cron:', updatedAgent.schedule_cron);
    console.log('updatedAgent.mode:', updatedAgent.mode);
    console.log('updatedAgent.next_run:', updatedAgent.next_run);
    console.log('updatedAgent.timezone:', updatedAgent.timezone);
    if (scheduleUpdateResult) {
      console.log('Schedule function result:', scheduleUpdateResult);
    }
    console.log('========================');

    console.log(`Agent updated: ${updatedAgent.agent_name} by user ${userId}`);

    // 📝 Audit Trail: Log agent update with change tracking (non-blocking)
    try {
      const changes = generateDiff(existingAgent, updatedAgent);

      if (changes && Object.keys(changes).length > 0) {
        auditLog({
          action: 'AGENT_UPDATED',
          entityType: 'agent',
          entityId: agentId,
          userId: userId,
          resourceName: updatedAgent.agent_name || 'Unnamed Agent',
          changes,
          details: {
            fields_changed: Object.keys(changes).length,
            critical_change: !!(changes.status || changes.schedule_cron || changes.mode),
            status_changed: !!changes.status,
            schedule_changed: !!changes.schedule_cron,
            mode_changed: !!changes.mode
          },
          severity: (changes.status || changes.mode) ? 'warning' : 'info',
          request
        }).catch(err => {
          console.error('⚠️ Audit log failed (non-blocking):', err);
        });
      }
    } catch (auditError) {
      console.error('⚠️ Audit trail error (non-blocking):', auditError);
    }

    return NextResponse.json({
      success: true,
      agent: updatedAgent,
      message: 'Agent updated successfully',
      scheduleUpdate: scheduleUpdateResult
    });

  } catch (error) {
    console.error('Error in PUT /api/agents/[id]:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error instanceof Error ? error.message : String(error) : undefined
      },
      { status: 500 }
    );
  }
}

// DELETE /api/agents/[id] - Delete a specific agent (unchanged)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log('DELETE /api/agents/[id] - Deleting agent:', id);
    
    const userId = getUserIdFromRequest(request);
    
    if (!userId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Unauthorized - Please provide user authentication',
          details: 'Missing x-user-id header or authorization token'
        },
        { status: 401 }
      );
    }

    const agentId = id;

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      );
    }

    console.log(`Deleting agent ${agentId} for user ${userId}`);

    // Verify the agent exists and user owns it - fetch more details for audit trail
    const { data: existingAgent, error: fetchError } = await supabase
      .from('agents')
      .select('id, user_id, agent_name, mode, status, created_at')
      .eq('id', agentId)
      .eq('user_id', userId)
      .maybeSingle();
    
    if (fetchError) {
      console.error('Error checking existing agent:', fetchError);
      return NextResponse.json(
        { success: false, error: 'Database error' },
        { status: 500 }
      );
    }

    if (!existingAgent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      );
    }

    // Get execution stats before deletion (for audit trail)
    const { count: executionCount } = await supabase
      .from('agent_executions')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId);

    // Delete the agent
    const { error: deleteError } = await supabase
      .from('agents')
      .delete()
      .eq('id', agentId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Error deleting agent:', deleteError);
      return NextResponse.json(
        { success: false, error: 'Failed to delete agent' },
        { status: 500 }
      );
    }

    console.log(`Agent deleted: ${agentId} by user ${userId}`);

    // 📝 Audit Trail: Log agent deletion (non-blocking)
    auditLog({
      action: 'AGENT_DELETED',
      entityType: 'agent',
      entityId: agentId,
      userId: userId,
      resourceName: existingAgent.agent_name || 'Unnamed Agent',
      details: {
        mode: existingAgent.mode,
        status: existingAgent.status,
        total_executions: executionCount || 0,
        created_at: existingAgent.created_at,
        permanently_deleted: true
      },
      severity: 'warning', // Deletion is always a warning-level event
      request
    }).catch(err => {
      console.error('⚠️ Audit log failed (non-blocking):', err);
    });

    return NextResponse.json({
      success: true,
      message: 'Agent deleted successfully'
    });

  } catch (error) {
    console.error('Error in DELETE /api/agents/[id]:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error instanceof Error ? error.message : String(error) : undefined
      },
      { status: 500 }
    );
  }
}