// components/analytics/AnalyticsView.tsx

import React from 'react';
import Link from 'next/link';
import {
  Bot,
  TrendingUp,
  Calendar,
  PieChart,
  DollarSign,
  Activity,
  Brain,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Rocket,
  Sparkles,
  FileText,
  BarChart3,
  MessageSquare,
  Zap,
  Award,
  Star,
  PlayCircle,
  Target,
  ExternalLink
} from 'lucide-react';
import { formatCost, formatPilotCredits, formatTime } from '@/lib/utils/analyticsHelpers';
import { formatActivityName } from '@/lib/utils/formatActivityName';
import type {
  AnalyticsView,
  ProcessedAnalyticsData
} from '@/types/analytics';

// Icon mapping helper
const getIconComponent = (iconName: string) => {
  const iconMap: { [key: string]: React.ComponentType<{ className?: string }> } = {
    Bot,
    Rocket,
    Sparkles,
    FileText,
    BarChart3,
    MessageSquare,
    Zap,
    Award,
    Star,
    AlertTriangle,
    TrendingUp
  };
  
  return iconMap[iconName] || Zap;
};

interface AnalyticsViewsProps {
  selectedView: AnalyticsView;
  data: ProcessedAnalyticsData;
  activityFilter?: string; // Optional filter for activity_type (e.g., 'agent_creation', 'agent_execution')
}

