/**
 * Insights List Component
 *
 * Lists multiple insights with filtering and sorting options
 */

'use client';

import React, { useState, useEffect } from 'react';
import { InsightCard } from './InsightCard';
import { ExecutionInsight } from '@/lib/pilot/insight/types';
import { Filter, SortDesc, ChevronDown } from 'lucide-react';

interface InsightsListProps {
  insights: ExecutionInsight[];
  onDismiss?: (id: string) => void;
  onSnooze?: (id: string, days: number) => void;
  onApply?: (id: string) => void;
  showFilters?: boolean;
  compact?: boolean;
}

export function InsightsList({
  insights,
  onDismiss,
  onSnooze,
  onApply,
  showFilters = true,
  compact = false,
}: InsightsListProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'severity'>('severity');
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showSeverityMenu, setShowSeverityMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.category-dropdown')) setShowCategoryMenu(false);
      if (!target.closest('.severity-dropdown')) setShowSeverityMenu(false);
      if (!target.closest('.sort-dropdown')) setShowSortMenu(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter insights
  let filteredInsights = insights;

  if (categoryFilter !== 'all') {
    filteredInsights = filteredInsights.filter((i) => i.category === categoryFilter);
  }

  if (severityFilter !== 'all') {
    filteredInsights = filteredInsights.filter((i) => i.severity === severityFilter);
  }

  // Sort insights
  const sortedInsights = [...filteredInsights].sort((a, b) => {
    if (sortBy === 'severity') {
      const severityOrder: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      return severityOrder[a.severity] - severityOrder[b.severity];
    } else {
      // Sort by date (newest first)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
  });

  if (insights.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--v2-text-muted)]">No insights available yet.</p>
        <p className="text-xs text-[var(--v2-text-muted)] mt-1">
          Insights will appear as your agent runs in production.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      {showFilters && (
        <div className="flex items-center gap-3 flex-wrap">
          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--v2-text-muted)]" />
            <div className="relative category-dropdown">
              <button
                onClick={() => setShowCategoryMenu(!showCategoryMenu)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {categoryFilter === 'all' && 'All Categories'}
                {categoryFilter === 'data_quality' && 'Data Quality'}
                {categoryFilter === 'growth' && 'Growth'}
                <ChevronDown className="w-3 h-3" />
              </button>

              {showCategoryMenu && (
                <div className="absolute top-full mt-1 left-0 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-10 min-w-[160px]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <button
                    onClick={() => { setCategoryFilter('all'); setShowCategoryMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                      categoryFilter === 'all'
                        ? 'bg-[var(--v2-primary)] text-white'
                        : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                    }`}
                  >
                    All Categories
                  </button>
                  <button
                    onClick={() => { setCategoryFilter('data_quality'); setShowCategoryMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                      categoryFilter === 'data_quality'
                        ? 'bg-[var(--v2-primary)] text-white'
                        : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                    }`}
                  >
                    Data Quality
                  </button>
                  <button
                    onClick={() => { setCategoryFilter('growth'); setShowCategoryMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                      categoryFilter === 'growth'
                        ? 'bg-[var(--v2-primary)] text-white'
                        : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                    }`}
                  >
                    Growth
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Severity Filter */}
          <div className="relative severity-dropdown">
            <button
              onClick={() => setShowSeverityMenu(!showSeverityMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {severityFilter === 'all' && 'All Severities'}
              {severityFilter === 'critical' && 'Critical'}
              {severityFilter === 'high' && 'High'}
              {severityFilter === 'medium' && 'Medium'}
              {severityFilter === 'low' && 'Low'}
              <ChevronDown className="w-3 h-3" />
            </button>

            {showSeverityMenu && (
              <div className="absolute top-full mt-1 left-0 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-10 min-w-[160px]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <button
                  onClick={() => { setSeverityFilter('all'); setShowSeverityMenu(false); }}
                  className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                    severityFilter === 'all'
                      ? 'bg-[var(--v2-primary)] text-white'
                      : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  All Severities
                </button>
                <button
                  onClick={() => { setSeverityFilter('critical'); setShowSeverityMenu(false); }}
                  className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                    severityFilter === 'critical'
                      ? 'bg-[var(--v2-primary)] text-white'
                      : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  Critical
                </button>
                <button
                  onClick={() => { setSeverityFilter('high'); setShowSeverityMenu(false); }}
                  className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                    severityFilter === 'high'
                      ? 'bg-[var(--v2-primary)] text-white'
                      : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  High
                </button>
                <button
                  onClick={() => { setSeverityFilter('medium'); setShowSeverityMenu(false); }}
                  className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                    severityFilter === 'medium'
                      ? 'bg-[var(--v2-primary)] text-white'
                      : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  Medium
                </button>
                <button
                  onClick={() => { setSeverityFilter('low'); setShowSeverityMenu(false); }}
                  className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                    severityFilter === 'low'
                      ? 'bg-[var(--v2-primary)] text-white'
                      : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  Low
                </button>
              </div>
            )}
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2 ml-auto">
            <SortDesc className="w-4 h-4 text-[var(--v2-text-muted)]" />
            <div className="relative sort-dropdown">
              <button
                onClick={() => setShowSortMenu(!showSortMenu)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-gray-200 dark:border-slate-700 transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {sortBy === 'severity' && 'Sort by Severity'}
                {sortBy === 'date' && 'Sort by Date'}
                <ChevronDown className="w-3 h-3" />
              </button>

              {showSortMenu && (
                <div className="absolute top-full mt-1 right-0 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-10 min-w-[160px]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <button
                    onClick={() => { setSortBy('severity'); setShowSortMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                      sortBy === 'severity'
                        ? 'bg-[var(--v2-primary)] text-white'
                        : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                    }`}
                  >
                    Sort by Severity
                  </button>
                  <button
                    onClick={() => { setSortBy('date'); setShowSortMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                      sortBy === 'date'
                        ? 'bg-[var(--v2-primary)] text-white'
                        : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                    }`}
                  >
                    Sort by Date
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results count */}
      <p className="text-xs text-[var(--v2-text-muted)]">
        Showing {sortedInsights.length} of {insights.length} insights
      </p>

      {/* Insights */}
      {sortedInsights.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-[var(--v2-text-muted)]">
            No insights match your filters.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedInsights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onDismiss={onDismiss}
              onSnooze={onSnooze}
              onApply={onApply}
              compact={compact}
            />
          ))}
        </div>
      )}
    </div>
  );
}
