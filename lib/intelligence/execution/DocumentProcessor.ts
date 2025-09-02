// /lib/intelligence/execution/DocumentProcessor.ts
import { SmartIntentAnalysis } from '../core/types'
import { TruncationUtils } from '../utils/TrancationUtils'
import { extractPdfTextFromBase64 } from '../../utils/extractPdfTextFromBase64'

export class DocumentProcessor {
  async processWithIntelligence(
    input_variables: Record<string, any>,
    pluginContext: Record<string, any>,
    intent: SmartIntentAnalysis
  ): Promise<void> {
    console.log('📄 Processing documents with advanced intelligence')
    
    // Enhanced PDF processing
    for (const key of Object.keys(input_variables)) {
      const value = input_variables[key]
      if (typeof value === 'string' && value.startsWith('data:application/pdf')) {
        try {
          console.log(`📄 Advanced PDF processing: ${key}`)
          const extractedText = await extractPdfTextFromBase64(value)
          
          // Intelligent text processing based on intent
          let processedText = extractedText
          
          if (intent.primaryIntent === 'financial_analysis') {
            processedText = this.extractFinancialDataFromText(extractedText)
          } else if (intent.primaryIntent === 'document_processing') {
            processedText = this.extractStructuredDataFromText(extractedText)
          }
          
          input_variables[`${key}Text`] = processedText
          console.log(`✅ PDF processed (${processedText.length} chars)`)
          
        } catch (err) {
          console.warn(`⚠️ PDF extraction failed for ${key}:`, err)
          input_variables[`${key}Text`] = 'PDF content extraction failed - manual review may be required'
        }
      }
    }

    // Advanced file processing
    if (input_variables.__uploaded_file_text && typeof input_variables.__uploaded_file_text === 'string') {
      pluginContext['uploaded-file'] = {
        summary: 'File content intelligently processed',
        data: await this.processFileContentIntelligently(input_variables.__uploaded_file_text, intent),
        confidence: 0.95,
        smartAnalysis: true,
        relevance: await this.assessContentRelevance(input_variables.__uploaded_file_text, intent)
      }
    }

    // Smart variable optimization
    Object.keys(input_variables).forEach((key) => {
      if (typeof input_variables[key] === 'string' && input_variables[key].length > 8000) {
        const context = intent.businessContext || intent.primaryIntent
        input_variables[key] = TruncationUtils.ultraSmartTruncation(input_variables[key], 6000, context)
      }
    })
  }

  private extractFinancialDataFromText(text: string): string {
    const financialPatterns = [
      /\$[\d,]+\.?\d*/g,
      /invoice|receipt|payment|amount|total|subtotal|tax|fee/gi,
      /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/g,
      /account\s*#?\s*\d+/gi
    ]
    
    let extractedData = ''
    const lines = text.split('\n')
    
    lines.forEach(line => {
      const hasFinancialData = financialPatterns.some(pattern => pattern.test(line))
      if (hasFinancialData) {
        extractedData += line + '\n'
      }
    })
    
    return extractedData || text.slice(0, 3000) + '...[financial data extraction attempted]'
  }

  private extractStructuredDataFromText(text: string): string {
    // Extract structured elements like headers, lists, tables
    const structuredLines = text.split('\n').filter(line => {
      const trimmed = line.trim()
      return trimmed.length > 0 && (
        trimmed.match(/^[\-\*\+]\s/) ||  // List items
        trimmed.match(/^\d+\./) ||        // Numbered lists
        trimmed.match(/^#{1,6}\s/) ||     // Headers
        trimmed.match(/\|.*\|/) ||        // Table rows
        trimmed.match(/^[A-Z][^:]*:/) ||  // Key-value pairs
        trimmed.length > 50               // Substantial content
      )
    })
    
    return structuredLines.join('\n') || text.slice(0, 3000)
  }

  private async processFileContentIntelligently(content: string, intent: SmartIntentAnalysis): Promise<any> {
    // Process file content based on intent
    if (intent.primaryIntent === 'financial_analysis') {
      return this.extractFinancialDataFromText(content)
    }
    
    if (intent.primaryIntent === 'research_and_analysis') {
      return this.extractKeyInsights(content)
    }
    
    return content.slice(0, 5000) // Default processing
  }

  private extractKeyInsights(text: string): string {
    const insightPatterns = [
      /key|important|significant|notable|critical/gi,
      /conclusion|summary|findings|results/gi,
      /recommend|suggest|propose|should|must/gi
    ]
    
    const sentences = text.split(/[.!?]+/)
    const keyInsights = sentences.filter(sentence => {
      return sentence.length > 30 && insightPatterns.some(pattern => pattern.test(sentence))
    })
    
    return keyInsights.join('. ') || text.slice(0, 2000)
  }

  private async assessContentRelevance(content: string, intent: SmartIntentAnalysis): Promise<number> {
    const lowerContent = content.toLowerCase()
    const intentTerms = [
      intent.primaryIntent.replace('_', ' '),
      ...intent.subIntents.map(s => s.replace('_', ' ')),
      intent.businessContext
    ]
    
    let relevance = 0.3
    intentTerms.forEach(term => {
      if (lowerContent.includes(term)) relevance += 0.15
    })
    
    return Math.min(relevance, 1.0)
  }

  // Additional helper methods for document analysis
  async analyzeDocumentStructure(content: string): Promise<any> {
    const lines = content.split('\n')
    const structure = {
      totalLines: lines.length,
      nonEmptyLines: lines.filter(line => line.trim().length > 0).length,
      hasHeaders: lines.some(line => /^#{1,6}\s/.test(line.trim())),
      hasTables: lines.some(line => /\|.*\|/.test(line)),
      hasLists: lines.some(line => /^[\-\*\+]\s/.test(line.trim())),
      hasNumbers: lines.some(line => /\d/.test(line)),
      averageLineLength: lines.reduce((sum, line) => sum + line.length, 0) / lines.length
    }
    
    return structure
  }

  async extractMetadata(content: string): Promise<any> {
    return {
      wordCount: content.split(/\s+/).length,
      characterCount: content.length,
      paragraphCount: content.split(/\n\s*\n/).length,
      hasFinancialData: /\$[\d,]+\.?\d*/.test(content),
      hasDates: /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(content),
      hasEmails: /@[\w.-]+\.\w+/.test(content),
      hasPhones: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(content)
    }
  }
}