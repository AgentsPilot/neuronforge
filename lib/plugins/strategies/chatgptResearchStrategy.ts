// lib/plugins/strategies/chatgptResearchStrategy.ts
import { PluginStrategy } from '../pluginRegistry'

// Universal topic extraction function that works for any prompt
function extractTopicFromPrompt(userPrompt: string): string | null {
  if (!userPrompt) return null
  
  // First, preserve important capitalized words (likely proper nouns, company names, symbols)
  const capitalizedWords = userPrompt.match(/\b[A-Z]{2,}\b/g) || []
  if (capitalizedWords.length > 0) {
    // If we find capitalized words, they're likely the main subject
    return capitalizedWords[0].toLowerCase()
  }
  
  // Remove only the most generic stop words and action words
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being']
  const actionWords = ['check', 'monitor', 'track', 'analyze', 'research', 'study', 'investigate', 'explore', 'report', 'find', 'get', 'provide', 'give', 'show', 'tell']
  const modifiers = ['continuously', 'more', 'than', 'above', 'below', 'higher', 'lower', 'if', 'when', 'where']
  
  // Split into words and filter more selectively
  const words = userPrompt
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => 
      word.length > 1 && 
      !stopWords.includes(word) && 
      !actionWords.includes(word) &&
      !modifiers.includes(word)
    )
  
  if (words.length > 0) {
    // Return the most meaningful words (preserve context words like "stock", "price", etc.)
    return words.slice(0, Math.min(2, words.length)).join(' ')
  }
  
  return null
}

// Smart query generator that analyzes the topic and creates relevant search terms
function generateSmartQueries(topic: string, maxQueries: number = 3): string[] {
  const queries = []
  const cleanTopic = topic.trim()
  
  // Always start with the exact topic
  queries.push(cleanTopic)
  
  // Add contextual searches based on intelligent analysis
  const currentYear = new Date().getFullYear()
  
  // Add temporal context for recent information
  queries.push(`${cleanTopic} ${currentYear}`)
  queries.push(`${cleanTopic} latest news`)
  
  return queries.slice(0, maxQueries)
}

