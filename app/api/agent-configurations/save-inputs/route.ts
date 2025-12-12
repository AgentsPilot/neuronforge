// /app/api/agent-configurations/save-inputs/route.ts
// API endpoint to save/update input_values for an agent

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'nodejs'

interface SaveInputsRequest {
  agent_id: string
  input_values: Record<string, any>
  input_schema?: any
}

/**
 * POST handler to save/update input_values in agent_configurations
 * This finds the most recent 'configured' entry or creates a new one
 */
export async function POST(req: Request) {
  const body: SaveInputsRequest = await req.json()
  const { agent_id, input_values, input_schema } = body

  console.log('[Save Inputs] Request received:', { agent_id, input_values })

  if (!agent_id) {
    return NextResponse.json({ error: 'agent_id is required' }, { status: 400 })
  }

  if (!input_values || typeof input_values !== 'object') {
    return NextResponse.json({ error: 'input_values must be an object' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: async () => {},
        remove: async () => {},
      },
    }
  )

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Find the most recent 'configured' entry for this agent and user
    console.log('[Save Inputs] Looking for existing config:', { agent_id, user_id: user.id })

    const { data: existingConfig, error: fetchError } = await supabase
      .from('agent_configurations')
      .select('id')
      .eq('agent_id', agent_id)
      .eq('user_id', user.id)
      .eq('status', 'configured')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchError) {
      console.error('[Save Inputs] Error fetching configuration:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch configuration' }, { status: 500 })
    }

    console.log('[Save Inputs] Existing config found:', existingConfig)

    // Update existing or create new configuration
    if (existingConfig) {
      console.log('[Save Inputs] Updating existing config:', existingConfig.id)

      // Update existing configuration
      const updateData: any = {
        input_values,
        updated_at: new Date().toISOString()
      }

      if (input_schema) {
        updateData.input_schema = input_schema
      }

      console.log('[Save Inputs] Update data:', updateData)

      console.log('[Save Inputs] About to execute update query')

      const { data, error: updateError } = await supabase
        .from('agent_configurations')
        .update(updateData)
        .eq('id', existingConfig.id)
        .eq('user_id', user.id)
        .select()
        .single()

      console.log('[Save Inputs] Update query completed:', { data, updateError })

      if (updateError) {
        console.error('[Save Inputs] Error updating configuration:', updateError)
        return NextResponse.json({ error: 'Failed to update configuration', details: updateError }, { status: 500 })
      }

      console.log('[Save Inputs] Successfully updated config:', data)

      return NextResponse.json({
        success: true,
        message: 'Input values updated successfully',
        data
      })
    } else {
      console.log('[Save Inputs] Creating new config')

      // Create new configuration
      const configId = `${agent_id}-${user.id}-${uuidv4()}`

      const insertData: any = {
        id: configId,
        agent_id,
        user_id: user.id,
        input_values,
        status: 'configured'
      }

      if (input_schema) {
        insertData.input_schema = input_schema
      }

      console.log('[Save Inputs] Insert data:', insertData)

      const { data, error: insertError } = await supabase
        .from('agent_configurations')
        .insert(insertData)
        .select()
        .single()

      if (insertError) {
        console.error('[Save Inputs] Error creating configuration:', insertError)
        return NextResponse.json({ error: 'Failed to create configuration' }, { status: 500 })
      }

      console.log('[Save Inputs] Successfully created config:', data)

      return NextResponse.json({
        success: true,
        message: 'Input values saved successfully',
        data
      })
    }
  } catch (error: any) {
    console.error('Unexpected error saving input values:', error)
    return NextResponse.json({
      error: error.message || 'Failed to save input values'
    }, { status: 500 })
  }
}
