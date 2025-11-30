import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })

    // Get current user
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { sharedAgentId } = await request.json()

    if (!sharedAgentId) {
      return NextResponse.json(
        { success: false, error: 'Missing shared agent ID' },
        { status: 400 }
      )
    }

    // Get the shared agent template
    const { data: sharedAgent, error: fetchError } = await supabase
      .from('shared_agents')
      .select('*')
      .eq('id', sharedAgentId)
      .single()

    if (fetchError || !sharedAgent) {
      return NextResponse.json(
        { success: false, error: 'Shared agent not found' },
        { status: 404 }
      )
    }

    // Create a new agent based on the template
    const { data: newAgent, error: insertError } = await supabase
      .from('agents')
      .insert({
        agent_name: `${sharedAgent.agent_name} (Imported)`,
        description: sharedAgent.description,
        system_prompt: sharedAgent.system_prompt,
        user_prompt: sharedAgent.user_prompt,
        user_id: user.id,
        input_schema: sharedAgent.input_schema,
        output_schema: sharedAgent.output_schema,
        plugins_required: sharedAgent.plugins_required,
        workflow_steps: sharedAgent.workflow_steps,
        mode: sharedAgent.mode || 'on_demand',
        generated_plan: sharedAgent.generated_plan,
        ai_reasoning: sharedAgent.ai_reasoning,
        ai_confidence: sharedAgent.ai_confidence,
        detected_categories: sharedAgent.detected_categories,
        created_from_prompt: sharedAgent.created_from_prompt,
        connected_plugins: sharedAgent.connected_plugins,
        status: 'draft',
        is_archived: false
      })
      .select()
      .single()

    if (insertError || !newAgent) {
      console.error('Error creating agent:', insertError)
      return NextResponse.json(
        { success: false, error: 'Failed to create agent' },
        { status: 500 }
      )
    }

    // Track import in shared_agent_imports table
    // This will automatically trigger import_count increment via database trigger
    const { error: trackError } = await supabase
      .from('shared_agent_imports')
      .insert({
        shared_agent_id: sharedAgentId,
        imported_by_user_id: user.id,
        created_agent_id: newAgent.id
      })

    if (trackError) {
      // Log error but don't fail the import (it's just analytics)
      console.error('Error tracking import:', trackError)

      // If it's a unique constraint violation (user already imported this template),
      // that's okay - just skip the tracking
      if (!trackError.message?.includes('duplicate') && !trackError.message?.includes('unique')) {
        console.warn('Non-duplicate import tracking error:', trackError)
      }
    }

    return NextResponse.json({
      success: true,
      agentId: newAgent.id,
      message: 'Template imported successfully'
    })
  } catch (error) {
    console.error('Error in import-shared API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
