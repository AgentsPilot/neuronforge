// app/api/agents/[id]/route.ts - FIXED with schedule support
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

// GET /api/agents/[id] - Retrieve a specific agent
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

    // SCHEDULE DEBUG: Log schedule data being returned
    console.log('=== SCHEDULE GET DEBUG ===');
    console.log('Agent schedule_cron:', agent.schedule_cron);
    console.log('Agent mode:', agent.mode);
    console.log('Agent agent_config schedule:', agent.agent_config?.schedule_cron);
    console.log('========================');

    console.log(`Agent fetched successfully: ${agent.agent_name || 'Unnamed Agent'} for user ${userId}`);

    return NextResponse.json({
      success: true,
      agent: agent
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

// PUT /api/agents/[id] - Update a specific agent
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

    // CRITICAL DEBUG: Log schedule data being updated
    console.log('=== SCHEDULE UPDATE DEBUG ===');
    console.log('Incoming schedule_cron:', agentData.schedule_cron);
    console.log('Incoming mode:', agentData.mode);
    console.log('Incoming agent_config schedule:', agentData.agent_config?.schedule_cron);
    console.log('Incoming agent_config mode:', agentData.agent_config?.mode);
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

    console.log('Existing agent schedule_cron:', existingAgent.schedule_cron);
    console.log('Existing agent mode:', existingAgent.mode);

    // Convert ai_reasoning array to string if it exists
    const aiReasoning = agentData.ai_reasoning 
      ? Array.isArray(agentData.ai_reasoning) 
        ? agentData.ai_reasoning.join('\n')
        : agentData.ai_reasoning
      : null;

    // CRITICAL FIX: Include ALL fields including schedule fields and agent_config
    const updateData = {
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
      
      // CRITICAL FIX: Include schedule fields
      mode: agentData.mode || 'on_demand',
      schedule_cron: agentData.schedule_cron || null,
      
      // CRITICAL FIX: Include agent_config
      agent_config: agentData.agent_config || null
    };

    // Remove undefined values to avoid Supabase errors
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // CRITICAL DEBUG: Log exactly what's being sent to database
    console.log('=== DATABASE UPDATE DEBUG ===');
    console.log('updateData.schedule_cron:', updateData.schedule_cron);
    console.log('updateData.mode:', updateData.mode);
    console.log('updateData.agent_config schedule:', updateData.agent_config?.schedule_cron);
    console.log('updateData.agent_config mode:', updateData.agent_config?.mode);
    console.log('All updateData keys:', Object.keys(updateData));
    console.log('============================');

    console.log('Update data prepared:', Object.keys(updateData));

    // Update the agent
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

    // CRITICAL DEBUG: Log what was actually saved
    console.log('=== DATABASE SAVE RESULT ===');
    console.log('updatedAgent.schedule_cron:', updatedAgent.schedule_cron);
    console.log('updatedAgent.mode:', updatedAgent.mode);
    console.log('updatedAgent.agent_config schedule:', updatedAgent.agent_config?.schedule_cron);
    console.log('updatedAgent.agent_config mode:', updatedAgent.agent_config?.mode);
    console.log('===========================');

    console.log(`Agent updated: ${updatedAgent.agent_name} by user ${userId}`);

    return NextResponse.json({
      success: true,
      agent: updatedAgent,
      message: 'Agent updated successfully'
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

// DELETE /api/agents/[id] - Delete a specific agent
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

    // Verify the agent exists and user owns it
    const { data: existingAgent, error: fetchError } = await supabase
      .from('agents')
      .select('id, user_id, agent_name')
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