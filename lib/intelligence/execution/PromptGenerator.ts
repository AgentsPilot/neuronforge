// /lib/intelligence/execution/PromptGenerator.ts
import { SmartIntentAnalysis, AdaptiveStrategy, ContextualMemory, SmartPromptData } from '../core/types'
import { TruncationUtils } from '../utils/TruncationUtils'

export class PromptGenerator {
  async generateUltraSmartPrompt(
    agent: any,
    userPrompt: string,
    pluginData: any,
    inputVariables: any,
    intent: SmartIntentAnalysis,
    strategy: AdaptiveStrategy,
    memory: ContextualMemory
  ): Promise<SmartPromptData> {
    
    console.log('🧠 Generating universal smart prompt for intent:', intent.primaryIntent)
    
    // Analyze available data
    const availableData = this.analyzeAvailableData(pluginData, inputVariables)
    const processedData = this.prepareDataContext(pluginData, intent, availableData, inputVariables)
    
    // Use simple, direct system prompt instead of LLM generation
    const directSystemPrompt = this.createDirectSystemPrompt(userPrompt, intent, availableData, inputVariables)
    
    return {
      systemPrompt: directSystemPrompt,
      userPrompt: `${userPrompt}\n\nData to process:\n${JSON.stringify(processedData, null, 2)}`,
      context: processedData,
      strategy: 'direct_processing',
      confidenceBoost: 0.2
    }
  }

  private createDirectSystemPrompt(userPrompt: string, intent: SmartIntentAnalysis, availableData: any, inputVariables?: any): string {
    if (!availableData.hasData) {
      return `No data was found to process for this request. Explain what was searched for and suggest next steps.`
    }

    const hasInputVariables = inputVariables && Object.keys(inputVariables).length > 0
    const inputVarInstructions = hasInputVariables 
      ? "\n- Use the provided input variables to perform automated processing and comparisons\n- If threshold values or parameters are provided, apply them automatically to the data"
      : ""

    return `You are processing data that was extracted from connected services. The data is provided in JSON format below.

TASK: ${userPrompt}

INSTRUCTIONS:
- Process the provided data directly
- Extract the specific information requested
- Present results clearly and structured
- Do not claim you cannot access data - it is provided to you
- Focus on the actual extracted content, especially any text from documents${inputVarInstructions}

Process the data to fulfill the user's request completely.`
  }

  private analyzeAvailableData(pluginData: any, inputVariables: any): any {
    const analysis = {
      hasData: false,
      dataStructures: [],
      dataQuality: 'unknown',
      totalItems: 0,
      availableFields: []
    }

    // Generic data analysis - no specific type assumptions
    if (pluginData && typeof pluginData === 'object') {
      for (const [pluginName, pluginResult] of Object.entries(pluginData)) {
        const result = pluginResult as any
        
        if (result.error) continue
        
        // Count any arrays of data
        Object.entries(result).forEach(([key, value]) => {
          if (Array.isArray(value) && value.length > 0) {
            analysis.hasData = true
            analysis.totalItems += value.length
            analysis.dataStructures.push(`${pluginName}.${key}`)
          } else if (value && typeof value === 'object') {
            analysis.hasData = true
            analysis.dataStructures.push(`${pluginName}.${key}`)
          }
        })
      }
    }

    // Analyze input variables
    if (inputVariables && typeof inputVariables === 'object') {
      analysis.availableFields = Object.keys(inputVariables)
      if (analysis.availableFields.length > 0) {
        analysis.hasData = true
      }
    }

    // Generic data quality assessment
    if (analysis.totalItems > 10) {
      analysis.dataQuality = 'good'
    } else if (analysis.totalItems > 0) {
      analysis.dataQuality = 'moderate'
    } else if (analysis.dataStructures.length > 0) {
      analysis.dataQuality = 'limited'
    } else {
      analysis.dataQuality = 'none'
    }

    return analysis
  }