// Generic web search function using Google Custom Search API
async function searchWithGoogle(query: string): Promise<string> {
  try {
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY
    
    console.log('Search credentials check:', {
      hasCx: !!cx,
      hasApiKey: !!apiKey,
      cxPreview: cx ? cx.substring(0, 10) + '...' : 'none',
      apiKeyPreview: apiKey ? apiKey.substring(0, 10) + '...' : 'none'
    })
    
    if (!cx || !apiKey) {
      console.log('Google Search API credentials not configured')
      return 'Web search temporarily unavailable. Providing analysis based on available knowledge.'
    }
    
    // Clean and encode the query
    const cleanQuery = query.trim()
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(cleanQuery)}&num=5`
    console.log('Making search request for:', cleanQuery)
    
    const response = await fetch(searchUrl)
    console.log('Search response status:', response.status)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('Google Search API error:', response.status, errorText)
      return 'Web search temporarily unavailable. Providing analysis based on available knowledge.'
    }
    
    const data = await response.json()
    console.log('Search results:', {
      totalResults: data.searchInformation?.totalResults || 0,
      itemsReturned: data.items?.length || 0
    })
    
    if (data.items && data.items.length > 0) {
      const results = data.items.map((item: any, index: number) => {
        console.log(`Result ${index + 1}:`, { title: item.title, snippet: item.snippet?.substring(0, 100) })
        return `**${item.title}**\n${item.snippet}\nSource: ${item.link}`
      })
      
      const combinedResults = results.join('\n\n---\n\n')
      console.log('Search successful, returning', combinedResults.length, 'characters of data')
      return combinedResults
    }
    
    console.log('No search results found')
    return 'No current search results found for this query.'
    
  } catch (error) {
    console.error('Google search failed:', error)
    return 'Web search temporarily unavailable. Providing analysis based on available knowledge.'
  }
}

// Universal research function that adapts to any topic
async function performWebResearch(topic: string, customSearchTerms: string[] = []): Promise<string> {
  const searchResults = []
  
  // Use custom search terms if provided, otherwise generate smart queries
  const queries = customSearchTerms.length > 0 
    ? customSearchTerms 
    : generateSmartQueries(topic, 2) // Limit to 2 for API quota management
  
  // Perform searches
  for (const searchQuery of queries) {
    console.log('Searching:', searchQuery)
    const result = await searchWithGoogle(searchQuery)
    if (result && !result.includes('temporarily unavailable') && !result.includes('No current search results')) {
      searchResults.push(`Search results for "${searchQuery}":\n\n${result}`)
    }
  }
  
  return searchResults.length > 0 ? searchResults.join('\n\n=== NEXT SEARCH ===\n\n') : 'No current web data available.'
}

export const chatgptResearchStrategy: PluginStrategy = {
  pluginKey: 'chatgpt-research',
  name: 'ChatGPT Research',
  
  async connect({ supabase, popup, userId }: { supabase: any; popup: Window; userId: string }) {
    try {
      console.log('Connecting ChatGPT plugin for user:', userId)
      
      const connectionData = {
        user_id: userId,
        plugin_key: 'chatgpt-research',
        plugin_name: 'ChatGPT Research',
        access_token: 'platform-key',
        refresh_token: null,
        expires_at: null,
        scope: 'research',
        username: 'ChatGPT',
        email: null,
        profile_data: { service: 'OpenAI ChatGPT with Web Search' },
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
    // Universal topic extraction - checks all possible input patterns
    const topic = input_variables.reportTopic || 
                  input_variables.topic || 
                  input_variables.stockSymbol ||
                  input_variables.query || 
                  input_variables.search || 
                  input_variables.subject ||
                  input_variables.research_topic ||
                  input_variables.analysis_topic ||
                  extractTopicFromPrompt(input_variables.userPrompt) ||
                  'general research'
    
    const date = input_variables.date || input_variables.currentDate || 'latest'
    const additionalContext = input_variables.context || input_variables.details || (date !== 'latest' ? `for ${date}` : '')
    const searchTerms = input_variables.search_terms ? input_variables.search_terms.split(',').map(s => s.trim()) : []
    
    console.log('ChatGPT Research with Web Search: Starting research...', {
      userId,
      topic,
      hasAdditionalContext: !!additionalContext,
      searchTermsCount: searchTerms.length
    })

    try {
      // Step 1: Test with a simple query first
      console.log('Testing search with simple query...')
      const testResult = await searchWithGoogle('news')
      console.log('Test search result length:', testResult.length)
      
      // Step 2: Perform intelligent web research
      console.log('Searching web for current information...')
      const mainQuery = additionalContext ? `${topic} ${additionalContext}` : topic
      const searchData = await performWebResearch(mainQuery, searchTerms)
      
      // Step 3: Determine if we have current data
      const hasSearchData = searchData && 
        !searchData.includes('temporarily unavailable') && 
        !searchData.includes('No current web data available')
      
      console.log('Search data status:', {
        hasData: hasSearchData,
        dataLength: searchData.length,
        preview: searchData.substring(0, 500)
      })
      
      // Step 4: Construct adaptive research query
      let researchQuery: string
      let systemPrompt: string
      
      if (hasSearchData) {
        researchQuery = `You are provided with CURRENT web search results about "${topic}". You must analyze this real, current data:

${searchData}

Based on the search results above, provide a comprehensive analysis of ${topic}${additionalContext ? ` ${additionalContext}` : ''}. The search results contain current information that you must use.

Your analysis should intelligently adapt to the topic and include relevant aspects such as:
- Current status, conditions, or state based on the search results
- Key data points, metrics, or figures from the sources
- Recent developments, news, or changes mentioned in the search results
- Trends, patterns, or movements identified in the web sources
- Important insights or implications drawn from the current data
- Context and background information that helps explain the current situation
- Future outlook or predictions if mentioned in the sources

Tailor your response to the specific nature of the topic. Use the search results as your primary source of information. Do not mention knowledge cutoffs or inability to access current data - you have current data in the search results above.`

        systemPrompt = `You are analyzing current web search results provided to you about "${topic}". Treat the search results as current, real data. Analyze and present insights based on these results. Adapt your analysis style to match the topic - whether it's financial, technological, scientific, cultural, or any other domain. Do not mention knowledge limitations or suggest external sources - you have been provided with current web data to analyze.`
      } else {
        researchQuery = `Provide comprehensive research and analysis about "${topic}"${additionalContext ? ` with focus on: ${additionalContext}` : ''}. 

Structure your response to include relevant aspects for this topic, such as:
- Current state and key information
- Recent developments and trends
- Important facts, data points, or metrics
- Analysis and insights
- Context and background
- Practical implications or recommendations
- Key takeaways

Adapt your analysis to the specific nature and domain of "${topic}". Note: Current web data is not available, so provide analysis based on your knowledge base.`

        systemPrompt = `You are a professional research analyst providing comprehensive analysis about "${topic}". Adapt your expertise and analysis style to match the topic domain. Focus on delivering factual information, insights, and practical recommendations. Note that you are working from your training data rather than current web sources.`
      }

      console.log('About to send to ChatGPT:', {
        hasSearchData,
        queryLength: researchQuery.length,
        systemPromptLength: systemPrompt.length
      })

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user', 
              content: researchQuery
            }
          ],
          max_tokens: 2500,
          temperature: 0.2
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('ChatGPT API error:', errorText)
        throw new Error(`OpenAI API error: ${response.status}`)
      }

      const data = await response.json()
      const researchContent = data.choices[0]?.message?.content || 'No research content returned'

      const result = {
        summary: `Research completed for: ${topic}`,
        research: researchContent,
        topic,
        source: hasSearchData ? 'ChatGPT-4 with Current Web Data' : 'ChatGPT-4 (Knowledge Base)',
        hasCurrentData: hasSearchData,
        wordCount: researchContent.split(' ').length,
        tokensUsed: data.usage?.total_tokens || 0,
        searchStatus: hasSearchData ? 'Current web data included' : 'Based on AI knowledge only'
      }

      console.log('ChatGPT research successful:', {
        topic,
        hasCurrentData: hasSearchData,
        wordCount: result.wordCount,
        tokensUsed: result.tokensUsed
      })

      return result

    } catch (error) {
      console.error('ChatGPT research failed:', error)
      
      return {
        summary: 'ChatGPT research encountered an error',
        error: error.message,
        topic,
        source: 'ChatGPT-4 with Web Search'
      }
    }
  }
}