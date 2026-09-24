'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
/**
 * One measured rate, compared with the same business's previous period.
 *
 * `rate === null` means there is not enough data to say — it is NOT zero, and
 * rendering it as a number is the defect this whole shape exists to prevent.
 */
export interface HealthMeasure {
  category: string;
  rate: number | null;
  previousRate: number | null;
  /** Percentage points moved, or null when there is nothing to compare with. */
  change: number | null;
  /** Translation key naming what the rate counts. */
  measureKey: string;
  unavailable: 'too_little_data' | 'not_measurable' | null;
  sample: number;
}

export interface HealthMeasures {
  categories: HealthMeasure[];
  /** Share of comparable measures that improved, or null below two of them. */
  movingUp: number | null;
  improved: number;
  declined: number;
  steady: number;
  measured: number;
  unavailable: number;
}

export interface BusinessHealthSummaryData {
  id: string;
  /**
   * No longer a grade.
   *
   * Was 100 minus severity penalties over insight COUNTS, so it moved when the
   * detector catalogue changed rather than when the business did. Now carries
   * `movingUp`, and is null when fewer than two categories can be compared.
   * Read `health_measures` for anything meaningful.
   */
  health_score: number | null;
  /** The measured rates. Null on summaries written before 2026-09-23. */
  health_measures?: HealthMeasures | null;
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
  /**
   * Event dates the journey timeline measures from — the account's first day,
   * and the anchors the pricing and retention vectors already count from.
   * Optional here because a cached response from before this shipped has none,
   * and the timeline degrades to undated nodes rather than to wrong ones.
   */
  journeyAnchors?: {
    accountCreatedAt: string | null;
    firstBookingAt: string | null;
    firstClientAt: string | null;
    convCrossedAt: string | null;
    /**
     * Standing automations switched on right now.
     *
     * Separate from `firstAutomationAt`, which records that the owner once
     * handed something over and stays set forever. The journey node claims the
     * platform is "working on its own", and only this can answer that.
     */
    runningAutomations?: number;
    firstAutomationAt: string | null;
  };
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
  /**
   * Tell the server this insight was actually put in front of the owner.
   *
   * Separate from `runAction` for two reasons: it must not refetch — a refetch
   * on display would re-render the card and mark it seen again, forever — and
   * it is not an action the owner took, so a failure is not worth an error
   * banner. It is a fact about what the screen showed.
   */
  markSeen: (insightId: string) => void;
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

  /**
   * Record that an insight was displayed.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Nothing did this. `surface_count` was 0 and `last_surfaced_at` null on
   * every row in the database, and `owner_insight_history` was empty, because
   * the only caller of the `view` action was a `runAction` union that did not
   * include it — so the server route existed and was unreachable.
   *
   * The consequences were quiet. The advisor card told every owner "first time
   * I've seen this" about an insight that had been on their dashboard for a
   * week. `timeToAction` could never be computed, because it is measured from
   * `last_surfaced_at`. And the one table that could answer whether any of this
   * advice is ever acted on had nothing in it.
   *
   * Once per insight per mount: the dashboard mounts on a page load, which is
   * the unit "how many times has this been shown" should count.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const seen = useRef(new Set<string>());

  const markSeen = useCallback((insightId: string) => {
    // Demo rows have no server side to tell.
    if (insightId.startsWith('00000000-')) return;
    if (seen.current.has(insightId)) return;
    seen.current.add(insightId);

    fetch('/api/business-os/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insightId, action: 'view' }),
    }).catch(() => {
      /*
       * Swallowed on purpose, and the id stays marked.
       *
       * The owner did not ask for this and must not be shown a failure for it.
       * Retrying on the next render would turn one dropped request into a loop
       * against a server that is already unhappy; the count being low is a
       * smaller harm than that.
       */
    });
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
    markSeen,
    refresh: fetchInsights,
  };
}
