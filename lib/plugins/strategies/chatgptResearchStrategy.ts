// lib/plugins/strategies/chatgptResearchStrategy.ts
import { PluginStrategy } from '../pluginRegistry'

// Generic function to safely stringify any data with optimized size limits
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
      if (typeof value === 'string' && value.length > 2000) {
        return value.substring(0, 2000) + '...[truncated]'
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

// Choose appropriate model based on content size - BALANCED for cost and quality
function selectModel(estimatedTokens: number, taskType: 'research' | 'standard'): { model: string, maxTokens: number } {
  // For research tasks, use better models with higher token limits
  if (taskType === 'research') {
    if (estimatedTokens > 8000) {
      return { model: 'gpt-4o', maxTokens: 4000 } // Large context research
    } else if (estimatedTokens > 4000) {
      return { model: 'gpt-4o', maxTokens: 3500 } // Medium context research
    } else {
      return { model: 'gpt-4o-mini', maxTokens: 3000 } // Small context - mini with higher tokens
    }
  }

  // For standard tasks, balance cost and quality
  if (estimatedTokens > 8000) {
    return { model: 'gpt-4o-mini', maxTokens: 2500 } // Large context, use mini to save costs
  } else if (estimatedTokens > 4000) {
    return { model: 'gpt-4o-mini', maxTokens: 2000 } // Medium context
  } else {
    return { model: 'gpt-4o-mini', maxTokens: 1500 } // Small context
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

// Fetch full content from a web page
async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AgentPilot/1.0; +https://agentpilot.com)'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    })

    if (!response.ok) {
      return ''
    }

    const html = await response.text()

    // Basic HTML to text conversion - remove scripts, styles, and extract text
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Limit to first 2500 characters for processing - OPTIMIZED for token usage
    return text.substring(0, 2500)

  } catch (error) {
    console.error('Error fetching page content:', error)
    return ''
  }
}

// Web search functionality with full page content fetching
async function searchWithGoogle(query: string, fetchFullContent: boolean = true): Promise<string> {
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
      const results = []

      for (const item of data.items) {
        let resultText = `**${item.title}**\n${item.snippet}\nSource: ${item.link}`

        // Fetch full content if enabled
        if (fetchFullContent) {
          const fullContent = await fetchPageContent(item.link)
          if (fullContent) {
            resultText += `\n\nFull Content Preview:\n${fullContent}`
          }
        }

        results.push(resultText)
      }

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

  for (const topic of topics.slice(0, 3)) { // Optimized to 3 searches to reduce token usage
    const result = await searchWithGoogle(topic)
    if (result && !result.includes('temporarily unavailable') && !result.includes('No search results')) {
      searchResults.push(`**Research results for "${topic}":**\n\n${result}`)
    }
  }

  return searchResults.length > 0 ? searchResults.join('\n\n=== === ===\n\n') : ''
}

// ADDED: Generate contextual system prompt based on task type
function generateContextualSystemPrompt(userPrompt: string, dataToAnalyze: any, input_variables: any): string {
  let prompt = "You are a professional AI assistant designed to help users accomplish specific tasks efficiently and accurately.\n\n"

  // Detect task type from user prompt and add specific instructions
  const promptLower = userPrompt.toLowerCase()

  if (promptLower.includes('summariz') || promptLower.includes('summary')) {
    prompt += "TASK: Create comprehensive summaries that capture key points, important details, and actionable insights.\n"
    prompt += "FORMAT: Use clear headers, bullet points for key findings, and a conclusion with next steps.\n"
    prompt += "LENGTH: Provide detailed summaries with at least 3-4 substantial paragraphs covering all major aspects.\n\n"
  }

  else if (promptLower.includes('analyz') || promptLower.includes('research')) {
    prompt += "TASK: Perform thorough analysis to identify patterns, insights, and recommendations.\n"
    prompt += "FORMAT: Structure your analysis with: Key Findings, Detailed Analysis, and Actionable Recommendations.\n"
    prompt += "DEPTH: Provide comprehensive coverage with multiple paragraphs per section, detailed explanations, and specific examples from the research.\n\n"
  }

  else if (promptLower.includes('email') && Object.keys(dataToAnalyze).length > 0) {
    prompt += "TASK: Process email data to extract meaningful insights and create useful outputs.\n"
    prompt += "FORMAT: Organize by relevance and importance. Include sender details, key topics, and any action items.\n"
    prompt += "DETAIL: Provide thorough analysis of each email with context and implications.\n\n"
  }

  else if (promptLower.includes('report') || promptLower.includes('document')) {
    prompt += "TASK: Generate professional reports with clear structure and actionable insights.\n"
    prompt += "FORMAT: Executive Summary, Detailed Findings, Recommendations, and Conclusion.\n"
    prompt += "LENGTH: Create comprehensive reports with substantial content in each section (minimum 4-5 paragraphs total).\n\n"
  }

  else {
    prompt += "TASK: Follow the user's specific instructions while providing comprehensive and detailed output.\n"
    prompt += "FORMAT: Structure your response logically with clear sections and actionable information.\n"
    prompt += "DEPTH: Provide thorough, detailed responses with comprehensive coverage of the topic.\n\n"
  }

  // Add data context if available
  if (Object.keys(dataToAnalyze).length > 0) {
    prompt += `DATA CONTEXT: You have access to ${Object.keys(dataToAnalyze).join(', ')} data. `
    prompt += "Reference this data directly in your response and cite specific examples.\n\n"
  }

  prompt += "INSTRUCTIONS:\n"
  prompt += "- Provide specific, actionable information with detailed explanations\n"
  prompt += "- Use clear, professional language with comprehensive coverage\n"
  prompt += "- Include relevant details, examples, and supporting evidence\n"
  prompt += "- Structure your response for easy scanning with clear sections\n"
  prompt += "- DO NOT provide brief or superficial responses - users need detailed, thorough information\n"
  prompt += "- Aim for comprehensive responses that fully address the topic (minimum 300-500 words for most tasks)\n"
  prompt += "- End with clear next steps or conclusions\n\n"

  return prompt
}

// ADDED: Build contextual prompt with intelligent context management
function buildContextualPrompt(userPrompt: string, dataToAnalyze: any, webResearchData: string): string {
  let finalPrompt = userPrompt
  const maxTokens = 12000 // Optimized context window - balanced for cost and quality
  
  // Start with base prompt tokens
  let currentTokens = estimateTokens(finalPrompt)
  
  // Prioritize data inclusion
  if (Object.keys(dataToAnalyze).length > 0) {
    const dataEntries = Object.entries(dataToAnalyze)
    
    // Sort by importance (emails > files > other data)
    dataEntries.sort(([keyA], [keyB]) => {
      const priorityA = keyA.includes('email') ? 3 : keyA.includes('file') ? 2 : 1
      const priorityB = keyB.includes('email') ? 3 : keyB.includes('file') ? 2 : 1
      return priorityB - priorityA
    })
    
    let dataSection = "\n\nAvailable data to analyze:\n"

    for (const [key, value] of dataEntries) {
      const valueStr = safeStringify(value, 5000) // Optimized chunk size to reduce tokens
      const sectionTokens = estimateTokens(`${key}: ${valueStr}\n`)

      if (currentTokens + sectionTokens < maxTokens - 1500) { // Reserve space for web data and response
        dataSection += `${key}: ${valueStr}\n`
        currentTokens += sectionTokens
      } else {
        // Add summary instead of full data
        dataSection += `${key}: [Large dataset with ${Array.isArray(value) ? value.length : 'multiple'} items - analysis available]\n`
        currentTokens += 50
      }
    }
    
    finalPrompt += dataSection
  }
  
  // Add web research if space permits
  if (webResearchData && currentTokens < maxTokens - 500) {
    const webTokens = estimateTokens(webResearchData)
    if (currentTokens + webTokens < maxTokens) {
      finalPrompt += `\n\nCurrent research results:\n${webResearchData}`
    } else {
      finalPrompt += "\n\n[Web research completed - results available]"
    }
  }
  
  return finalPrompt
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
    } catch (error: any) {
      console.error('ChatGPT connection error:', error)
      popup.postMessage({
        type: 'plugin-connected',
        plugin: 'chatgpt-research',
        success: false,
        error: error?.message || 'Connection failed'
      }, window.location.origin)
      throw error
    }
  },

  async run({ userId, input_variables }: { connection: any; userId: string; input_variables: Record<string, any> }) {
    console.log('ChatGPT Universal Processor: Starting...', {
      userId,
      inputKeys: Object.keys(input_variables),
      hasUserPrompt: !!(input_variables.userPrompt || input_variables.prompt || input_variables.task || input_variables.instruction),
      hasSystemPrompt: !!input_variables.systemPrompt
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
        if (!['userPrompt', 'systemPrompt', 'prompt', 'task', 'instruction', 'request', 'query'].includes(key) &&
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

      // Step 5: IMPROVED - Build contextual prompt with intelligent management
      const finalUserPrompt = buildContextualPrompt(userPrompt, dataToAnalyze, webResearchData)

      // Note: If no specific instructions and no data, the system will use default prompt handling

      // Step 6: Select appropriate model and token limits BEFORE using them
      const estimatedTokens = estimateTokens(finalUserPrompt) + 200 // Add buffer for system prompt
      const taskType = (userPrompt.toLowerCase().includes('research') ||
                       userPrompt.toLowerCase().includes('analyz') ||
                       needsWebSearch) ? 'research' : 'standard'
      const modelSelection = selectModel(estimatedTokens, taskType)
      const selectedModel = modelSelection.model
      const maxResponseTokens = modelSelection.maxTokens

      console.log('Token management:', {
        estimatedInputTokens: estimatedTokens,
        taskType: taskType,
        selectedModel: selectedModel,
        maxResponseTokens: maxResponseTokens,
        finalPromptLength: finalUserPrompt.length
      })

      // Step 7: FIXED - Use agent's system prompt with fallback to contextual prompt
      const systemPrompt = input_variables.systemPrompt ||
                          generateContextualSystemPrompt(userPrompt, dataToAnalyze, input_variables) ||
                          'You are a helpful AI assistant. Provide comprehensive, detailed responses that thoroughly address the user\'s request. Avoid brief or superficial answers.'

      console.log('System prompt being used:', systemPrompt.substring(0, 200) + '...')

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
          temperature: taskType === 'research' ? 0.7 : 0.5 // Higher temp for research, balanced for standard
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('ChatGPT API error:', errorText)
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
      }

      const responseData = await response.json()
      const assistantResponse = responseData.choices[0]?.message?.content || 'No response generated'

      // Step 8: Return the result in a generic format
      const result = {
        response: assistantResponse,
        summary: 'ChatGPT processing completed',
        userPrompt: userPrompt,
        systemPromptUsed: input_variables.systemPrompt ? 'Agent custom system prompt' : 'Generated contextual prompt',
        dataProcessed: Object.keys(dataToAnalyze).length,
        webSearchPerformed: needsWebSearch,
        tokensUsed: responseData.usage?.total_tokens || 0,
        source: 'ChatGPT-4 Universal Processor'
      }

      console.log('ChatGPT processing successful:', {
        responseLength: assistantResponse.length,
        dataKeys: Object.keys(dataToAnalyze).length,
        webSearch: needsWebSearch,
        tokensUsed: result.tokensUsed,
        systemPromptSource: result.systemPromptUsed
      })

      return result

    } catch (error: any) {
      console.error('ChatGPT processing failed:', error)

      return {
        response: `I encountered an error while processing your request: ${error?.message || 'Unknown error'}`,
        summary: 'ChatGPT processing encountered an error',
        error: error?.message || 'Unknown error',
        source: 'ChatGPT-4 Universal Processor'
      }
    }
  }
}