export class IntelligenceEngine {
  private intentAnalyzer: IntentAnalyzer
  private capabilityMatcher: CapabilityMatcher

  constructor() {
    this.intentAnalyzer = new IntentAnalyzer()
    this.capabilityMatcher = new CapabilityMatcher()
  }

  async processQuery(
    query: string, 
    inputVariables: Record<string, any>,
    availablePlugins: string[]
  ): Promise<IntelligenceResult> {
    // Step 1: Analyze intent
    const intent = this.intentAnalyzer.analyzeIntent(query, inputVariables)
    
    // Step 2: Find optimal plugins
    const pluginMatches = this.capabilityMatcher.findOptimalPlugins(
      intent.requiredCapabilities,
      availablePlugins
    )

    // Step 3: Generate execution strategy
    const executionStrategy = this.generateExecutionStrategy(intent, pluginMatches)

    // Step 4: Create dynamic system prompt
    const systemPrompt = this.generateDynamicSystemPrompt(intent, pluginMatches, executionStrategy)

    return {
      intent,
      pluginMatches,
      executionStrategy,
      systemPrompt
    }
  }

  private generateExecutionStrategy(intent: Intent, pluginMatches: PluginMatch[]): ExecutionStrategy {
    const strategy: ExecutionStrategy = {
      steps: [],
      toolChain: pluginMatches.map(match => match.plugin),
      parallelExecution: intent.complexity === 'simple',
      fallbackPlan: this.createFallbackPlan(intent)
    }

    // Build execution steps based on intent
    if (intent.queryType === 'financial_data') {
      strategy.steps = [
        { action: 'research_current_data', plugins: ['chatgpt-research'], priority: 1 },
        { action: 'cross_reference_internal', plugins: ['google-drive'], priority: 2 },
        { action: 'synthesize_intelligence', plugins: [], priority: 3 }
      ]
    } else if (intent.queryType === 'competitive_analysis') {
      strategy.steps = [
        { action: 'research_competitors', plugins: ['chatgpt-research'], priority: 1 },
        { action: 'access_internal_analysis', plugins: ['google-drive', 'notion'], priority: 2 },
        { action: 'comparative_analysis', plugins: [], priority: 3 }
      ]
    } else {
      // Default strategy
      strategy.steps = [
        { action: 'gather_data', plugins: pluginMatches.slice(0, 3).map(m => m.plugin), priority: 1 },
        { action: 'analyze_and_respond', plugins: [], priority: 2 }
      ]
    }

    return strategy
  }

  private generateDynamicSystemPrompt(
    intent: Intent, 
    pluginMatches: PluginMatch[],
    strategy: ExecutionStrategy
  ): string {
    const urgencyMap = {
      immediate: 'CRITICAL - Real-time data required',
      recent: 'HIGH - Current information needed',
      historical: 'MEDIUM - Historical analysis required',
      timeless: 'LOW - General information acceptable'
    }

    let prompt = `BUSINESS INTELLIGENCE AGENT - ${urgencyMap[intent.urgency]}

MISSION: ${this.getMissionStatement(intent)}

EXECUTION REQUIREMENTS:
- Query Type: ${intent.queryType.toUpperCase()}
- Business Function: ${intent.businessFunction.join(', ').toUpperCase()}
- Data Requirements: ${intent.dataRequirements.join(', ').toUpperCase()}
- Complexity Level: ${intent.complexity.toUpperCase()}
- Confidence Target: ${Math.round(intent.confidence * 100)}%

AVAILABLE INTELLIGENCE TOOLS:`

    pluginMatches.forEach(match => {
      const capabilities = CAPABILITY_REGISTRY[match.plugin]
      prompt += `\n\n${match.plugin.toUpperCase()}:
- Capabilities: ${match.matchingCapabilities.join(', ')}
- Data Quality: ${capabilities.quality}
- Response Speed: ${capabilities.speed}
- INSTRUCTION: ${this.getPluginInstructions(match.plugin, intent)}`
    })

    prompt += `\n\nEXECUTION PROTOCOL:
1. ${strategy.steps.map(step => step.action).join(' → ')}
2. Cross-validate information from multiple sources when possible
3. Provide specific metrics, numbers, and quantifiable insights
4. Include business implications and strategic recommendations
5. Cite data sources and indicate information freshness

RESPONSE STANDARDS:
- Lead with key findings and executive summary
- Include specific data points and metrics
- Explain business context and implications  
- Provide actionable recommendations
- Indicate confidence levels and data quality
- Suggest follow-up actions if appropriate

CRITICAL: Use all available tools actively. Do not provide generic advice when real data can be obtained.`

    return prompt
  }

  private getMissionStatement(intent: Intent): string {
    const missions = {
      financial_data: 'Provide comprehensive financial analysis with current market data and investment insights',
      competitive_analysis: 'Deliver competitive intelligence with market positioning and strategic recommendations', 
      operational_metrics: 'Analyze operational performance and provide optimization recommendations',
      customer_intelligence: 'Gather customer insights and provide actionable intelligence for business decisions',
      strategic_planning: 'Provide strategic analysis and planning recommendations based on comprehensive research',
      compliance_check: 'Ensure compliance requirements are met and provide regulatory guidance',
      communication: 'Facilitate effective business communication and stakeholder coordination',
      document_processing: 'Process and analyze documents to extract actionable business intelligence',
      research_investigation: 'Conduct thorough research and provide comprehensive analysis with actionable insights'
    }

    return missions[intent.queryType] || 'Provide comprehensive business intelligence and actionable recommendations'
  }

  private getPluginInstructions(plugin: string, intent: Intent): string {
    const instructions = {
      'chatgpt-research': intent.urgency === 'immediate' 
        ? 'MANDATORY - Fetch current data immediately'
        : 'Research thoroughly for comprehensive analysis',
      'google-drive': 'Search for relevant internal documents and company data',
      'google-mail': 'Check communications for business context and coordinate follow-ups',
      'notion': 'Access project data and team coordination information'
    }

    return instructions[plugin] || 'Use as appropriate for the business context'
  }

  private createFallbackPlan(intent: Intent): string[] {
    // Fallback strategies when primary tools fail
    if (intent.queryType === 'financial_data') {
      return ['Use general financial knowledge', 'Recommend connecting financial data sources']
    }
    return ['Provide best available information', 'Suggest appropriate tool connections']
  }
}

interface ExecutionStrategy {
  steps: { action: string; plugins: string[]; priority: number }[]
  toolChain: string[]
  parallelExecution: boolean
  fallbackPlan: string[]
}

interface IntelligenceResult {
  intent: Intent
  pluginMatches: PluginMatch[]
  executionStrategy: ExecutionStrategy
  systemPrompt: string
}