export const AnalyticsViews: React.FC<AnalyticsViewsProps> = ({ selectedView, data, activityFilter }) => {
  const { agents, dailyUsage, costBreakdown, insights, pilotCreditConfig } = data;

  // Helper function to convert activity cost from tokens to Pilot Credit pricing
  const convertActivityCost = React.useCallback((activity: { total_tokens: number }) => {
    const pilotCredits = Math.ceil(activity.total_tokens / pilotCreditConfig.tokensPerCredit);
    return pilotCredits * pilotCreditConfig.pilotCreditCostUsd;
  }, [pilotCreditConfig]);

  // Activity type filter state - MUST be at top level (before any returns)
  const [selectedActivityType, setSelectedActivityType] = React.useState<string>(activityFilter || 'all');

  // Update selected activity type when activityFilter prop changes
  React.useEffect(() => {
    if (activityFilter) {
      setSelectedActivityType(activityFilter);
    }
  }, [activityFilter]);

  // Extract unique activity types from activities - MUST be at top level
  const uniqueActivityTypes = React.useMemo(() => {
    const types = new Set<string>();
    data.rawActivities.forEach(activity => {
      if (activity.activity_type) {
        // Normalize: treat agent_generation as agent_creation to avoid duplicates
        const normalizedType = activity.activity_type === 'agent_generation'
          ? 'agent_creation'
          : activity.activity_type;
        types.add(normalizedType);
      }
    });
    return Array.from(types).sort();
  }, [data.rawActivities]);

  // Filter activities by activity type - MUST be at top level
  const filteredActivities = React.useMemo(() => {
    if (selectedActivityType === 'all') {
      return data.rawActivities;
    }
    // Handle unified naming: both agent_creation and agent_generation should match
    if (selectedActivityType === 'agent_creation') {
      return data.rawActivities.filter(activity =>
        activity.activity_type === 'agent_creation' || activity.activity_type === 'agent_generation'
      );
    }
    return data.rawActivities.filter(activity => activity.activity_type === selectedActivityType);
  }, [data.rawActivities, selectedActivityType]);

  // Group activities by session_id - MUST be at top level
  const groupedActivities = React.useMemo(() => {
    return filteredActivities.reduce((acc, activity) => {
      const sessionKey = activity.session_id || activity.id;
      if (!acc[sessionKey]) {
        acc[sessionKey] = [];
      }
      acc[sessionKey].push(activity);
      return acc;
    }, {} as Record<string, typeof data.rawActivities>);
  }, [filteredActivities]);

  // Convert to array and sort by most recent - MUST be at top level
  const allSessionGroups = React.useMemo(() => {
    return Object.entries(groupedActivities)
      .map(([sessionId, activities]) => {
        const sortedActivities = activities.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        // Extract agent name and create summary of operations
        const firstActivity = sortedActivities[0].activity_name;
        const agentNameMatch = firstActivity.match(/^(.+?)\s*-\s*/);
        const agentName = agentNameMatch ? agentNameMatch[1] : formatActivityName(firstActivity);

        // Collect unique operations (extract everything after " - ")
        const operations = sortedActivities
          .map(a => {
            const match = a.activity_name.match(/\s*-\s*(.+)$/);
            return match ? formatActivityName(match[1]) : null;
          })
          .filter((op, idx, arr) => op && op !== 'Final response' && arr.indexOf(op) === idx);

        // Create display name
        let displayName = agentName;
        if (operations.length > 0) {
          displayName = `${agentName} - ${operations.join(' → ')}`;
        }

        return {
          sessionId,
          activities: sortedActivities,
          totalCost: activities.reduce((sum, a) => sum + convertActivityCost(a), 0), // Use Pilot Credit pricing
          totalTokens: activities.reduce((sum, a) => sum + a.total_tokens, 0),
          totalLatency: activities.reduce((sum, a) => sum + a.latency_ms, 0),
          startTime: sortedActivities[0].created_at,
          allSuccess: activities.every(a => a.success),
          activityName: displayName,
          model: sortedActivities[0].model_name,
          provider: sortedActivities[0].provider
        };
      })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }, [groupedActivities, convertActivityCost]);

  // Pagination state - MUST be at top level
  const [currentPage, setCurrentPage] = React.useState(1);
  const itemsPerPage = 10;

  // Reset pagination when activity type filter changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [selectedActivityType]);

  // Convert activity type to user-friendly name - MUST be at top level
  const getActivityTypeLabel = React.useCallback((activityType: string): string => {
    const labelMap: Record<string, string> = {
      'agent_creation': 'Agent Creation',
      'agent_generation': 'Agent Creation', // Same as agent_creation - unified naming
      'agent_execution': 'Agent Execution',
      'agent_enhancement': 'Agent Enhancement',
      'plugin_operation': 'Plugin Operations',
      'research': 'Research',
      'analysis': 'Analysis',
      'generation': 'Generation',
      'chat': 'Chat',
      'system': 'System',
      'workflow': 'Workflow',
      'api': 'API Calls',
      'database': 'Database',
      'authentication': 'Authentication'
    };

    return labelMap[activityType] || activityType.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }, []);

  // Calculate pagination - MUST be at top level
  const totalPages = Math.ceil(allSessionGroups.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const sessionGroups = allSessionGroups.slice(startIndex, endIndex);

  // Agent status filter - MUST be at top level
  const [agentStatusFilter, setAgentStatusFilter] = React.useState<'all' | 'active' | 'paused' | 'draft' | 'archived'>('all');

  // Filter agents by status - MUST be at top level
  const filteredAgents = React.useMemo(() => {
    switch (agentStatusFilter) {
      case 'active':
        return agents.filter(a => a.isActive && !a.isArchived && !a.isDraft && !a.isPaused);
      case 'paused':
        return agents.filter(a => a.isPaused && !a.isArchived && !a.isDraft);
      case 'draft':
        return agents.filter(a => a.isDraft && !a.isArchived);
      case 'archived':
        return agents.filter(a => a.isArchived);
      default:
        return agents;
    }
  }, [agents, agentStatusFilter]);

  // Overview View - Just show the cards (cards are rendered in parent component)
  if (selectedView === 'overview') {
    return null; // Cards are shown by parent component
  }

  // Insights View - Show detailed analysis with all insights
  if (selectedView === 'insights') {
    // Calculate daily insights for decision-making
    const last7Days = dailyUsage.slice(-7);
    const avgDailyCost = last7Days.length > 0
      ? last7Days.reduce((sum, d) => sum + d.cost, 0) / last7Days.length
      : 0;
    const maxDay = last7Days.length > 0
      ? last7Days.reduce((max, d) => d.cost > max.cost ? d : max, last7Days[0])
      : null;
    const minDay = last7Days.length > 0
      ? last7Days.reduce((min, d) => d.cost < min.cost ? d : min, last7Days[0])
      : null;
    const totalWeekCost = last7Days.reduce((sum, d) => sum + d.cost, 0);
    const projectedMonthlyCost = avgDailyCost * 30;

    // Calculate spending insights
    const topSpender = costBreakdown[0];
    const topThreePercent = costBreakdown.slice(0, 3).reduce((sum, item) => sum + item.percentage, 0);

    return (
      <div className="space-y-6">
        {/* Summary Cards Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Weekly Spending */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                Last 7 days
              </span>
            </div>
            <h3 className="text-3xl font-bold text-blue-900 mb-1">{formatCost(totalWeekCost)}</h3>
            <p className="text-sm text-blue-700 font-medium mb-2">Weekly Spend</p>
            <p className="text-xs text-blue-600">Avg: {formatCost(avgDailyCost)}/day</p>
          </div>

          {/* Projected Monthly */}
          <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center shadow-md">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <span className="text-xs font-semibold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                Projection
              </span>
            </div>
            <h3 className="text-3xl font-bold text-purple-900 mb-1">{formatCost(projectedMonthlyCost)}</h3>
            <p className="text-sm text-purple-700 font-medium mb-2">Monthly Forecast</p>
            <p className="text-xs text-purple-600">Based on current usage</p>
          </div>

          {/* Top Cost Driver */}
          {topSpender && (
            <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200/50 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center shadow-md">
                  <Target className="w-5 h-5 text-white" />
                </div>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                  {topSpender.percentage.toFixed(0)}%
                </span>
              </div>
              <h3 className="text-3xl font-bold text-emerald-900 mb-1">{formatCost(topSpender.cost)}</h3>
              <p className="text-sm text-emerald-700 font-medium mb-2">Top Spender</p>
              <p className="text-xs text-emerald-600 truncate">{topSpender.name}</p>
            </div>
          )}
        </div>

        {/* Main Grid: Daily Activity & Spending Analysis */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Daily Activity with Insights */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-b border-blue-200/50 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
                    <TrendingUp className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Daily Activity Trend</h3>
                    <p className="text-sm text-blue-700">Last 7 days usage pattern</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              {dailyUsage.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No daily data available</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Visual Graph */}
                  <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/30 rounded-xl p-5 border border-blue-200/30">
                    <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-4">7-Day Spending Trend</h4>
                    <div className="flex items-end justify-between gap-2 h-40">
                      {last7Days.map((day) => {
                        const maxCost = Math.max(...last7Days.map(d => d.cost));
                        const barHeight = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
                        const isHighest = maxDay && day.date === maxDay.date;

                        return (
                          <div key={day.date} className="flex-1 flex flex-col items-center gap-2 group">
                            {/* Cost tooltip */}
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap mb-1">
                              {formatCost(day.cost)}
                            </div>

                            {/* Bar */}
                            <div className="w-full flex items-end justify-center" style={{ height: '120px' }}>
                              <div
                                className={`w-full rounded-t-lg transition-all duration-500 ${
                                  isHighest
                                    ? 'bg-gradient-to-t from-blue-600 to-indigo-600 shadow-lg'
                                    : 'bg-gradient-to-t from-blue-400 to-indigo-500'
                                } hover:opacity-80 cursor-pointer relative group-hover:shadow-xl`}
                                style={{ height: `${Math.max(barHeight, 5)}%` }}
                              >
                                {isHighest && (
                                  <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-blue-600">
                                    <Star className="w-4 h-4 fill-current" />
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Day label */}
                            <div className={`text-xs font-medium ${isHighest ? 'text-blue-900' : 'text-gray-600'}`}>
                              {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Key Insights */}
                  {maxDay && minDay && maxDay.date !== minDay.date && (
                    <div className="bg-blue-50/50 border border-blue-200/50 rounded-xl p-4">
                      <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Key Insights</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-blue-700">Highest usage day:</span>
                          <span className="font-bold text-blue-900">
                            {new Date(maxDay.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            {' '}({formatCost(maxDay.cost)})
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-blue-700">Daily average:</span>
                          <span className="font-bold text-blue-900">{formatCost(avgDailyCost)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Daily Bars */}
                  <div className="space-y-4">
                    {last7Days.map((day) => {
                      const maxCost = Math.max(...last7Days.map(d => d.cost));
                      const costWidth = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
                      const isHighest = maxDay && day.date === maxDay.date;

                      return (
                        <div key={day.date} className={`space-y-2 ${isHighest ? 'p-3 bg-blue-50/50 rounded-xl border border-blue-200/30' : ''}`}>
                          <div className="flex justify-between items-start text-sm">
                            <div className="flex items-center gap-2">
                              <span className={`font-semibold ${isHighest ? 'text-blue-900' : 'text-gray-700'}`}>
                                {new Date(day.date).toLocaleDateString('en-US', {
                                  weekday: 'short',
                                  month: 'short',
                                  day: 'numeric'
                                })}
                              </span>
                              {isHighest && (
                                <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                                  Peak
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              <div className={`font-bold ${isHighest ? 'text-blue-900 text-base' : 'text-gray-900'}`}>
                                {formatCost(day.cost)}
                              </div>
                              <div className="text-xs text-gray-500">{formatPilotCredits(day.tokens)} Pilot Credits</div>
                            </div>
                          </div>
                          <div className="bg-gray-100 rounded-full h-2.5 overflow-hidden">
                            <div
                              className={`h-2.5 rounded-full transition-all duration-500 ${
                                isHighest
                                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600'
                                  : 'bg-gradient-to-r from-blue-400 to-purple-500'
                              }`}
                              style={{ width: `${Math.max(costWidth, 2)}%` }}
                            ></div>
                          </div>
                          <div className="flex justify-between text-xs text-gray-600">
                            <span className="flex items-center gap-1">
                              <Bot className="w-3 h-3" />
                              {day.agents_run} runs
                            </span>
                            <span>{day.activities} operations</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Spending Analysis with Recommendations */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-b border-emerald-200/50 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center shadow-md">
                    <PieChart className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Spending Breakdown</h3>
                    <p className="text-sm text-emerald-700">Budget allocation by category</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              {costBreakdown.length === 0 ? (
                <div className="text-center py-8">
                  <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No cost data available</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Budget Concentration Insight */}
                  <div className="bg-amber-50/50 border border-amber-200/50 rounded-xl p-4">
                    <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-2">Budget Insight</h4>
                    <p className="text-sm text-amber-800">
                      Top 3 categories account for <span className="font-bold">{topThreePercent.toFixed(0)}%</span> of your spending.
                      {topThreePercent > 80 && (
                        <span className="block mt-1 text-xs text-amber-700">
                          💡 Consider optimizing high-cost operations for better efficiency.
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Category Breakdown */}
                  <div className="space-y-3">
                    {costBreakdown.slice(0, 6).map((item, index) => (
                      <div key={index} className="group hover:bg-gradient-to-r hover:from-emerald-50/50 hover:to-green-50/30 rounded-xl p-3 transition-all duration-200 border border-transparent hover:border-emerald-200/30">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <div className={`w-4 h-4 rounded-lg ${item.bgColor} shadow-sm`}></div>
                              <span className="text-sm font-semibold text-gray-800">{item.name}</span>
                            </div>
                            {index === 0 && (
                              <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                                Highest
                              </span>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-gray-900">{formatCost(item.cost)}</div>
                            <div className="text-xs font-semibold text-emerald-600">{item.percentage.toFixed(1)}%</div>
                          </div>
                        </div>
                        <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full transition-all duration-500 ${item.bgColor} shadow-sm`}
                            style={{ width: `${item.percentage}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Action Recommendation */}
                  {topSpender && topSpender.percentage > 40 && (
                    <div className="bg-blue-50/50 border border-blue-200/50 rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Target className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-blue-900 mb-1">Optimization Opportunity</h4>
                          <p className="text-xs text-blue-800 leading-relaxed">
                            <strong>{topSpender.name}</strong> represents {topSpender.percentage.toFixed(0)}% of costs.
                            Review this workflow for potential optimization—even small improvements could yield significant savings.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI-Generated Insights from data */}
        {insights.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900">AI-Powered Insights</h3>
            <div className="grid lg:grid-cols-2 gap-4">
              {insights.map((insight, index) => {
                const IconComponent = getIconComponent(insight.icon);
                return (
                  <div key={index} className={`${insight.bgColor} backdrop-blur-sm rounded-2xl border ${insight.borderColor} shadow-lg p-6 hover:shadow-xl transition-all duration-300`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 ${insight.color.replace('text-', 'bg-').replace('600', '100')} rounded-lg flex items-center justify-center ${insight.color}`}>
                        <IconComponent className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-gray-900 mb-1">{insight.title}</h4>
                        <p className="text-gray-700 text-sm leading-relaxed">{insight.message}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Activities View - Grouped by session with iteration details
  if (selectedView === 'activities') {
    return (
    <div className="space-y-4">
      {/* Sticky Header */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6 sticky top-0 z-10">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">AI Activities</h3>
                <p className="text-gray-600">Complete history of AI operations</p>
              </div>
            </div>
            {allSessionGroups.length > 0 && (
              <div className="text-sm text-gray-600">
                Showing {startIndex + 1}-{Math.min(endIndex, allSessionGroups.length)} of {allSessionGroups.length}
              </div>
            )}
          </div>

          {/* Activity Type Filter Tabs */}
          {uniqueActivityTypes.length > 0 && (
            <div className="inline-flex bg-gray-100/80 rounded-xl p-1 w-fit overflow-x-auto max-w-full">
              <button
                onClick={() => setSelectedActivityType('all')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  selectedActivityType === 'all'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                All Activities
              </button>
              {uniqueActivityTypes.map((activityType) => (
                <button
                  key={activityType}
                  onClick={() => setSelectedActivityType(activityType)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                    selectedActivityType === activityType
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {getActivityTypeLabel(activityType)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activities List */}
      {sessionGroups.length === 0 ? (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
          <div className="text-center py-12">
            <Activity className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h4 className="text-lg font-bold text-gray-900 mb-2">No Activities Yet</h4>
            <p className="text-gray-600">Start using AI features to see activity log</p>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-4">
          {sessionGroups.map((group) => {
            const agentNameMatch = group.activityName.match(/^(.+?)\s*-\s*/);
            const agentName = agentNameMatch ? agentNameMatch[1] : group.activityName;
            const operationsMatch = group.activityName.match(/\s*-\s*(.+)$/);
            const operations = operationsMatch ? operationsMatch[1] : null;

            return (
            <div key={group.sessionId} className="group/card bg-white rounded-2xl border border-gray-200/60 hover:border-purple-300/60 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden">
              {/* Main execution summary */}
              <div className="p-6 bg-gradient-to-br from-white via-purple-50/30 to-pink-50/20">
                {/* Header Row */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
                        <Bot className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-gray-900">{agentName}</h4>
                        <p className="text-xs text-gray-500">
                          {new Date(group.startTime).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {/* Operations Flow */}
                    {operations && (
                      <div className="ml-13 mt-3">
                        <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-xl border border-purple-200/50 shadow-sm">
                          <Zap className="w-4 h-4 text-purple-500 flex-shrink-0" />
                          <div className="flex items-center gap-2 text-xs font-mono">
                            {operations.split('→').map((op, i, arr) => (
                              <span key={i} className="flex items-center gap-2">
                                <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-md font-semibold">
                                  {op.trim()}
                                </span>
                                {i < arr.length - 1 && (
                                  <span className="text-gray-400">→</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cost Summary Card */}
                  <div className="ml-4 bg-white/80 backdrop-blur-sm rounded-xl px-4 py-3 border border-gray-200/50 shadow-sm min-w-[120px]">
                    <p className="text-xs text-gray-500 mb-1">Total Cost</p>
                    <p className="text-2xl font-bold text-gray-900">{formatCost(group.totalCost)}</p>
                    <p className="text-xs text-gray-600 mt-1">{formatPilotCredits(group.totalTokens)} Pilot Credits</p>
                  </div>
                </div>

                {/* Metrics Row */}
                <div className="flex items-center gap-6 ml-13 mt-4 pt-4 border-t border-gray-200/50">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <PlayCircle className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Duration</p>
                      <p className="text-sm font-semibold text-gray-900">{formatTime(group.totalLatency)}</p>
                    </div>
                  </div>

                  {group.activities.length > 1 && (
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                        <Zap className="w-4 h-4 text-purple-600" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Steps</p>
                        <p className="text-sm font-semibold text-gray-900">{group.activities.length}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      group.allSuccess ? 'bg-green-100' : 'bg-amber-100'
                    }`}>
                      {group.allSuccess ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Status</p>
                      <p className={`text-sm font-semibold ${
                        group.allSuccess ? 'text-green-600' : 'text-amber-600'
                      }`}>
                        {group.allSuccess ? 'Completed' : 'Partial'}
                      </p>
                    </div>
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-600">{group.model}</span>
                    <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-md">
                      {group.provider}
                    </span>
                  </div>
                </div>
              </div>

              {/* Step breakdown (only show if multiple steps) */}
              {group.activities.length > 1 && (
                <div className="px-6 py-4 bg-gradient-to-b from-gray-50/80 to-white border-t border-gray-200/50">
                  <details className="group/details">
                    <summary className="cursor-pointer flex items-center justify-between p-3 rounded-lg hover:bg-purple-50/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-lg bg-purple-100 flex items-center justify-center group-open/details:bg-purple-200 transition-colors">
                          <Zap className="w-3.5 h-3.5 text-purple-600" />
                        </div>
                        <span className="text-sm font-semibold text-gray-900">
                          Step-by-step breakdown
                        </span>
                        <span className="text-xs text-gray-500">
                          ({group.activities.length} steps)
                        </span>
                      </div>
                      <span className="text-xs text-purple-600 group-open/details:rotate-180 transition-transform">▼</span>
                    </summary>

                    <div className="mt-4 space-y-2">
                      {group.activities.map((activity, idx) => {
                        // Extract the actual operation from activity_name (everything after " - ")
                        let stepDescription = `Step ${idx + 1}`;
                        const operationMatch = activity.activity_name.match(/\s*-\s*(.+)$/);
                        if (operationMatch && operationMatch[1]) {
                          stepDescription = formatActivityName(operationMatch[1]);
                        } else {
                          // No " - " separator, normalize the whole activity name
                          stepDescription = formatActivityName(activity.activity_name);
                        }

                        return (
                          <div key={activity.id} className="group/step relative bg-white rounded-xl border border-gray-200/60 hover:border-purple-200 hover:shadow-md transition-all duration-200 overflow-hidden">
                            {/* Step number badge */}
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-purple-500 to-pink-600"></div>

                            <div className="flex items-center justify-between p-4 pl-5">
                              <div className="flex items-center gap-4 flex-1">
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-xs">
                                    {idx + 1}
                                  </div>
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                                    activity.success ? 'bg-green-100' : 'bg-red-100'
                                  }`}>
                                    {activity.success ? (
                                      <CheckCircle className="w-4 h-4 text-green-600" />
                                    ) : (
                                      <XCircle className="w-4 h-4 text-red-600" />
                                    )}
                                  </div>
                                </div>

                                <div className="flex-1">
                                  <p className="font-mono text-sm font-semibold text-gray-900">{stepDescription}</p>
                                  <div className="flex items-center gap-4 mt-1">
                                    <span className="text-xs text-gray-500 flex items-center gap-1">
                                      <PlayCircle className="w-3 h-3" />
                                      {formatTime(activity.latency_ms)}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {formatPilotCredits(activity.total_tokens)} Pilot Credits
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="text-right">
                                <p className="text-lg font-bold text-gray-900">{formatCost(activity.cost_usd)}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                </div>
              )}
            </div>
            );
          })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  ← Previous
                </button>

                <div className="flex items-center gap-2">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-1 text-sm font-medium rounded-lg transition-colors ${
                        page === currentPage
                          ? 'bg-purple-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

  // Agents View
  if (selectedView === 'agents') {
    const activeCount = agents.filter(a => a.isActive && !a.isArchived && !a.isDraft && !a.isPaused).length;
    const pausedCount = agents.filter(a => a.isPaused && !a.isArchived && !a.isDraft).length;
    const draftCount = agents.filter(a => a.isDraft && !a.isArchived).length;
    const archivedCount = agents.filter(a => a.isArchived).length;

    return (
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Workflow Agents</h3>
              <p className="text-gray-600">Performance analytics for your AI agents</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-gray-600">Active ({activeCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-400"></div>
              <span className="text-gray-600">Paused ({pausedCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-purple-400"></div>
              <span className="text-gray-600">Draft ({draftCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500"></div>
              <span className="text-gray-600">Archived ({archivedCount})</span>
            </div>
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="mb-6 inline-flex bg-gray-100/80 rounded-xl p-1 w-fit">
          <button
            onClick={() => setAgentStatusFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              agentStatusFilter === 'all'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            All ({agents.length})
          </button>
          <button
            onClick={() => setAgentStatusFilter('active')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              agentStatusFilter === 'active'
                ? 'bg-white text-green-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Active ({activeCount})
          </button>
          <button
            onClick={() => setAgentStatusFilter('paused')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              agentStatusFilter === 'paused'
                ? 'bg-white text-orange-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Paused ({pausedCount})
          </button>
          <button
            onClick={() => setAgentStatusFilter('draft')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              agentStatusFilter === 'draft'
                ? 'bg-white text-purple-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Draft ({draftCount})
          </button>
          <button
            onClick={() => setAgentStatusFilter('archived')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              agentStatusFilter === 'archived'
                ? 'bg-white text-amber-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Archived ({archivedCount})
          </button>
        </div>

        {filteredAgents.length === 0 ? (
          <div className="text-center py-12">
            <Bot className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h4 className="text-lg font-bold text-gray-900 mb-2">
              {agentStatusFilter === 'all' ? 'No Agents Created Yet' : `No ${agentStatusFilter} agents`}
            </h4>
            <p className="text-gray-600">
              {agentStatusFilter === 'all'
                ? 'Build your first workflow agent to see metrics'
                : `You don't have any ${agentStatusFilter} agents at the moment`
              }
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredAgents.map((agent, index) => (
              <div key={agent.id || index} className={`border rounded-xl p-4 hover:shadow-md transition-all duration-200 ${
                agent.isArchived ? 'border-amber-200/50 bg-amber-50/30' :
                agent.isActive ? 'border-gray-200/50 bg-white' : 'border-gray-300/50 bg-gray-50/50'
              }`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg relative ${
                      agent.isArchived
                        ? 'bg-gradient-to-br from-amber-400 to-amber-600'
                        : agent.isDraft
                        ? 'bg-gradient-to-br from-purple-400 to-purple-600'
                        : agent.isPaused
                        ? 'bg-gradient-to-br from-orange-400 to-orange-600'
                        : agent.isActive
                        ? 'bg-gradient-to-br from-green-500 to-emerald-600'
                        : 'bg-gradient-to-br from-gray-400 to-gray-500'
                    }`}>
                      <Bot className="w-6 h-6 text-white" />
                      {/* Active/Paused/Draft/Archived indicator dot */}
                      <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${
                        agent.isArchived ? 'bg-amber-500' :
                        agent.isDraft ? 'bg-purple-500' :
                        agent.isPaused ? 'bg-orange-400' :
                        agent.isActive ? 'bg-green-500' : 'bg-gray-400'
                      }`}></div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/agents/${agent.id}`}
                          className="font-bold text-gray-900 hover:text-blue-600 transition-colors flex items-center gap-1 group"
                        >
                          {agent.name}
                          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                        {/* Status Badge */}
                        {agent.isArchived ? (
                          <span className="px-2 py-0.5 bg-amber-200 text-amber-700 text-xs font-medium rounded">
                            Archived
                          </span>
                        ) : agent.isDraft ? (
                          <span className="px-2 py-0.5 bg-purple-200 text-purple-700 text-xs font-medium rounded">
                            Draft
                          </span>
                        ) : agent.isPaused ? (
                          <span className="px-2 py-0.5 bg-orange-200 text-orange-700 text-xs font-medium rounded">
                            Paused
                          </span>
                        ) : agent.isActive ? (
                          <span className="px-2 py-0.5 bg-green-200 text-green-700 text-xs font-medium rounded">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs font-medium rounded">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">ID: {agent.id.slice(0, 8)}...</span>
                        {agent.isActive && !agent.isArchived && (
                          <div className={`px-2 py-1 rounded-lg text-xs font-bold ${
                            agent.status === 'excellent' ? 'bg-green-100 text-green-700' :
                            agent.status === 'good' ? 'bg-blue-100 text-blue-700' :
                            'bg-orange-100 text-orange-700'
                          }`}>
                            {agent.status === 'excellent' ? 'Excellent' :
                             agent.status === 'good' ? 'Good' : 'Needs Attention'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{formatCost(agent.totalCost)}</p>
                    <p className="text-sm text-gray-500">Total Investment</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">Creation</p>
                    <p className="font-bold text-gray-900">{formatCost(agent.creationCost)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">Usage</p>
                    <p className="font-bold text-gray-900">{formatCost(agent.usageCost)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">Runs</p>
                    <p className="font-bold text-gray-900">{agent.totalRuns}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">Success</p>
                    <div className="flex items-center justify-center gap-1">
                      {agent.totalRuns > 0 ? (
                        <>
                          {agent.successRate >= 95 ? (
                            <CheckCircle className="w-3 h-3 text-green-500" />
                          ) : agent.successRate >= 80 ? (
                            <AlertTriangle className="w-3 h-3 text-yellow-500" />
                          ) : (
                            <XCircle className="w-3 h-3 text-red-500" />
                          )}
                          <span className="font-bold text-gray-900">{agent.successRate.toFixed(1)}%</span>
                        </>
                      ) : (
                        <span className="font-bold text-gray-500">N/A</span>
                      )}
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">Efficiency</p>
                    <p className="font-bold text-gray-900">{agent.efficiency?.toFixed(0) ?? '0'}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">{agent.isActive ? 'Last Used' : 'Created'}</p>
                    <p className="font-bold text-gray-900">
                      {agent.lastUsed ? new Date(agent.lastUsed).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
};