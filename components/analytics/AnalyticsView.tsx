// components/analytics/AnalyticsView.tsx

import React from 'react';
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
  Archive,
  PauseCircle,
  PlayCircle,
  Power,
  Pause
} from 'lucide-react';
import { formatCost, formatTokens, formatTime } from '@/lib/utils/analyticsHelpers';
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
}

export const AnalyticsViews: React.FC<AnalyticsViewsProps> = ({ selectedView, data }) => {
  const { activities, agents, dailyUsage, costBreakdown, insights } = data;

  // Overview View
  if (selectedView === 'overview') {
    return (
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Daily Activity */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Daily Activity</h3>
              <p className="text-sm text-gray-600">AI usage trends</p>
            </div>
          </div>
          
          {dailyUsage.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No daily data available</p>
            </div>
          ) : (
            <div className="space-y-4">
              {dailyUsage.slice(-7).map((day, index) => {
                const maxCost = Math.max(...dailyUsage.map(d => d.cost));
                const costWidth = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
                
                return (
                  <div key={day.date} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        {new Date(day.date).toLocaleDateString('en-US', { 
                          weekday: 'short', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </span>
                      <div className="text-right">
                        <div className="font-bold text-gray-900">{formatCost(day.cost)}</div>
                        <div className="text-xs text-gray-500">{formatTokens(day.tokens)} tokens</div>
                      </div>
                    </div>
                    <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(costWidth, 2)}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{day.agents_created} created</span>
                      <span>{day.agents_run} executed</span>
                      <span>{day.activities} total</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Cost Breakdown */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
              <PieChart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Spending Analysis</h3>
              <p className="text-sm text-gray-600">Where your budget goes</p>
            </div>
          </div>
          
          {costBreakdown.length === 0 ? (
            <div className="text-center py-8">
              <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No cost data available</p>
            </div>
          ) : (
            <div className="space-y-3">
              {costBreakdown.slice(0, 5).map((item, index) => (
                <div key={index} className="group hover:bg-gray-50/50 rounded-xl p-3 transition-all duration-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${item.bgColor}`}></div>
                      <span className="text-sm font-medium text-gray-700">{item.name}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-gray-900">{formatCost(item.cost)}</div>
                      <div className="text-xs text-gray-500">{item.percentage.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className={`h-1.5 rounded-full transition-all duration-500 ${item.bgColor}`}
                      style={{ width: `${item.percentage}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Insights View
  if (selectedView === 'insights') {
    return (
      <div className="space-y-6">
        {insights.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-12 text-center">
            <Brain className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">Generating Insights</h3>
            <p className="text-gray-600">Create more agents to unlock AI-powered insights</p>
          </div>
        ) : (
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
        )}
      </div>
    );
  }

  // Activities View - Grouped by session with iteration details
if (selectedView === 'activities') {
  // Group activities by session_id
  const groupedActivities = data.rawActivities.reduce((acc, activity) => {
    const sessionKey = activity.session_id || activity.id;
    if (!acc[sessionKey]) {
      acc[sessionKey] = [];
    }
    acc[sessionKey].push(activity);
    return acc;
  }, {} as Record<string, typeof data.rawActivities>);

  // Convert to array and sort by most recent
  const allSessionGroups = Object.entries(groupedActivities)
    .map(([sessionId, activities]) => {
      const sortedActivities = activities.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      // Extract agent name and create summary of operations
      const firstActivity = sortedActivities[0].activity_name;
      const agentNameMatch = firstActivity.match(/^(.+?)\s*-\s*/);
      const agentName = agentNameMatch ? agentNameMatch[1] : firstActivity;

      // Collect unique operations (extract everything after " - ")
      const operations = sortedActivities
        .map(a => {
          const match = a.activity_name.match(/\s*-\s*(.+)$/);
          return match ? match[1] : null;
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
        totalCost: activities.reduce((sum, a) => sum + a.cost_usd, 0),
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

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1);
  const itemsPerPage = 10;
  const totalPages = Math.ceil(allSessionGroups.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const sessionGroups = allSessionGroups.slice(startIndex, endIndex);

  return (
    <div className="space-y-4">
      {/* Sticky Header */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6 sticky top-0 z-10">
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
                    <p className="text-xs text-gray-600 mt-1">{formatTokens(group.totalTokens)} tokens</p>
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
                          stepDescription = operationMatch[1];
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
                                      {formatTokens(activity.total_tokens)} tokens
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
              <span className="text-gray-600">Active ({agents.filter(a => a.isActive && !a.isArchived).length})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-400"></div>
              <span className="text-gray-600">Inactive ({agents.filter(a => !a.isActive && !a.isArchived).length})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500"></div>
              <span className="text-gray-600">Archived ({agents.filter(a => a.isArchived).length})</span>
            </div>
          </div>
        </div>
        
        {agents.length === 0 ? (
          <div className="text-center py-12">
            <Bot className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h4 className="text-lg font-bold text-gray-900 mb-2">No Agents Created Yet</h4>
            <p className="text-gray-600">Build your first workflow agent to see metrics</p>
          </div>
        ) : (
          <div className="space-y-4">
            {agents.map((agent, index) => (
              <div key={agent.id || index} className={`border rounded-xl p-4 hover:shadow-md transition-all duration-200 ${
                agent.isArchived ? 'border-amber-200/50 bg-amber-50/30' :
                agent.isActive ? 'border-gray-200/50 bg-white' : 'border-gray-300/50 bg-gray-50/50'
              }`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg relative ${
                      agent.isArchived
                        ? 'bg-gradient-to-br from-amber-400 to-amber-600'
                        : agent.isActive
                        ? 'bg-gradient-to-br from-green-500 to-emerald-600'
                        : 'bg-gradient-to-br from-gray-400 to-gray-500'
                    }`}>
                      <Bot className="w-6 h-6 text-white" />
                      {/* Active/Inactive/Archived indicator dot */}
                      <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${
                        agent.isArchived ? 'bg-amber-500' : (agent.isActive ? 'bg-green-500' : 'bg-gray-400')
                      }`}></div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-gray-900">{agent.name}</h4>
                        {/* Status Badge */}
                        {agent.isArchived ? (
                          <span className="px-2 py-0.5 bg-amber-200 text-amber-700 text-xs font-medium rounded">
                            Archived
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