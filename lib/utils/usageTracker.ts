// utils/usageTracker.ts
/**
 * @deprecated This module is deprecated and will be removed in a future version.
 *
 * MIGRATION GUIDE:
 * - Use AIAnalyticsService from '@/lib/analytics/aiAnalytics' instead
 * - Use OpenAIProvider from '@/lib/ai/providers/openaiProvider' for automatic tracking
 * - Pricing is now database-backed via ai_model_pricing table
 *
 * Benefits of AIAnalyticsService:
 * - Automatic tracking via BaseProvider (no manual calls needed)
 * - 40+ tracked fields vs 10 fields in trackUsage
 * - Activity-based tracking for better analytics
 * - Multi-provider support (OpenAI, Anthropic, Google)
 * - Database-backed pricing with caching
 * - No duplicate tracking issues
 *
 * Example migration:
 *
 * OLD CODE:
 * const response = await fetch('https://api.openai.com/v1/chat/completions', {...});
 * await trackUsage({ userId, provider: 'openai', modelName: 'gpt-4o', ... });
 *
 * NEW CODE:
 * const aiAnalytics = new AIAnalyticsService(supabase);
 * const openaiProvider = new OpenAIProvider(apiKey, aiAnalytics);
 * const response = await openaiProvider.chatCompletion(params, context);
 * // Tracking happens automatically - no manual call needed!
 */

import { createClient } from '@supabase/supabase-js'

// Create server-side Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role key for server-side
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Model pricing configuration
const MODEL_PRICING = {
  'openai': {
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  },
  'anthropic': {
    'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
    'claude-3-5-haiku-20241022': { input: 0.001, output: 0.005 },
    'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  },
  'google': {
    'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
    'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  }
}

interface UsageData {
  userId: string
  provider: string
  modelName: string
  inputTokens: number
  outputTokens: number
  requestType?: string
  sessionId?: string
  metadata?: Record<string, any>
}

export function calculateCost(provider: string, modelName: string, inputTokens: number, outputTokens: number): number {
  console.log('💰 Calculating cost for:', { provider, modelName, inputTokens, outputTokens })
  
  const pricing = MODEL_PRICING[provider as keyof typeof MODEL_PRICING]?.[modelName]
  
  if (!pricing) {
    console.warn(`❌ No pricing found for ${provider}/${modelName}`)
    console.log('Available providers:', Object.keys(MODEL_PRICING))
    console.log(`Available models for ${provider}:`, Object.keys(MODEL_PRICING[provider as keyof typeof MODEL_PRICING] || {}))
    return 0
  }
  
  const inputCost = (inputTokens / 1000) * pricing.input
  const outputCost = (outputTokens / 1000) * pricing.output
  const totalCost = inputCost + outputCost
  
  console.log('💰 Cost breakdown:', {
    inputCost: inputCost.toFixed(6),
    outputCost: outputCost.toFixed(6),
    totalCost: totalCost.toFixed(6)
  })
  
  return totalCost
}

/**
 * @deprecated Use AIAnalyticsService instead. This function will be removed in a future version.
 * See file header for migration guide.
 */
export async function trackUsage(data: UsageData): Promise<boolean> {
  console.warn('⚠️ DEPRECATED: trackUsage() is deprecated. Use AIAnalyticsService with OpenAIProvider instead.');
  console.warn('⚠️ See /lib/utils/usageTracker.ts file header for migration guide.');
  console.log('🎯 trackUsage called with data:', data)
  
  try {
    // Validate required fields
    if (!data.userId) {
      console.error('❌ Missing userId in trackUsage data')
      return false
    }
    
    if (!data.provider || !data.modelName) {
      console.error('❌ Missing provider or modelName in trackUsage data')
      return false
    }
    
    if (typeof data.inputTokens !== 'number' || typeof data.outputTokens !== 'number') {
      console.error('❌ Invalid token counts in trackUsage data')
      return false
    }
    
    console.log('✅ Input validation passed')
    
    // Calculate cost
    const cost = calculateCost(data.provider, data.modelName, data.inputTokens, data.outputTokens)
    console.log('💰 Calculated cost:', cost)
    
    // Prepare insert data
    const insertData = {
      user_id: data.userId,
      provider: data.provider,
      model_name: data.modelName,
      input_tokens: data.inputTokens,
      output_tokens: data.outputTokens,
      cost_usd: cost,
      request_type: data.requestType || 'chat',
      session_id: data.sessionId,
      metadata: data.metadata
    }
    
    console.log('📝 Preparing to insert into Supabase:', insertData)
    
    // Test Supabase connection first
    console.log('🔌 Testing Supabase connection...')
    const { data: testData, error: testError } = await supabase
      .from('token_usage')
      .select('id')
      .limit(1)
    
    if (testError) {
      console.error('❌ Supabase connection test failed:', testError)
      return false
    }
    
    console.log('✅ Supabase connection test passed')
    
    // Insert the usage data
    console.log('📊 Inserting usage data...')
    const { data: result, error } = await supabase
      .from('token_usage')
      .insert(insertData)
      .select() // Return the inserted data
    
    if (error) {
      console.error('❌ Supabase insert error:', error)
      console.log('Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return false
    }

    console.log('✅ Supabase insert successful!')
    console.log('📊 Inserted record:', result)
    
    // Verify the insert by counting records
    const { data: countData, error: countError } = await supabase
      .from('token_usage')
      .select('id')
      .eq('user_id', data.userId)
      .eq('request_type', data.requestType || 'chat')
      .order('created_at', { ascending: false })
      .limit(1)
    
    if (countError) {
      console.warn('⚠️ Could not verify insert:', countError)
    } else {
      console.log('✅ Insert verified, latest record:', countData)
    }

    return true
  } catch (error) {
    console.error('❌ trackUsage unexpected error:', error)
    console.log('Error stack:', (error as Error).stack)
    return false
  }
}

// Debug function to test the tracker
export async function debugTrackUsage(userId: string): Promise<void> {
  console.log('🔧 Running debug test for trackUsage...')
  
  const testData: UsageData = {
    userId: userId,
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    inputTokens: 100,
    outputTokens: 50,
    requestType: 'debug_test',
    sessionId: 'debug-session-' + Date.now(),
    metadata: {
      test: true,
      timestamp: new Date().toISOString()
    }
  }
  
  console.log('🧪 Test data:', testData)
  
  const success = await trackUsage(testData)
  
  if (success) {
    console.log('✅ Debug test PASSED - usage tracking is working')
  } else {
    console.log('❌ Debug test FAILED - usage tracking has issues')
  }
  
  // Check if the record was actually inserted
  const { data: verifyData, error: verifyError } = await supabase
    .from('token_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('request_type', 'debug_test')
    .order('created_at', { ascending: false })
    .limit(1)
  
  if (verifyError) {
    console.error('❌ Could not verify debug insert:', verifyError)
  } else if (verifyData && verifyData.length > 0) {
    console.log('✅ Debug record found in database:', verifyData[0])
  } else {
    console.log('❌ Debug record NOT found in database')
  }
}

// Test function to check database connectivity
export async function testSupabaseConnection(): Promise<boolean> {
  console.log('🔌 Testing Supabase connection...')
  
  try {
    const { data, error } = await supabase
      .from('token_usage')
      .select('id')
      .limit(1)
    
    if (error) {
      console.error('❌ Supabase connection failed:', error)
      return false
    }
    
    console.log('✅ Supabase connection successful')
    return true
  } catch (error) {
    console.error('❌ Supabase connection error:', error)
    return false
  }
}