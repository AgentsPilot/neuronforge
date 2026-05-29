/**
 * Business Metrics Dashboard Component
 *
 * Displays aggregated business metrics with clickable cards:
 * - Volume Trends (time-series chart)
 * - Performance Metrics (avg duration, failure rate, success rate)
 * - ROI Summary (time saved, cost saved, items automated)
 * - Health Score (0-10 gauge)
 *
 * Cards are clickable and lead to detailed insights categorized as:
 * 1. System Alerts (critical/high severity issues)
 * 2. Technical Insights (performance, reliability, cost optimization)
 * 3. Business Insights (volume trends, ROI, automation opportunities)
 *
 * @module components/v2/metrics/BusinessMetricsDashboard
 */

'use client';

import React, { useEffect, useState, memo, useMemo, useCallback } from 'react';
import { Card } from '@/components/v2/ui/card';
import { InlineLoading } from '@/components/v2/ui/loading';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  Activity,
  AlertCircle,
  BarChart3,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Play,
  Calendar,
} from 'lucide-react';
import { BusinessMetricsResponse, TimeRange } from '@/lib/services/MetricsAggregationService';

interface BusinessMetricsDashboardProps {
  agentId: string;
  onNavigateToInsights?: (category?: 'system' | 'technical' | 'business') => void;
  categoryFilter?: 'all' | 'system' | 'technical' | 'business'; // Filter from insights panel
}

