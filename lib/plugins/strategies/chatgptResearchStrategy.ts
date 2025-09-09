// lib/plugins/strategies/chatgptResearchStrategy.ts
import { PluginStrategy } from '../pluginRegistry'

// Generic function to safely stringify any data with aggressive size limits
function safeStringify(data: any, maxLength: number = 15000): string {
  try {
    if (data === null || data === undefined) {
      return 'null'
    }
    
    if (typeof data === 'string') {
      return data.length > maxLength ? data.substring(0, maxLength) + '\n[Content truncated]' : data
    }
    
    if (typeof data === 'number' || typeof data === 'boolean') {
      return String(data)
    }
    
    // For objects and arrays, convert to JSON with limited depth
    const jsonString = JSON.stringify(data, (key, value) => {
      if (typeof value === 'string' && value.length > 500) {
        return value.substring(0, 500) + '...[truncated]'
      }
      return value
    }, 2)
    
    return jsonString.length > maxLength 
      ? jsonString.substring(0, maxLength) + '\n[Data truncated]' 
      : jsonString
      
  } catch (error) {
    return `[Unable to process data: ${error.message}]`
  }
}

// Estimate token count (rough approximation: 1 token ≈ 4 characters)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Choose appropriate model based on content size
function selectModel(estimatedTokens: number): { model: string, maxTokens: number } {
  if (estimatedTokens > 6000) {
    return { model: 'gpt-4-turbo-preview', maxTokens: 2000 } // Has 128k context
  } else if (estimatedTokens > 4000) {
    return { model: 'gpt-4-1106-preview', maxTokens: 2000 } // Has 128k context
  } else {
    return { model: 'gpt-4', maxTokens: 3000 } // Standard 8k context
  }
}

// Extract research topics from user prompts using simple keyword detection
function extractResearchTopics(userPrompt: string): string[] {
  if (!userPrompt || typeof userPrompt !== 'string') return []
  
  // Look for quoted topics or specific research indicators
  const quotedTopics = userPrompt.match(/"([^"]+)"/g)?.map(match => match.replace(/"/g, '')) || []
  const afterResearchWords = userPrompt.match(/(?:research|analyze|study|investigate|find information about|search for|look up)\s+([^.,!?]+)/gi)
  const extractedTopics = afterResearchWords?.map(match => match.replace(/^(?:research|analyze|study|investigate|find information about|search for|look up)\s+/i, '').trim()) || []
  
  return [...quotedTopics, ...extractedTopics].filter(topic => topic && topic.length > 2)
}

