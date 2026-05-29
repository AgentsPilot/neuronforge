// types/system-health.ts
// TypeScript types for system health dashboard

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'all';

export interface OverviewMetrics {
  status: 'healthy' | 'warning' | 'critical';
  statusMessage: string;
  totalRuns: number;
  totalRunsChange: number;
  successRate: number;
  moneySaved: number; // Total money saved for the selected period
  timeSavedHours: number;
}

export interface AlertItem {
  agentId: string;
  agentName: string;
  count: number;
  lastFailedAt: string;
  errorMessage: string;
}

export interface WarningItem {
  agentId: string;
  agentName: string;
  type: 'slow_performance' | 'high_credit_usage' | 'integration_issue';
  message: string;
}

export interface SystemAlerts {
  failed: AlertItem[];
  warnings: WarningItem[];
  healthyCount: number;
}

export interface TrendDataPoint {
  date: string;
  successRate: number;
  totalRuns: number;
  failedRuns: number;
}

export interface TopPerformer {
  agentId: string;
  agentName: string;
  successRate: number;
  moneySaved: number; // Total money saved for the selected period
  totalRuns: number;
  rank: number;
}

export interface SystemHealthData {
  overview: OverviewMetrics;
  alerts: SystemAlerts;
  trends: TrendDataPoint[];
  topPerformers: TopPerformer[];
}

export interface SystemHealthResponse {
  success: boolean;
  data?: SystemHealthData;
  error?: string;
  details?: any;
}
