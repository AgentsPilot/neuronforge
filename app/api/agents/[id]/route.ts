// app/api/agents/[id]/route.ts - Fixed with Service Role Key
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with Service Role Key (like your working route)
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
  { params }: { params: { id: string } }
) {
  try {
    console.log('🔍 API Route called with params:', params);
    console.log('📋 Request headers:', Object.fromEntries(request.headers.entries()));
    
    const userId = getUserIdFromRequest(request);
    console.log('👤 Extracted user ID:', userId);
    
    if (!userId) {
      console.log('❌ No user ID found in request');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Unauthorized - Please provide user authentication',
          details: 'Missing x-user-id header or authorization token'
        },
        { status: 401 }
      );
    }

    const agentId = params.id;
    console.log('🎯 Agent ID from params:', agentId);

    if (!agentId) {
      console.log('❌ No agent ID provided');
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      );
    }

    console.log(`🔍 Fetching agent ${agentId} for user ${userId}`);

    // Test Supabase connection first
    try {
      const { data: connectionTest, error: connectionError } = await supabase
        .from('agents')
        .select('count', { count: 'exact', head: true });
      
      if (connectionError) {
        console.error('💥 Supabase connection error:', connectionError);
        return NextResponse.json(
          { 
            success: false, 
            error: 'Database connection failed',
            details: process.env.NODE_ENV === 'development' ? connectionError.message : 'Unable to connect to database'
          },
          { status: 500 }
        );
      }
      console.log('✅ Supabase connection successful');
    } catch (connErr) {
      console.error('💥 Supabase connection test failed:', connErr);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Database connection failed',
          details: process.env.NODE_ENV === 'development' ? String(connErr) : 'Unable to connect to database'
        },
        { status: 500 }
      );
    }

    // Query the agent from Supabase
    console.log('📊 Executing Supabase query...');
    const { data: agent, error } = await supabase
      .from('agents')
      .select('*') // Get all fields first
      .eq('id', agentId)
      .eq('user_id', userId)
      .maybeSingle();

    console.log('📊 Supabase query completed');
    console.log('📊 Query error:', error);
    console.log('📊 Query result:', agent ? 'Agent found' : 'No agent found');

    if (error) {
      console.error('💥 Supabase query error:', error);
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
      console.log(`❌ Agent ${agentId} not found for user ${userId}`);
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      );
    }

    // Clean the agent data before returning - remove unwanted debug fields
    const cleanAgent = {
      ...agent,
      // Remove the unwanted debug fields
      sessionId: undefined,
      clarificationAnswers: undefined,
      promptType: undefined
    };

    // Remove undefined fields
    Object.keys(cleanAgent).forEach(key => {
      if (cleanAgent[key] === undefined) {
        delete cleanAgent[key];
      }
    });

    console.log(`✅ Agent fetched successfully: ${agent.agent_name || 'Unnamed Agent'} for user ${userId}`);

    return NextResponse.json({
      success: true,
      agent: cleanAgent
    });

  } catch (error) {
    console.error('💥 Unexpected error in GET /api/agents/[id]:', error);
    console.error('💥 Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
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
  { params }: { params: { id: string } }
) {
  try {
    console.log('🔄 PUT request initiated for agent:', params.id);
    
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

    const agentId = params.id;
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

    console.log(`🔄 Updating agent ${agentId} for user ${userId}`);

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

    // Prepare update data - only include fields that exist in your schema
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
      mode: agentData.mode,
      status: agentData.status,
      updated_at: new Date().toISOString()
    };

    // Remove undefined values to avoid Supabase errors
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

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
        { success: false, error: 'Failed to update agent' },
        { status: 500 }
      );
    }

    console.log(`✅ Agent updated: ${updatedAgent.agent_name} by user ${userId}`);

    return NextResponse.json({
      success: true,
      agent: updatedAgent
    });

  } catch (error) {
    console.error('💥 Error in PUT /api/agents/[id]:', error);
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
  { params }: { params: { id: string } }
) {
  try {
    console.log('🗑️ DELETE request initiated for agent:', params.id);
    
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

    const agentId = params.id;

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      );
    }

    console.log(`🗑️ Deleting agent ${agentId} for user ${userId}`);

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

    // Soft delete by setting is_archived flag
    const { error: deleteError } = await supabase
      .from('agents')
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq('id', agentId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Error deleting agent:', deleteError);
      return NextResponse.json(
        { success: false, error: 'Failed to delete agent' },
        { status: 500 }
      );
    }

    console.log(`✅ Agent archived: ${agentId} by user ${userId}`);

    return NextResponse.json({
      success: true,
      message: 'Agent deleted successfully'
    });

  } catch (error) {
    console.error('💥 Error in DELETE /api/agents/[id]:', error);
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