// Web search functionality
async function searchWithGoogle(query: string): Promise<string> {
  try {
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY
    
    if (!cx || !apiKey) {
      return 'Web search temporarily unavailable.'
    }
    
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query.trim())}&num=5`
    const response = await fetch(searchUrl)
    
    if (!response.ok) {
      return 'Web search temporarily unavailable.'
    }
    
    const data = await response.json()
    
    if (data.items && data.items.length > 0) {
      const results = data.items.map((item: any) => `**${item.title}**\n${item.snippet}\nSource: ${item.link}`)
      return results.join('\n\n---\n\n')
    }
    
    return 'No search results found.'
    
  } catch (error) {
    console.error('Search error:', error)
    return 'Web search temporarily unavailable.'
  }
}

// Perform web research if needed
async function performWebResearch(topics: string[]): Promise<string> {
  if (topics.length === 0) return ''
  
  const searchResults = []
  
  for (const topic of topics.slice(0, 3)) { // Limit to 3 searches to manage API costs
    const result = await searchWithGoogle(topic)
    if (result && !result.includes('temporarily unavailable') && !result.includes('No search results')) {
      searchResults.push(`**Research results for "${topic}":**\n\n${result}`)
    }
  }
  
  return searchResults.length > 0 ? searchResults.join('\n\n=== === ===\n\n') : ''
}

export const chatgptResearchStrategy: PluginStrategy = {
  pluginKey: 'chatgpt-research',
  name: 'ChatGPT Universal Processor',
  
  async connect({ supabase, popup, userId }: { supabase: any; popup: Window; userId: string }) {
    try {
      const connectionData = {
        user_id: userId,
        plugin_key: 'chatgpt-research',
        plugin_name: 'ChatGPT Universal Processor',
        access_token: 'platform-key',
        refresh_token: null,
        expires_at: null,
        scope: 'universal',
        username: 'ChatGPT',
        email: null,
        profile_data: { service: 'OpenAI ChatGPT - Universal Data Processor' },
        settings: {},
        status: 'active',
        connected_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('plugin_connections')
        .upsert(connectionData, { onConflict: 'user_id,plugin_key' })

      if (error) throw error

      popup.postMessage({ 
        type: 'plugin-connected', 
        plugin: 'chatgpt-research',
        success: true 
      }, window.location.origin)
      
      return connectionData
    } catch (error) {
      console.error('ChatGPT connection error:', error)
      popup.postMessage({ 
        type: 'plugin-connected', 
        plugin: 'chatgpt-research',
        success: false,
        error: error.message 
      }, window.location.origin)
      throw error
    }
  },

  async run({ connection, userId, input_variables }: { connection: any; userId: string; input_variables: Record<string, any> }) {
    console.log('ChatGPT Universal Processor: Starting...', {
      userId,
      inputKeys: Object.keys(input_variables),
      hasUserPrompt: !!(input_variables.userPrompt || input_variables.prompt || input_variables.task || input_variables.instruction)
    })

    try {
      // Step 1: Extract user instructions from various possible keys
      const userPrompt = input_variables.userPrompt || 
                        input_variables.prompt || 
                        input_variables.task || 
                        input_variables.instruction || 
                        input_variables.request ||
                        input_variables.query ||
                        'Analyze the provided data and give insights.'

      console.log('User prompt extracted:', userPrompt.substring(0, 200))

      // Step 2: Gather all available data (everything except the prompt itself)
      const dataToAnalyze = {}
      Object.entries(input_variables).forEach(([key, value]) => {
        // Skip prompt-related keys and internal workflow keys
        if (!['userPrompt', 'prompt', 'task', 'instruction', 'request', 'query'].includes(key) &&
            !key.startsWith('_') && value !== undefined && value !== null) {
          dataToAnalyze[key] = value
        }
      })

      console.log('Data keys to analyze:', Object.keys(dataToAnalyze))

      // Step 3: Check if user wants web research
      const researchTopics = extractResearchTopics(userPrompt)
      const needsWebSearch = researchTopics.length > 0 || 
                            userPrompt.toLowerCase().includes('current') ||
                            userPrompt.toLowerCase().includes('latest') ||
                            userPrompt.toLowerCase().includes('recent') ||
                            userPrompt.toLowerCase().includes('search') ||
                            userPrompt.toLowerCase().includes('research')

      console.log('Web search needed:', needsWebSearch, 'Topics:', researchTopics)

      // Step 4: Perform web research if requested
      let webResearchData = ''
      if (needsWebSearch) {
        console.log('Performing web research...')
        webResearchData = await performWebResearch(researchTopics.length > 0 ? researchTopics : [userPrompt])
      }

      // Step 5: Prepare data for ChatGPT with aggressive size management
      const dataString = safeStringify(dataToAnalyze, 12000) // Much more conservative limit
      const webDataString = webResearchData ? safeStringify(webResearchData, 8000) : ''
      
      // Step 6: Construct the prompt with token awareness
      let finalUserPrompt = userPrompt

      // Add available data if we have any, with size checks
      if (Object.keys(dataToAnalyze).length > 0) {
        const dataSection = `\n\nAvailable data to work with:\n${dataString}`
        if (estimateTokens(finalUserPrompt + dataSection) < 5500) { // Leave room for system prompt and response
          finalUserPrompt += dataSection
        } else {
          finalUserPrompt += '\n\n[Large dataset available - processing summary only due to size limits]'
        }
      }

      // Add web research results if available and space permits
      if (webDataString && estimateTokens(finalUserPrompt + webDataString) < 6000) {
        finalUserPrompt += `\n\nCurrent web research results:\n${webDataString}`
      } else if (webDataString) {
        finalUserPrompt += '\n\n[Web research completed - results available but truncated due to size limits]'
      }

      // If no specific instructions and no data, ask for clarification
      if (!userPrompt || (userPrompt.includes('Analyze the provided data') && Object.keys(dataToAnalyze).length === 0)) {
        finalUserPrompt = 'I need more specific instructions on what you would like me to do. Could you provide more details about your request?'
      }

      // Step 7: Select appropriate model and token limits BEFORE using them
      const estimatedTokens = estimateTokens(finalUserPrompt) + 200 // Add buffer for system prompt
      const modelSelection = selectModel(estimatedTokens)
      const selectedModel = modelSelection.model
      const maxResponseTokens = modelSelection.maxTokens
      
      console.log('Token management:', {
        estimatedInputTokens: estimatedTokens,
        selectedModel: selectedModel,
        maxResponseTokens: maxResponseTokens,
        finalPromptLength: finalUserPrompt.length
      })

      // Step 8: Send to ChatGPT with selected model
      const systemPrompt = 'You are a helpful AI assistant. Follow the user\'s instructions exactly and provide the response they are asking for.'

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: finalUserPrompt }
          ],
          max_tokens: maxResponseTokens,
          temperature: 0.3
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('ChatGPT API error:', errorText)
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
      }

      const responseData = await response.json()
      const assistantResponse = responseData.choices[0]?.message?.content || 'No response generated'

      // Step 9: Return the result in a generic format
      const result = {
        response: assistantResponse,
        summary: 'ChatGPT processing completed',
        userPrompt: userPrompt,
        dataProcessed: Object.keys(dataToAnalyze).length,
        webSearchPerformed: needsWebSearch,
        tokensUsed: responseData.usage?.total_tokens || 0,
        source: 'ChatGPT-4 Universal Processor'
      }

      console.log('ChatGPT processing successful:', {
        responseLength: assistantResponse.length,
        dataKeys: Object.keys(dataToAnalyze).length,
        webSearch: needsWebSearch,
        tokensUsed: result.tokensUsed
      })

      return result

    } catch (error) {
      console.error('ChatGPT processing failed:', error)
      
      return {
        response: `I encountered an error while processing your request: ${error.message}`,
        summary: 'ChatGPT processing encountered an error',
        error: error.message,
        source: 'ChatGPT-4 Universal Processor'
      }
    }
  }
}