  private prepareDataContext(pluginData: any, intent: SmartIntentAnalysis, availableData: any, inputVariables?: any): any {
    const context: any = {
      metadata: {
        dataStructures: availableData.dataStructures,
        totalItems: availableData.totalItems,
        quality: availableData.dataQuality
      },
      extractedContent: [], // Put all extracted text here prominently
      inputVariables: inputVariables || {} // Include input variables for LLM processing
    }

    // Process plugin data and make extracted text easily accessible
    if (pluginData && typeof pluginData === 'object') {
      for (const [pluginName, pluginResult] of Object.entries(pluginData)) {
        const result = pluginResult as any
        if (result.error) continue

        // Handle emails with special focus on attachment content
        if (result.emails && Array.isArray(result.emails)) {
          result.emails.forEach((email: any, emailIndex: number) => {
            if (email.attachments && Array.isArray(email.attachments)) {
              email.attachments.forEach((att: any, attIndex: number) => {
                if (att.extractedText && att.extractedText.length > 10) {
                  // Add extracted content to prominent location
                  context.extractedContent.push({
                    source: `Email ${emailIndex + 1}: ${email.subject}`,
                    filename: att.filename,
                    type: att.mimeType,
                    content: att.extractedText
                  })
                }
              })
            }
          })

          // Also keep structured email data
          context[`${pluginName}_emails`] = result.emails.map((email: any) => ({
            subject: email.subject,
            from: email.from,
            date: email.date,
            attachmentCount: email.attachments?.length || 0,
            hasExtractedText: email.attachments?.some((att: any) => att.extractedText?.length > 10) || false
          }))
        }

        // Handle research/web search data 
        if (result.searchData || result.webData || result.research) {
          const researchContent = result.searchData || result.webData || result.research;
          if (typeof researchContent === 'string' && researchContent.length > 50) {
            context.extractedContent.push({
              source: `${pluginName} research`,
              filename: 'web_search_results',
              type: 'text/plain',
              content: researchContent
            });
          }
        }

        // Handle ChatGPT research plugin specifically
        if (pluginName === 'chatgpt-research' && typeof result === 'object') {
          // Look for any string content that looks like research results
          Object.entries(result).forEach(([key, value]) => {
            if (typeof value === 'string' && value.length > 100 && 
                (key.includes('result') || key.includes('content') || key.includes('data') || key.includes('response'))) {
              context.extractedContent.push({
                source: `Research: ${key}`,
                filename: 'research_results.txt',
                type: 'text/plain', 
                content: value
              });
            }
          });
        }

        // Handle other data structures
        Object.entries(result).forEach(([key, value]) => {
          if (key !== 'emails' && value && (Array.isArray(value) || (typeof value === 'object' && Object.keys(value).length > 0))) {
            context[`${pluginName}_${key}`] = value
          }
        })
      }
    }

    // Debug logging to see what LLM receives
    console.log('🔍 DEBUG: Final context being sent to LLM:')
    console.log('Extracted Content Count:', context.extractedContent.length)
    context.extractedContent.forEach((item: any, index: number) => {
      console.log(`Content ${index + 1}:`, {
        source: item.source,
        filename: item.filename,
        contentLength: item.content.length,
        firstChars: item.content.substring(0, 100)
      })
    })

    // Don't truncate - the extracted text is the most important data
    return context
  }

  private generateFallbackPrompt(
    userPrompt: string,
    intent: SmartIntentAnalysis,
    strategy: AdaptiveStrategy,
    memory: ContextualMemory,
    pluginData: any
  ): SmartPromptData {
    
    const fallbackSystemPrompt = `You are an intelligent AI assistant. 

User Request: "${userPrompt}"
Task Type: ${intent.primaryIntent}
Expected Output: ${intent.expectedOutputFormat}
Business Context: ${intent.businessContext}

Instructions:
1. Process any available data according to the user's request
2. If data is available, extract relevant information and present it clearly
3. If no relevant data is found, explain what was searched and suggest alternatives
4. Match the output format to the user's expectations
5. Be direct and helpful, avoiding unnecessary disclaimers
6. Focus on providing actionable results

Available data will be provided in the user message.`

    const processedData = this.prepareDataContext(pluginData, intent, this.analyzeAvailableData(pluginData, {}), {})

    return {
      systemPrompt: fallbackSystemPrompt,
      userPrompt: `${userPrompt}\n\nAvailable Data: ${JSON.stringify(processedData, null, 2)}`,
      context: processedData,
      strategy: 'fallback_universal',
      confidenceBoost: 0
    }
  }
}