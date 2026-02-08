/**
 * Insights Panel Component
 *
 * Full panel for displaying insights on agent detail page or execution results
 * Fetches insights from API and handles actions
 */

'use client';

import React, { useEffect, useState } from 'react';
import { InsightsList } from './InsightsList';
import { ExecutionInsight } from '@/lib/pilot/insight/types';
import { Lightbulb, RefreshCw } from 'lucide-react';
import { InlineLoading } from '@/components/v2/ui/loading';

interface InsightsPanelProps {
  agentId: string;
  executionId?: string; // Optional: filter by specific execution
  compact?: boolean;
}

export function InsightsPanel({ agentId, executionId, compact = false }: InsightsPanelProps) {
  const [insights, setInsights] = useState<ExecutionInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [insightsEnabled, setInsightsEnabled] = useState<boolean>(false);
  const [toggleLoading, setToggleLoading] = useState(false);

  useEffect(() => {
    fetchInsightsEnabled();
    fetchInsights();
  }, [agentId, executionId]);

  const fetchInsightsEnabled = async () => {
    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch agent');
      }

      const data = await response.json();
      setInsightsEnabled(data.agent?.insights_enabled || false);
    } catch (err) {
      console.error('[InsightsPanel] Failed to fetch insights enabled status:', err);
    }
  };

  const fetchInsights = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        agentId,
        status: 'new', // Only show unresolved insights
      });

      const response = await fetch(`/api/v6/insights?${params}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch insights');
      }

      const data = await response.json();
      let fetchedInsights = data.data || [];

      // Filter by execution if specified
      if (executionId) {
        fetchedInsights = fetchedInsights.filter((insight: ExecutionInsight) =>
          insight.execution_ids.includes(executionId)
        );
      }

      setInsights(fetchedInsights);
    } catch (err) {
      console.error('[InsightsPanel] Failed to fetch insights:', err);
      setError(err instanceof Error ? err.message : 'Failed to load insights');
    } finally {
      setLoading(false);
    }
  };

  const toggleInsights = async () => {
    try {
      setToggleLoading(true);

      const response = await fetch(`/api/agents/${agentId}/insights`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          insights_enabled: !insightsEnabled,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update insights setting');
      }

      setInsightsEnabled(!insightsEnabled);
    } catch (err) {
      console.error('[InsightsPanel] Failed to toggle insights:', err);
      alert('Failed to update insights setting. Please try again.');
    } finally {
      setToggleLoading(false);
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      const response = await fetch(`/api/v6/insights/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'dismissed' }),
      });

      if (!response.ok) {
        throw new Error('Failed to dismiss insight');
      }

      // Remove from list
      setInsights((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error('[InsightsPanel] Failed to dismiss insight:', err);
      alert('Failed to dismiss insight. Please try again.');
    }
  };

  const handleSnooze = async (id: string, days: number) => {
    try {
      const response = await fetch(`/api/v6/insights/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ snooze_days: days }),
      });

      if (!response.ok) {
        throw new Error('Failed to snooze insight');
      }

      // Remove from list (will reappear after snooze period)
      setInsights((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error('[InsightsPanel] Failed to snooze insight:', err);
      alert('Failed to snooze insight. Please try again.');
    }
  };

  const handleApply = async (id: string) => {
    try {
      const response = await fetch(`/api/v6/insights/${id}/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to apply insight');
      }

      // Update status in list
      setInsights((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: 'applied' as const } : i))
      );

      alert('Recommendation applied successfully!');
    } catch (err) {
      console.error('[InsightsPanel] Failed to apply insight:', err);
      alert('Failed to apply recommendation. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="py-8">
        <InlineLoading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        <button
          onClick={fetchInsights}
          className="mt-2 flex items-center gap-2 text-xs text-red-700 dark:text-red-400 hover:underline"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-[var(--v2-primary)]" />
          <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
            Business Insights
          </h3>
          {insights.length > 0 && (
            <span className="text-xs px-2 py-0.5 bg-[var(--v2-primary)] text-white rounded-full font-medium">
              {insights.length}
            </span>
          )}
        </div>

        <button
          onClick={fetchInsights}
          className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Insights Toggle */}
      <div className="mb-4 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                AI-Powered Insights
              </h4>
              {insightsEnabled && (
                <span className="text-xs px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full font-medium">
                  Enabled
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed">
              {insightsEnabled
                ? 'Your agent will analyze execution patterns and generate business insights to help improve reliability, reduce costs, and identify opportunities.'
                : 'Enable insights to get AI-powered recommendations based on your agent\'s execution patterns.'
              }
            </p>
            {!insightsEnabled && (
              <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                Note: Enabling insights requires additional LLM API calls.
              </p>
            )}
          </div>
          <button
            onClick={toggleInsights}
            disabled={toggleLoading}
            className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
              insightsEnabled
                ? 'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)]'
                : 'bg-[var(--v2-primary)] text-white hover:opacity-90'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {toggleLoading ? 'Updating...' : insightsEnabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {/* Description */}
      {!compact && insights.length > 0 && insightsEnabled && (
        <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
          Based on {insights.length} detected pattern{insights.length !== 1 ? 's' : ''} from your agent's execution history.
        </p>
      )}

      {/* Insights List */}
      {insightsEnabled ? (
        <InsightsList
          insights={insights}
          onDismiss={handleDismiss}
          onSnooze={handleSnooze}
          onApply={handleApply}
          showFilters={!compact && insights.length > 3}
          compact={compact}
        />
      ) : (
        <div className="text-center py-12">
          <Lightbulb className="w-12 h-12 text-[var(--v2-text-muted)] mx-auto mb-3 opacity-50" />
          <p className="text-sm text-[var(--v2-text-muted)]">
            Insights are disabled for this agent.
          </p>
          <p className="text-xs text-[var(--v2-text-muted)] mt-1">
            Enable insights above to start receiving AI-powered recommendations.
          </p>
        </div>
      )}
    </div>
  );
}
