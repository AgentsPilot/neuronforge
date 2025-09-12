// app/api/orchestration/run-step/route.ts
// Dedicated API for workflow orchestration - separate from standalone agents

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import OpenAI from 'openai'

export const runtime = 'nodejs'

// Initialize OpenAI with your existing configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface OrchestrationStepRequest {
  stepId: string
  stepName: string
  stepDescription?: string
  workflowId: string
  inputs: Record<string, any>
  expectedOutputs?: Array<{name: string, type: string, description?: string}>
  previousResults?: Record<string, any>
}

export async function POST(req: Request) {
  const body = await req.json()
  const { 
    stepId, 
    stepName, 
    stepDescription, 
    workflowId, 
    inputs, 
    expectedOutputs, 
    previousResults 
  }: OrchestrationStepRequest = body

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

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Validate required fields
  if (!stepId || !stepName || !workflowId) {
    return NextResponse.json({ 
      error: 'Missing required fields: stepId, stepName, workflowId' 
    }, { status: 400 })
  }

  try {
    console.log(`[ORCHESTRATION] Processing step: ${stepName} in workflow: ${workflowId}`)

    // Build system prompt for orchestration context
    const systemPrompt = buildOrchestrationSystemPrompt(stepName, stepDescription, expectedOutputs)
    
    // Build user prompt with workflow context
    const userPrompt = buildOrchestrationUserPrompt(inputs, previousResults, expectedOutputs)

    // Call OpenAI directly for orchestration
    const startTime = Date.now()
    
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 2000,
    })

    const executionTime = Date.now() - startTime
    const aiResponse = completion.choices[0]?.message?.content || ''
    
    // Parse AI response into structured outputs
    const outputs = parseOrchestrationResponse(aiResponse, expectedOutputs)
    
    // Determine success status
    const success = outputs && Object.keys(outputs).length > 0 && !outputs.error

    // Log orchestration execution (separate from standalone agents)
    await logOrchestrationExecution({
      stepId,
      stepName,
      workflowId,
      userId: user.id,
      inputs,
      outputs,
      executionTime,
      tokensUsed: completion.usage?.total_tokens || 0,
      success
    })

    return NextResponse.json({
      success,
      outputs,
      executionTime,
      metadata: {
        stepId,
        stepName,
        workflowId,
        tokensUsed: completion.usage?.total_tokens,
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        requestId: completion.id,
        type: 'orchestration'
      }
    })

  } catch (error) {
    console.error('[ORCHESTRATION] Execution error:', error)
    
    // Log the error
    await logOrchestrationExecution({
      stepId,
      stepName,
      workflowId,
      userId: user.id,
      inputs,
      error: error instanceof Error ? error.message : 'Unknown error',
      success: false
    })

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Step execution failed',
      outputs: {},
      executionTime: 0
    }, { status: 500 })
  }
}

function buildOrchestrationSystemPrompt(
  stepName: string,
  stepDescription?: string,
  expectedOutputs?: Array<{name: string, type: string, description?: string}>
): string {
  let prompt = `You are an AI agent executing a step in a business workflow orchestration system.

Current Step: "${stepName}"
${stepDescription ? `Description: ${stepDescription}` : ''}

Your role in workflow orchestration:
- Process inputs from previous workflow steps
- Generate outputs for subsequent workflow steps  
- Maintain data consistency across the workflow
- Provide business-appropriate, professional results
- Ensure outputs are properly structured for automation`

  if (expectedOutputs && expectedOutputs.length > 0) {
    prompt += `\n\nRequired Output Structure (return as valid JSON):`
    expectedOutputs.forEach(output => {
      prompt += `\n- ${output.name} (${output.type})${output.description ? ': ' + output.description : ''}`
    })
    prompt += `\n\nIMPORTANT: Your response must be valid JSON with exactly these field names.`
  } else {
    prompt += `\n\nReturn your response as JSON with meaningful field names based on the step purpose.`
  }

  prompt += `\n\nFocus on accuracy, consistency, and providing results that enable the workflow to continue smoothly.`

  return prompt
}

