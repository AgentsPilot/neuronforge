// lib/utils/analyticsHelpers.ts

import type { AIUsageData, ProcessedAnalyticsData, ActivityData, AgentData, TimeFilter } from '@/types/analytics';

interface AgentInfo {
  agentId: string;
  agentName: string;
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
export const processAnalyticsData = (
  rawData: AIUsageData[],
  allAgents?: Array<{ id: string; agent_name: string; created_at: string; is_archived?: boolean }>
): ProcessedAnalyticsData => {
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
      const totalCost = records.reduce((sum, r) => sum + (r.cost_usd || 0), 0);

      // Separate creation vs usage costs
      const creationCost = records
        .filter(r => r.activity_name && r.activity_name.includes('specification'))
        .reduce((sum, r) => sum + (r.cost_usd || 0), 0);
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

  // Add inactive agents (agents with no usage data)
  const activeAgentIds = new Set(activeAgents.map(a => a.agentId));
  const inactiveAgents: AgentData[] = (allAgents || [])
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
      isActive: false,
      isArchived: agent.is_archived || false
    }));

  // Combine active and inactive agents, sort by: active > inactive > archived
  const agents: AgentData[] = [...activeAgents, ...inactiveAgents]
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
    const cost = records.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
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
    session_id: item.session_id || null
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

  const dailyUsage = Array.from(dailyGroups.entries()).map(([date, records]) => ({
    date,
    cost: records.reduce((sum, r) => sum + (r.cost_usd || 0), 0),
    tokens: records.reduce((sum, r) => sum + (r.total_tokens || 0), 0),
    requests: records.length,
    activities: records.length,
    agents_created: 0,
    agents_run: records.filter(r => r.agent_id && r.agent_id !== 'unknown').length
  })).sort((a, b) => a.date.localeCompare(b.date));

  // Calculate metrics FIRST (needed for costBreakdown)
  const totalActivities = rawData.length;
  const totalCost = rawData.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
  const totalTokens = rawData.reduce((sum, r) => sum + (r.total_tokens || 0), 0);
  const successCount = rawData.filter(r => r.success !== false).length;
  const successRate = totalActivities > 0 ? (successCount / totalActivities) * 100 : 0;
  const averageLatency = totalActivities > 0 ? rawData.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / totalActivities : 0;
  const costSavings = totalTokens * 0.00005; // Rough estimate of cost savings

  // Process cost breakdown by activity_name (AFTER totalCost is calculated)
  const costBreakdownGroups = new Map<string, number>();
  
  rawData.forEach(item => {
    let category = 'Other';
    
    // Use activity_name from token_usage table
    if (item.activity_name && 
        item.activity_name !== 'unknown' && 
        item.activity_name.trim() !== '') {
      category = item.activity_name.trim();
    } else {
      category = 'Unnamed Activity';
    }
    
    const current = costBreakdownGroups.get(category) || 0;
    costBreakdownGroups.set(category, current + (item.cost_usd || 0));
  });

  const costBreakdown = Array.from(costBreakdownGroups.entries())
    .map(([name, cost]) => ({
      name,
      cost,
      percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      color: getColorForCategory(name),
      bgColor: getBgColorForCategory(name)
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
    rawActivities: individualActivities
  };
};