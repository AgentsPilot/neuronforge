// app/(protected)/analytic/page.tsx

'use client'

import React, { useState } from 'react';
import { Bot } from 'lucide-react';
import { useAnalyticsData } from '@/lib/hooks/useAnalyticsData';
import { AnalyticsHeader } from '@/components/analytics/AnalyticHeader';
import { MetricsCards } from '@/components/analytics/MetricsCards';
import { AnalyticsViews } from '@/components/analytics/AnalyticsView';
import type { TimeFilter, AnalyticsView } from '@/types/analytics';

export default function AnalyticsPage() {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('last_30d');
  const [selectedView, setSelectedView] = useState<AnalyticsView>('overview');
  
  const { loading, processedData, error, refetch, exportData } = useAnalyticsData(timeFilter);

  // Loading State
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4">
              <Bot className="h-8 w-8 text-white animate-pulse" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Loading Analytics</h3>
            <p className="text-gray-600 text-sm">Analyzing your AI workflow data...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-gradient-to-br from-red-500 to-pink-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4">
            <Bot className="h-8 w-8 text-white" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Error Loading Data</h3>
          <p className="text-gray-600 text-sm mb-4">{error}</p>
          <button
            onClick={refetch}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // No Data State
  if (!processedData || processedData.metrics.totalActivities === 0) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <AnalyticsHeader
          timeFilter={timeFilter}
          selectedView={selectedView}
          onTimeFilterChange={setTimeFilter}
          onViewChange={setSelectedView}
          onRefresh={refetch}
          onExport={exportData}
          hasData={false}
        />

        {/* Empty State */}
        <div className="text-center py-16 bg-gray-50/80 backdrop-blur-sm rounded-2xl border border-gray-200/50">
          <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Ready to Start</h3>
          <p className="text-gray-600 max-w-md mx-auto">
            Create your first workflow agent to unlock powerful AI analytics
          </p>
        </div>
      </div>
    );
  }

  // Main Analytics Dashboard
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header with Controls */}
      <AnalyticsHeader
        timeFilter={timeFilter}
        selectedView={selectedView}
        onTimeFilterChange={setTimeFilter}
        onViewChange={setSelectedView}
        onRefresh={refetch}
        onExport={exportData}
        hasData={true}
      />

      {/* Key Metrics Cards */}
      <MetricsCards metrics={processedData.metrics} />

      {/* Main Content Views */}
      <AnalyticsViews selectedView={selectedView} data={processedData} />
    </div>
  );
}