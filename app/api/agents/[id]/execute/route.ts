// app/api/agents/[id]/execute/route.ts

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabaseClient'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const agent_id = params.id
    const body = await request.json()
    const inputs = body.inputs || {}

    // Forward to your existing run-agent endpoint
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/run-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': request.headers.get('Authorization') || ''
      },
      body: JSON.stringify({
        agent_id,
        input_variables: inputs,
        use_queue: true
      })
    })

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error || 'Failed to execute agent')
    }

    return Response.json({
      success: true,
      execution_id: result.execution_id,
      job_id: result.job_id,
      message: 'Agent execution started successfully'
    })

  } catch (error) {
    console.error('❌ Agent execution API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const agent_id = params.id

    // Get agent execution status from your existing endpoint
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/run-agent?agent_id=${agent_id}`)
    const result = await response.json()

    return Response.json({
      success: true,
      agent_id,
      executions: result.executions || [],
      count: result.count || 0
    })

  } catch (error) {
    console.error('❌ Agent status API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 })
  }
}