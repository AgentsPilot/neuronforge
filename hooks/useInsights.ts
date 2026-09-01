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

// Correlated Insight - unified story-driven insights
export interface CorrelatedInsightData {
  id: string;
  detector_id: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  story?: string;
  correlation_pattern_id?: string;
  total_correlated_impact_usd?: number;
  estimated_impact_usd?: number;
  contributing_insights?: Array<{
    detector_id: string;
    detector_name: string;
    severity: string;
    summary: string;
    impact_usd: number;
    insight_id?: string;
  }>;
  trend_direction?: 'improving' | 'stable' | 'worsening';
  status: string;
  paired_process_id?: string;
}

// Business Health Summary
export interface BusinessHealthSummaryData {
  id: string;
  health_score: number;
  previous_health_score?: number;
  score_change?: number;
  acquisition_score: number;
  conversion_score: number;
  sales_score: number;
  cash_flow_score: number;
  retention_score: number;
  operations_score: number;
  pricing_score: number;
  summary_title: string;
  summary_narrative: string;
  highlights: Array<{ type: 'positive' | 'negative' | 'neutral'; text: string }>;
  priorities: Array<{ rank: number; category: string; title: string; insight_id?: string }>;
  period_start: string;
  period_end: string;
  // Stats fields from database
  insight_count: number;
  critical_count: number;
  high_count: number;
  total_impact_usd: number;
}

// Vector Maturity System (Progressive Data Revelation)
export type VectorKey = 'wins' | 'conv' | 'ops' | 'cash' | 'leads' | 'ret' | 'price';
export type VectorState = 'dark' | 'learn' | 'lit';
export type MaturityLevel = 'cold_start' | 'early' | 'running' | 'mature';

export interface VectorStatus {
  key: VectorKey;
  name: string;
  state: VectorState;
  dataPoints: number;
  threshold: number;
  note?: string;
}

export interface VectorMaturityData {
  vectors: VectorStatus[];
  maturityLevel: MaturityLevel;
  litCount: number;
  totalVectors: number;
  accountAgeDays: number;
  /** English fallback. Prefer `noteKey`, which the reader's language can reach. */
  note: string;
  noteKey: 'vecs.note.cold' | 'vecs.note.full' | 'vecs.note.partial';
  /** Vector keys still learning, for the partial note's list. */
  noteLearning: string[];
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
  correlatedInsights: CorrelatedInsightData[];
  healthSummary: BusinessHealthSummaryData | null;
  vectorMaturity: VectorMaturityData | null;
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
  const [correlatedInsights, setCorrelatedInsights] = useState<CorrelatedInsightData[]>([]);
  const [healthSummary, setHealthSummary] = useState<BusinessHealthSummaryData | null>(null);
  const [vectorMaturity, setVectorMaturity] = useState<VectorMaturityData | null>(null);
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
      const fetchedCorrelated = data.data.correlatedInsights || [];
      const fetchedHealthSummary = data.data.healthSummary || null;
      const fetchedVectorMaturity = data.data.vectorMaturity || null;
      const fetchedWork = data.data.autonomousWork || [];

      // Use demo data if no real insights exist and demo mode is enabled
      if (USE_DEMO_MODE && fetchedInsights.length === 0 && fetchedWork.length === 0) {
        setInsights([DEMO_INSIGHT]);
        setCorrelatedInsights([]);
        setHealthSummary(null);
        setVectorMaturity(null);
        setAutonomousWork(DEMO_WORK);
        setStats(DEMO_STATS);
      } else {
        setInsights(fetchedInsights);
        setCorrelatedInsights(fetchedCorrelated);
        setHealthSummary(fetchedHealthSummary);
        setVectorMaturity(fetchedVectorMaturity);
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
        setCorrelatedInsights([]);
        setHealthSummary(null);
        setVectorMaturity(null);
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
    correlatedInsights,
    healthSummary,
    vectorMaturity,
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
