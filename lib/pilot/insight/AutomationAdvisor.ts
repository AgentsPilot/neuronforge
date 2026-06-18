/**
 * AutomationAdvisor - Domain-Agnostic AI Strategic Analysis
 *
 * Analyzes the user's entire automation portfolio and provides strategic
 * recommendations. Uses Claude to generate insights that work for ANY
 * business type, industry, or workflow category.
 *
 * Key Principles:
 * - 100% domain-agnostic (no hardcoded industries, departments, categories)
 * - Uses user-defined groups and tags for analysis structure
 * - Universal metrics only (time, count, percentage, success rate)
 * - LLM infers context from workflow descriptions, not hardcoded assumptions
 *
 * @module lib/pilot/insight/AutomationAdvisor
 */

import { createLogger } from '@/lib/logger';
import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { OrganizationService } from '@/lib/services/OrganizationService';
import { WorkflowGroupRepository, WorkflowGroupWithStats } from '@/lib/repositories/WorkflowGroupRepository';
import { Agent } from '@/lib/repositories/types';
import Anthropic from '@anthropic-ai/sdk';

const logger = createLogger({ service: 'AutomationAdvisor' });

// ============================================================================
// Types
// ============================================================================

/**
 * Types of strategic recommendations
 * All domain-agnostic - work for any workflow type
 */
/**
 * Types of strategic recommendations - business-focused
 */
export type RecommendationType =
  | 'cost_savings'         // Save money
  | 'time_savings'         // Save time
  | 'growth'               // Growth opportunity
  | 'fix_issue'            // Fix a problem
  | 'optimize';            // Improve efficiency

/**
 * Individual strategic recommendation from AI
 * Simplified for business storytelling
 */
export interface StrategicRecommendation {
  type: RecommendationType;
  title: string;              // Business-focused title
  description: string;        // Plain language explanation
  action: string;             // What to do
  impact: string;             // Expected business outcome
  priority: 'high' | 'medium' | 'low';
  // Legacy fields for backward compatibility
  evidence?: string;
  recommendation?: string;
  workflows_involved?: string[];
  confidence?: number;
}

/**
 * Portfolio summary statistics
 */
export interface PortfolioSummary {
  total_workflows: number;
  total_executions_30d: number;
  total_time_saved_seconds: number;
  overall_success_rate: number;
  active_workflows: number;
  groups: GroupSummary[];
  top_performers: WorkflowPerformance[];
  needs_attention: WorkflowPerformance[];
  // Rich business context for meaningful insights
  business_context?: BusinessContext;
}

/**
 * Summary of a user-defined group
 */
export interface GroupSummary {
  id: string;
  name: string;
  workflow_count: number;
  total_runs_30d: number;
  total_time_saved_seconds: number;
  success_rate: number;
}

/**
 * Workflow performance metrics
 */
export interface WorkflowPerformance {
  id: string;
  name: string;
  description: string | null;
  purpose: string | null;
  runs_30d: number;
  success_rate: number;
  avg_time_saved_seconds: number;
  groups: string[];           // User-defined group names
  tags: string[];             // User-defined tags
  status: 'active' | 'inactive' | 'failing';
  // Rich business context
  plugins?: string[];         // e.g., ["gmail", "hubspot", "google-sheets"]
  business_domain?: string;   // Inferred: "CRM/Sales", "Communications", "Data/Reporting"
  total_items_processed?: number;  // Total items processed in 30 days
  item_types?: string[];      // Inferred from field names: ["leads", "emails", "invoices"]
}

/**
 * Business insight from execution_insights table
 */
export interface BusinessInsightSummary {
  agent_id: string;
  agent_name: string;
  workflow_purpose?: string;
  category: 'data_insight' | 'business_insight' | 'technical_insight';
  insight_type: string;
  title: string;
  description: string;
  recommendation?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  time_saved_hours_per_week?: number;
  cost_saved_usd_per_week?: number;
  revenue_at_risk_usd?: number;
  automation_potential_percentage?: number;
}

/**
 * Rich business context for LLM
 */
export interface BusinessContext {
  // What business objects are being processed
  business_objects: {
    domain: string;           // "Sales/CRM", "Communications", "Finance", "Operations"
    object_types: string[];   // ["leads", "contacts", "emails", "invoices"]
    total_processed_30d: number;
  }[];
  // Active insights detected by the system
  active_insights: BusinessInsightSummary[];
  // Trends and patterns
  trends: {
    volume_change_pct: number;  // +15% means 15% more items than previous period
    success_rate_change_pct: number;
    busiest_workflow: string;
    most_improved_workflow?: string;
    declining_workflow?: string;
  };
}

