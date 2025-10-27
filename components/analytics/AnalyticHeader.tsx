// components/analytics/AnalyticHeader.tsx

import React from 'react';
import {
  Bot,
  RefreshCw,
  Download,
  BarChart3,
  Activity,
  Brain
} from 'lucide-react';
import { getTimeFilterLabel } from '@/lib/utils/analyticsHelpers';
import type { TimeFilter, AnalyticsView } from '@/types/analytics';

interface AnalyticsHeaderProps {
  timeFilter: TimeFilter;
  selectedView: AnalyticsView;
  onTimeFilterChange: (filter: TimeFilter) => void;
  onViewChange: (view: AnalyticsView) => void;
  onRefresh: () => void;
  onExport: () => void;
  hasData: boolean;
}

export const AnalyticsHeader: React.FC<AnalyticsHeaderProps> = ({
  timeFilter,
  selectedView,
  onTimeFilterChange,
  onViewChange,
  onRefresh,
  onExport,
  hasData
}) => {
  const handleTimeFilterChange = (filter: TimeFilter) => {
    console.log(`📊 Analytics Time Filter Changed: ${timeFilter} → ${filter}`);
    onTimeFilterChange(filter);
  };

  return (
    <>
      {/* Header */}
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
          AI Workflow Analytics
        </h1>
        <p className="text-gray-600 mt-2">
          Your automation insights for the {getTimeFilterLabel(timeFilter)}
        </p>
      </div>

      {/* Controls - Sticky */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md rounded-2xl border border-gray-200/50 shadow-lg p-6 -mx-6 px-12">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Time Filter Buttons */}
            <div className="flex bg-white/90 backdrop-blur-sm border border-gray-200/60 rounded-xl p-1 shadow-sm">
              {[
                { value: 'last_24h' as TimeFilter, label: '24h' },
                { value: 'last_7d' as TimeFilter, label: '7d' },
                { value: 'last_30d' as TimeFilter, label: '30d' },
                { value: 'last_90d' as TimeFilter, label: '90d' }
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleTimeFilterChange(option.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    timeFilter === option.value
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* View Navigation */}
            {hasData && (
              <div className="flex bg-gray-100/80 rounded-xl p-1">
                {[
                  { key: 'overview', label: 'Overview', icon: BarChart3 },
                  { key: 'insights', label: 'Insights', icon: Brain },
                  { key: 'activities', label: 'Activities', icon: Activity },
                  { key: 'agents', label: 'Agents', icon: Bot }
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => onViewChange(key as AnalyticsView)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      selectedView === key
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={onRefresh}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-300 text-sm font-medium shadow-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            
            {hasData && (
              <button
                onClick={onExport}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all duration-300 text-sm font-medium bg-white/80"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};