function buildOrchestrationUserPrompt(
  inputs: Record<string, any>,
  previousResults?: Record<string, any>,
  expectedOutputs?: Array<{name: string, type: string}>
): string {
  let prompt = `Execute this workflow step with the following data:\n\n`
  
  // Add current step inputs
  if (inputs && Object.keys(inputs).length > 0) {
    prompt += `Step Inputs:\n`
    Object.entries(inputs).forEach(([key, value]) => {
      const valueStr = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
      prompt += `${key}: ${valueStr}\n`
    })
    prompt += `\n`
  }

  // Add previous workflow results for context
  if (previousResults && Object.keys(previousResults).length > 0) {
    prompt += `Previous Workflow Results:\n`
    Object.entries(previousResults).forEach(([stepId, result]) => {
      prompt += `Step ${stepId}: ${JSON.stringify(result, null, 2)}\n`
    })
    prompt += `\n`
  }

  // Add expected output format
  if (expectedOutputs && expectedOutputs.length > 0) {
    prompt += `Required JSON Response Format:\n{\n`
    expectedOutputs.forEach((output, index) => {
      const isLast = index === expectedOutputs.length - 1
      prompt += `  "${output.name}": <${output.type.toLowerCase()}_value>${isLast ? '' : ','}\n`
    })
    prompt += `}\n\n`
  }

  prompt += `Process the above data and provide the required outputs for this workflow step.`

  return prompt
}

function parseOrchestrationResponse(
  response: string, 
  expectedOutputs?: Array<{name: string, type: string}>
): Record<string, any> {
  try {
    // First, try direct JSON parse
    const parsed = JSON.parse(response)
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // Continue with extraction methods
  }

  // Try to extract JSON block from response
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const extracted = JSON.parse(jsonMatch[0])
      if (typeof extracted === 'object' && !Array.isArray(extracted)) {
        return extracted
      }
    } catch {
      // Continue with fallback
    }
  }

  // Fallback: create structured response based on expected outputs
  const outputs: Record<string, any> = {}
  
  if (expectedOutputs && expectedOutputs.length > 0) {
    expectedOutputs.forEach(expected => {
      outputs[expected.name] = extractValueFromText(response, expected.name, expected.type)
    })
  } else {
    // Generic output structure
    outputs.result = response.trim()
    outputs.processed = true
    outputs.timestamp = new Date().toISOString()
  }

  return outputs
}

function extractValueFromText(text: string, fieldName: string, fieldType: string): any {
  const lowerText = text.toLowerCase()
  const lowerFieldName = fieldName.toLowerCase()

  switch (fieldType.toLowerCase()) {
    case 'boolean':
      return lowerText.includes('true') || 
             lowerText.includes('yes') || 
             lowerText.includes('success') ||
             lowerText.includes('completed')
    
    case 'number':
    case 'integer':
      const numberMatch = text.match(/\d+/)
      return numberMatch ? parseInt(numberMatch[0]) : 0
    
    case 'array':
      // Extract arrays or create from lines
      const arrayMatch = text.match(/\[[\s\S]*?\]/)
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0])
        } catch {
          return text.split('\n').filter(line => line.trim()).slice(0, 3)
        }
      }
      return text.split('\n').filter(line => line.trim()).slice(0, 3)
    
    case 'object':
      const objMatch = text.match(/\{[\s\S]*?\}/)
      if (objMatch) {
        try {
          return JSON.parse(objMatch[0])
        } catch {
          return { extracted_content: text.substring(0, 100), field_name: fieldName }
        }
      }
      return { extracted_content: text.substring(0, 100), field_name: fieldName }
    
    default: // string/text
      if (lowerFieldName.includes('status')) {
        return lowerText.includes('error') || lowerText.includes('fail') ? 'error' : 'success'
      }
      return text.length > 200 ? text.substring(0, 200) + '...' : text
  }
}

async function logOrchestrationExecution(data: {
  stepId: string
  stepName: string
  workflowId: string
  userId: string
  inputs?: Record<string, any>
  outputs?: Record<string, any>
  executionTime?: number
  tokensUsed?: number
  error?: string
  success: boolean
}): Promise<void> {
  try {
    console.log('[ORCHESTRATION-LOG]', {
      timestamp: new Date().toISOString(),
      type: 'workflow_orchestration',
      ...data
    })
    
    // You could add database logging here if needed:
    // await supabase.from('orchestration_logs').insert({ 
    //   ...data, 
    //   timestamp: new Date() 
    // })
    
  } catch (error) {
    console.error('[ORCHESTRATION-LOGGING-ERROR]', error)
  }
}