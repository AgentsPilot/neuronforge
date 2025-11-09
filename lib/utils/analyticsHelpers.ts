 // lib/utils/analyticsHelpers.ts

import type { AIUsageData, ProcessedAnalyticsData, ActivityData, AgentData, TimeFilter } from '@/types/analytics';
import { supabase } from '@/lib/supabaseClient';

interface AgentInfo {
  agentId: string;
  agentName: string;
}

/**
 * Cache for Pilot Credit configuration
 * Refreshes every 5 minutes to avoid excessive database queries
 */
let cachedPilotConfig: {
  pilotCreditCostUsd: number;
  tokensPerCredit: number;
  cachedAt: number;
} | null = null;

const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch Pilot Credit configuration from database
 * Uses 5-minute cache to minimize database queries
 *
 * @returns Configuration with pilot credit cost and token conversion rate
 */
async function getPilotCreditConfig(): Promise<{
  pilotCreditCostUsd: number;
  tokensPerCredit: number;
}> {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedPilotConfig && (now - cachedPilotConfig.cachedAt) < CONFIG_CACHE_TTL) {
    return {
      pilotCreditCostUsd: cachedPilotConfig.pilotCreditCostUsd,
      tokensPerCredit: cachedPilotConfig.tokensPerCredit
    };
  }

  // Fetch fresh config from database
  const { data, error } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit']);

  if (error) {
    console.error('[analyticsHelpers] Error fetching Pilot Credit config:', error);
    // Fall back to default values if fetch fails
    return {
      pilotCreditCostUsd: 0.00048,
      tokensPerCredit: 10
    };
  }

  // Build config map
  const configMap = new Map(data?.map(c => [c.config_key, c.config_value]) || []);

  const config = {
    pilotCreditCostUsd: parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048'),
    tokensPerCredit: parseInt(configMap.get('tokens_per_pilot_credit') || '10'),
    cachedAt: now
  };

  // Update cache
  cachedPilotConfig = config;

  return {
    pilotCreditCostUsd: config.pilotCreditCostUsd,
    tokensPerCredit: config.tokensPerCredit
  };
}

/**
 * Calculate Pilot Credit cost from LLM tokens
 * Formula: Pilot Credits = Math.ceil(tokens / tokensPerCredit) × pilotCreditCostUsd
 *
 * @param tokens - Total LLM tokens used
 * @param config - Pilot Credit configuration
 * @returns Cost in USD based on Pilot Credit pricing
 */
function calculatePilotCreditCost(
  tokens: number,
  config: { pilotCreditCostUsd: number; tokensPerCredit: number }
): number {
  if (!tokens || tokens <= 0) return 0;

  const pilotCredits = Math.ceil(tokens / config.tokensPerCredit);
  return pilotCredits * config.pilotCreditCostUsd;
}

/**
 * Get human-readable label for time filter
 */
export const getTimeFilterLabel = (timeFilter: TimeFilter): string => {
  switch (timeFilter) {
    case 'last_7d':
      return 'last 7 days';
    case 'last_30d':
      return 'last 30 days';
    case 'last_90d':
      return 'last 90 days';
    case 'last_year':
      return 'last year';
    case 'all':
      return 'all time';
    default:
      return 'selected period';
  }
};

/**
 * Convert activity_type to human-friendly display name
 */