/**
 * Organization context for AI recommendations
 * When provided, AI can tailor language and prioritize insights accordingly
 */
export interface OrganizationContext {
  industry?: string;           // e.g., "b2b_saas", "ecommerce", "agency"
  company_size?: string;       // e.g., "solo", "small", "medium", "large", "enterprise"
  primary_goal?: string;       // e.g., "reduce_costs", "grow_revenue", "improve_efficiency"
  technical_level?: string;    // e.g., "non_technical", "some_technical", "technical"
}

/**
 * Full advisor report
 */
export interface AdvisorReport {
  generated_at: string;
  portfolio: PortfolioSummary;
  recommendations: StrategicRecommendation[];
  ai_summary: string;         // Executive summary from AI
  next_review_date: string;   // Suggested review date
}

// ============================================================================
// Main Class
// ============================================================================

export class AutomationAdvisor {
  private supabase: SupabaseClient;
  private orgService: OrganizationService;
  private groupRepo: WorkflowGroupRepository;
  private anthropic: Anthropic;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.orgService = new OrganizationService(this.supabase);
    this.groupRepo = new WorkflowGroupRepository(this.supabase);
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
    });
  }

  // ============================================================================
  // Public Methods for Portfolio Metrics
  // ============================================================================

  /**
   * Get fresh portfolio metrics without generating AI recommendations.
   * Used to refresh metrics when returning cached reports.
   */
  async getPortfolioMetrics(userId: string): Promise<{
    total_workflows: number;
    total_executions_30d: number;
    total_time_saved_seconds: number;
    overall_success_rate: number;
    active_workflows: number;
  } | null> {
    const org = await this.orgService.getCurrentOrganization(userId);
    if (!org) {
      return null;
    }

    const portfolio = await this.gatherPortfolioData(userId, org.id);
    return {
      total_workflows: portfolio.total_workflows,
      total_executions_30d: portfolio.total_executions_30d,
      total_time_saved_seconds: portfolio.total_time_saved_seconds,
      overall_success_rate: portfolio.overall_success_rate,
      active_workflows: portfolio.active_workflows,
    };
  }

  // ============================================================================
  // Rich Business Context Gathering
  // ============================================================================

  /**
   * Gather business insights from execution_insights table
   * These are LLM-generated insights from actual workflow executions
   */
  private async gatherBusinessInsights(agentIds: string[]): Promise<BusinessInsightSummary[]> {
    if (agentIds.length === 0) return [];

    const { data: insights } = await this.supabase
      .from('execution_insights')
      .select(`
        id,
        agent_id,
        category,
        insight_type,
        title,
        description,
        recommendation,
        severity,
        confidence,
        time_saved_hours_per_week,
        cost_saved_usd_per_week,
        revenue_at_risk_usd,
        automation_potential_percentage,
        agents!inner(agent_name, workflow_purpose)
      `)
      .in('agent_id', agentIds)
      .in('status', ['new', 'viewed'])
      .order('severity', { ascending: true })
      .order('confidence', { ascending: false })
      .limit(20);

    if (!insights) return [];

    return insights.map(i => {
      const agentData = (i.agents as unknown) as { agent_name: string; workflow_purpose?: string } | null;
      return {
        agent_id: i.agent_id,
        agent_name: agentData?.agent_name || 'Unknown',
        workflow_purpose: agentData?.workflow_purpose,
        category: i.category as 'data_insight' | 'business_insight' | 'technical_insight',
        insight_type: i.insight_type,
        title: i.title,
        description: i.description,
        recommendation: i.recommendation,
        severity: i.severity as 'low' | 'medium' | 'high' | 'critical',
        confidence: i.confidence,
        time_saved_hours_per_week: i.time_saved_hours_per_week,
        cost_saved_usd_per_week: i.cost_saved_usd_per_week,
        revenue_at_risk_usd: i.revenue_at_risk_usd,
        automation_potential_percentage: i.automation_potential_percentage,
      };
    });
  }

  /**
   * Gather detailed metrics including items processed and step-level data
   */
  private async gatherDetailedMetrics(agentIds: string[]): Promise<{
    totalItemsProcessed: number;
    itemsByAgent: Map<string, number>;
    stepMetricsSummary: { plugin: string; action: string; total_count: number }[];
  }> {
    if (agentIds.length === 0) {
      return { totalItemsProcessed: 0, itemsByAgent: new Map(), stepMetricsSummary: [] };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Filter out calibration runs - only include production runs
    const { data: metrics } = await this.supabase
      .from('execution_metrics')
      .select('agent_id, total_items, step_metrics, workflow_executions!inner(run_mode)')
      .in('agent_id', agentIds)
      .gte('executed_at', thirtyDaysAgo.toISOString())
      .eq('workflow_executions.run_mode', 'production');

    if (!metrics) {
      return { totalItemsProcessed: 0, itemsByAgent: new Map(), stepMetricsSummary: [] };
    }

    let totalItemsProcessed = 0;
    const itemsByAgent = new Map<string, number>();
    const stepAggregation = new Map<string, number>();

    for (const m of metrics) {
      // Aggregate total items
      totalItemsProcessed += m.total_items || 0;
      itemsByAgent.set(m.agent_id, (itemsByAgent.get(m.agent_id) || 0) + (m.total_items || 0));

      // Aggregate step metrics
      const steps = m.step_metrics as { plugin?: string; action?: string; count?: number }[] | null;
      if (steps && Array.isArray(steps)) {
        for (const step of steps) {
          if (step.plugin && step.action) {
            const key = `${step.plugin}:${step.action}`;
            stepAggregation.set(key, (stepAggregation.get(key) || 0) + (step.count || 0));
          }
        }
      }
    }

    // Convert step aggregation to array
    const stepMetricsSummary = Array.from(stepAggregation.entries())
      .map(([key, count]) => {
        const [plugin, action] = key.split(':');
        return { plugin, action, total_count: count };
      })
      .sort((a, b) => b.total_count - a.total_count)
      .slice(0, 15); // Top 15 most used actions

    return { totalItemsProcessed, itemsByAgent, stepMetricsSummary };
  }

  /**
   * Calculate trends by comparing current period to previous period
   */
  private async calculateTrends(agentIds: string[]): Promise<BusinessContext['trends']> {
    if (agentIds.length === 0) {
      return { volume_change_pct: 0, success_rate_change_pct: 0, busiest_workflow: 'N/A' };
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Current period (last 30 days) - exclude calibration runs
    const { data: currentMetrics } = await this.supabase
      .from('execution_metrics')
      .select('agent_id, total_items, failed_step_count, success_step_count, workflow_executions!inner(run_mode)')
      .in('agent_id', agentIds)
      .gte('executed_at', thirtyDaysAgo.toISOString())
      .eq('workflow_executions.run_mode', 'production');

    // Previous period (30-60 days ago) - exclude calibration runs
    const { data: previousMetrics } = await this.supabase
      .from('execution_metrics')
      .select('agent_id, total_items, failed_step_count, success_step_count, workflow_executions!inner(run_mode)')
      .in('agent_id', agentIds)
      .gte('executed_at', sixtyDaysAgo.toISOString())
      .lt('executed_at', thirtyDaysAgo.toISOString())
      .eq('workflow_executions.run_mode', 'production');

    // Calculate current totals
    let currentItems = 0;
    let currentSuccess = 0;
    let currentFailed = 0;
    const currentByAgent = new Map<string, number>();

    (currentMetrics || []).forEach(m => {
      currentItems += m.total_items || 0;
      currentSuccess += m.success_step_count || 0;
      currentFailed += m.failed_step_count || 0;
      currentByAgent.set(m.agent_id, (currentByAgent.get(m.agent_id) || 0) + (m.total_items || 0));
    });

    // Calculate previous totals
    let previousItems = 0;
    let previousSuccess = 0;
    let previousFailed = 0;
    const previousByAgent = new Map<string, number>();

    (previousMetrics || []).forEach(m => {
      previousItems += m.total_items || 0;
      previousSuccess += m.success_step_count || 0;
      previousFailed += m.failed_step_count || 0;
      previousByAgent.set(m.agent_id, (previousByAgent.get(m.agent_id) || 0) + (m.total_items || 0));
    });

    // Calculate changes
    const volumeChange = previousItems > 0
      ? Math.round(((currentItems - previousItems) / previousItems) * 100)
      : 0;

    const currentSuccessRate = (currentSuccess + currentFailed) > 0
      ? currentSuccess / (currentSuccess + currentFailed)
      : 1;
    const previousSuccessRate = (previousSuccess + previousFailed) > 0
      ? previousSuccess / (previousSuccess + previousFailed)
      : 1;
    const successRateChange = Math.round((currentSuccessRate - previousSuccessRate) * 100);

    // Find busiest workflow
    let busiestAgent = '';
    let busiestCount = 0;
    currentByAgent.forEach((count, agentId) => {
      if (count > busiestCount) {
        busiestCount = count;
        busiestAgent = agentId;
      }
    });

    // Find most improved and declining workflows
    let mostImproved = '';
    let mostImprovedDelta = 0;
    let declining = '';
    let decliningDelta = 0;

    currentByAgent.forEach((current, agentId) => {
      const previous = previousByAgent.get(agentId) || 0;
      if (previous > 0) {
        const delta = ((current - previous) / previous) * 100;
        if (delta > mostImprovedDelta) {
          mostImprovedDelta = delta;
          mostImproved = agentId;
        }
        if (delta < decliningDelta) {
          decliningDelta = delta;
          declining = agentId;
        }
      }
    });

    return {
      volume_change_pct: volumeChange,
      success_rate_change_pct: successRateChange,
      busiest_workflow: busiestAgent,
      most_improved_workflow: mostImproved || undefined,
      declining_workflow: declining || undefined,
    };
  }

  /**
   * Generate a strategic advisor report for the user's portfolio
   * @param userId - User ID
   * @param providedContext - Optional organization context (if not provided, will be fetched)
   */
  async generateReport(userId: string, providedContext?: OrganizationContext): Promise<AdvisorReport> {
    const startTime = Date.now();

    logger.info({ userId }, 'Starting portfolio analysis');

    // 1. Get organization
    const org = await this.orgService.getCurrentOrganization(userId);
    if (!org) {
      throw new Error('Organization not found for user');
    }

    // 2. Get organization context (from parameter or fetch from org settings)
    let orgContext: OrganizationContext | undefined = providedContext;
    if (!orgContext && org.settings) {
      const settings = org.settings as Record<string, unknown>;
      orgContext = {
        industry: settings.industry as string | undefined,
        company_size: settings.company_size as string | undefined,
        primary_goal: settings.primary_goal as string | undefined,
        technical_level: settings.technical_level as string | undefined,
      };
      // Only use if at least one field is set
      if (!orgContext.industry && !orgContext.company_size && !orgContext.primary_goal && !orgContext.technical_level) {
        orgContext = undefined;
      }
    }

    // 3. Gather portfolio data
    const portfolio = await this.gatherPortfolioData(userId, org.id);

    logger.info({
      userId,
      totalWorkflows: portfolio.total_workflows,
      totalRuns: portfolio.total_executions_30d,
      hasOrgContext: !!orgContext,
    }, 'Portfolio data gathered');

    // 4. Generate AI recommendations with organization context
    const { recommendations, summary } = await this.generateAIRecommendations(portfolio, false, orgContext);

    // 4. Build report
    const report: AdvisorReport = {
      generated_at: new Date().toISOString(),
      portfolio,
      recommendations,
      ai_summary: summary,
      next_review_date: this.calculateNextReviewDate(portfolio),
    };

    logger.info({
      userId,
      duration: Date.now() - startTime,
      recommendationCount: recommendations.length,
    }, 'Advisor report generated');

    return report;
  }

  /**
   * Get quick recommendations without full report (faster, lower token usage)
   */
  async getQuickRecommendations(userId: string, limit = 3): Promise<StrategicRecommendation[]> {
    const org = await this.orgService.getCurrentOrganization(userId);
    if (!org) {
      return [];
    }

    // Get organization context from settings
    let orgContext: OrganizationContext | undefined;
    if (org.settings) {
      const settings = org.settings as Record<string, unknown>;
      orgContext = {
        industry: settings.industry as string | undefined,
        company_size: settings.company_size as string | undefined,
        primary_goal: settings.primary_goal as string | undefined,
        technical_level: settings.technical_level as string | undefined,
      };
      if (!orgContext.industry && !orgContext.company_size && !orgContext.primary_goal && !orgContext.technical_level) {
        orgContext = undefined;
      }
    }

    const portfolio = await this.gatherPortfolioData(userId, org.id);
    const { recommendations } = await this.generateAIRecommendations(portfolio, true, orgContext);

    return recommendations.slice(0, limit);
  }

  // ============================================================================
  // Data Gathering
  // ============================================================================

  private async gatherPortfolioData(userId: string, orgId: string): Promise<PortfolioSummary> {
    // Use same date calculation as SystemAnalyticsService.getDateRange('30d')
    const now = new Date();

    // End of today UTC
    const endDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23, 59, 59, 999
    ));

    // 30 days ago at start of day UTC
    const startDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - 30,
      0, 0, 0, 0
    ));

    // Get all agents for the user (use user_id like SystemAnalyticsService, not org_id)
    // This ensures consistency with dashboard metrics
    const { data: agents } = await this.supabase
      .from('agents')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'deleted');

    if (!agents || agents.length === 0) {
      return this.emptyPortfolio();
    }

    const agentIds = agents.map(a => a.id);

    // Get executions from agent_executions (same source as SystemAnalyticsService)
    // Query by user_id directly to match exactly how SystemAnalyticsService counts
    // Use same date range as SystemAnalyticsService
    const { data: executions } = await this.supabase
      .from('agent_executions')
      .select('id, agent_id, status, started_at')
      .eq('user_id', userId)
      .eq('run_mode', 'production')
      .gte('started_at', startDate.toISOString())
      .lte('started_at', endDate.toISOString());

    const executionIds = executions?.map(e => e.id) || [];

    // Get execution_metrics for time saved calculation (joined by execution_id)
    // Use same approach as SystemAnalyticsService.getHeroMetrics for consistency
    let metrics: Array<{
      agent_id: string;
      total_items: number;
      time_saved_seconds: number;
      executed_at: string;
      failed_step_count: number;
      success_step_count: number;
    }> = [];

    if (executionIds.length > 0) {
      const { data: metricsData } = await this.supabase
        .from('execution_metrics')
        .select('execution_id, agent_id, total_items, time_saved_seconds, executed_at, failed_step_count, success_step_count')
        .in('execution_id', executionIds);

      if (metricsData && metricsData.length > 0) {
        metrics = metricsData.map(m => ({
          agent_id: m.agent_id,
          total_items: m.total_items || 0,
          time_saved_seconds: m.time_saved_seconds || 0,
          executed_at: m.executed_at,
          failed_step_count: m.failed_step_count || 0,
          success_step_count: m.success_step_count || 0,
        }));
      }
    }

    // Get user-defined groups
    const groupsResult = await this.groupRepo.findByOrgIdWithStats(orgId);
    const groups = groupsResult.data || [];

    // Get agent-group memberships
    const { data: memberships } = await this.supabase
      .from('agent_group_memberships')
      .select('agent_id, group_id')
      .in('agent_id', agentIds);

    // Build membership map
    const agentGroups = new Map<string, string[]>();
    memberships?.forEach(m => {
      const existing = agentGroups.get(m.agent_id) || [];
      agentGroups.set(m.agent_id, [...existing, m.group_id]);
    });

    // Count runs per agent from executions (agent_executions - source of truth for counts)
    const agentRunCounts = new Map<string, { runs: number; successful: number; failed: number }>();
    executions?.forEach(exec => {
      const existing = agentRunCounts.get(exec.agent_id) || { runs: 0, successful: 0, failed: 0 };
      existing.runs++;
      const isSuccess = exec.status === 'success' || exec.status === 'completed';
      if (isSuccess) {
        existing.successful++;
      } else {
        existing.failed++;
      }
      agentRunCounts.set(exec.agent_id, existing);
    });

    // Calculate total runs from executions (matches SystemAnalyticsService)
    const totalRuns = executions?.length || 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    agentRunCounts.forEach(m => {
      totalSuccessful += m.successful;
      totalFailed += m.failed;
    });

    // Aggregate time saved from metrics (execution_metrics)
    const agentTimeSaved = new Map<string, number>();
    let totalTimeSaved = 0;

    metrics?.forEach(m => {
      const timeSaved = m.time_saved_seconds || 0;
      agentTimeSaved.set(m.agent_id, (agentTimeSaved.get(m.agent_id) || 0) + timeSaved);
      totalTimeSaved += timeSaved;
    });

    // Build combined agentMetrics for workflow performance calculation
    const agentMetrics = new Map<string, {
      runs: number;
      timeSaved: number;
      failed: number;
      successful: number;
    }>();

    agentRunCounts.forEach((counts, agentId) => {
      agentMetrics.set(agentId, {
        runs: counts.runs,
        timeSaved: agentTimeSaved.get(agentId) || 0,
        failed: counts.failed,
        successful: counts.successful,
      });
    });

    // Calculate total items processed per agent
    const itemsByAgent = new Map<string, number>();
    metrics?.forEach(m => {
      itemsByAgent.set(m.agent_id, (itemsByAgent.get(m.agent_id) || 0) + (m.total_items || 0));
    });

    // Build workflow performance list with rich business context
    const workflows: WorkflowPerformance[] = agents.map(agent => {
      const m = agentMetrics.get(agent.id) || { runs: 0, timeSaved: 0, failed: 0, successful: 0 };
      const totalSteps = m.failed + m.successful;
      const successRate = totalSteps > 0 ? m.successful / totalSteps : 1;
      const groupIds = agentGroups.get(agent.id) || [];

      // Extract plugins from plugins_required (can be array or JSONB)
      let plugins: string[] = [];
      if (agent.plugins_required) {
        if (Array.isArray(agent.plugins_required)) {
          plugins = agent.plugins_required;
        } else if (typeof agent.plugins_required === 'string') {
          try {
            plugins = JSON.parse(agent.plugins_required);
          } catch {
            plugins = [agent.plugins_required];
          }
        }
      }

      return {
        id: agent.id,
        name: agent.agent_name,
        description: agent.description,
        purpose: agent.workflow_purpose,
        runs_30d: m.runs,
        success_rate: successRate,
        avg_time_saved_seconds: m.runs > 0 ? m.timeSaved / m.runs : 0,
        groups: groups.filter(g => groupIds.includes(g.id)).map(g => g.name),
        tags: agent.tags || [],
        status: this.determineStatus(agent.status, successRate, m.runs),
        // Rich business context
        plugins,
        total_items_processed: itemsByAgent.get(agent.id) || 0,
      };
    });

    // Sort for top performers and needs attention
    const topPerformers = [...workflows]
      .filter(w => w.runs_30d > 0)
      .sort((a, b) => b.avg_time_saved_seconds * b.runs_30d - a.avg_time_saved_seconds * a.runs_30d)
      .slice(0, 5);

    const needsAttention = [...workflows]
      .filter(w => w.success_rate < 0.9 || w.status === 'failing' || w.status === 'inactive')
      .sort((a, b) => a.success_rate - b.success_rate)
      .slice(0, 5);

    // Build group summaries
    const groupSummaries: GroupSummary[] = groups.map(group => {
      const groupAgentIds = memberships
        ?.filter(m => m.group_id === group.id)
        .map(m => m.agent_id) || [];

      let groupRuns = 0;
      let groupTimeSaved = 0;
      let groupFailed = 0;
      let groupSuccessful = 0;

      groupAgentIds.forEach(agentId => {
        const m = agentMetrics.get(agentId);
        if (m) {
          groupRuns += m.runs;
          groupTimeSaved += m.timeSaved;
          groupFailed += m.failed;
          groupSuccessful += m.successful;
        }
      });

      const totalSteps = groupFailed + groupSuccessful;

      return {
        id: group.id,
        name: group.name,
        workflow_count: group.agent_count,
        total_runs_30d: groupRuns,
        total_time_saved_seconds: groupTimeSaved,
        success_rate: totalSteps > 0 ? groupSuccessful / totalSteps : 1,
      };
    });

    const totalSteps = totalFailed + totalSuccessful;

    // Gather active business insights
    const activeInsights = await this.gatherBusinessInsights(agentIds);

    // Calculate trends (volume change, success rate change)
    const trends = await this.calculateTrends(agentIds);

    // Build agent name lookup for trend display
    const agentNameMap = new Map(agents.map(a => [a.id, a.agent_name]));

    // Build business context for LLM
    const businessContext: BusinessContext = {
      business_objects: this.aggregateBusinessObjects(workflows),
      active_insights: activeInsights,
      trends: {
        ...trends,
        busiest_workflow: agentNameMap.get(trends.busiest_workflow) || trends.busiest_workflow,
        most_improved_workflow: trends.most_improved_workflow
          ? agentNameMap.get(trends.most_improved_workflow)
          : undefined,
        declining_workflow: trends.declining_workflow
          ? agentNameMap.get(trends.declining_workflow)
          : undefined,
      },
    };

    return {
      total_workflows: agents.length,
      total_executions_30d: totalRuns,
      total_time_saved_seconds: totalTimeSaved,
      overall_success_rate: totalSteps > 0 ? totalSuccessful / totalSteps : 1,
      active_workflows: agents.filter(a => a.status === 'active').length,
      groups: groupSummaries,
      top_performers: topPerformers,
      needs_attention: needsAttention,
      business_context: businessContext,
    };
  }

  /**
   * Aggregate business objects from workflows for context
   * Groups by plugins used to understand what business domains are automated
   */
  private aggregateBusinessObjects(workflows: WorkflowPerformance[]): BusinessContext['business_objects'] {
    // Group workflows by their plugins to understand business domains
    const pluginGroups = new Map<string, { workflows: string[]; items: number }>();

    for (const w of workflows) {
      if (w.plugins && w.plugins.length > 0) {
        // Use the primary plugin (first one) as the grouping key
        const primaryPlugin = w.plugins[0];
        const existing = pluginGroups.get(primaryPlugin) || { workflows: [], items: 0 };
        existing.workflows.push(w.name);
        existing.items += w.total_items_processed || 0;
        pluginGroups.set(primaryPlugin, existing);
      }
    }

    return Array.from(pluginGroups.entries()).map(([plugin, data]) => ({
      domain: plugin, // Let LLM interpret the plugin name
      object_types: data.workflows, // Workflow names hint at what's being processed
      total_processed_30d: data.items,
    }));
  }

  private emptyPortfolio(): PortfolioSummary {
    return {
      total_workflows: 0,
      total_executions_30d: 0,
      total_time_saved_seconds: 0,
      overall_success_rate: 1,
      active_workflows: 0,
      groups: [],
      top_performers: [],
      needs_attention: [],
    };
  }

  private determineStatus(
    agentStatus: string,
    successRate: number,
    runs: number
  ): 'active' | 'inactive' | 'failing' {
    if (agentStatus === 'inactive' || runs === 0) return 'inactive';
    if (successRate < 0.7) return 'failing';
    return 'active';
  }

  // ============================================================================
  // AI Recommendation Generation
  // ============================================================================

  private async generateAIRecommendations(
    portfolio: PortfolioSummary,
    quickMode = false,
    orgContext?: OrganizationContext
  ): Promise<{ recommendations: StrategicRecommendation[]; summary: string }> {
    if (portfolio.total_workflows === 0) {
      return {
        recommendations: [],
        summary: 'No workflows found. Create your first automation to get started.',
      };
    }

    // Build the prompt (with organization context if available)
    const prompt = this.buildPrompt(portfolio, quickMode, orgContext);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: quickMode ? 1000 : 2000,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Parse response
      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      return this.parseAIResponse(content.text);
    } catch (error) {
      logger.error({ err: error }, 'Failed to generate AI recommendations');

      // Return empty recommendations on error
      return {
        recommendations: [],
        summary: 'Unable to generate recommendations at this time.',
      };
    }
  }

  /**
   * Build the prompt for business storytelling
   * Optimized for token efficiency while providing rich context
   */
  private buildPrompt(portfolio: PortfolioSummary, quickMode: boolean, orgContext?: OrganizationContext): string {
    const bc = portfolio.business_context;

    // Workflow summary with purpose/description
    const topWorkflows = [...portfolio.top_performers, ...portfolio.needs_attention]
      .filter(w => w.runs_30d > 0)
      .slice(0, 10)
      .map(w => {
        const plugins = w.plugins?.join(', ') || 'unknown';
        const items = w.total_items_processed || 0;
        const purpose = w.purpose || w.description || '';
        const timeSaved = w.avg_time_saved_seconds > 0 ? this.formatTime(w.avg_time_saved_seconds * w.runs_30d) : '0';
        return `- ${w.name}
    Purpose: ${purpose || 'Not specified'}
    Plugins: ${plugins}
    Stats: ${w.runs_30d} runs, ${(w.success_rate * 100).toFixed(0)}% success, ${items} items processed, ${timeSaved} saved`;
      })
      .join('\n');

    // Full insight details including recommendation and ROI
    const topInsights = bc?.active_insights
      ?.slice(0, 10)
      .map(i => {
        const roiInfo = [];
        if (i.time_saved_hours_per_week) roiInfo.push(`${i.time_saved_hours_per_week.toFixed(1)}h/week saved`);
        if (i.cost_saved_usd_per_week) roiInfo.push(`$${i.cost_saved_usd_per_week.toFixed(0)}/week saved`);
        if (i.revenue_at_risk_usd) roiInfo.push(`$${i.revenue_at_risk_usd.toFixed(0)} at risk`);
        const roi = roiInfo.length > 0 ? `\n    ROI: ${roiInfo.join(', ')}` : '';
        const rec = i.recommendation ? `\n    Suggested Action: ${i.recommendation}` : '';
        return `[${i.severity.toUpperCase()}] ${i.agent_name}: ${i.title}
    What: ${i.description}
    Category: ${i.category} | Type: ${i.insight_type} | Confidence: ${(i.confidence * 100).toFixed(0)}%${roi}${rec}`;
      })
      .join('\n\n') || '';

    // Organization context - expanded
    const orgSection = orgContext ? `
Industry: ${orgContext.industry || 'Not specified'}
Company Size: ${orgContext.company_size || 'Not specified'}
Primary Goal: ${orgContext.primary_goal || 'Not specified'}
Technical Level: ${orgContext.technical_level || 'Not specified'}` : 'No organization context configured';

    // Trends with workflow names
    const trendsSection = bc?.trends ? `
Volume Change (30d): ${bc.trends.volume_change_pct >= 0 ? '+' : ''}${bc.trends.volume_change_pct}%
Success Rate Change: ${bc.trends.success_rate_change_pct >= 0 ? '+' : ''}${bc.trends.success_rate_change_pct}%
Busiest Workflow: ${bc.trends.busiest_workflow || 'N/A'}
${bc.trends.most_improved_workflow ? `Most Improved: ${bc.trends.most_improved_workflow}` : ''}
${bc.trends.declining_workflow ? `Needs Attention: ${bc.trends.declining_workflow}` : ''}` : 'No trend data available';

    // Groups summary
    const groupsSection = portfolio.groups.length > 0
      ? portfolio.groups.map(g =>
          `- ${g.name}: ${g.workflow_count} workflows, ${g.total_runs_30d} runs, ${(g.success_rate * 100).toFixed(0)}% success`
        ).join('\n')
      : 'No workflow groups defined';

    const prompt = `You are a business automation advisor. Analyze this automation portfolio and provide an executive summary with actionable recommendations.

## Organization Profile
${orgSection}

## Portfolio Summary
- Total Workflows: ${portfolio.total_workflows}
- Active Workflows: ${portfolio.active_workflows}
- Executions (30 days): ${portfolio.total_executions_30d}
- Total Time Saved: ${this.formatTime(portfolio.total_time_saved_seconds)}
- Overall Success Rate: ${(portfolio.overall_success_rate * 100).toFixed(0)}%

## Trends & Patterns
${trendsSection}

## Workflow Categories
${groupsSection}

## Active Workflows (with recent activity)
${topWorkflows || 'No workflows have run in the last 30 days.'}

## Detected Issues & Opportunities
These insights were automatically detected from actual execution data:

${topInsights || 'No insights detected yet. The system will generate insights after more workflow executions.'}

## Your Task
Based on ALL the data above, provide:
1. An executive summary (2-3 sentences) that captures the overall health of their automation portfolio
2. ${quickMode ? '3' : '3-5'} prioritized recommendations

${topInsights ? `IMPORTANT: Your recommendations should be based on the detected insights above. Synthesize related insights into actionable recommendations. Use the "Suggested Action" from each insight as guidance.` : `Since no insights are detected yet, provide general recommendations based on the portfolio metrics.`}

## Output Format (JSON only, no markdown)
{"recommendations":[{"type":"cost_savings|time_savings|growth|fix_issue|optimize","title":"Business-focused title","description":"What the data shows and why it matters to their business","action":"Specific next step they should take","impact":"Expected business outcome","priority":"high|medium|low"}],"summary":"Executive summary that mentions their industry/goal and key findings"}

## Rules
- Write for a non-technical ${orgContext?.industry || 'business'} owner
- Frame value in terms relevant to their goal: ${orgContext?.primary_goal || 'efficiency'}
- Reference specific workflows by name when relevant
- DO NOT invent issues not shown in the data
- Priority: critical/high severity → high, medium → medium, low → low`;

    return prompt;
  }

  private parseAIResponse(text: string): { recommendations: StrategicRecommendation[]; summary: string } {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr.trim());

      // Clean up summary: remove leading/trailing dashes, em dashes, and whitespace
      let summary = parsed.summary || 'Analysis complete.';
      summary = summary
        .replace(/^[\s—–-]+/, '')  // Remove leading dashes/em-dashes/en-dashes
        .replace(/[\s—–-]+$/, '')  // Remove trailing dashes/em-dashes/en-dashes
        .trim();

      return {
        recommendations: parsed.recommendations || [],
        summary: summary || 'Analysis complete.',
      };
    } catch (error) {
      logger.warn({ error, text: text.slice(0, 500) }, 'Failed to parse AI response');
      return {
        recommendations: [],
        summary: text.slice(0, 500),  // Use raw text as summary
      };
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }


  private calculateNextReviewDate(portfolio: PortfolioSummary): string {
    // More workflows or more issues = more frequent reviews
    let daysUntilReview = 30;

    if (portfolio.needs_attention.length > 3) {
      daysUntilReview = 7;
    } else if (portfolio.needs_attention.length > 0) {
      daysUntilReview = 14;
    } else if (portfolio.total_workflows > 10) {
      daysUntilReview = 14;
    }

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + daysUntilReview);
    return nextReview.toISOString();
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let advisorInstance: AutomationAdvisor | null = null;

export function getAutomationAdvisor(supabaseClient?: SupabaseClient): AutomationAdvisor {
  if (!advisorInstance) {
    advisorInstance = new AutomationAdvisor(supabaseClient);
  }
  return advisorInstance;
}

export { AutomationAdvisor as default };
