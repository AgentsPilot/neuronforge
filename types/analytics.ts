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
}