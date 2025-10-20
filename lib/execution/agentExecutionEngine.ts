// lib/execution/agentExecutionEngine.ts

import { supabase } from '@/lib/supabaseClient'

interface WorkflowStep {
  id: string
  type: 'data_source' | 'processing' | 'output' | 'delivery' | 'error_handling'
  plugin_name: string
  capability_name: string
  input_mapping: Record<string, any>
  output_mapping: Record<string, string>
  order: number
  condition?: string
}

interface ExecutionContext {
  agent_id: string
  execution_id: string
  variables: Record<string, any>
  step_results: Record<string, any>
}

export class AgentExecutionEngine {
  private static instance: AgentExecutionEngine

  private constructor() {}

  static getInstance(): AgentExecutionEngine {
    if (!AgentExecutionEngine.instance) {
      AgentExecutionEngine.instance = new AgentExecutionEngine()
    }
    return AgentExecutionEngine.instance
  }

  /**
   * Main entry point for executing an agent
   */
  async executeAgent(agent_id: string, inputs: Record<string, any> = {}, trigger_type: string = 'manual'): Promise<string> {
    const execution_id = await this.createExecution(agent_id, trigger_type, inputs)
    
    // Execute asynchronously to avoid blocking
    this.executeAgentAsync(agent_id, execution_id, inputs).catch(error => {
      console.error(`❌ Agent execution ${execution_id} failed:`, error)
    })

    return execution_id
  }