export const getActivityTypeDisplayName = (activityType: string): string => {
  const displayNames: { [key: string]: string } = {
    // Agent operations
    'agent_execution': 'Agent Executions',
    'agent_creation': 'Agent Creation',
    'agent_generation': 'Agent Creation', // Same as agent_creation - unified naming
    'agent_enhancement': 'Agent Enhancement',
    'agent_update': 'Agent Updates',

    // Chat and conversation
    'chat': 'AI Chat',
    'conversation': 'Conversations',
    'chat_completion': 'Chat Responses',

    // Research and analysis
    'research': 'Research & Analysis',
    'analysis': 'Data Analysis',
    'web_search': 'Web Research',
    'summarization': 'Summarization',

    // Plugin operations
    'plugin_execution': 'Plugin Operations',
    'gmail': 'Gmail Integration',
    'notion': 'Notion Integration',
    'slack': 'Slack Integration',
    'drive': 'Google Drive',

    // Prompt operations
    'prompt_analysis': 'Prompt Analysis',
    'prompt_enhancement': 'Prompt Enhancement',
    'prompt_generation': 'Prompt Generation',

    // General
    'other': 'Other Operations',
    'unknown': 'Miscellaneous'
  };

  // Try exact match first
  if (displayNames[activityType.toLowerCase()]) {
    return displayNames[activityType.toLowerCase()];
  }

  // Try to make it readable by capitalizing and replacing underscores
  return activityType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Format cost with appropriate currency symbol and decimals
 * FIXED: Handle undefined/null values
 */
export const formatCost = (cost: number | undefined | null): string => {
  // Handle all falsy and invalid values first
  if (cost == null || typeof cost !== 'number' || isNaN(cost)) {
    return '$0.00';
  }
  
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return '<$0.01';
  if (cost < 1) return `$${cost.toFixed(3)}`;
  if (cost < 10) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
};

/**
 * Format large numbers with appropriate suffixes (K, M, B)
 */
export const formatNumber = (num: number | undefined | null): string => {
  if (num == null || typeof num !== 'number' || isNaN(num)) return '0';
  if (num === 0) return '0';
  if (num < 1000) return num.toString();
  if (num < 1000000) return `${(num / 1000).toFixed(1)}K`;
  if (num < 1000000000) return `${(num / 1000000).toFixed(1)}M`;
  return `${(num / 1000000000).toFixed(1)}B`;
};

/**
 * Format token counts with appropriate suffixes
 * @deprecated Use formatPilotCredits instead for user-facing displays
 */
export const formatTokens = (tokens: number | undefined | null): string => {
  if (tokens == null || typeof tokens !== 'number' || isNaN(tokens)) return '0';
  if (tokens === 0) return '0';
  if (tokens < 1000) return Math.floor(tokens).toLocaleString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  if (tokens < 1000000000) return `${(tokens / 1000000).toFixed(1)}M`;
  return `${(tokens / 1000000000).toFixed(1)}B`;
};

/**
 * Format Pilot Credits (10 tokens = 1 Pilot Credit)
 * This is the user-facing format for displaying token usage
 */
export const formatPilotCredits = (tokens: number | undefined | null): string => {
  if (tokens == null || typeof tokens !== 'number' || isNaN(tokens)) return '0';

  const pilotCredits = Math.round(tokens / 10); // 10 tokens = 1 Pilot Credit

  if (pilotCredits === 0) return '0';
  if (pilotCredits < 1000) return Math.floor(pilotCredits).toLocaleString();
  if (pilotCredits < 1000000) return `${(pilotCredits / 1000).toFixed(1)}K`;
  if (pilotCredits < 1000000000) return `${(pilotCredits / 1000000).toFixed(1)}M`;
  return `${(pilotCredits / 1000000000).toFixed(1)}B`;
};

/**
 * Format latency/response time
 */
export const formatLatency = (ms: number | undefined | null): string => {
  if (ms == null || typeof ms !== 'number' || isNaN(ms)) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/**
 * Format time duration (alias for formatLatency for consistency)
 */
export const formatTime = (ms: number | undefined | null): string => {
  return formatLatency(ms);
};

/**
 * Format percentage with one decimal place
 */
export const formatPercentage = (percentage: number | undefined | null): string => {
  if (percentage == null || typeof percentage !== 'number' || isNaN(percentage)) return '0.0%';
  return `${percentage.toFixed(1)}%`;
};

/**
 * Calculate trend direction based on current vs previous values
 */
export const getTrendDirection = (current: number, previous: number): 'up' | 'down' | 'flat' => {
  if (current == null || previous == null || typeof current !== 'number' || typeof previous !== 'number') {
    return 'flat';
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 1) return 'flat';
  return change > 0 ? 'up' : 'down';
};

/**
 * Calculate percentage change between two values
 */
export const getPercentageChange = (current: number, previous: number): number => {
  if (current == null || previous == null || typeof current !== 'number' || typeof previous !== 'number') {
    return 0;
  }
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

/**
 * Get agent status based on performance metrics
 */
const getAgentStatus = (successRate: number, avgLatency: number, totalCost: number): 'excellent' | 'good' | 'needs_attention' => {
  // Handle undefined values
  const safeSuccessRate = successRate || 0;
  const safeAvgLatency = avgLatency || 0;
  const safeTotalCost = totalCost || 0;
  
  // More reasonable thresholds
  if (safeSuccessRate >= 95 && safeAvgLatency < 5000) { // < 5 seconds
    return 'excellent';
  } else if (safeSuccessRate >= 80 && safeAvgLatency < 10000) { // < 10 seconds  
    return 'good';
  } else {
    return 'needs_attention';
  }
};

/**
 * Calculate agent efficiency score
 */
const calculateEfficiency = (totalCost: number, totalCalls: number): number => {
  if (totalCalls === 0 || totalCost == null || totalCalls == null) return 0;
  const costPerCall = totalCost / totalCalls;
  // Lower cost per call = higher efficiency (scale 0-100)
  return Math.max(0, Math.min(100, 100 - (costPerCall * 1000)));
};

/**
 * Fixed agent identification that uses agent names from database JOIN
 */
export const extractAgentInfo = (item: AIUsageData): AgentInfo => {
  let agentName = 'System Operation';
  let agentId = 'system';

  // STEP 1: Extract Agent ID
  if (item.agent_id && item.agent_id !== 'unknown' && item.agent_id.trim() !== '') {
    agentId = item.agent_id.trim();
  } else if (item.session_id && item.session_id !== 'unknown' && item.session_id.trim() !== '') {
    agentId = item.session_id.trim();
  } else {
    agentId = `system-${item.category || 'general'}`;
  }

  // STEP 2: Extract Agent Name - USE DATABASE JOIN RESULT
  if (item.agent_name && item.agent_name.trim() !== '') {
    // This comes from the JOIN with agents table - use it directly
    agentName = item.agent_name.trim();
    console.log(`✅ Using agent name from database: ${agentName} for ID ${agentId}`);
  } else if (item.agent_id && item.agent_id !== 'unknown' && item.agent_id.length > 10) {
    // Create a meaningful fallback name for agents without names
    const shortId = item.agent_id.slice(0, 8);
    agentName = `Agent ${shortId}`;
    console.log(`🔧 Created fallback agent name: ${agentName} for ID ${item.agent_id}`);
  } else {
    // System operations without agent IDs
    agentName = generateSystemOperationName(item);
  }

  return { agentId, agentName };
};

/**
 * Generate descriptive names for system operations
 */
const generateSystemOperationName = (item: AIUsageData): string => {
  // Use activity_name if available and meaningful
  if (item.activity_name && 
      item.activity_name !== 'unknown' && 
      item.activity_name.length > 3 &&
      !item.activity_name.includes('undefined')) {
    return item.activity_name;
  }

  // Use activity_type if available
  if (item.activity_type && item.activity_type !== 'unknown') {
    return `${item.activity_type} Operation`;
  }

  // Use feature if available
  if (item.feature && item.feature !== 'unknown') {
    return `${item.feature} Feature`;
  }

  // Use component if available
  if (item.component && item.component !== 'unknown') {
    return `${item.component} Component`;
  }

  // Fall back to category
  const categoryName = item.category || 'general';
  return `${categoryName.charAt(0).toUpperCase() + categoryName.slice(1)} Operation`;
};

/**
 * Get color for category with special handling for specific activities
 */
const getColorForCategory = (category: string): string => {
  // Special color assignments for specific activities
  if (category.includes('Generating clarification questions')) {
    return 'text-purple-600';
  }
  if (category.includes('Analyzing prompt clarity')) {
    return 'text-blue-600';
  }
  
  // Default color assignment for other categories
  const colors = [
    'text-green-600', 'text-orange-600', 'text-pink-600', 'text-indigo-600', 
    'text-red-600', 'text-yellow-600', 'text-teal-600', 'text-cyan-600'
  ];
  const hash = category.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

/**
 * Get background color for category with special handling for specific activities
 */
const getBgColorForCategory = (category: string): string => {
  // Special color assignments for specific activities
  if (category.includes('Generating clarification questions')) {
    return 'bg-purple-500';
  }
  if (category.includes('Analyzing prompt clarity')) {
    return 'bg-blue-500';
  }
  
  // Default color assignment for other categories
  const colors = [
    'bg-green-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500',
    'bg-red-500', 'bg-yellow-500', 'bg-teal-500', 'bg-cyan-500'
  ];
  const hash = category.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

/**
 * Generate insights based on analytics data
 */
const generateInsights = (
  rawData: AIUsageData[], 
  agents: AgentData[], 
  activities: ActivityData[],
  totalCost: number,
  totalActivities: number
): Array<{
  type: 'positive' | 'warning' | 'info';
  icon: string;
  title: string;
  message: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> => {
  const insights = [];

  // Cost efficiency insight
  if (totalCost < 1.00 && totalActivities > 10) {
    insights.push({
      type: 'positive' as const,
      icon: 'DollarSign',
      title: 'Cost Efficient',
      message: `Your AI operations cost only $${totalCost.toFixed(3)} for ${totalActivities} activities.`,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200'
    });
  }

  // Agent performance insight - ONLY count real agents from database
  const realAgents = agents.filter(a => 
    a.agentName && 
    a.agentName !== 'System Operation' &&
    !a.agentName.startsWith('Agent ') // Exclude fallback agent names
  );
  
  const excellentRealAgents = realAgents.filter(a => a.successRate && a.successRate > 95).length;
  
  if (excellentRealAgents > 0 && realAgents.length > 0) {
    insights.push({
      type: 'positive' as const,
      icon: 'Award',
      title: 'High Performance',
      message: `${excellentRealAgents} of your ${realAgents.length} agent${realAgents.length === 1 ? '' : 's'} ${realAgents.length === 1 ? 'has' : 'have'} >95% success rate.`,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200'
    });
  }

  // Usage trend insight
  if (totalActivities > 0) {
    const avgLatency = rawData.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / totalActivities;
    insights.push({
      type: 'info' as const,
      icon: 'TrendingUp',
      title: 'Active Usage',
      message: `You've run ${totalActivities} AI operations with an average response time of ${(avgLatency / 1000).toFixed(1)}s.`,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-200'
    });
  }

  return insights;
};

/**
 * Process analytics data into structured format
 * @param rawData - Token usage data from database
 * @param allAgents - ALL user's agents (optional, for showing inactive agents)
 */
export const processAnalyticsData = async (
  rawData: AIUsageData[],
  allAgents?: Array<{ id: string; agent_name: string; created_at: string; is_archived?: boolean }>
): Promise<ProcessedAnalyticsData> => {
  // Fetch Pilot Credit configuration at the start
  const pilotConfig = await getPilotCreditConfig();
  if (!rawData || rawData.length === 0) {
    // If no usage data but we have agents, show them all as inactive
    const inactiveAgents: AgentData[] = (allAgents || []).map(agent => ({
      id: agent.id,
      agentId: agent.id,
      agentName: agent.agent_name,
      name: agent.agent_name,
      totalCalls: 0,
      totalRuns: 0,
      totalCost: 0,
      creationCost: 0,
      usageCost: 0,
      successRate: 0,
      avgLatency: 0,
      status: 'needs_attention' as const,
      lastUsed: agent.created_at,
      efficiency: 0,
      isActive: false,
      isArchived: agent.is_archived || false
    }));

    return {
      metrics: {
        totalActivities: 0,
        totalCost: 0,
        averageLatency: 0,
        successRate: 0,
        totalTokens: 0,
        costSavings: 0,
        overallSuccessRate: 0,
        avgResponseTime: 0
      },
      activities: [],
      agents: inactiveAgents,
      dailyUsage: [],
      costBreakdown: [],
      insights: [],
      rawActivities: []
    };
  }

  // Group by agents
  const agentGroups = new Map<string, {
    agentInfo: AgentInfo;
    records: AIUsageData[];
  }>();

  rawData.forEach(item => {
    const agentInfo = extractAgentInfo(item);
    if (!agentGroups.has(agentInfo.agentId)) {
      agentGroups.set(agentInfo.agentId, {
        agentInfo,
        records: []
      });
    }
    agentGroups.get(agentInfo.agentId)!.records.push(item);
  });

  // Process agents data - Show BOTH active (with usage) and inactive (without usage)
  const activeAgents: AgentData[] = Array.from(agentGroups.entries())
    .map(([agentId, group]) => {
      const { agentInfo, records } = group;
      const totalCalls = records.length;

      // Calculate cost from tokens using Pilot Credit pricing (not LLM cost_usd)
      const totalTokens = records.reduce((sum, r) => sum + (r.total_tokens || 0), 0);
      const totalCost = calculatePilotCreditCost(totalTokens, pilotConfig);

      // Separate creation vs usage costs - FIXED: Check activity_type instead of activity_name
      const creationTokens = records
        .filter(r =>
          r.activity_type === 'agent_creation' ||
          r.activity_type === 'agent_generation' ||
          (r.activity_name && r.activity_name.toLowerCase().includes('generate agent'))
        )
        .reduce((sum, r) => sum + (r.total_tokens || 0), 0);

      const creationCost = calculatePilotCreditCost(creationTokens, pilotConfig);
      const usageCost = totalCost - creationCost;

      const successCount = records.filter(r => r.success !== false).length;
      const successRate = totalCalls > 0 ? (successCount / totalCalls) * 100 : 0;
      const avgLatency = totalCalls > 0 ? records.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / totalCalls : 0;

      // Find the agent in allAgents to get is_archived status
      const agentRecord = (allAgents || []).find(a => a.id === agentId);

      return {
        id: agentId,
        agentId,
        agentName: agentInfo.agentName,
        name: agentInfo.agentName,
        totalCalls,
        totalRuns: totalCalls,
        totalCost,
        creationCost,
        usageCost,
        successRate,
        avgLatency,
        status: getAgentStatus(successRate, avgLatency, totalCost),
        lastUsed: records[0]?.created_at || new Date().toISOString(),
        efficiency: calculateEfficiency(totalCost, totalCalls),
        isActive: true,
        isArchived: agentRecord?.is_archived || false
      };
    })
    .filter(agent =>
      // ONLY show real agents from database - exclude fallback agents
      agent.agentName &&
      agent.agentName !== 'System Operation' &&
      !agent.agentName.startsWith('Agent ')
    );

  // Add agents with no usage data - FIXED: They are NOT active (no usage)
  const activeAgentIds = new Set(activeAgents.map(a => a.agentId));
  const unusedAgents: AgentData[] = (allAgents || [])
    .filter(agent => !activeAgentIds.has(agent.id))
    .map(agent => ({
      id: agent.id,
      agentId: agent.id,
      agentName: agent.agent_name,
      name: agent.agent_name,
      totalCalls: 0,
      totalRuns: 0,
      totalCost: 0,
      creationCost: 0,
      usageCost: 0,
      successRate: 0,
      avgLatency: 0,
      status: 'needs_attention' as const,
      lastUsed: agent.created_at,
      efficiency: 0,
      isActive: false, // FIXED: Not active if no usage data
      isArchived: agent.is_archived || false
    }));

  // Combine active and unused agents, sort by: active > inactive > archived
  const agents: AgentData[] = [...activeAgents, ...unusedAgents]
    .sort((a, b) => {
      // Priority: active (not archived) > inactive (not archived) > archived
      const aPriority = a.isArchived ? 2 : (a.isActive ? 0 : 1);
      const bPriority = b.isArchived ? 2 : (b.isActive ? 0 : 1);

      if (aPriority !== bPriority) return aPriority - bPriority;

      // Within same priority, active agents sort by cost (descending)
      if (a.isActive && b.isActive) return b.totalCost - a.totalCost;

      // Inactive/archived agents sort by creation date (newest first)
      return new Date(b.lastUsed || 0).getTime() - new Date(a.lastUsed || 0).getTime();
    });

  // Group by activities (for activities view) - CHANGED: Show individual token_usage records
  const activityGroups = new Map<string, AIUsageData[]>();
  
  rawData.forEach(item => {
    // Use activity_name as the key, or create a meaningful fallback
    let activityName = 'Unnamed Activity';
    
    if (item.activity_name && item.activity_name.trim() !== '' && item.activity_name !== 'unknown') {
      activityName = item.activity_name.trim();
    } else if (item.activity_type && item.activity_type !== 'unknown') {
      activityName = `${item.activity_type} Operation`;
    } else if (item.feature && item.feature !== 'unknown') {
      activityName = `${item.feature} Task`;
    } else if (item.category && item.category !== 'unknown') {
      activityName = `${item.category} Activity`;
    }
    
    if (!activityGroups.has(activityName)) {
      activityGroups.set(activityName, []);
    }
    activityGroups.get(activityName)!.push(item);
  });

  // Process activities data - CHANGED: Keep aggregated for overview, but main focus is rawActivities
  const activities: ActivityData[] = Array.from(activityGroups.entries()).map(([name, records]) => {
    const count = records.length;
    // Calculate cost from tokens using Pilot Credit pricing (not LLM cost_usd)
    const totalTokens = records.reduce((sum, r) => sum + (r.total_tokens || 0), 0);
    const cost = calculatePilotCreditCost(totalTokens, pilotConfig);
    const successCount = records.filter(r => r.success !== false).length;
    const successRate = count > 0 ? (successCount / count) * 100 : 0;
    const avgLatency = count > 0 ? records.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / count : 0;

    return {
      name,
      count,
      cost,
      successRate,
      avgLatency,
      // Add color and bgColor properties for UI
      color: getColorForCategory(name),
      bgColor: getBgColorForCategory(name)
    };
  }).sort((a, b) => b.cost - a.cost);

  // MAIN FOCUS: Individual activities list for Activities tab (no aggregation)
  const individualActivities = rawData.map(item => ({
    id: item.id,
    activity_name: item.activity_name || 'Unnamed Activity',
    created_at: item.created_at,
    cost_usd: item.cost_usd || 0,
    total_tokens: item.total_tokens || 0,
    input_tokens: item.input_tokens || 0,
    output_tokens: item.output_tokens || 0,
    latency_ms: item.latency_ms || 0,
    success: item.success !== false,
    model_name: item.model_name || 'Unknown',
    provider: item.provider || 'Unknown',
    category: item.category || 'general',
    activity_type: item.activity_type || null,
    feature: item.feature || null,
    endpoint: item.endpoint || null,
    session_id: item.session_id || null,
    workflow_step: item.workflow_step || null,
    metadata: item.metadata || null
  })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); // Most recent first

  // Process daily usage
  const dailyGroups = new Map<string, AIUsageData[]>();
  
  rawData.forEach(item => {
    const date = new Date(item.created_at).toISOString().split('T')[0];
    if (!dailyGroups.has(date)) {
      dailyGroups.set(date, []);
    }
    dailyGroups.get(date)!.push(item);
  });

  const dailyUsage = Array.from(dailyGroups.entries()).map(([date, records]) => {
    const tokens = records.reduce((sum, r) => sum + (r.total_tokens || 0), 0);
    return {
      date,
      cost: calculatePilotCreditCost(tokens, pilotConfig), // Use Pilot Credit pricing
      tokens,
      requests: records.length,
      activities: records.length,
      agents_created: 0,
      agents_run: records.filter(r => r.agent_id && r.agent_id !== 'unknown').length
    };
  }).sort((a, b) => a.date.localeCompare(b.date));

  // Calculate metrics FIRST (needed for costBreakdown)
  const totalActivities = rawData.length;
  const totalTokens = rawData.reduce((sum, r) => sum + (r.total_tokens || 0), 0);
  const totalCost = calculatePilotCreditCost(totalTokens, pilotConfig); // Use Pilot Credit pricing
  const successCount = rawData.filter(r => r.success !== false).length;
  const successRate = totalActivities > 0 ? (successCount / totalActivities) * 100 : 0;
  const averageLatency = totalActivities > 0 ? rawData.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / totalActivities : 0;
  const costSavings = totalTokens * 0.00005; // Rough estimate of cost savings

  // Process cost breakdown by activity_type (AFTER totalCost is calculated)
  const costBreakdownGroups = new Map<string, { tokens: number; cost: number }>();

  rawData.forEach(item => {
    let category = 'Other';

    // Group by activity_type for high-level categorization
    if (item.activity_type &&
        item.activity_type !== 'unknown' &&
        item.activity_type.trim() !== '') {
      category = item.activity_type.trim();
    } else if (item.category && item.category !== 'other') {
      category = item.category;
    } else {
      category = 'Other Operations';
    }

    // NORMALIZE: Merge agent_generation into agent_creation BEFORE grouping
    if (category === 'agent_generation') {
      category = 'agent_creation';
    }

    const current = costBreakdownGroups.get(category) || { tokens: 0, cost: 0 };
    const itemTokens = item.total_tokens || 0;
    const itemCost = calculatePilotCreditCost(itemTokens, pilotConfig);
    costBreakdownGroups.set(category, {
      tokens: current.tokens + itemTokens,
      cost: current.cost + itemCost
    });
  });

  const costBreakdown = Array.from(costBreakdownGroups.entries())
    .map(([activityType, data]) => ({
      name: getActivityTypeDisplayName(activityType), // Convert to human-friendly name
      cost: data.cost,
      percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
      color: getColorForCategory(activityType),
      bgColor: getBgColorForCategory(activityType)
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8); // Top 8 cost categories

  // Generate insights
  const insights = generateInsights(rawData, agents, activities, totalCost, totalActivities);

  console.log(`📊 Analytics processed: ${totalActivities} activities, ${agents.length} agents, ${activities.length} unique activity types`);

  return {
    metrics: {
      totalActivities,
      totalCost,
      averageLatency: averageLatency || 0,
      successRate: successRate || 0,
      totalTokens,
      costSavings,
      // Add additional common metric names for compatibility
      overallSuccessRate: successRate || 0,
      avgResponseTime: averageLatency || 0
    },
    activities,
    agents,
    dailyUsage,
    costBreakdown: costBreakdown || [], // Ensure it's always an array
    insights: insights || [], // Ensure it's always an array
    rawActivities: individualActivities,
    pilotCreditConfig: pilotConfig // Add config for UI components
  };
};