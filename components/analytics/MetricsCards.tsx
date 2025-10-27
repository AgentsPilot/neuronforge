// components/analytics/MetricsCards.tsx

import React from 'react';
import {
  DollarSign,
  Zap,
  Activity,
  Timer,
  CheckCircle,
  Bot,
  TrendingUp,
  BarChart3,
  Target,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { formatCost, formatTokens, formatTime } from '@/lib/utils/analyticsHelpers';
import type { ProcessedAnalyticsData } from '@/types/analytics';

interface MetricsCardsProps {
  data: ProcessedAnalyticsData;
  onViewChange: (view: 'overview' | 'insights' | 'activities' | 'agents', activityFilter?: string) => void;
}

export const MetricsCards: React.FC<MetricsCardsProps> = ({ data, onViewChange }) => {
  const { metrics, agents, activities, costBreakdown } = data;

  // Count real agents (exclude system operations)
  const realAgents = agents.filter(a =>
    a.agentName &&
    a.agentName !== 'System Operation' &&
    !a.agentName.startsWith('Agent ')
  );

  const activeAgents = realAgents.filter(a => a.isActive && !a.isArchived).length;
  const totalAgents = realAgents.length;

  // Calculate cost of agent creation (not count)
  const agentCreationCost = data.rawActivities?.filter(activity =>
    activity.activity_type === 'agent_creation' || activity.activity_type === 'agent_generation'
  ).reduce((sum, activity) => sum + (activity.cost_usd || 0), 0) || 0;

  // Calculate cost of agent executions (not count)
  const agentExecutionCost = data.rawActivities?.filter(activity =>
    activity.activity_type === 'agent_execution'
  ).reduce((sum, activity) => sum + (activity.cost_usd || 0), 0) || 0;

  // Top activity type by cost - just use percentage, not count (count is unreliable due to name matching)
  const topActivity = costBreakdown[0];

  return (
    <div className="space-y-4">
      {/* ROW 1: CORE METRICS - High-level KPIs */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Core Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* AI Investment */}
          <button
            onClick={() => onViewChange('activities')}
            className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200/50 rounded-xl p-3 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <DollarSign className="w-4 h-4 text-white" />
              </div>
              <ChevronRight className="w-4 h-4 text-emerald-400" />
            </div>
            <h3 className="text-xl font-bold text-emerald-900 mb-1">{formatCost(metrics.totalCost)}</h3>
            <p className="text-xs text-emerald-700 font-medium">AI Investment</p>
          </button>

          {/* Total Operations */}
          <button
            onClick={() => onViewChange('activities')}
            className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-xl p-3 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <Activity className="w-4 h-4 text-white" />
              </div>
              <ChevronRight className="w-4 h-4 text-purple-400" />
            </div>
            <h3 className="text-xl font-bold text-purple-900 mb-1">{metrics.totalActivities}</h3>
            <p className="text-xs text-purple-700 font-medium">Operations</p>
          </button>

          {/* Tokens Processed */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-3 transition-all duration-200">
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                Metric
              </span>
            </div>
            <h3 className="text-xl font-bold text-blue-900 mb-1">{formatTokens(metrics.totalTokens)}</h3>
            <p className="text-xs text-blue-700 font-medium">Tokens</p>
          </div>

          {/* Average Speed */}
          <div className="bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200/50 rounded-xl p-3 transition-all duration-200">
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <Timer className="w-4 h-4 text-white" />
              </div>
              <span className="text-xs font-semibold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                Avg
              </span>
            </div>
            <h3 className="text-xl font-bold text-orange-900 mb-1">{formatTime(metrics.avgResponseTime)}</h3>
            <p className="text-xs text-orange-700 font-medium">Speed</p>
          </div>

          {/* Success Rate */}
          <div className="bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-200/50 rounded-xl p-3 transition-all duration-200">
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <CheckCircle className="w-4 h-4 text-white" />
              </div>
              <span className="text-xs font-semibold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full">
                Rate
              </span>
            </div>
            <h3 className="text-xl font-bold text-teal-900 mb-1">{metrics.overallSuccessRate.toFixed(1)}%</h3>
            <p className="text-xs text-teal-700 font-medium">Success</p>
          </div>
        </div>
      </div>

      {/* ROW 2: AGENT METRICS - Creation & Execution */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Agent Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Total Agents */}
          <button
            onClick={() => onViewChange('agents')}
            className="bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-200/50 rounded-xl p-3 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <ChevronRight className="w-4 h-4 text-cyan-400" />
            </div>
            <h3 className="text-xl font-bold text-cyan-900 mb-1">{totalAgents}</h3>
            <p className="text-xs text-cyan-700 font-medium">Total Agents</p>
          </button>

          {/* Active Agents */}
          <button
            onClick={() => onViewChange('agents')}
            className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200/50 rounded-xl p-3 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <TrendingUp className="w-4 h-4 text-white" />
              </div>
              <div className="flex items-center gap-2">
                {totalAgents > 0 && (
                  <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                    {((activeAgents / totalAgents) * 100).toFixed(0)}%
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-green-400" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-green-900 mb-1">{activeAgents}</h3>
            <p className="text-xs text-green-700 font-medium">Active Agents</p>
          </button>

          {/* Agent Creation Cost */}
          <button
            onClick={() => onViewChange('activities', 'agent_creation')}
            className="bg-gradient-to-br from-purple-50 to-fuchsia-50 border border-purple-200/50 rounded-xl p-3 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-fuchsia-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <ChevronRight className="w-4 h-4 text-purple-400" />
            </div>
            <h3 className="text-xl font-bold text-purple-900 mb-1">{formatCost(agentCreationCost)}</h3>
            <p className="text-xs text-purple-700 font-medium">Creation Cost</p>
          </button>

          {/* Agent Execution Cost */}
          <button
            onClick={() => onViewChange('activities', 'agent_execution')}
            className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200/50 rounded-xl p-3 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <ChevronRight className="w-4 h-4 text-indigo-400" />
            </div>
            <h3 className="text-xl font-bold text-indigo-900 mb-1">{formatCost(agentExecutionCost)}</h3>
            <p className="text-xs text-indigo-700 font-medium">Execution Cost</p>
          </button>

          {/* Activity Types */}
          <button
            onClick={() => onViewChange('activities')}
            className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200/50 rounded-xl p-3 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <BarChart3 className="w-4 h-4 text-white" />
              </div>
              <ChevronRight className="w-4 h-4 text-violet-400" />
            </div>
            <h3 className="text-xl font-bold text-violet-900 mb-1">{activities.length}</h3>
            <p className="text-xs text-violet-700 font-medium">Activity Types</p>
          </button>
        </div>
      </div>
    </div>
  );
};