// app/(protected)/analytic/page.tsx

'use client'

import React, { useState, useEffect } from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { useAnalyticsData } from '@/lib/hooks/useAnalyticsData';
import { AnalyticsHeader } from '@/components/analytics/AnalyticHeader';
import { MetricsCards } from '@/components/analytics/MetricsCards';
import { AnalyticsViews } from '@/components/analytics/AnalyticsView';
import type { TimeFilter, AnalyticsView } from '@/types/analytics';

export default function AnalyticsPage() {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('last_30d');
  const [selectedView, setSelectedView] = useState<AnalyticsView>('overview');
  const [activityFilter, setActivityFilter] = useState<string | undefined>(undefined);

  const { loading, processedData, error, refetch, exportData } = useAnalyticsData(timeFilter);

  // Handler for view change with optional activity filter
  const handleViewChange = (view: AnalyticsView, filter?: string) => {
    setSelectedView(view);
    setActivityFilter(filter);
  };

  // Clear activity filter when changing time filter or switching away from activities view
  React.useEffect(() => {
    if (selectedView !== 'activities') {
      setActivityFilter(undefined);
    }
  }, [selectedView, timeFilter]);

  // Main Analytics Dashboard - Always show header
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header with Controls - Always visible */}
      <AnalyticsHeader
        timeFilter={timeFilter}
        selectedView={selectedView}
        onTimeFilterChange={setTimeFilter}
        onViewChange={(view) => handleViewChange(view)}
        onRefresh={refetch}
        onExport={exportData}
        hasData={!loading && !error && !!processedData && processedData.metrics.totalActivities > 0}
      />

      {/* Loading State */}
      {loading && (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-sm p-12 text-center">
          <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading analytics data...</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-red-200/50 shadow-sm p-12 text-center">
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
      )}

      {/* No Data State */}
      {!loading && !error && (!processedData || processedData.metrics.totalActivities === 0) && (
        <div className="text-center py-16 bg-gray-50/80 backdrop-blur-sm rounded-2xl border border-gray-200/50">
          <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Ready to Start</h3>
          <p className="text-gray-600 max-w-md mx-auto">
            Create your first workflow agent to unlock powerful AI analytics
          </p>
        </div>
      )}

      {/* Main Content - Only show when data is loaded */}
      {!loading && !error && processedData && processedData.metrics.totalActivities > 0 && (
        <>
          {/* Key Metrics Cards - Only show in overview */}
          {selectedView === 'overview' && (
            <MetricsCards data={processedData} onViewChange={handleViewChange} />
          )}

          {/* Main Content Views */}
          <AnalyticsViews selectedView={selectedView} data={processedData} activityFilter={activityFilter} />
        </>
      )}
    </div>
  );
}