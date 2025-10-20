// components/analytics/MetricsCards.tsx

import React from 'react';
import { 
  DollarSign, 
  Zap, 
  Activity, 
  Timer, 
  CheckCircle, 
  ArrowUp, 
  ArrowDown 
} from 'lucide-react';
import { formatCost, formatTokens, formatTime } from '@/lib/utils/analyticsHelpers';
import type { AnalyticsMetrics } from '@/types/analytics';

interface MetricsCardsProps {
  metrics: AnalyticsMetrics;
}

export const MetricsCards: React.FC<MetricsCardsProps> = ({ metrics }) => {
  const {
    totalCost,
    totalTokens,
    totalActivities,
    avgResponseTime,
    overallSuccessRate,
    costTrend,
    usageTrend
  } = metrics;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {/* AI Investment */}
      <div className="lg:col-span-1 bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
            <DollarSign className="h-6 w-6 text-white" />
          </div>
          <div>
            <p className="text-xs text-gray-600 font-medium mb-1">AI Investment</p>
            <p className="text-xl font-bold text-gray-900">{formatCost(totalCost)}</p>
            <div className="flex items-center gap-1">
              {costTrend === 'up' ? (
                <ArrowUp className="w-3 h-3 text-red-500" />
              ) : costTrend === 'down' ? (
                <ArrowDown className="w-3 h-3 text-green-500" />
              ) : null}
              <span className="text-xs text-gray-500">vs previous</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tokens */}
      <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
        <div className="text-center">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-lg">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <p className="text-xs text-gray-600 font-medium mb-1">Tokens</p>
          <p className="text-lg font-bold text-gray-900">{formatTokens(totalTokens)}</p>
        </div>
      </div>

      {/* Operations */}
      <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
        <div className="text-center">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-lg">
            <Activity className="h-5 w-5 text-white" />
          </div>
          <p className="text-xs text-gray-600 font-medium mb-1">Operations</p>
          <p className="text-lg font-bold text-gray-900">{totalActivities}</p>
        </div>
      </div>

      {/* Speed */}
      <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
        <div className="text-center">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-lg">
            <Timer className="h-5 w-5 text-white" />
          </div>
          <p className="text-xs text-gray-600 font-medium mb-1">Speed</p>
          <p className="text-lg font-bold text-gray-900">{formatTime(avgResponseTime)}</p>
        </div>
      </div>

      {/* Success Rate */}
      <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
        <div className="text-center">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-lg">
            <CheckCircle className="h-5 w-5 text-white" />
          </div>
          <p className="text-xs text-gray-600 font-medium mb-1">Success</p>
          <p className="text-lg font-bold text-gray-900">{overallSuccessRate.toFixed(1)}%</p>
        </div>
      </div>
    </div>
  );
};