export interface Intent {
  queryType: QueryType
  dataRequirements: DataRequirement[]
  urgency: Urgency
  businessFunction: BusinessFunction[]
  requiredCapabilities: string[]
  confidence: number
  complexity: Complexity
}

export type QueryType = 
  | 'financial_data'
  | 'competitive_analysis' 
  | 'operational_metrics'
  | 'customer_intelligence'
  | 'strategic_planning'
  | 'compliance_check'
  | 'communication'
  | 'document_processing'
  | 'research_investigation'
  | 'general_inquiry'

export type DataRequirement = 
  | 'real_time'
  | 'historical'
  | 'comparative'
  | 'quantitative'
  | 'qualitative'
  | 'external'
  | 'internal'

export type Urgency = 'immediate' | 'recent' | 'historical' | 'timeless'

export type BusinessFunction = 
  | 'finance'
  | 'operations'
  | 'marketing'
  | 'sales'
  | 'strategy'
  | 'hr'
  | 'compliance'
  | 'research'

export type Complexity = 'simple' | 'moderate' | 'complex' | 'multi_step'

// lib/intelligence/IntentAnalyzer.ts
export class IntentAnalyzer {
  private patterns = {
    financial: {
      keywords: /stock|price|market|financial|earnings|revenue|profit|loss|investment|trading|valuation|dividend|analyst|quote|portfolio|fund|ipo|merger|acquisition/i,
      indicators: /current|today|latest|now|real.?time/i,
      entities: /msft|aapl|googl|amzn|tsla|\$[a-z]+|nasdaq|s&p|dow/i
    },
    
    competitive: {
      keywords: /competitor|competition|market share|industry|benchmark|compare|versus|alternative|rival|leader|ranking/i,
      indicators: /analysis|research|intelligence|landscape|positioning/i,
      entities: /company|business|startup|enterprise|corporation/i
    },
    
    operational: {
      keywords: /process|workflow|efficiency|optimization|performance|metrics|kpi|dashboard|analytics|productivity/i,
      indicators: /improve|optimize|measure|track|monitor|report/i,
      entities: /team|department|operation|system|process/i
    },
    
    customer: {
      keywords: /customer|client|user|feedback|satisfaction|support|retention|acquisition|churn|survey/i,
      indicators: /analyze|understand|improve|measure|track/i,
      entities: /segment|persona|journey|experience/i
    },
    
    communication: {
      keywords: /email|send|contact|message|meeting|call|follow.?up|outreach|campaign|notification/i,
      indicators: /send|draft|schedule|coordinate|inform|update/i,
      entities: /stakeholder|team|client|customer|partner/i
    },
    
    research: {
      keywords: /research|investigate|analyze|study|explore|discover|find out|learn about|gather|collect/i,
      indicators: /current|latest|recent|comprehensive|detailed|thorough/i,
      entities: /data|information|trend|insight|intelligence/i
    }
  }

  analyzeIntent(query: string, inputVariables: Record<string, any> = {}): Intent {
    const combinedText = query + ' ' + Object.values(inputVariables).join(' ')
    const normalizedText = combinedText.toLowerCase()

    // Detect query types
    const queryTypes = this.detectQueryTypes(normalizedText)
    const primaryQueryType = queryTypes[0] || 'general_inquiry'

    // Analyze data requirements
    const dataRequirements = this.analyzeDataRequirements(normalizedText)
    
    // Determine urgency
    const urgency = this.determineUrgency(normalizedText)
    
    // Identify business functions
    const businessFunctions = this.identifyBusinessFunctions(normalizedText, queryTypes)
    
    // Map to required capabilities
    const requiredCapabilities = this.mapToCapabilities(queryTypes, dataRequirements, urgency)
    
    // Calculate complexity
    const complexity = this.assessComplexity(combinedText, queryTypes, dataRequirements)
    
    // Calculate confidence
    const confidence = this.calculateConfidence(normalizedText, queryTypes)

    return {
      queryType: primaryQueryType,
      dataRequirements,
      urgency,
      businessFunction: businessFunctions,
      requiredCapabilities,
      confidence,
      complexity
    }
  }

  private detectQueryTypes(text: string): QueryType[] {
    const detected: QueryType[] = []
    
    Object.entries(this.patterns).forEach(([type, pattern]) => {
      const keywordMatch = pattern.keywords.test(text)
      const indicatorMatch = pattern.indicators.test(text) 
      const entityMatch = pattern.entities.test(text)
      
      // Score based on multiple matches
      const score = (keywordMatch ? 2 : 0) + (indicatorMatch ? 1 : 0) + (entityMatch ? 1 : 0)
      
      if (score >= 2) {
        detected.push(type as QueryType)
      }
    })

    return detected.length > 0 ? detected : ['general_inquiry']
  }

