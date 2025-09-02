// /lib/intelligence/utils/TruncationUtils.ts

export class TruncationUtils {
  static ultraSmartTruncation(data: any, maxTokens: number = 2000, context: string = ''): any {
    if (!data) return data
    
    const dataStr = JSON.stringify(data)
    const estimatedTokens = Math.ceil(dataStr.length / 4)
    
    if (estimatedTokens <= maxTokens) return data

    // Context-aware truncation strategies
    if (context.includes('financial')) {
      return this.truncateFinancialData(data, maxTokens)
    } else if (context.includes('research')) {
      return this.truncateResearchData(data, maxTokens)
    } else if (context.includes('email')) {
      return this.truncateEmailData(data, maxTokens)
    }
    
    return this.genericIntelligentTruncation(data, maxTokens)
  }

  private static truncateFinancialData(data: any, maxTokens: number): any {
    if (Array.isArray(data)) {
      // For financial data, keep most recent and highest amounts
      return data
        .sort((a, b) => {
          const dateA = new Date(a.date || a.created || 0).getTime()
          const dateB = new Date(b.date || b.created || 0).getTime()
          const amountA = Math.abs(parseFloat(a.amount || a.total || 0))
          const amountB = Math.abs(parseFloat(b.amount || b.total || 0))
          
          // Prioritize recent and high-value items
          return (dateB - dateA) + (amountB - amountA) * 0.1
        })
        .slice(0, Math.max(5, Math.floor(maxTokens / 200)))
        .map(item => ({
          ...item,
          description: (item.description || '').slice(0, 100)
        }))
    }
    
    return this.genericIntelligentTruncation(data, maxTokens)
  }

  private static truncateResearchData(data: any, maxTokens: number): any {
    if (Array.isArray(data)) {
      // For research data, keep most relevant and recent
      return data
        .filter(item => item.relevance > 0.5 || item.confidence > 0.7)
        .slice(0, Math.floor(maxTokens / 300))
        .map(item => ({
          title: item.title,
          summary: (item.summary || item.content || '').slice(0, 150),
          relevance: item.relevance,
          source: item.source
        }))
    }
    
    return this.genericIntelligentTruncation(data, maxTokens)
  }

  private static truncateEmailData(data: any, maxTokens: number): any {
    if (Array.isArray(data)) {
      // For email data, prioritize business emails and recent dates
      return data
        .filter(email => !this.isMarketingEmail(email))
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
        .slice(0, Math.floor(maxTokens / 250))
        .map(email => ({
          from: email.from,
          subject: email.subject,
          date: email.date,
          snippet: (email.body || email.snippet || '').slice(0, 200),
          relevance: email.relevance || this.assessEmailRelevance(email)
        }))
    }
    
    return this.genericIntelligentTruncation(data, maxTokens)
  }

  private static isMarketingEmail(email: any): boolean {
    const marketingIndicators = [
      'unsubscribe', 'marketing', 'promotional', 'newsletter', 'deal', 'sale',
      'discount', 'offer', 'limited time', 'act now', 'click here'
    ]
    
    const subject = (email.subject || '').toLowerCase()
    const from = (email.from || '').toLowerCase()
    const body = (email.body || email.snippet || '').toLowerCase()
    
    return marketingIndicators.some(indicator => 
      subject.includes(indicator) || from.includes(indicator) || body.includes(indicator)
    )
  }

  private static assessEmailRelevance(email: any): number {
    const businessIndicators = ['invoice', 'receipt', 'payment', 'contract', 'proposal', 'meeting', 'project']
    const content = `${email.subject || ''} ${email.body || email.snippet || ''}`.toLowerCase()
    
    let relevance = 0.5
    businessIndicators.forEach(indicator => {
      if (content.includes(indicator)) relevance += 0.1
    })
    
    return Math.min(relevance, 1.0)
  }

  private static genericIntelligentTruncation(data: any, maxTokens: number): any {
    if (Array.isArray(data)) {
      const itemsToKeep = Math.max(1, Math.floor(maxTokens / 200))
      return data.slice(0, itemsToKeep).map(item => 
        typeof item === 'object' ? this.genericIntelligentTruncation(item, 150) : item
      )
    }

    if (typeof data === 'object' && data !== null) {
      const truncated = {}
      const entries = Object.entries(data)
      const tokensPerEntry = Math.max(50, maxTokens / entries.length)
      
      // Prioritize important fields
      const priorityFields = ['id', 'name', 'title', 'subject', 'amount', 'date', 'status', 'type']
      const priorityEntries = entries.filter(([key]) => priorityFields.includes(key.toLowerCase()))
      const otherEntries = entries.filter(([key]) => !priorityFields.includes(key.toLowerCase()))
      
      const allEntries = priorityEntries.concat(otherEntries)
      allEntries.forEach(([key, value]) => {
        if (typeof value === 'string' && value.length > tokensPerEntry * 4) {
          truncated[key] = value.slice(0, Math.floor(tokensPerEntry * 4)) + '...'
        } else if (typeof value === 'object') {
          truncated[key] = this.genericIntelligentTruncation(value, tokensPerEntry)
        } else {
          truncated[key] = value
        }
      })
      
      return truncated
    }

    if (typeof data === 'string' && data.length > maxTokens * 4) {
      return data.slice(0, maxTokens * 4) + '...[intelligently truncated]'
    }

    return data
  }
}