  /**
   * Execute agent asynchronously
   */
  private async executeAgentAsync(agent_id: string, execution_id: string, inputs: Record<string, any>): Promise<void> {
    try {
      // Update execution status to running
      await this.updateExecutionStatus(execution_id, 'running')

      // Get agent configuration
      const agent = await this.getAgent(agent_id)
      if (!agent) {
        throw new Error(`Agent ${agent_id} not found`)
      }

      // Get workflow steps
      const steps = await this.getWorkflowSteps(agent_id)
      
      // Initialize execution context
      const context: ExecutionContext = {
        agent_id,
        execution_id,
        variables: { ...inputs },
        step_results: {}
      }

      console.log(`🚀 Executing agent: ${agent.agent_name} (${execution_id})`)

      // Execute steps in order
      for (const step of steps.sort((a, b) => a.order - b.order)) {
        await this.executeStep(step, context)
      }

      // Mark execution as completed
      await this.updateExecutionStatus(execution_id, 'completed')
      console.log(`✅ Agent execution completed: ${execution_id}`)

    } catch (error) {
      console.error(`❌ Agent execution failed: ${execution_id}`, error)
      await this.updateExecutionStatus(execution_id, 'failed', error.message)
      
      // Try to execute error handling steps
      await this.handleExecutionError(agent_id, execution_id, error)
    }
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(step: WorkflowStep, context: ExecutionContext): Promise<void> {
    try {
      console.log(`🔄 Executing step ${step.id}: ${step.type} - ${step.capability_name}`)

      // Update step status to running
      await this.updateStepStatus(context.execution_id, step.id, 'running')

      // Check condition if exists
      if (step.condition && !this.evaluateCondition(step.condition, context)) {
        console.log(`⏭️ Step ${step.id} skipped due to condition: ${step.condition}`)
        await this.updateStepStatus(context.execution_id, step.id, 'skipped')
        return
      }

      // Prepare step inputs by mapping from context
      const stepInputs = this.prepareStepInputs(step.input_mapping, context)

      // Execute the step using the plugin (mock for now)
      const result = await this.executePluginCapability(
        step.plugin_name,
        step.capability_name,
        stepInputs
      )

      // Store step result in context
      context.step_results[step.id] = result

      // Map outputs to context variables
      this.mapStepOutputs(step.output_mapping, result, context)

      // Update step status to completed
      await this.updateStepStatus(context.execution_id, step.id, 'completed', result)

      console.log(`✅ Step ${step.id} completed`)

    } catch (error) {
      console.error(`❌ Step ${step.id} failed:`, error)
      await this.updateStepStatus(context.execution_id, step.id, 'failed', null, error.message)
      throw error
    }
  }

  /**
   * Execute plugin capability (placeholder - replace with your plugin system)
   */
  private async executePluginCapability(
    plugin_name: string, 
    capability_name: string, 
    inputs: Record<string, any>
  ): Promise<any> {
    // TODO: Replace this with your actual plugin execution system
    console.log(`🔌 Executing ${plugin_name}.${capability_name} with inputs:`, inputs)
    
    // Mock execution based on common capabilities
    switch (`${plugin_name}.${capability_name}`) {
      case 'gmail.read_email':
        return {
          emails: [
            { subject: 'Test Email', from: 'test@example.com', body: 'This is a test email' }
          ],
          count: 1
        }
      
      case 'chatgpt-research.summarize':
        return {
          summary: 'This is a generated summary of the content.',
          word_count: 150
        }
      
      case 'google-drive.upload_files':
        return {
          file_id: 'mock-file-id-' + Date.now(),
          url: 'https://drive.google.com/file/d/mock-file-id'
        }
      
      case 'gmail.send_email':
        return {
          message_id: 'mock-message-id-' + Date.now(),
          status: 'sent'
        }
      
      default:
        // Generic mock response
        await new Promise(resolve => setTimeout(resolve, 1000)) // Simulate processing time
        return {
          status: 'success',
          data: `Executed ${plugin_name}.${capability_name}`,
          timestamp: new Date().toISOString()
        }
    }
  }

  /**
   * Prepare step inputs by mapping from context
   */
  private prepareStepInputs(input_mapping: Record<string, any>, context: ExecutionContext): Record<string, any> {
    const inputs: Record<string, any> = {}

    for (const [key, mapping] of Object.entries(input_mapping)) {
      if (typeof mapping === 'string' && mapping.startsWith('$')) {
        // Variable reference like "$notification_email"
        const varName = mapping.slice(1)
        inputs[key] = context.variables[varName]
      } else if (typeof mapping === 'string' && mapping.startsWith('@')) {
        // Step result reference like "@step1.emails"
        const [stepId, resultKey] = mapping.slice(1).split('.')
        inputs[key] = resultKey 
          ? context.step_results[stepId]?.[resultKey]
          : context.step_results[stepId]
      } else {
        // Literal value
        inputs[key] = mapping
      }
    }

    return inputs
  }

  /**
   * Map step outputs to context variables
   */
  private mapStepOutputs(output_mapping: Record<string, string>, result: any, context: ExecutionContext): void {
    for (const [outputKey, variableName] of Object.entries(output_mapping)) {
      const value = outputKey === '_result' ? result : result?.[outputKey]
      context.variables[variableName] = value
    }
  }

  /**
   * Evaluate simple conditions
   */
  private evaluateCondition(condition: string, context: ExecutionContext): boolean {
    try {
      // Simple condition evaluation
      if (condition.startsWith('!$')) {
        const varName = condition.slice(2)
        return !context.variables[varName]
      } else if (condition.startsWith('$')) {
        const varName = condition.slice(1)
        return !!context.variables[varName]
      }
      return true
    } catch {
      return true
    }
  }

  /**
   * Handle execution errors
   */
  private async handleExecutionError(agent_id: string, execution_id: string, error: any): Promise<void> {
    try {
      // Look for error handling steps
      const { data: errorSteps } = await supabase
        .from('workflow_steps')
        .select('*')
        .eq('agent_id', agent_id)
        .eq('type', 'error_handling')
        .order('order')

      if (errorSteps && errorSteps.length > 0) {
        console.log(`🚨 Executing ${errorSteps.length} error handling steps`)
        
        for (const step of errorSteps) {
          try {
            // Execute error handling step with error context
            const errorContext: ExecutionContext = {
              agent_id,
              execution_id,
              variables: { error_message: error.message, error_type: error.name },
              step_results: {}
            }
            
            await this.executeStep(step, errorContext)
          } catch (errorHandlingError) {
            console.error(`❌ Error handling step failed:`, errorHandlingError)
          }
        }
      }
    } catch (error) {
      console.error(`❌ Failed to handle execution error:`, error)
    }
  }

  /**
   * Database helper methods
   */
  private async createExecution(agent_id: string, trigger_type: string, inputs: Record<string, any>): Promise<string> {
    const { data, error } = await supabase
      .from('agent_executions')
      .insert({
        agent_id,
        status: 'pending',
        trigger_type,
        inputs,
        started_at: new Date().toISOString()
      })
      .select('id')
      .single()

    if (error || !data) {
      throw new Error(`Failed to create execution: ${error?.message}`)
    }

    return data.id
  }

  private async updateExecutionStatus(execution_id: string, status: string, error_message?: string): Promise<void> {
    const updates: any = { 
      status,
      ...(status === 'completed' || status === 'failed' ? { ended_at: new Date().toISOString() } : {})
    }
    
    if (error_message) {
      updates.error_message = error_message
    }

    const { error } = await supabase
      .from('agent_executions')
      .update(updates)
      .eq('id', execution_id)

    if (error) {
      console.error(`❌ Failed to update execution status:`, error)
    }
  }

  private async updateStepStatus(
    execution_id: string, 
    step_id: string, 
    status: string, 
    result?: any, 
    error_message?: string
  ): Promise<void> {
    const { error } = await supabase
      .from('execution_steps')
      .upsert({
        execution_id,
        step_id,
        status,
        result,
        error_message,
        started_at: status === 'running' ? new Date().toISOString() : undefined,
        ended_at: ['completed', 'failed', 'skipped'].includes(status) ? new Date().toISOString() : undefined
      })

    if (error) {
      console.error(`❌ Failed to update step status:`, error)
    }
  }

  private async getAgent(agent_id: string): Promise<any> {
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agent_id)
      .single()

    if (error) {
      throw new Error(`Failed to get agent: ${error.message}`)
    }

    return data
  }

  private async getWorkflowSteps(agent_id: string): Promise<WorkflowStep[]> {
    const { data, error } = await supabase
      .from('workflow_steps')
      .select('*')
      .eq('agent_id', agent_id)
      .order('order')

    if (error) {
      throw new Error(`Failed to get workflow steps: ${error.message}`)
    }

    return data || []
  }
}

// Export singleton instance
export const agentExecutionEngine = AgentExecutionEngine.getInstance()