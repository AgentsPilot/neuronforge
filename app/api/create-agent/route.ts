import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    console.log('📝 POST /api/agents - Creating new agent');
    
    const body = await request.json();
    console.log('Request body:', JSON.stringify(body, null, 2));
    
    // Extract agent data from the request body
    const { agent } = body;
    
    if (!agent) {
      console.error('❌ No agent data provided');
      return NextResponse.json(
        { error: 'Agent data is required' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!agent.user_id || !agent.agent_name) {
      console.error('❌ Missing required fields:', { 
        has_user_id: !!agent.user_id, 
        has_agent_name: !!agent.agent_name 
      });
      return NextResponse.json(
        { error: 'user_id and agent_name are required' },
        { status: 400 }
      );
    }

    // Convert ai_reasoning array to string if it exists
    const aiReasoning = agent.ai_reasoning 
      ? Array.isArray(agent.ai_reasoning) 
        ? agent.ai_reasoning.join('\n')
        : agent.ai_reasoning
      : null;

    // Prepare data for insertion
    const agentData = {
      agent_name: agent.agent_name,
      user_prompt: agent.user_prompt,
      user_id: agent.user_id,
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

    console.log('💾 Inserting agent data:', JSON.stringify(agentData, null, 2));

    // Insert into Supabase
    const { data, error } = await supabase
      .from('agents')
      .insert([agentData])
      .select()
      .single();

    if (error) {
      console.error('❌ Supabase error:', error);
      return NextResponse.json(
        { error: 'Failed to create agent', details: error.message },
        { status: 500 }
      );
    }

    console.log('✅ Agent created successfully:', data.id);

    // IMPORTANT: Return the structure your frontend expects
    return NextResponse.json(
      { 
        success: true, 
        agent: data,  // This matches what your frontend expects: result.agent
        message: 'Agent created successfully' 
      },
      { status: 201 }
    );

  } catch (error) {
    console.error('❌ API error:', error);
    
    if (error instanceof SyntaxError) {
      console.error('❌ JSON parsing error:', error.message);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Make sure we always return JSON, never HTML
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

// Handle other HTTP methods properly
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to create an agent.' },
    { status: 405 }
  );
}

export async function PUT() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to create an agent.' },
    { status: 405 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to create an agent.' },
    { status: 405 }
  );
}