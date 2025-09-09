// types/usage.ts

export interface TokenUsage {
  id: string
  user_id: string
  model_name: string
  provider: 'openai' | 'anthropic' | 'google' | 'meta' | 'cohere' | 'mistral' | string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  request_type: 'chat' | 'completion' | 'embedding' | 'image' | 'audio' | string
  session_id?: string
  metadata?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface UsageStats {
  totalTokens: number
  totalCost: number
  totalRequests: number
  avgTokensPerRequest: number
  topModel: string
  topProvider: string
  currentMonthTokens: number
  currentMonthCost: number
  dailyUsage: DailyUsage[]
}

export interface DailyUsage {
  date: string
  tokens: number
  cost: number
  requests: number
}

export interface MonthlyUsage {
  month: string
  user_id: string
  provider: string
  model_name: string
  request_count: number
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost_usd: number
  avg_cost_per_request: number
  avg_tokens_per_request: number
}

export interface UsageSummary {
  total_requests: number
  total_tokens: number
  total_cost: number
  avg_tokens_per_request: number
  most_used_model: string
  most_used_provider: string
}

export interface ModelPricing {
  provider: string
  model_name: string
  input_price_per_1k: number  // USD per 1000 input tokens
  output_price_per_1k: number // USD per 1000 output tokens
  context_length: number
  supports_streaming: boolean
  supports_function_calling: boolean
}

// Predefined model pricing (you can move this to a database table later)
export const MODEL_PRICING: ModelPricing[] = [
  // OpenAI
  {
    provider: 'openai',
    model_name: 'gpt-4o',
    input_price_per_1k: 0.0025,
    output_price_per_1k: 0.01,
    context_length: 128000,
    supports_streaming: true,
    supports_function_calling: true
  },
  {
    provider: 'openai',
    model_name: 'gpt-4o-mini',
    input_price_per_1k: 0.00015,
    output_price_per_1k: 0.0006,
    context_length: 128000,
    supports_streaming: true,
    supports_function_calling: true
  },
  {
    provider: 'openai',
    model_name: 'gpt-4-turbo',
    input_price_per_1k: 0.01,
    output_price_per_1k: 0.03,
    context_length: 128000,
    supports_streaming: true,
    supports_function_calling: true
  },
  {
    provider: 'openai',
    model_name: 'gpt-3.5-turbo',
    input_price_per_1k: 0.0005,
    output_price_per_1k: 0.0015,
    context_length: 16385,
    supports_streaming: true,
    supports_function_calling: true
  },
  // Anthropic
  {
    provider: 'anthropic',
    model_name: 'claude-3-5-sonnet-20241022',
    input_price_per_1k: 0.003,
    output_price_per_1k: 0.015,
    context_length: 200000,
    supports_streaming: true,
    supports_function_calling: true
  },
  {
    provider: 'anthropic',
    model_name: 'claude-3-5-haiku-20241022',
    input_price_per_1k: 0.001,
    output_price_per_1k: 0.005,
    context_length: 200000,
    supports_streaming: true,
    supports_function_calling: true
  },
  {
    provider: 'anthropic',
    model_name: 'claude-3-opus-20240229',
    input_price_per_1k: 0.015,
    output_price_per_1k: 0.075,
    context_length: 200000,
    supports_streaming: true,
    supports_function_calling: true
  },
  // Google
  {
    provider: 'google',
    model_name: 'gemini-1.5-pro',
    input_price_per_1k: 0.00125,
    output_price_per_1k: 0.005,
    context_length: 2000000,
    supports_streaming: true,
    supports_function_calling: true
  },
  {
    provider: 'google',
    model_name: 'gemini-1.5-flash',
    input_price_per_1k: 0.000075,
    output_price_per_1k: 0.0003,
    context_length: 1000000,
    supports_streaming: true,
    supports_function_calling: true
  }
]

// Utility function to calculate cost
export function calculateCost(
  provider: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING.find(
    p => p.provider === provider && p.model_name === modelName
  )
  
  if (!pricing) {
    console.warn(`No pricing found for ${provider}/${modelName}`)
    return 0
  }
  
  const inputCost = (inputTokens / 1000) * pricing.input_price_per_1k
  const outputCost = (outputTokens / 1000) * pricing.output_price_per_1k
  
  return inputCost + outputCost
}

// Utility function to track usage (call this after LLM requests)
export async function trackTokenUsage(
  supabase: any,
  userId: string,
  data: {
    modelName: string
    provider: string
    inputTokens: number
    outputTokens: number
    requestType?: string
    sessionId?: string
    metadata?: Record<string, any>
  }
): Promise<TokenUsage | null> {
  try {
    const cost = calculateCost(
      data.provider,
      data.modelName,
      data.inputTokens,
      data.outputTokens
    )

    const { data: usage, error } = await supabase
      .from('token_usage')
      .insert({
        user_id: userId,
        model_name: data.modelName,
        provider: data.provider,
        input_tokens: data.inputTokens,
        output_tokens: data.outputTokens,
        cost_usd: cost,
        request_type: data.requestType || 'chat',
        session_id: data.sessionId,
        metadata: data.metadata
      })
      .select()
      .single()

    if (error) {
      console.error('Error tracking token usage:', error)
      return null
    }

    return usage
  } catch (error) {
    console.error('Error tracking token usage:', error)
    return null
  }
}

// Usage filters for the UI
export interface UsageFilters {
  timeRange: '7d' | '30d' | '90d' | 'all'
  provider?: string
  model?: string
  requestType?: string
}

// Chart data types for visualization
export interface ChartDataPoint {
  date: string
  tokens: number
  cost: number
  requests: number
  label?: string
}

export interface ModelUsageData {
  model: string
  provider: string
  tokens: number
  cost: number
  requests: number
  percentage: number
}

export interface ProviderUsageData {
  provider: string
  tokens: number
  cost: number
  requests: number
  percentage: number
  models: string[]
}