export const CAPABILITY_REGISTRY = {
  // Plugin capabilities mapped to business needs
  'chatgpt-research': {
    capabilities: [
      'real_time_market_data',
      'financial_research', 
      'company_analysis',
      'market_research',
      'competitor_intelligence',
      'industry_analysis',
      'web_research',
      'breaking_news',
      'live_data',
      'multi_source_research'
    ],
    dataTypes: ['real_time', 'external', 'quantitative', 'qualitative'],
    businessFunctions: ['finance', 'strategy', 'research', 'marketing'],
    quality: 'high',
    speed: 'fast',
    cost: 'low'
  },

  'google-mail': {
    capabilities: [
      'email_access',
      'message_sending', 
      'communication_analysis',
      'correspondence_history',
      'stakeholder_communication'
    ],
    dataTypes: ['internal', 'historical', 'qualitative'],
    businessFunctions: ['sales', 'operations', 'hr', 'strategy'],
    quality: 'high',
    speed: 'fast', 
    cost: 'none'
  },

  'google-drive': {
    capabilities: [
      'document_search',
      'file_reading',
      'content_analysis',
      'document_access',
      'report_generation',
      'data_storage'
    ],
    dataTypes: ['internal', 'historical', 'quantitative', 'qualitative'],
    businessFunctions: ['operations', 'finance', 'strategy', 'compliance'],
    quality: 'high',
    speed: 'medium',
    cost: 'none'
  },

  'notion': {
    capabilities: [
      'workspace_integration',
      'project_data',
      'team_coordination',
      'knowledge_management',
      'task_tracking'
    ],
    dataTypes: ['internal', 'historical', 'qualitative'],
    businessFunctions: ['operations', 'strategy', 'hr'],
    quality: 'medium',
    speed: 'medium',
    cost: 'none'
  }
}

export class CapabilityMatcher {
  findOptimalPlugins(requiredCapabilities: string[], availablePlugins: string[]): PluginMatch[] {
    const matches: PluginMatch[] = []

    availablePlugins.forEach(plugin => {
      const pluginCapabilities = CAPABILITY_REGISTRY[plugin]
      if (!pluginCapabilities) return

      const matchingCapabilities = requiredCapabilities.filter(capability =>
        pluginCapabilities.capabilities.includes(capability)
      )

      if (matchingCapabilities.length > 0) {
        matches.push({
          plugin,
          matchingCapabilities,
          score: this.calculateMatchScore(matchingCapabilities, pluginCapabilities),
          priority: this.calculatePriority(plugin, matchingCapabilities)
        })
      }
    })

    return matches.sort((a, b) => b.score - a.score)
  }

  private calculateMatchScore(
    matchingCapabilities: string[], 
    pluginCapabilities: any
  ): number {
    let score = matchingCapabilities.length * 10 // Base score for capability count

    // Bonus for high-quality plugins
    if (pluginCapabilities.quality === 'high') score += 5
    if (pluginCapabilities.speed === 'fast') score += 3
    if (pluginCapabilities.cost === 'none') score += 2

    return score
  }

  private calculatePriority(plugin: string, capabilities: string[]): number {
    // Critical capabilities get higher priority
    const criticalCapabilities = [
      'real_time_market_data',
      'financial_research',
      'web_research',
      'breaking_news'
    ]

    const hasCritical = capabilities.some(cap => criticalCapabilities.includes(cap))
    
    // Plugin-specific priorities
    const pluginPriority = {
      'chatgpt-research': 10, // Highest for real-time data
      'google-drive': 8,      // High for internal data
      'google-mail': 7,       // High for communication
      'notion': 6             // Medium for workspace data
    }

    return (pluginPriority[plugin] || 5) + (hasCritical ? 5 : 0)
  }
}

interface PluginMatch {
  plugin: string
  matchingCapabilities: string[]
  score: number
  priority: number
}