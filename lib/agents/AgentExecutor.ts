// lib/agents/AgentExecutor.ts
import { enrichClaudeContext } from '../utils/enrichClaudeContext';

export interface AgentConfig {
  type: 'openai' | 'anthropic' | 'custom' | 'webhook';
  apiKey?: string;
  endpoint?: string;
  model?: string;
  parameters?: Record<string, any>;
  timeout?: number;
  retries?: number;
}

export interface ExecutionContext {
  stepId: string;
  workflowId: string;
  userId: string;
  inputs: Record<string, any>;
  previousResults?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface ExecutionResult {
  success: boolean;
  outputs: Record<string, any>;
  executionTime: number;
  error?: string;
  metadata?: {
    tokensUsed?: number;
    cost?: number;
    model?: string;
    requestId?: string;
  };
}

export class RealAgentExecutor {
  private config: AgentConfig;
  
  constructor(config: AgentConfig) {
    this.config = config;
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      console.log(`[AGENT] Starting real execution for step: ${context.stepId}`);
      console.log(`[AGENT] Agent type: ${this.config.type}`);
      
      let result: ExecutionResult;
      
      switch (this.config.type) {
        case 'openai':
          result = await this.executeOpenAI(context);
          break;
        case 'anthropic':
          result = await this.executeAnthropic(context);
          break;
        case 'webhook':
          result = await this.executeWebhook(context);
          break;
        case 'custom':
          result = await this.executeCustom(context);
          break;
        default:
          throw new Error(`Unsupported agent type: ${this.config.type}`);
      }
      
      return {
        ...result,
        executionTime: Date.now() - startTime
      };
      
    } catch (error) {
      console.error(`[AGENT] Execution failed:`, error);
      
      return {
        success: false,
        outputs: {},
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown execution error'
      };
    }
  }

  private async executeOpenAI(context: ExecutionContext): Promise<ExecutionResult> {
    // Implementation for OpenAI API calls
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.model || 'gpt-3.5-turbo',
        messages: this.buildPrompt(context),
        ...this.config.parameters
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      outputs: this.parseAgentResponse(data.choices[0].message.content),
      executionTime: 0,
      metadata: {
        tokensUsed: data.usage?.total_tokens,
        model: data.model,
        requestId: response.headers.get('x-request-id') || undefined
      }
    };
  }

  private async executeAnthropic(context: ExecutionContext): Promise<ExecutionResult> {
    // Enrich context with project information
    const enrichedContext = await enrichClaudeContext(context, process.cwd());
    
    // Implementation for Anthropic API calls
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey!,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.config.model || 'claude-3-sonnet-20240229',
        max_tokens: 4000,
        messages: this.buildAnthropicPrompt(context),
        ...this.config.parameters
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      outputs: this.parseAgentResponse(data.content[0].text),
      executionTime: 0,
      metadata: {
        tokensUsed: data.usage?.output_tokens + data.usage?.input_tokens,
        model: data.model,
        requestId: data.id
      }
    };
  }

  private async executeWebhook(context: ExecutionContext): Promise<ExecutionResult> {
    // Implementation for webhook-based agents
    const response = await fetch(this.config.endpoint!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders()
      },
      body: JSON.stringify({
        stepId: context.stepId,
        workflowId: context.workflowId,
        inputs: context.inputs,
        previousResults: context.previousResults,
        metadata: context.metadata
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      success: data.success !== false,
      outputs: data.outputs || data.result || data,
      executionTime: 0,
      metadata: data.metadata
    };
  }

  private async executeCustom(context: ExecutionContext): Promise<ExecutionResult> {
    // Placeholder for custom agent implementations
    throw new Error('Custom agent execution not implemented - override this method');
  }

  private buildPrompt(context: ExecutionContext): Array<{role: string, content: string}> {
    const systemPrompt = this.config.parameters?.systemPrompt || 
      'You are an AI agent executing a workflow step. Analyze the inputs and provide the requested outputs in JSON format.';
    
    const userPrompt = `
Step ID: ${context.stepId}
Inputs: ${JSON.stringify(context.inputs, null, 2)}
${context.previousResults ? `Previous Results: ${JSON.stringify(context.previousResults, null, 2)}` : ''}

Please process these inputs and return the results in JSON format.
`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  }

  private buildAnthropicPrompt(context: ExecutionContext): Array<{role: string, content: string}> {
    const systemPrompt = context.metadata?.systemContext ? 
      `${context.metadata.systemContext}\n\n${this.config.parameters?.systemPrompt || ''}` :
      this.config.parameters?.systemPrompt || 'Process these inputs and return results in JSON format.';

    const userPrompt = `
Step ID: ${context.stepId}
Inputs: ${JSON.stringify(context.inputs, null, 2)}
${context.previousResults ? `Previous Results: ${JSON.stringify(context.previousResults, null, 2)}` : ''}`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  }

  private parseAgentResponse(response: string): Record<string, any> {
    try {
      // Try to parse as JSON first
      return JSON.parse(response);
    } catch {
      // If not JSON, try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          // If still fails, return as text result
          return { result: response };
        }
      }
      
      // Fallback to text result
      return { result: response };
    }
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    
    return headers;
  }
}