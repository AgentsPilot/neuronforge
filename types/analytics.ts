// types/analytics.ts

export interface AIUsageData {
  id: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  model_name: string;
  provider: string;
  created_at: string;
  success: boolean;
  latency_ms?: number;
  metadata?: {
    feature?: string;
    component?: string;
    agent_name?: string;
    agent_id?: string;
    execution_type?: string;
    endpoint?: string;
    activity_type?: string;
    activity_name?: string;
  };
  category: string;
  activity_type?: string;
  activity_name?: string;
  agent_id?: string;
  agent_name?: string; // ADDED: This comes from the JOIN with agents table
  feature?: string;
  component?: string;
  endpoint?: string;
  session_id?: string;
}

export type TimeFilter = 'last_24h' | 'last_7d' | 'last_30d' | 'last_90d' | 'last_year' | 'all';

export interface TimeFilterOption {
  value: TimeFilter;
  label: string;
}

export type AnalyticsView = 'overview' | 'insights' | 'activities' | 'agents';

export interface ActivityData {
  name: string;
  count: number;
  cost: number;
  successRate: number;
  avgLatency: number;
  color?: string; // Added for UI display
  bgColor?: string; // Added for UI display
}

export interface AgentData {
  id: string; // Added for UI compatibility
  agentId: string;
  agentName: string;
  name: string; // Added alias for UI compatibility
  totalCalls: number;
  totalRuns: number; // Total execution runs
  totalCost: number;
  creationCost: number; // Added for UI breakdown
  usageCost: number;    // Added for UI breakdown
  successRate: number;
  avgLatency: number;
  status?: 'excellent' | 'good' | 'needs_attention'; // Added for UI display
  lastUsed?: string; // Added for UI display
  efficiency?: number; // Added for UI display
  isActive?: boolean; // Whether the agent has been executed (has token usage data)
  isArchived?: boolean; // Whether the agent has been archived
  dbStatus?: string; // Database status: 'active', 'inactive', 'draft'
  isPaused?: boolean; // Whether the agent is paused (inactive status)
  isDraft?: boolean; // Whether the agent is in draft mode
}

export interface ProcessedAnalyticsData {
  metrics: {
    totalActivities: number;
    totalCost: number;
    averageLatency: number;
    successRate: number;
    totalTokens: number;
    costSavings: number;
    overallSuccessRate: number;
    avgResponseTime: number;
  };
  activities: ActivityData[];
  agents: AgentData[];
  dailyUsage: Array<{
    date: string;
    cost: number;
    tokens: number;
    requests: number;
    activities: number;
    agents_created: number;
    agents_run: number;
  }>;
  costBreakdown: Array<{
    name: string;
    cost: number;
    percentage: number;
    color: string;
    bgColor: string;
  }>;
  insights: Array<{
    type: 'positive' | 'warning' | 'info';
    icon: string;
    title: string;
    message: string;
    color: string;
    bgColor: string;
    borderColor: string;
  }>;
  rawActivities: Array<{
    id: string;
    activity_name: string;
    created_at: string;
    cost_usd: number;
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
    success: boolean;
    model_name: string;
    provider: string;
    category: string;
    activity_type: string | null;
    feature: string | null;
    endpoint: string | null;
    session_id: string | null;
    workflow_step: string | null;
    metadata: any | null;
  }>;
  pilotCreditConfig: {
    pilotCreditCostUsd: number;
    tokensPerCredit: number;
  };
}

// Business Analytics Dashboard Types
export type TimeRange = '7d' | '30d' | '90d' | 'all';

export interface BusinessAnalyticsData {
  timeRange: {
    start: string;
    end: string;
    days: number;
  };
  heroMetrics: {
    totalRuns: number;
    totalRunsChange: number; // percentage
    successRate: number; // 0-100
    moneySaved: number; // USD
    costPerExecution: number; // USD
    hoursAutomated: number;
  };
  volumeTrends: VolumeTrendPoint[];
  costTrends: CostTrendPoint[];
  agentBreakdown: AgentBreakdownItem[];
  systemHealth: {
    status: 'healthy' | 'warning' | 'critical';
    message: string;
    failedRuns24h: number;
    activeInsights: number;
  };
}

export interface VolumeTrendPoint {
  date: string; // YYYY-MM-DD
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number; // 0-100
}

export interface CostTrendPoint {
  date: string; // YYYY-MM-DD
  creationCost: number; // USD
  executionCost: number; // USD
  pluginCost: number; // USD
}

export interface AgentBreakdownItem {
  agentId: string;
  agentName: string;
  status: 'active' | 'paused' | 'draft';
  totalRuns: number;
  successRate: number; // 0-100
  moneySaved: number; // USD
  lastRun: string | null; // ISO date string
}

// Business Dashboard Types (for HTML mockup implementation)
export interface DashboardTrends {
  executions_change_pct: number;
  time_saved_change_pct: number;
  money_saved_change_pct: number;
  success_rate_change: number; // Absolute change, not percentage
}

export interface DashboardValueMetrics {
  time_saved_seconds: number;
  time_saved_hours: number;
  work_days_saved: number;
  money_saved_usd: number;
  hourly_rate: number;
  tasks_completed: number;
  avg_tasks_per_day: number;
  trends: DashboardTrends;
}

export interface HealthScoreData {
  score: number;
  status: 'excellent' | 'good' | 'warning' | 'critical';
  breakdown: {
    reliability: number;
    efficiency: number;
    coverage: number;
  };
}

export interface AttentionItem {
  id: string;
  type: 'warning' | 'info';
  title: string;
  description: string;
  impact: string;
  agent_id?: string;
  agent_name?: string;
  created_at: string;
}

export interface AIRecommendation {
  id: string;
  type: 'save_money' | 'save_time' | 'grow';
  title: string;
  description: string;
  estimated_value: string;
  action_label: string;
  action_type: 'learn_more' | 'try_this' | 'create_this';
}

export interface CategoryMetrics {
  group_id: string;
  group_name: string;
  group_color: string | null;
  workflow_count: number;
  workflow_names: string[];
  hours_saved: number;
  trend_pct: number | null;
}

export interface ActivityItem {
  id: string;
  status: 'success' | 'warning' | 'error';
  agent_name: string;
  action: string;
  timestamp: string;
  relative_time: string;
}

export interface GoalProgress {
  id: string;
  label: string;
  current_value: number;
  goal_value: number;
  unit: string;
  status: 'exceeding' | 'meeting' | 'on_track' | 'at_risk' | 'behind';
  progress_pct: number;
}