  private analyzeDataRequirements(text: string): DataRequirement[] {
    const requirements: DataRequirement[] = []

    // Real-time indicators
    if (/current|today|now|latest|real.?time|live|immediate|breaking/i.test(text)) {
      requirements.push('real_time')
    }

    // Historical indicators  
    if (/historical|past|previous|last year|archive|trend|history/i.test(text)) {
      requirements.push('historical')
    }

    // Comparative indicators
    if (/compare|versus|vs|against|benchmark|relative|competition/i.test(text)) {
      requirements.push('comparative')
    }

    // Quantitative indicators
    if (/number|metric|data|analytics|statistics|percentage|amount|value|price/i.test(text)) {
      requirements.push('quantitative')
    }

    // Qualitative indicators
    if (/opinion|sentiment|review|feedback|quality|experience|satisfaction/i.test(text)) {
      requirements.push('qualitative')
    }

    // External data indicators
    if (/market|industry|competitor|public|external|third.?party/i.test(text)) {
      requirements.push('external')
    }

    // Internal data indicators
    if (/our|internal|company|team|department|organization/i.test(text)) {
      requirements.push('internal')
    }

    return requirements.length > 0 ? requirements : ['external']
  }

  private determineUrgency(text: string): Urgency {
    if (/now|immediate|urgent|breaking|live|real.?time|current/i.test(text)) {
      return 'immediate'
    }
    if (/recent|latest|today|this week|this month/i.test(text)) {
      return 'recent'
    }
    if (/historical|past|archive|last year|previous/i.test(text)) {
      return 'historical'
    }
    return 'timeless'
  }

  private identifyBusinessFunctions(text: string, queryTypes: QueryType[]): BusinessFunction[] {
    const functions: BusinessFunction[] = []

    if (queryTypes.includes('financial_data') || /financial|finance|accounting|budget/i.test(text)) {
      functions.push('finance')
    }
    if (queryTypes.includes('operational_metrics') || /operations|process|efficiency/i.test(text)) {
      functions.push('operations')
    }
    if (/marketing|campaign|brand|promotion|advertising/i.test(text)) {
      functions.push('marketing')
    }
    if (/sales|revenue|customer|client|deal|pipeline/i.test(text)) {
      functions.push('sales')
    }
    if (queryTypes.includes('strategic_planning') || /strategy|planning|vision|roadmap/i.test(text)) {
      functions.push('strategy')
    }
    if (/employee|hr|human resources|hiring|talent/i.test(text)) {
      functions.push('hr')
    }
    if (queryTypes.includes('compliance_check') || /compliance|legal|regulation|audit/i.test(text)) {
      functions.push('compliance')
    }
    if (queryTypes.includes('research_investigation') || /research|analysis|investigation/i.test(text)) {
      functions.push('research')
    }

    return functions
  }

  private mapToCapabilities(
    queryTypes: QueryType[], 
    dataRequirements: DataRequirement[], 
    urgency: Urgency
  ): string[] {
    const capabilities: string[] = []

    // Map query types to capabilities
    if (queryTypes.includes('financial_data')) {
      capabilities.push('real_time_market_data', 'financial_research', 'company_analysis')
    }
    if (queryTypes.includes('competitive_analysis')) {
      capabilities.push('market_research', 'competitor_intelligence', 'industry_analysis')
    }
    if (queryTypes.includes('communication')) {
      capabilities.push('email_access', 'message_sending', 'communication_analysis')
    }
    if (queryTypes.includes('document_processing')) {
      capabilities.push('document_search', 'file_reading', 'content_analysis')
    }

    // Map data requirements to capabilities
    if (dataRequirements.includes('real_time')) {
      capabilities.push('web_research', 'api_access', 'live_data')
    }
    if (dataRequirements.includes('internal')) {
      capabilities.push('document_access', 'email_access', 'workspace_integration')
    }
    if (dataRequirements.includes('comparative')) {
      capabilities.push('multi_source_research', 'benchmarking', 'analysis')
    }

    // Map urgency to capabilities
    if (urgency === 'immediate') {
      capabilities.push('real_time_data', 'breaking_news', 'live_feeds')
    }

    return [...new Set(capabilities)] // Remove duplicates
  }

  private assessComplexity(text: string, queryTypes: QueryType[], dataRequirements: DataRequirement[]): Complexity {
    let complexityScore = 0

    // Base complexity from query types
    complexityScore += queryTypes.length
    
    // Complexity from data requirements
    complexityScore += dataRequirements.length

    // Complexity indicators in text
    if (/analyze|compare|evaluate|assess|comprehensive|detailed|thorough/i.test(text)) {
      complexityScore += 2
    }
    if (/multiple|several|various|different|cross|between/i.test(text)) {
      complexityScore += 1
    }
    if (/strategy|plan|recommendation|solution|approach/i.test(text)) {
      complexityScore += 1
    }

    if (complexityScore >= 6) return 'multi_step'
    if (complexityScore >= 4) return 'complex'
    if (complexityScore >= 2) return 'moderate'
    return 'simple'
  }

  private calculateConfidence(text: string, queryTypes: QueryType[]): number {
    let confidence = 0.5 // Base confidence

    // Higher confidence for clear patterns
    if (queryTypes.length === 1) confidence += 0.2
    if (queryTypes.length > 1) confidence += 0.1

    // Confidence based on specificity
    if (/specific|exact|precise|particular/i.test(text)) confidence += 0.2
    if (/\b(stock|company|business)\s+\w+/i.test(text)) confidence += 0.1 // Named entities

    // Lower confidence for ambiguous queries
    if (/maybe|perhaps|possibly|might|could/i.test(text)) confidence -= 0.2
    if (text.length < 20) confidence -= 0.1

    return Math.max(0.1, Math.min(1.0, confidence))
  }
}