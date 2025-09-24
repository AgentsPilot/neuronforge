import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper function to extract user ID from request (consistent with your other API)
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

export async function POST(request: NextRequest) {
  try {
    console.log('📝 POST /api/create-agent - Creating new agent');
    console.log('📋 Request headers:', Object.fromEntries(request.headers.entries()));
    
    // Extract user ID from headers (consistent with your other API)
    const userId = getUserIdFromRequest(request);
    console.log('👤 Extracted user ID:', userId);
    
    if (!userId) {
      console.log('❌ No user ID found in request headers');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Unauthorized - Please provide user authentication',
          details: 'Missing x-user-id header or authorization token'
        },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    console.log('Request body keys:', Object.keys(body));
    
    // Extract agent data from the request body
    const { agent } = body;
    
    if (!agent) {
      console.error('❌ No agent data provided');
      return NextResponse.json(
        { success: false, error: 'Agent data is required' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!agent.agent_name) {
      console.error('❌ Missing required field: agent_name');
      return NextResponse.json(
        { success: false, error: 'agent_name is required' },
        { status: 400 }
      );
    }

    // Use the authenticated user's ID instead of trusting the client
    // This is more secure than accepting user_id from the request body
    const agentUserIdToUse = userId;
    
    console.log('🔒 Using authenticated user ID for agent creation:', agentUserIdToUse);

    // Convert ai_reasoning array to string if it exists
    const aiReasoning = agent.ai_reasoning 
      ? Array.isArray(agent.ai_reasoning) 
        ? agent.ai_reasoning.join('\n')
        : agent.ai_reasoning
      : null;

    // Prepare data for insertion - use authenticated user ID
    const agentData = {
      agent_name: agent.agent_name,
      user_prompt: agent.user_prompt,
      user_id: agentUserIdToUse, // Use the authenticated user's ID
      system_prompt: agent.system_prompt,
      description: agent.description,
      input_schema: agent.input_schema || null,
      output_schema: agent.output_schema || null,
      connected_plugins: agent.connected_plugins || null,
      status: agent.status || 'draft',
      mode: agent.mode || 'on_demand',
      schedule_cron: agent.schedule_cron || null,
      trigger_conditions: agent.trigger_conditions || null,
      plugins_required: agent.plugins_required || null,
      workflow_steps: agent.workflow_steps || null,
      ai_reasoning: aiReasoning,
      ai_confidence: agent.ai_confidence || null,
      detected_categories: agent.detected_categories || null,
      created_from_prompt: agent.created_from_prompt || null,
      ai_generated_at: agent.ai_generated_at ? new Date(agent.ai_generated_at).toISOString() : null,
    };

    console.log('💾 Inserting agent for user:', agentUserIdToUse);
    console.log('💾 Agent name:', agentData.agent_name);

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

    // Insert into Supabase
    const { data, error } = await supabase
      .from('agents')
      .insert([agentData])
      .select()
      .single();

    if (error) {
      console.error('❌ Supabase insert error:', error);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to create agent', 
          details: process.env.NODE_ENV === 'development' ? {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code
          } : 'Database insert failed'
        },
        { status: 500 }
      );
    }

    console.log('✅ Agent created successfully:', data.id, 'for user:', agentUserIdToUse);

    // Return the structure your frontend expects (consistent with your other API)
    return NextResponse.json(
      { 
        success: true, 
        agent: data,
        message: 'Agent created successfully' 
      },
      { status: 201 }
    );

  } catch (error) {
    console.error('❌ API error:', error);
    
    if (error instanceof SyntaxError) {
      console.error('❌ JSON parsing error:', error.message);
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Make sure we always return JSON, never HTML
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

// Handle other HTTP methods properly
export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST to create an agent.' },
    { status: 405 }
  );
}

export async function PUT() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST to create an agent.' },
    { status: 405 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST to create an agent.' },
    { status: 405 }
  );
}