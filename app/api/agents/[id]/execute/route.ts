// app/api/agents/[id]/execute/route.ts

import { NextRequest } from 'next/server'
import { agentSchedulerBridge } from '@/lib/scheduler/schedulerBridge'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const agent_id = params.id
    const body = await request.json()
    const inputs = body.inputs || {}

    // Execute the agent manually
    const execution_id = await agentSchedulerBridge.executeAgentManually(agent_id, inputs)

    return Response.json({
      success: true,
      execution_id,
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

// app/api/agents/[id]/status/route.ts

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const agent_id = params.id

    // Get agent execution status
    const status = await agentSchedulerBridge.getAgentExecutionStatus(agent_id)

    return Response.json({
      success: true,
      agent_id,
      ...status
    })

  } catch (error) {
    console.error('❌ Agent status API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 })
  }
}

// app/api/agents/[id]/route.ts - Add hooks for agent lifecycle

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const agent_id = params.id
    const body = await request.// app/api/agents/[id]/execute/route.ts

import { NextRequest } from 'next/server'
import { agentSchedulerBridge } from '@/lib/scheduler/schedulerBridge'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const agent_id = params.id
    const body = await request.json()
    const inputs = body.inputs || {}

    // Execute the agent manually
    const execution_id = await agentSchedulerBridge.executeAgentManually(agent_id, inputs)

    return Response.json({
      success: true,
      execution_id,
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

// app/api/agents/[id]/status/route.ts

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const agent_id = params.id

    // Get agent execution status
    const status = await agentSchedulerBridge.getAgentExecutionStatus(agent_id)

    return Response.json({
      success: true,
      agent_id,
      ...status
    })

  } catch (error) {
    console.error('❌ Agent status API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 })
  }
}

// app/api/agents/[id]/route.ts - Add hooks for agent lifecycle

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const agent_id = params.id
    const body = await request.json()

    // Update agent in database (your existing logic)
    const { data, error } = await supabase
      .from('agents')
      .update(body)
      .eq('id', agent_id)
      .select()
      .single()

    if (error) {
      throw new Error(`Database update failed: ${error.message}`)
    }

    // Notify scheduler bridge about the update
    await agentSchedulerBridge.onAgentUpdated(agent_id, body)

    return Response.json({
      success: true,
      agent: data,
      message: 'Agent updated successfully'
    })

  } catch (error) {
    console.error('❌ Agent update API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const agent_id = params.id

    // Delete agent from database (your existing logic)
    const { error } = await supabase
      .from('agents')
      .delete()
      .eq('id', agent_id)

    if (error) {
      throw new Error(`Database delete failed: ${error.message}`)
    }

    // Notify scheduler bridge about the deletion
    await agentSchedulerBridge.onAgentDeleted(agent_id)

    return Response.json({
      success: true,
      message: 'Agent deleted successfully'
    })

  } catch (error) {
    console.error('❌ Agent delete API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 })
  }
}

// app/api/agents/route.ts - Add hook for agent creation

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Create agent in database (your existing logic)
    const { data, error } = await supabase
      .from('agents')
      .insert(body)
      .select()
      .single()

    if (error) {
      throw new Error(`Database insert failed: ${error.message}`)
    }

    // Notify scheduler bridge about the new agent
    await agentSchedulerBridge.onAgentCreated(data.id)

    return Response.json({
      success: true,
      agent: data,
      message: 'Agent created successfully'
    })

  } catch (error) {
    console.error('❌ Agent creation API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 })
  }
}

// app/api/system/status/route.ts - System status endpoint

export async function GET() {
  try {
    const systemStatus = agentSchedulerBridge.getSystemStatus()

    return Response.json({
      success: true,
      system: {
        scheduler: systemStatus.scheduler,
        totalActiveAgents: await systemStatus.totalActiveAgents,
        totalExecutions: await systemStatus.totalExecutions,
        timestamp: new Date().toISOString()
      }
    })

  } catch (error) {
    console.error('❌ System status API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 })
  }
}

// app/api/system/reload-schedules/route.ts - Force reload schedules

export async function POST() {
  try {
    await agentSchedulerBridge.reloadAllSchedules()

    return Response.json({
      success: true,
      message: 'All schedules reloaded successfully'
    })

  } catch (error) {
    console.error('❌ Reload schedules API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 })
  }
}