const BusinessMetricsDashboardComponent = ({
  agentId,
  onNavigateToInsights,
  categoryFilter = 'all',
}: BusinessMetricsDashboardProps) => {
  const [metrics, setMetrics] = useState<BusinessMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [showTimeRangeDropdown, setShowTimeRangeDropdown] = useState(false);

  const fetchMetrics = useCallback(async (isInitialLoad = false) => {
    try {
      // Only show full loading on initial load, use refreshing state for updates
      if (isInitialLoad) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      const response = await fetch(
        `/api/v6/agents/${agentId}/business-metrics?range=${timeRange}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch business metrics');
      }

      const data = await response.json();
      setMetrics(data.data);
    } catch (err) {
      console.error('[BusinessMetricsDashboard] Failed to fetch metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agentId, timeRange]);

  useEffect(() => {
    // Only treat as initial load if we don't have metrics yet
    fetchMetrics(!metrics);
  }, [agentId, timeRange]);

  // Dynamic title based on category filter - memoized
  const title = useMemo(() => {
    switch (categoryFilter) {
      case 'all':
        return 'All Metrics';
      case 'system':
        return 'System Metrics';
      case 'technical':
        return 'Technical Metrics';
      case 'business':
        return 'Business Metrics';
      default:
        return 'All Metrics';
    }
  }, [categoryFilter]);

  // Determine which cards to show based on filter - memoized
  const shouldShowCard = useCallback((cardType: 'system' | 'technical' | 'business') => {
    if (categoryFilter === 'all') return true;
    return categoryFilter === cardType;
  }, [categoryFilter]);

  const formatNumber = useCallback((num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toFixed(0);
  }, []);

  const formatDuration = useCallback((ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }, []);

  const getTrendIcon = useCallback((change: number) => {
    if (change > 0) return <TrendingUp className="w-4 h-4" />;
    if (change < 0) return <TrendingDown className="w-4 h-4" />;
    return <Activity className="w-4 h-4" />;
  }, []);

  const getTrendColor = useCallback((change: number, isDesirable: boolean = true) => {
    if (change === 0) return 'text-gray-600 dark:text-gray-400';
    const positive = isDesirable ? change > 0 : change < 0;
    return positive
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';
  }, []);

  if (loading) {
    return (
      <div className="py-12">
        <InlineLoading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        <button
          onClick={fetchMetrics}
          className="mt-2 flex items-center gap-2 text-xs text-red-700 dark:text-red-400 hover:underline"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="w-12 h-12 text-[var(--v2-text-muted)] mx-auto mb-3 opacity-50" />
        <p className="text-sm text-[var(--v2-text-muted)]">
          No metrics available yet.
        </p>
        <p className="text-xs text-[var(--v2-text-muted)] mt-1">
          Run your agent a few times to generate business metrics.
        </p>
      </div>
    );
  }

  const isDesirable = metrics.entity_desirability === 'desirable';
  const volumeChange = metrics.volume_trend.change_percentage;

  return (
    <Card className="!p-4 h-full">
      <div className="space-y-6 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
              {title}
            </h3>
            {metrics.entity_type && (
              <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                Tracking {metrics.entity_type} automation
              </p>
            )}
          </div>

          {/* Time Range Selector - Dropdown */}
          <div className="relative flex items-center gap-2">
            {refreshing && (
              <RefreshCw className="w-3 h-3 text-[var(--v2-primary)] animate-spin" />
            )}
            <button
              onClick={() => setShowTimeRangeDropdown(!showTimeRangeDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] text-xs text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition-colors"
              disabled={refreshing}
            >
              {timeRange === '24h' ? 'Last 24 hours' : timeRange === '7d' ? 'Last 7 days' : timeRange === '30d' ? 'Last 30 days' : timeRange === '90d' ? 'Last 90 days' : 'All time'}
              <ChevronDown className="w-3 h-3" />
            </button>

            {showTimeRangeDropdown && (
              <div className="absolute right-0 top-full mt-1 py-0.5 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-10 min-w-[140px]">
                {(['24h', '7d', '30d', '90d', 'all'] as TimeRange[]).map((range) => (
                  <button
                    key={range}
                    onClick={() => {
                      setTimeRange(range);
                      setShowTimeRangeDropdown(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--v2-surface-hover)] transition-colors ${
                      range === timeRange ? 'text-[var(--v2-primary)] font-medium' : 'text-[var(--v2-text-primary)]'
                    }`}
                  >
                    {range === '24h' ? 'Last 24 hours' : range === '7d' ? 'Last 7 days' : range === '30d' ? 'Last 30 days' : range === '90d' ? 'Last 90 days' : 'All time'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Metrics Grid - 2 Columns Layout */}
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-300 ${refreshing ? 'opacity-60' : 'opacity-100'}`}>
        {/* Total Executions Card - TECHNICAL */}
        {shouldShowCard('technical') && (
          <Card
            className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 cursor-pointer hover:shadow-md transition-all duration-200"
            onClick={() => onNavigateToInsights?.('technical')}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                <Play className="w-5 h-5 text-indigo-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--v2-text-muted)]">Total Executions</div>
                <div className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {metrics.total_executions_all_time || 0}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)]" />
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {metrics.execution_count} in selected period
            </div>
          </Card>
        )}

        {/* Time Period Card - TECHNICAL */}
        {shouldShowCard('technical') && (
          <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-cyan-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--v2-text-muted)]">Time Period</div>
                <div className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {metrics.time_range.days === 1 ? '24 hours' : `${metrics.time_range.days} days`}
                </div>
              </div>
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {new Date(metrics.time_range.start).toLocaleDateString()} - {new Date(metrics.time_range.end).toLocaleDateString()}
            </div>
          </Card>
        )}

        {/* Volume Trend Card - BUSINESS */}
        {shouldShowCard('business') && (
          <Card
            className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 cursor-pointer hover:shadow-md transition-all duration-200"
            onClick={() => onNavigateToInsights?.('business')}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <BarChart3 className="w-5 h-5 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--v2-text-muted)]">{metrics.entity_type || 'Items'} Processed</div>
                <div className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {formatNumber(metrics.volume_trend.current_period)}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)]" />
            </div>
            <div className="space-y-0.5">
              <div className={`flex items-center gap-1 text-xs font-medium ${getTrendColor(volumeChange, isDesirable)}`}>
                {getTrendIcon(volumeChange)}
                <span>
                  {volumeChange > 0 ? '+' : ''}
                  {volumeChange.toFixed(1)}% vs previous
                </span>
              </div>
            </div>
          </Card>
        )}

        {/* Performance Card - TECHNICAL */}
        {shouldShowCard('technical') && (
          <Card
            className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 cursor-pointer hover:shadow-md transition-all duration-200"
            onClick={() => onNavigateToInsights?.('technical')}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-purple-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--v2-text-muted)]">Avg Duration</div>
                <div className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {formatDuration(metrics.performance_metrics.avg_duration_ms)}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)]" />
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {(metrics.performance_metrics.success_rate * 100).toFixed(1)}% success rate
            </div>
          </Card>
        )}

        {/* ROI Card - BUSINESS */}
        {shouldShowCard('business') && (
          <Card
            className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 cursor-pointer hover:shadow-md transition-all duration-200"
            onClick={() => onNavigateToInsights?.('business')}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <DollarSign className="w-5 h-5 text-emerald-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--v2-text-muted)]">Cost Saved</div>
                <div className="text-lg font-semibold text-emerald-500">
                  ${formatNumber(metrics.roi_metrics.total_cost_saved_usd)}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)]" />
            </div>
            <div className="text-xs text-[var(--v2-text-muted)] space-y-0.5">
              <div>{metrics.roi_metrics.total_time_saved_hours.toFixed(1)} hours saved</div>
              {metrics.manual_time_per_item_seconds ? (
                <div className="text-[10px] opacity-70">
                  {formatNumber(metrics.roi_metrics.items_automated_count)} items × {metrics.manual_time_per_item_seconds}s = {(metrics.roi_metrics.items_automated_count * metrics.manual_time_per_item_seconds / 3600).toFixed(1)}h
                </div>
              ) : (
                <div className="text-[10px] opacity-70">
                  {formatNumber(metrics.roi_metrics.items_automated_count)} items processed
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Health Score Card - SYSTEM */}
        {shouldShowCard('system') && (
          <Card
            className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 cursor-pointer hover:shadow-md transition-all duration-200"
            onClick={() => {
              // Navigate to system alerts if health score is low
              const category = metrics.health_score < 6 ? 'system' : 'technical';
              onNavigateToInsights?.(category);
            }}
          >
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
              metrics.health_score >= 8
                ? 'bg-green-500/10'
                : metrics.health_score >= 6
                ? 'bg-blue-500/10'
                : metrics.health_score >= 4
                ? 'bg-yellow-500/10'
                : 'bg-red-500/10'
            }`}>
              {metrics.health_score < 6 ? (
                <AlertCircle className={`w-5 h-5 ${
                  metrics.health_score >= 4 ? 'text-yellow-500' : 'text-red-500'
                }`} />
              ) : (
                <Activity className={`w-5 h-5 ${
                  metrics.health_score >= 8 ? 'text-green-500' : 'text-blue-500'
                }`} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[var(--v2-text-muted)]">Health Score</div>
              <div className={`text-lg font-semibold ${
                metrics.health_score >= 8
                  ? 'text-green-500'
                  : metrics.health_score >= 6
                  ? 'text-blue-500'
                  : metrics.health_score >= 4
                  ? 'text-yellow-500'
                  : 'text-red-500'
              }`}>
                {metrics.health_score.toFixed(1)}/10
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)]" />
          </div>
          <div className="text-xs text-[var(--v2-text-muted)]">
            {metrics.health_score >= 8
              ? 'Excellent performance'
              : metrics.health_score >= 6
              ? 'Good performance'
              : metrics.health_score >= 4
              ? 'Needs attention'
              : 'Critical issues detected'
            }
            </div>
          </Card>
        )}
        </div>

        {/* Summary Section */}
        <div className={`p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg transition-opacity duration-300 ${refreshing ? 'opacity-60' : 'opacity-100'}`}>
        <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
          Period Summary ({metrics.time_range.days} days)
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Items Automated</div>
            <div className="font-semibold text-[var(--v2-text-primary)]">
              {formatNumber(metrics.roi_metrics.items_automated_count)}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Failure Rate</div>
            <div className={`font-semibold ${
              metrics.performance_metrics.failure_rate === 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : metrics.performance_metrics.failure_rate < 0.1
                ? 'text-blue-600 dark:text-blue-400'
                : metrics.performance_metrics.failure_rate < 0.3
                ? 'text-orange-600 dark:text-orange-400'
                : 'text-red-600 dark:text-red-400'
            }`}>
              {(metrics.performance_metrics.failure_rate * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--v2-text-muted)] mb-1">Empty Results</div>
            <div className={`font-semibold ${
              metrics.performance_metrics.empty_result_rate === 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : metrics.performance_metrics.empty_result_rate < 0.1
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-orange-600 dark:text-orange-400'
            }`}>
              {(metrics.performance_metrics.empty_result_rate * 100).toFixed(1)}%
            </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

BusinessMetricsDashboardComponent.displayName = 'BusinessMetricsDashboard';

export const BusinessMetricsDashboard = memo(BusinessMetricsDashboardComponent, (prevProps, nextProps) => {
  // Only re-render if agentId or categoryFilter changes
  // Time range changes are handled internally via state
  return prevProps.agentId === nextProps.agentId &&
         prevProps.categoryFilter === nextProps.categoryFilter;
});
