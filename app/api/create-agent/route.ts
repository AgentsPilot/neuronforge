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
    
    // FIXED: Extract agent data AND IDs from the request body
    const { agent, sessionId: providedSessionId, agentId: providedAgentId } = body;
    
    console.log('🆔 CREATE-AGENT API - Extracted IDs:', {
      providedAgentId,
      providedSessionId,
      hasAgent: !!agent,
      agentIdType: typeof providedAgentId,
      sessionIdType: typeof providedSessionId
    });
    
    if (!agent) {
      console.error('❌ No agent data provided');
      return NextResponse.json(
        { success: false, error: 'Agent data is required' },
        { status: 400 }
      );
    }

    // ENHANCED DEBUG LOGGING for agent_config
    console.log('=== AGENT CONFIG DEBUG ===');
    console.log('Agent config present in request:', !!agent.agent_config);
    if (agent.agent_config) {
      console.log('Agent config keys:', Object.keys(agent.agent_config));
      console.log('Agent config size:', JSON.stringify(agent.agent_config).length, 'characters');
      console.log('Agent config preview:', JSON.stringify(agent.agent_config).substring(0, 200) + '...');
    }
    console.log('========================');

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

    // CRITICAL FIX: Use the provided agent ID for database consistency
    const finalAgentId = providedAgentId || agent.id;
    
    console.log('🆔 AGENT ID DECISION:', {
      providedAgentId,
      agentId: agent.id,
      finalAgentId,
      willUseProvidedId: !!providedAgentId,
      idSource: providedAgentId ? 'frontend_provided' : agent.id ? 'agent_object' : 'database_generated'
    });

    // ENHANCED: Prepare data for insertion with agent_config support AND consistent agent ID
    const agentData = {
      // CRITICAL FIX: Use the provided agent ID to maintain consistency with token tracking
      ...(finalAgentId && { id: finalAgentId }),

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
      timezone: agent.timezone || 'UTC', // FIXED: Add timezone field for scheduled agents
      trigger_conditions: agent.trigger_conditions || null,
      plugins_required: agent.plugins_required || null,
      workflow_steps: agent.workflow_steps || null,
      generated_plan: agent.generated_plan || null, // Added missing field
      detected_categories: agent.detected_categories || null,
      ai_reasoning: aiReasoning,
      ai_confidence: agent.ai_confidence || null,
      created_from_prompt: agent.created_from_prompt || null,
      ai_generated_at: agent.ai_generated_at ? new Date(agent.ai_generated_at).toISOString() : null,

      // CRITICAL FIX: Add the agent_config JSONB field
      agent_config: agent.agent_config || null
    };

    console.log('💾 Inserting agent for user:', agentUserIdToUse);
    console.log('💾 Agent name:', agentData.agent_name);
    console.log('💾 Agent ID being used:', finalAgentId || 'database_generated');
    console.log('💾 Agent config being saved:', !!agentData.agent_config);
    console.log('💾 Schedule configuration:', {
      mode: agentData.mode,
      schedule_cron: agentData.schedule_cron,
      timezone: agentData.timezone
    });

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
    console.log('✅ Agent ID consistency check:', {
      requestedId: finalAgentId,
      createdId: data.id,
      idsMatch: finalAgentId === data.id,
      tokenTrackingWillWork: finalAgentId === data.id
    });
    console.log('✅ Saved agent_config present:', !!data.agent_config);
    console.log('✅ Saved agent_config size:', data.agent_config ? JSON.stringify(data.agent_config).length : 0);
    console.log('✅ Saved schedule configuration:', {
      mode: data.mode,
      schedule_cron: data.schedule_cron,
      timezone: data.timezone
    });

    // Track creation costs in AIS system now that agent exists in database
    if (providedSessionId) {
      try {
        console.log('📊 [AIS] ========================================');
        console.log('📊 [AIS] TRACKING CREATION COSTS');
        console.log('📊 [AIS] Agent ID:', data.id);
        console.log('📊 [AIS] Session ID:', providedSessionId);
        console.log('📊 [AIS] User ID:', agentUserIdToUse);
        console.log('📊 [AIS] ========================================');

        // First, check if ANY records exist for this session (for debugging)
        const { data: allSessionRecords } = await supabase
          .from('token_usage')
          .select('*')
          .eq('session_id', providedSessionId);

        console.log('📊 [AIS] All token_usage records for session:', {
          count: allSessionRecords?.length || 0,
          sessionId: providedSessionId,
          records: allSessionRecords?.map(r => ({
            activity_type: r.activity_type,
            input_tokens: r.input_tokens,
            output_tokens: r.output_tokens,
            created_at: r.created_at
          }))
        });

        // Get all creation-related token usage for this session
        const { data: creationTokens, error: tokenError } = await supabase
          .from('token_usage')
          .select('input_tokens, output_tokens, activity_type, created_at')
          .eq('session_id', providedSessionId)
          .in('activity_type', ['agent_creation', 'agent_generation']);

        if (tokenError) {
          console.error('❌ [AIS] Error fetching token usage:', tokenError);
        } else if (creationTokens && creationTokens.length > 0) {
          const totalCreationTokens = creationTokens.reduce((sum: number, record: any) =>
            sum + (record.input_tokens || 0) + (record.output_tokens || 0), 0
          );

          console.log(`📊 [AIS] Found ${creationTokens.length} token records for activity types [agent_creation, agent_generation]`);
          console.log(`📊 [AIS] Total tokens: ${totalCreationTokens}`);
          console.log('📊 [AIS] Token breakdown:', creationTokens.map(r => ({
            activity_type: r.activity_type,
            input: r.input_tokens,
            output: r.output_tokens,
            total: (r.input_tokens || 0) + (r.output_tokens || 0),
            created_at: r.created_at
          })));

          // Import and call trackCreationCosts with server-side supabase client
          const { AgentIntensityService } = await import('@/lib/services/AgentIntensityService');
          const result = await AgentIntensityService.trackCreationCosts(
            supabase, // Pass the server-side supabase client
            {
              agent_id: data.id,
              user_id: agentUserIdToUse,
              tokens_used: totalCreationTokens,
              creation_duration_ms: 0 // We don't track timing across APIs
            }
          );

          if (result) {
            console.log(`✅ [AIS] Successfully tracked creation costs: ${totalCreationTokens} tokens for agent ${data.id}`);
            console.log('✅ [AIS] Tracking result:', {
              agent_id: result.agent_id,
              creation_tokens_used: result.creation_tokens_used,
              total_creation_cost_usd: result.total_creation_cost_usd
            });
          } else {
            console.log('⚠️ [AIS] trackCreationCosts returned null');
          }
        } else {
          console.log('⚠️ [AIS] No token usage records found for session:', providedSessionId);
          console.log('⚠️ [AIS] This could mean:');
          console.log('   1. SessionId mismatch between generation and creation');
          console.log('   2. Token tracking failed during generation');
          console.log('   3. Wrong activity_type used for token records');
        }
      } catch (aisError) {
        console.error('❌ [AIS] Failed to track creation costs:', aisError);
        // Non-fatal error - continue (agent is already created successfully)
      }
    } else {
      console.log('❌ [AIS] ========================================');
      console.log('❌ [AIS] NO SESSION ID PROVIDED');
      console.log('❌ [AIS] Cannot track creation costs without sessionId');
      console.log('❌ [AIS] Check frontend is passing sessionId to create-agent API');
      console.log('❌ [AIS] ========================================');
    }

    // Return the structure your frontend expects (consistent with your other API)
    return NextResponse.json(
      { 
        success: true, 
        agent: data,
        message: 'Agent created successfully',
        analytics: {
          agentId: data.id,
          sessionId: providedSessionId,
          tokenTrackingConsistent: finalAgentId === data.id
        }
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