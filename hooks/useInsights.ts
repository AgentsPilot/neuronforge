'use client';

import { useState, useEffect, useCallback } from 'react';
import type { InsightData, InsightProjection, InsightProcess } from '@/components/business-os/insight';

// ===========================
// Types
// ===========================

export interface AutonomousWorkEntry {
  executionId: string;
  processName: string;
  processId: string;
  summary: string;
  triggeredBy: 'insight' | 'automation' | 'user_command';
  timestamp: string;
  outcome: {
    itemsProcessed: number;
    itemsSucceeded: number;
    itemsFailed: number;
    valueImpact?: number;
  };
  insightId?: string;
}

export interface InsightStats {
  totalActionsToday: number;
  totalValueImpact: number;
  pendingInsightCount: number;
  criticalInsightCount: number;
}

export interface InsightWithProjection extends InsightData {
  projection?: InsightProjection;
}

// ===========================
// Demo Data (for UI testing when no real insights exist)
// ===========================

const DEMO_INSIGHT: InsightWithProjection = {
  id: '00000000-0000-0000-0000-000000000001', // Demo UUID
  detector_id: 'cash_ar_overdue',
  category: 'cash_flow',
  severity: 'high',
  title: '$2,840 is sitting unpaid across 7 invoices',
  description: 'The oldest is 3 weeks past due — about 12% of this month\'s income still waiting to land. I can send each client a warm, personal reminder right now.',
  affected_count: 7,
  estimated_impact_usd: 2840,
  status: 'new',
  paired_process_id: 'chase_overdue_invoices',
  eligible_for_automation: true,
  process_parameters: { days_threshold: 7 },
  priority_score: 85,
  surface_count: 0,
  detected_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  projection: {
    doNothing: {
      summary: '~$2,840 stays unpaid',
      details: '~2 hours of manual chasing required',
    },
    letMeHandleIt: {
      summary: 'I chase all 7 today',
      details: 'And anything 7+ days late from now on — you do nothing',
      projectedOutcome: {
        cashRecovered: 1136, // ~40% of $2,840
        timeSaved: 120,
      },
    },
    confidence: 'high',
    basis: 'Based on 7 eligible invoices and 40% historical collection rate',
  },
};

const DEMO_WORK: AutonomousWorkEntry[] = [
  {
    executionId: '00000000-0000-0000-0000-000000000011', // Demo UUID
    processName: 'Chase Overdue Invoices',
    processId: 'chase_overdue_invoices',
    summary: 'Chased 7 overdue invoices — 2 have paid ($680 in)',
    triggeredBy: 'automation',
    timestamp: new Date().toISOString(),
    outcome: {
      itemsProcessed: 7,
      itemsSucceeded: 2,
      itemsFailed: 0,
      valueImpact: 680,
    },
  },
  {
    executionId: '00000000-0000-0000-0000-000000000012', // Demo UUID
    processName: 'Send Follow-up Nudge',
    processId: 'send_followup_nudge',
    summary: 'Followed up with 6 quiet clients — 1 rebooked',
    triggeredBy: 'automation',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    outcome: {
      itemsProcessed: 6,
      itemsSucceeded: 1,
      itemsFailed: 0,
    },
  },
];

const DEMO_STATS: InsightStats = {
  totalActionsToday: 4,
  totalValueImpact: 680,
  pendingInsightCount: 1,
  criticalInsightCount: 0,
};

// Set to true to show demo data when no real insights exist
const USE_DEMO_MODE = false;

interface UseInsightsResult {
  insights: InsightWithProjection[];
  autonomousWork: AutonomousWorkEntry[];
  stats: InsightStats;
  loading: boolean;
  error: string | null;
  selectedInsight: InsightData | null;
  selectedProjection: InsightProjection | null;
  selectedProcess: InsightProcess | null;
  selectInsight: (insightId: string) => Promise<void>;
  clearSelection: () => void;
  runAction: (insightId: string, action: 'run' | 'automate' | 'snooze' | 'dismiss', params?: Record<string, unknown>) => Promise<boolean>;
  refresh: () => Promise<void>;
}

// ===========================
// Hook
// ===========================

export function useInsights(): UseInsightsResult {
  const [insights, setInsights] = useState<InsightWithProjection[]>([]);
  const [autonomousWork, setAutonomousWork] = useState<AutonomousWorkEntry[]>([]);
  const [stats, setStats] = useState<InsightStats>({
    totalActionsToday: 0,
    totalValueImpact: 0,
    pendingInsightCount: 0,
    criticalInsightCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedInsight, setSelectedInsight] = useState<InsightData | null>(null);
  const [selectedProjection, setSelectedProjection] = useState<InsightProjection | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<InsightProcess | null>(null);

  // Fetch insights
  const fetchInsights = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/business-os/insights?includeProjection=true');
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch insights');
      }

      const fetchedInsights = data.data.insights || [];
      const fetchedWork = data.data.autonomousWork || [];

      // Use demo data if no real insights exist and demo mode is enabled
      if (USE_DEMO_MODE && fetchedInsights.length === 0 && fetchedWork.length === 0) {
        setInsights([DEMO_INSIGHT]);
        setAutonomousWork(DEMO_WORK);
        setStats(DEMO_STATS);
      } else {
        setInsights(fetchedInsights);
        setAutonomousWork(fetchedWork);
        setStats(data.data.stats || {
          totalActionsToday: 0,
          totalValueImpact: 0,
          pendingInsightCount: 0,
          criticalInsightCount: 0,
        });
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch insights');
      // On error, also show demo data if enabled
      if (USE_DEMO_MODE) {
        setInsights([DEMO_INSIGHT]);
        setAutonomousWork(DEMO_WORK);
        setStats(DEMO_STATS);
        setError(null); // Clear error since we're showing demo
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Select an insight to view details
  const selectInsight = useCallback(async (insightId: string) => {
    try {
      const response = await fetch(`/api/business-os/insights/${insightId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch insight');
      }

      setSelectedInsight(data.data.insight);
      setSelectedProjection(data.data.projection);
      setSelectedProcess(data.data.process);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch insight');
    }
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedInsight(null);
    setSelectedProjection(null);
    setSelectedProcess(null);
  }, []);

  // Run an action on an insight
  const runAction = useCallback(async (
    insightId: string,
    action: 'run' | 'automate' | 'snooze' | 'dismiss',
    params?: Record<string, unknown>
  ): Promise<boolean> => {
    try {
      // Skip API call for demo insights (IDs starting with 00000000-)
      if (insightId.startsWith('00000000-')) {
        // For demo mode, just simulate success and remove the insight on dismiss/snooze
        if (action === 'dismiss' || action === 'snooze') {
          setInsights(prev => prev.filter(i => i.id !== insightId));
        }
        return true;
      }

      const body: Record<string, unknown> = {
        insightId,
        action,
        ...params,
      };

      // Add snooze time if snoozing
      if (action === 'snooze' && !params?.snoozeUntil) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        body.snoozeUntil = tomorrow.toISOString();
      }

      const response = await fetch('/api/business-os/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Action failed');
      }

      // Refresh insights after action
      await fetchInsights();

      return true;

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      return false;
    }
  }, [fetchInsights]);

  // Initial fetch
  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  return {
    insights,
    autonomousWork,
    stats,
    loading,
    error,
    selectedInsight,
    selectedProjection,
    selectedProcess,
    selectInsight,
    clearSelection,
    runAction,
    refresh: fetchInsights,
  };
}
