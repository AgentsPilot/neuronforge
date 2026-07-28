// app/api/admin/token-usage/drill-down/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'TokenUsageDrillDownAPI' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = 'force-dynamic';

// Types
interface CategoryBreakdown {
  creation: { cost: number; tokens: number; calls: number };
  execution: { cost: number; tokens: number; calls: number };
  memory: { cost: number; tokens: number; calls: number };
  system: { cost: number; tokens: number; calls: number };
}

interface PeriodComparison {
  previousPeriod: {
    cost: number;
    tokens: number;
    calls: number;
    from: string;
    to: string;
  };
  changes: {
    costPct: number;
    tokensPct: number;
    callsPct: number;
  };
}

interface DrillDownItem {
  id: string;
  label: string;
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  percentage: number;
  type: 'provider' | 'model' | 'activity' | 'user' | 'agent' | 'execution' | 'call' | 'request_type' | 'feature' | 'component' | 'endpoint';
  metadata?: Record<string, unknown>;
  isHighCost?: boolean;
  category_breakdown?: CategoryBreakdown;
}

interface DrillDownResponse {
  success: boolean;
  totals: { cost: number; tokens: number; inputTokens: number; outputTokens: number; calls: number };
  items: DrillDownItem[];
  filters: {
    provider?: string;
    model?: string;
    activity?: string;
    user?: string;
    agent?: string;
    category?: string;
  };
  availableFilters: {
    providers: string[];
    models: string[];
    activities: string[];
    users: Array<{ id: string; label: string }>;
    agents: Array<{ id: string; label: string }>;
  };
  categoryTotals: CategoryBreakdown;
  period: { from: string; to: string };
  comparison?: PeriodComparison;
}

/**
 * GET /api/admin/token-usage/drill-down
 *
 * BI-style aggregation API for cost analytics.
 * Supports multiple filters that stack together.
 *
 * Query params:
 * - breakdownBy: 'provider' | 'model' | 'activity' | 'user' | 'agent' | 'request_type' | 'feature' | 'component' | 'endpoint' (what to group by)
 * - provider: filter by provider
 * - model: filter by model
 * - activity: filter by activity type
 * - user: filter by user_id
 * - agent: filter by agent_id
 * - execution: filter by execution_id (returns individual calls)
 * - period: number of days (default: 30)
 * - dateFrom, dateTo: explicit date range
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const breakdownBy = searchParams.get('breakdownBy') || 'provider';
    const provider = searchParams.get('provider');
    const model = searchParams.get('model');
    const activity = searchParams.get('activity');
    const request_type = searchParams.get('request_type');
    const feature = searchParams.get('feature');
    const component = searchParams.get('component');
    const endpoint = searchParams.get('endpoint');
    const user = searchParams.get('user');
    const agent = searchParams.get('agent');
    const execution = searchParams.get('execution');
    const category = searchParams.get('category') || 'all'; // 'all' | 'creation' | 'execution' | 'memory' | 'other'

    // Date range handling
    const periodParam = searchParams.get('period');
    const periodDays = periodParam ? Math.min(Math.max(parseInt(periodParam, 10), 1), 365) : 30;
    let dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo') || new Date().toISOString();

    if (!dateFrom) {
      const periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - periodDays);
      dateFrom = periodStart.toISOString();
    }

    logger.info({ breakdownBy, provider, model, activity, request_type, feature, component, endpoint, user, agent, execution, category, dateFrom, dateTo }, 'BI Drill-down API called');

    // If execution is provided, return individual calls
    if (execution) {
      return await getExecutionCalls(execution);
    }

    // Build filters object
    const filters = {
      provider: provider || undefined,
      model: model || undefined,
      activity: activity || undefined,
      request_type: request_type || undefined,
      feature: feature || undefined,
      component: component || undefined,
      endpoint: endpoint || undefined,
      user: user || undefined,
      agent: agent || undefined,
      category: category !== 'all' ? category : undefined
    };

    // Get aggregated data with filters applied
    const result = await getAggregatedData(breakdownBy, filters, dateFrom, dateTo, category);

    return NextResponse.json(result);

  } catch (error) {
    logger.error({ err: error }, 'BI Drill-down API error');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Activity type classifications for category detection
const CREATION_ACTIVITY_TYPES = [
  'agent_creation',
  'agent_generation',
  'intent_contract_generation',
  'intent_extraction',
  'semantic_plan_generation',
  'semantic_skeleton_generation',
  'ir_formalization',
  'workflow_generation',
  'dsl_repair',
  'requirements_extraction',
  'correction_intent_extraction',
  'capability_binding',
];

const MEMORY_ACTIVITY_TYPES = [
  'memory_creation',
  'memory_summarization',
  'user_memory_extraction',
  'semantic_memory_search',
  'single_embedding',
  'batch_embedding',
  'async_embedding',
];

/**
 * Get aggregated data with BI-style filtering
 */
async function getAggregatedData(
  breakdownBy: string,
  filters: {
    provider?: string;
    model?: string;
    activity?: string;
    user?: string;
    agent?: string;
    category?: string;
  },
  dateFrom: string,
  dateTo: string,
  category: string = 'all'
): Promise<DrillDownResponse> {
  // Build base query with all filters
  let query = supabase
    .from('token_usage')
    .select('*')
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo);

  if (filters.provider) query = query.eq('provider', filters.provider);
  if (filters.model) query = query.eq('model_name', filters.model);
  if (filters.activity) query = query.eq('activity_type', filters.activity);
  if (filters.request_type) query = query.eq('request_type', filters.request_type);
  if (filters.feature) query = query.eq('feature', filters.feature);
  if (filters.component) query = query.eq('component', filters.component);
  if (filters.endpoint) query = query.eq('endpoint', filters.endpoint);

  // Handle user filter - "system" means NULL user_id
  if (filters.user) {
    if (filters.user === 'system') {
      query = query.is('user_id', null);
    } else {
      query = query.eq('user_id', filters.user);
    }
  }

  // Handle agent filter - "no-agent" means NULL agent_id
  if (filters.agent) {
    if (filters.agent === 'no-agent') {
      query = query.is('agent_id', null);
    } else {
      query = query.eq('agent_id', filters.agent);
    }
  }

  // Category filter - note: we'll filter in memory after fetching since category
  // determination requires pattern matching on activity_type/activity_name
  // For 'execution' category we can filter by execution_id IS NOT NULL at DB level
  if (category === 'execution') {
    query = query.not('execution_id', 'is', null);
  }

  const { data: records, error } = await query;

  if (error) {
    logger.error({ err: error }, 'Failed to fetch token usage data');
    throw error;
  }

  const emptyCategoryTotals: CategoryBreakdown = {
    creation: { cost: 0, tokens: 0, calls: 0 },
    execution: { cost: 0, tokens: 0, calls: 0 },
    memory: { cost: 0, tokens: 0, calls: 0 },
    system: { cost: 0, tokens: 0, calls: 0 }
  };

  if (!records || records.length === 0) {
    return {
      success: true,
      totals: { cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, calls: 0 },
      items: [],
      filters,
      availableFilters: {
        providers: [],
        models: [],
        activities: [],
        users: [],
        agents: []
      },
      categoryTotals: emptyCategoryTotals,
      period: { from: dateFrom, to: dateTo }
    };
  }

  // Compute categoryTotals from ALL records (before category filtering)
  const categoryTotals: CategoryBreakdown = {
    creation: { cost: 0, tokens: 0, calls: 0 },
    execution: { cost: 0, tokens: 0, calls: 0 },
    memory: { cost: 0, tokens: 0, calls: 0 },
    system: { cost: 0, tokens: 0, calls: 0 }
  };

  for (const record of records) {
    const recordCategory = getActivityCategory(record.activity_type || '', record.activity_name, record.category);
    const cost = parseFloat(record.cost_usd) || 0;
    const tokens = (record.input_tokens || 0) + (record.output_tokens || 0);
    categoryTotals[recordCategory].cost += cost;
    categoryTotals[recordCategory].tokens += tokens;
    categoryTotals[recordCategory].calls += 1;
  }

  // Filter records by category if specified (for categories other than 'execution' which was already filtered at DB level)
  let filteredRecords = records;
  if (category !== 'all' && category !== 'execution') {
    filteredRecords = records.filter(record => {
      const recordCategory = getActivityCategory(record.activity_type || '', record.activity_name, record.category);
      return recordCategory === category;
    });
  }

  // Calculate totals from filtered records
  const totals = {
    cost: filteredRecords.reduce((sum, r) => sum + (parseFloat(r.cost_usd) || 0), 0),
    tokens: filteredRecords.reduce((sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0),
    inputTokens: filteredRecords.reduce((sum, r) => sum + (r.input_tokens || 0), 0),
    outputTokens: filteredRecords.reduce((sum, r) => sum + (r.output_tokens || 0), 0),
    calls: filteredRecords.length
  };

  // Get available filter values from current dataset
  const availableFilters = await getAvailableFilters(filteredRecords);

  // Group data based on breakdownBy parameter
  const items = await aggregateByDimension(filteredRecords, breakdownBy, totals);

  // Mark high-cost items (top 20%)
  if (items.length > 0) {
    const sortedByCost = [...items].sort((a, b) => b.cost - a.cost);
    const threshold = sortedByCost[Math.floor(items.length * 0.2)]?.cost || 0;
    items.forEach(item => {
      item.isHighCost = item.cost >= threshold && threshold > 0;
    });
  }

  // Calculate period comparison - fetch data from previous period
  const periodMs = new Date(dateTo).getTime() - new Date(dateFrom).getTime();
  const prevPeriodTo = new Date(new Date(dateFrom).getTime() - 1); // 1ms before current period start
  const prevPeriodFrom = new Date(prevPeriodTo.getTime() - periodMs);

  let comparison: PeriodComparison | undefined;

  // Build comparison query with same filters
  let comparisonQuery = supabase
    .from('token_usage')
    .select('cost_usd, input_tokens, output_tokens')
    .gte('created_at', prevPeriodFrom.toISOString())
    .lte('created_at', prevPeriodTo.toISOString());

  if (filters.provider) comparisonQuery = comparisonQuery.eq('provider', filters.provider);
  if (filters.model) comparisonQuery = comparisonQuery.eq('model_name', filters.model);
  if (filters.activity) comparisonQuery = comparisonQuery.eq('activity_type', filters.activity);
  if (filters.user) {
    if (filters.user === 'system') {
      comparisonQuery = comparisonQuery.is('user_id', null);
    } else {
      comparisonQuery = comparisonQuery.eq('user_id', filters.user);
    }
  }
  if (filters.agent) {
    if (filters.agent === 'no-agent') {
      comparisonQuery = comparisonQuery.is('agent_id', null);
    } else {
      comparisonQuery = comparisonQuery.eq('agent_id', filters.agent);
    }
  }

  const { data: prevRecords } = await comparisonQuery;

  if (prevRecords && prevRecords.length > 0) {
    const prevCost = prevRecords.reduce((sum, r) => sum + (parseFloat(r.cost_usd) || 0), 0);
    const prevTokens = prevRecords.reduce((sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
    const prevCalls = prevRecords.length;

    comparison = {
      previousPeriod: {
        cost: prevCost,
        tokens: prevTokens,
        calls: prevCalls,
        from: prevPeriodFrom.toISOString(),
        to: prevPeriodTo.toISOString()
      },
      changes: {
        costPct: prevCost > 0 ? ((totals.cost - prevCost) / prevCost) * 100 : (totals.cost > 0 ? 100 : 0),
        tokensPct: prevTokens > 0 ? ((totals.tokens - prevTokens) / prevTokens) * 100 : (totals.tokens > 0 ? 100 : 0),
        callsPct: prevCalls > 0 ? ((totals.calls - prevCalls) / prevCalls) * 100 : (totals.calls > 0 ? 100 : 0)
      }
    };
  }

  return {
    success: true,
    totals,
    items: items.sort((a, b) => b.cost - a.cost),
    filters,
    availableFilters,
    categoryTotals,
    period: { from: dateFrom, to: dateTo },
    comparison
  };
}

/**
 * Get available filter values from the current dataset
 */
async function getAvailableFilters(records: any[]): Promise<DrillDownResponse['availableFilters']> {
  // Extract unique values from records
  const providers = [...new Set(records.map(r => r.provider).filter(Boolean))];
  const models = [...new Set(records.map(r => r.model_name).filter(Boolean))];
  const activities = [...new Set(records.map(r => r.activity_type).filter(Boolean))];
  const userIds = [...new Set(records.map(r => r.user_id).filter(Boolean))];
  const agentIds = [...new Set(records.map(r => r.agent_id).filter(Boolean))];

  // Fetch user emails from auth.users
  let users: Array<{ id: string; label: string }> = [];
  if (userIds.length > 0) {
    // Fetch emails from auth.users via admin API
    const { data: authData } = await supabase.auth.admin.listUsers();
    const authUsers = authData?.users || [];

    // Also fetch profiles for full_name fallback
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);

    // Build maps for lookup
    const authEmailMap = new Map<string, string>();
    authUsers.forEach(u => {
      if (u.email) {
        authEmailMap.set(u.id, u.email);
      }
    });

    const profileNameMap = new Map<string, string>();
    (profiles || []).forEach(p => {
      if (p.full_name) {
        profileNameMap.set(p.id, p.full_name);
      }
    });

    users = userIds.map(userId => ({
      id: userId,
      label: authEmailMap.get(userId) || profileNameMap.get(userId) || userId
    }));
  }

  // Fetch agent names
  let agents: Array<{ id: string; label: string }> = [];
  if (agentIds.length > 0) {
    const { data: agentRecords } = await supabase
      .from('agents')
      .select('id, agent_name')
      .in('id', agentIds);

    agents = (agentRecords || []).map(a => ({
      id: a.id,
      label: a.agent_name || a.id
    }));
  }

  return {
    providers: providers.sort(),
    models: models.sort(),
    activities: activities.sort(),
    users,
    agents
  };
}

/**
 * Aggregate records by a specific dimension
 */
async function aggregateByDimension(
  records: any[],
  breakdownBy: string,
  totals: { cost: number; tokens: number; inputTokens: number; outputTokens: number; calls: number }
): Promise<DrillDownItem[]> {
  const groups = new Map<string, {
    cost: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    calls: number;
    metadata: Record<string, unknown>;
    category_breakdown: CategoryBreakdown;
    // Track context for each group
    userIds: Set<string>;
    agentIds: Set<string>;
    activities: Set<string>;
    models: Set<string>;
    providers: Set<string>;
  }>();

  // Group records
  for (const record of records) {
    let key: string;
    let metadata: Record<string, unknown> = {};

    switch (breakdownBy) {
      case 'provider':
        key = record.provider || 'unknown';
        break;
      case 'model':
        key = record.model_name || 'unknown';
        metadata.provider = record.provider;
        break;
      case 'activity':
        key = record.activity_type || 'unknown';
        // Category will be determined later based on dominant cost allocation
        break;
      case 'request_type':
        key = record.request_type || 'unknown';
        metadata.category = record.category;
        break;
      case 'feature':
        key = record.feature || 'unspecified';
        metadata.category = record.category;
        break;
      case 'component':
        key = record.component || 'unspecified';
        metadata.category = record.category;
        break;
      case 'endpoint':
        key = record.endpoint || 'unspecified';
        metadata.category = record.category;
        break;
      case 'user':
        key = record.user_id || 'system';
        break;
      case 'agent':
        key = record.agent_id || 'no-agent';
        break;
      case 'execution':
        key = record.execution_id || `single-${record.id}`;
        metadata.timestamp = record.created_at;
        metadata.agentId = record.agent_id;
        break;
      default:
        key = record.provider || 'unknown';
    }

    if (!groups.has(key)) {
      groups.set(key, {
        cost: 0,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        calls: 0,
        metadata,
        category_breakdown: {
          creation: { cost: 0, tokens: 0, calls: 0 },
          execution: { cost: 0, tokens: 0, calls: 0 },
          memory: { cost: 0, tokens: 0, calls: 0 },
          system: { cost: 0, tokens: 0, calls: 0 }
        },
        userIds: new Set(),
        agentIds: new Set(),
        activities: new Set(),
        models: new Set(),
        providers: new Set()
      });
    }

    const group = groups.get(key)!;
    const recordCost = parseFloat(record.cost_usd) || 0;
    const recordTokens = (record.input_tokens || 0) + (record.output_tokens || 0);

    group.cost += recordCost;
    group.tokens += recordTokens;
    group.inputTokens += record.input_tokens || 0;
    group.outputTokens += record.output_tokens || 0;
    group.calls += 1;

    // Track context - collect unique values for each dimension
    if (record.user_id) group.userIds.add(record.user_id);
    if (record.agent_id) group.agentIds.add(record.agent_id);
    if (record.activity_type) group.activities.add(record.activity_type);
    if (record.model_name) group.models.add(record.model_name);
    if (record.provider) group.providers.add(record.provider);

    // Track category breakdown for this group
    const recordCategory = getActivityCategory(record.activity_type || '', record.activity_name, record.category);
    group.category_breakdown[recordCategory].cost += recordCost;
    group.category_breakdown[recordCategory].tokens += recordTokens;
    group.category_breakdown[recordCategory].calls += 1;

    // Preserve metadata
    if (!group.metadata.timestamp && record.created_at) {
      group.metadata.timestamp = record.created_at;
    }
  }

  // Collect ALL user and agent IDs across all groups (for context labels)
  const allUserIds = new Set<string>();
  const allAgentIds = new Set<string>();
  const allExecutionIds = new Set<string>();

  for (const group of groups.values()) {
    group.userIds.forEach(id => allUserIds.add(id));
    group.agentIds.forEach(id => allAgentIds.add(id));
  }

  // For execution breakdown, collect execution IDs
  if (breakdownBy === 'execution') {
    for (const key of groups.keys()) {
      if (!key.startsWith('single-')) {
        allExecutionIds.add(key);
      }
    }
  }

  // Also add primary grouping keys
  if (breakdownBy === 'user') {
    Array.from(groups.keys()).filter(id => id !== 'system').forEach(id => allUserIds.add(id));
  }
  if (breakdownBy === 'agent') {
    Array.from(groups.keys()).filter(id => id !== 'no-agent').forEach(id => allAgentIds.add(id));
  }

  const userLabels = new Map<string, string>();
  const agentLabels = new Map<string, string>();
  const executionLabels = new Map<string, { agentName: string; timestamp: string; status?: string }>();

  // Fetch user labels
  if (allUserIds.size > 0) {
    const userIdsArray = Array.from(allUserIds);
    // Fetch emails from auth.users via admin API
    const { data: authData } = await supabase.auth.admin.listUsers();
    const authUsers = authData?.users || [];

    // Also fetch profiles for full_name fallback
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIdsArray);

    // Build a map of user_id -> email from auth.users
    const authEmailMap = new Map<string, string>();
    authUsers.forEach(u => {
      if (u.email) {
        authEmailMap.set(u.id, u.email);
      }
    });

    // Build a map of user_id -> full_name from profiles
    const profileNameMap = new Map<string, string>();
    (profiles || []).forEach(p => {
      if (p.full_name) {
        profileNameMap.set(p.id, p.full_name);
      }
    });

    // Set labels with priority: email > full_name > id
    userIdsArray.forEach(userId => {
      const email = authEmailMap.get(userId);
      const fullName = profileNameMap.get(userId);
      userLabels.set(userId, email || fullName || userId.slice(0, 8) + '...');
    });
  }

  // Fetch agent labels
  if (allAgentIds.size > 0) {
    const { data: agents } = await supabase
      .from('agents')
      .select('id, agent_name')
      .in('id', Array.from(allAgentIds));

    (agents || []).forEach(a => {
      agentLabels.set(a.id, a.agent_name || a.id);
    });
  }

  // Fetch execution details (agent name + timestamp)
  if (allExecutionIds.size > 0) {
    const { data: executions } = await supabase
      .from('workflow_executions')
      .select('id, agent_id, started_at, status')
      .in('id', Array.from(allExecutionIds));

    if (executions) {
      // Get agent names for these executions
      const execAgentIds = executions.map(e => e.agent_id).filter(Boolean);
      if (execAgentIds.length > 0) {
        const { data: execAgents } = await supabase
          .from('agents')
          .select('id, agent_name')
          .in('id', execAgentIds);

        const execAgentMap = new Map<string, string>();
        (execAgents || []).forEach(a => {
          execAgentMap.set(a.id, a.agent_name || 'Unknown Agent');
          // Also add to main agent labels
          agentLabels.set(a.id, a.agent_name || a.id);
        });

        executions.forEach(e => {
          const agentName = e.agent_id ? execAgentMap.get(e.agent_id) || 'Unknown' : 'System';
          const timestamp = new Date(e.started_at).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
          executionLabels.set(e.id, { agentName, timestamp, status: e.status });
        });
      }
    }
  }

  // Build items
  const items: DrillDownItem[] = [];

  for (const [key, group] of groups) {
    let label = key;

    // Get proper label
    switch (breakdownBy) {
      case 'user':
        label = key === 'system' ? 'System' : userLabels.get(key) || key;
        break;
      case 'agent':
        label = key === 'no-agent' ? 'System / Platform' : agentLabels.get(key) || key;
        break;
      case 'activity':
        label = formatActivityLabel(key);
        break;
      case 'execution':
        const execInfo = executionLabels.get(key);
        if (execInfo) {
          // Format: "Agent Name - Jun 15, 3:45 PM"
          label = `${execInfo.agentName} - ${execInfo.timestamp}`;
        } else if (group.metadata.timestamp) {
          // Fallback for single-* entries
          label = new Date(group.metadata.timestamp as string).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
        }
        break;
    }

    // Build context metadata - shows related dimensions for this group
    const contextMeta: Record<string, unknown> = { ...group.metadata };

    // Add context about which users are involved (if not grouping by user)
    if (breakdownBy !== 'user' && group.userIds.size > 0) {
      const userNames = Array.from(group.userIds).map(id => userLabels.get(id) || id.slice(0, 8));
      contextMeta.users = userNames.length <= 3 ? userNames : [...userNames.slice(0, 2), `+${userNames.length - 2} more`];
      contextMeta.userCount = group.userIds.size;
    }

    // Add context about which agents are involved (if not grouping by agent)
    if (breakdownBy !== 'agent' && group.agentIds.size > 0) {
      const agentNames = Array.from(group.agentIds).map(id => agentLabels.get(id) || id.slice(0, 8));
      contextMeta.agents = agentNames.length <= 3 ? agentNames : [...agentNames.slice(0, 2), `+${agentNames.length - 2} more`];
      contextMeta.agentCount = group.agentIds.size;
    }

    // Add context about which activities are involved (if not grouping by activity)
    if (breakdownBy !== 'activity' && group.activities.size > 0) {
      const activityNames = Array.from(group.activities).map(a => formatActivityLabel(a));
      contextMeta.activities = activityNames.length <= 3 ? activityNames : [...activityNames.slice(0, 2), `+${activityNames.length - 2} more`];
      contextMeta.activityCount = group.activities.size;
    }

    // Add context about which models are involved (if not grouping by model)
    if (breakdownBy !== 'model' && group.models.size > 0) {
      contextMeta.models = Array.from(group.models);
      contextMeta.modelCount = group.models.size;
    }

    // Add context about which providers are involved (if not grouping by provider)
    if (breakdownBy !== 'provider' && group.providers.size > 0) {
      contextMeta.providers = Array.from(group.providers);
      contextMeta.providerCount = group.providers.size;
    }

    // For activity type grouping, determine the dominant category (highest cost)
    // This ensures the category badge reflects where most of the cost is allocated
    if (breakdownBy === 'activity') {
      let dominantCategory: ActivityCategory = 'system';
      let highestCost = 0;

      for (const [cat, breakdown] of Object.entries(group.category_breakdown)) {
        if (breakdown.cost > highestCost) {
          highestCost = breakdown.cost;
          dominantCategory = cat as ActivityCategory;
        }
      }

      contextMeta.category = dominantCategory;
    }

    items.push({
      id: key,
      label,
      cost: group.cost,
      tokens: group.tokens,
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
      calls: group.calls,
      percentage: totals.cost > 0 ? (group.cost / totals.cost) * 100 : 0,
      type: breakdownBy as DrillDownItem['type'],
      metadata: contextMeta,
      category_breakdown: group.category_breakdown
    });
  }

  return items;
}

/**
 * Get individual calls for a specific execution
 */
/**
 * Format step ID into a human-readable label
 * e.g., "step_9" -> "Step 9", "fetch_emails" -> "Fetch Emails"
 */
function formatStepLabel(stepId: string): string {
  if (!stepId) return '';

  // Handle "step_N" format
  const stepMatch = stepId.match(/^step[_-]?(\d+)$/i);
  if (stepMatch) {
    return `Step ${stepMatch[1]}`;
  }

  // Otherwise title-case the step ID
  return stepId
    .replace(/[_-]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

async function getExecutionCalls(executionId: string): Promise<NextResponse> {
  // Handle synthetic single-call execution IDs (format: "single-{token_usage_id}")
  // These are generated when a token_usage record has no execution_id
  if (executionId.startsWith('single-')) {
    const tokenUsageId = executionId.replace('single-', '');
    const { data: record, error } = await supabase
      .from('token_usage')
      .select('*')
      .eq('id', tokenUsageId)
      .single();

    if (error || !record) {
      logger.error({ err: error }, 'Failed to fetch single call');
      return NextResponse.json({ success: false, error: 'Failed to fetch data' }, { status: 500 });
    }

    const cost = parseFloat(record.cost_usd) || 0;
    const tokens = (record.input_tokens || 0) + (record.output_tokens || 0);

    // Build a meaningful label from available fields
    let label = record.activity_name
      || record.activity_step
      || record.feature
      || record.component;

    // Try workflow_step but format it nicely
    if (!label && record.workflow_step) {
      label = formatStepLabel(record.workflow_step);
    }

    // If still no label, try to use activity_type formatted nicely
    if (!label && record.activity_type) {
      label = formatActivityLabel(record.activity_type);
    }

    // Final fallback with model info
    if (!label) {
      label = record.model_name ? `${record.model_name} call` : 'Single Call';
    }

    const item: DrillDownItem = {
      id: record.id,
      label,
      cost,
      tokens,
      inputTokens: record.input_tokens || 0,
      outputTokens: record.output_tokens || 0,
      calls: 1,
      percentage: 100,
      type: 'call',
      metadata: {
        model: record.model_name,
        provider: record.provider,
        inputTokens: record.input_tokens,
        outputTokens: record.output_tokens,
        latencyMs: record.latency_ms,
        success: record.success,
        timestamp: record.created_at,
        step: record.workflow_step || record.activity_step || record.activity_name,
        activity: record.activity_type ? formatActivityLabel(record.activity_type) : undefined,
        callId: record.call_id
      }
    };

    return NextResponse.json({
      success: true,
      totals: { cost, tokens, inputTokens: record.input_tokens || 0, outputTokens: record.output_tokens || 0, calls: 1 },
      items: [item],
      filters: { execution: executionId },
      availableFilters: { providers: [], models: [], activities: [], users: [], agents: [] }
    });
  }

  const { data: records, error } = await supabase
    .from('token_usage')
    .select('*')
    .eq('execution_id', executionId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ err: error }, 'Failed to fetch execution calls');
    return NextResponse.json({ success: false, error: 'Failed to fetch data' }, { status: 500 });
  }

  // Fetch execution info to get agent_id
  const { data: executionInfo } = await supabase
    .from('workflow_executions')
    .select('agent_id, started_at, completed_at, status, input_data, output_data')
    .eq('id', executionId)
    .single();

  // Fetch agent data if we have an agent_id
  let agentData = null;
  if (executionInfo?.agent_id) {
    const { data: agent } = await supabase
      .from('agents')
      .select('id, agent_name, user_prompt, system_prompt, pilot_steps, input_schema, output_schema, connected_plugins, mode, status')
      .eq('id', executionInfo.agent_id)
      .single();

    if (agent) {
      agentData = {
        id: agent.id,
        name: agent.agent_name,
        userPrompt: agent.user_prompt,
        systemPrompt: agent.system_prompt,
        pilotSteps: agent.pilot_steps,
        inputSchema: agent.input_schema,
        outputSchema: agent.output_schema,
        connectedPlugins: agent.connected_plugins,
        mode: agent.mode,
        status: agent.status
      };
    }
  }

  // Try to fetch step names from workflow_step_executions table
  const stepNameMap = new Map<string, string>();
  const { data: stepExecutions } = await supabase
    .from('workflow_step_executions')
    .select('step_id, step_name')
    .eq('execution_id', executionId);

  if (stepExecutions) {
    stepExecutions.forEach(se => {
      if (se.step_id && se.step_name) {
        stepNameMap.set(se.step_id, se.step_name);
      }
    });
  }

  // Calculate totals and category breakdowns
  const categoryTotals: CategoryBreakdown = {
    creation: { cost: 0, tokens: 0, calls: 0 },
    execution: { cost: 0, tokens: 0, calls: 0 },
    memory: { cost: 0, tokens: 0, calls: 0 },
    system: { cost: 0, tokens: 0, calls: 0 }
  };

  (records || []).forEach(r => {
    const category = getActivityCategory(r.activity_type || '', r.activity_name, r.category);
    const cost = parseFloat(r.cost_usd) || 0;
    const tokens = (r.input_tokens || 0) + (r.output_tokens || 0);
    categoryTotals[category].cost += cost;
    categoryTotals[category].tokens += tokens;
    categoryTotals[category].calls += 1;
  });

  const totals = {
    cost: (records || []).reduce((sum, r) => sum + (parseFloat(r.cost_usd) || 0), 0),
    tokens: (records || []).reduce((sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0),
    inputTokens: (records || []).reduce((sum, r) => sum + (r.input_tokens || 0), 0),
    outputTokens: (records || []).reduce((sum, r) => sum + (r.output_tokens || 0), 0),
    calls: records?.length || 0
  };

  // Find the most expensive call
  const sortedByCost = [...(records || [])].sort((a, b) =>
    (parseFloat(b.cost_usd) || 0) - (parseFloat(a.cost_usd) || 0)
  );
  const mostExpensiveId = sortedByCost[0]?.id;

  const items: DrillDownItem[] = (records || []).map((record, index) => {
    // First try to get human-readable step name from workflow_step_executions
    let label = record.workflow_step ? stepNameMap.get(record.workflow_step) : undefined;

    // If not found, try other fields
    if (!label) {
      label = record.activity_name
        || record.activity_step
        || record.feature
        || record.component;
    }

    // Try workflow_step but format it nicely
    if (!label && record.workflow_step) {
      label = formatStepLabel(record.workflow_step);
    }

    // If still no label, try to use activity_type formatted nicely
    if (!label && record.activity_type) {
      label = formatActivityLabel(record.activity_type);
    }

    // Final fallback with model info
    if (!label) {
      label = record.model_name ? `${record.model_name} call` : `Call ${index + 1}`;
    }

    const category = getActivityCategory(record.activity_type || '', record.activity_name, record.category);

    return {
      id: record.id,
      label,
      cost: parseFloat(record.cost_usd) || 0,
      tokens: (record.input_tokens || 0) + (record.output_tokens || 0),
      inputTokens: record.input_tokens || 0,
      outputTokens: record.output_tokens || 0,
      calls: 1,
      percentage: totals.cost > 0 ? ((parseFloat(record.cost_usd) || 0) / totals.cost) * 100 : 0,
      type: 'call' as const,
      isHighCost: record.id === mostExpensiveId && totals.calls > 1,
      metadata: {
        model: record.model_name,
        provider: record.provider,
        inputTokens: record.input_tokens,
        outputTokens: record.output_tokens,
        latencyMs: record.latency_ms,
        success: record.success,
        timestamp: record.created_at,
        step: record.workflow_step || record.activity_step || record.activity_name,
        activity: record.activity_type ? formatActivityLabel(record.activity_type) : undefined,
        activityType: record.activity_type,
        activityName: record.activity_name,
        activityStep: record.activity_step,
        category, // 'creation' | 'execution' | 'memory' | 'system'
        dbCategory: record.category,
        requestType: record.request_type,
        feature: record.feature,
        component: record.component,
        endpoint: record.endpoint,
        workflowStep: record.workflow_step,
        callId: record.call_id
      }
    };
  });

  return NextResponse.json({
    success: true,
    totals,
    items,
    filters: { execution: executionId },
    availableFilters: { providers: [], models: [], activities: [], users: [], agents: [] },
    // Include agent and execution details for the execution view
    executionDetails: {
      executionId,
      startedAt: executionInfo?.started_at,
      completedAt: executionInfo?.completed_at,
      status: executionInfo?.status,
      inputData: executionInfo?.input_data,
      outputData: executionInfo?.output_data,
      agent: agentData
    },
    // Cost breakdown by category (creation vs execution vs memory)
    categoryTotals
  });
}

/**
 * Categorize activity types into creation vs execution vs memory vs system
 */
type ActivityCategory = 'creation' | 'execution' | 'memory' | 'system';

function getActivityCategory(activityType: string, activityName?: string, dbCategory?: string): ActivityCategory {
  // PRIORITY 1: Map DB category column to BI categories
  // The DB uses a different category taxonomy, so we need to translate
  if (dbCategory) {
    const dbCategoryLower = dbCategory.toLowerCase();

    // Map DB categories to BI categories
    switch (dbCategoryLower) {
      // Creation: agent/workflow generation, V6 pipeline
      case 'agent_creation':
      case 'v6_pipeline':
        return 'creation';

      // Execution: running agents, workflows, LLM calls
      case 'agent_workflow':
      case 'workflow_execution':
      case 'agent_execution':
        return 'execution';

      // Memory: embeddings, memory operations
      case 'memory':
      case 'embedding':
        return 'memory';

      // System: everything else (general, classification, thread management, etc.)
      case 'general':
      case 'classification':
      case 'thread_management':
      case 'simulator':
      case 'agent_input':
      case 'support':
        return 'system';

      // If DB category doesn't match known values, continue to pattern matching
      default:
        // Fall through to pattern matching below
        break;
    }
  }

  // PRIORITY 2: Pattern matching on activity_type and activity_name
  // Normalize activity type for comparison (handle both snake_case and human-readable formats)
  const normalizedType = activityType.toLowerCase().replace(/[\s-]+/g, '_');

  // Creation activities - V6 pipeline, agent generation
  const creationActivities = [
    'agent_creation',
    'agent_generation',
    'intent_contract_generation',
    'intent_extraction',
    'semantic_plan_generation',
    'semantic_skeleton_generation',
    'ir_formalization',
    'workflow_generation',
    'dsl_repair',
    'requirements_extraction',
    'correction_intent_extraction',
    'capability_binding',
    // Also match human-readable format variants
    'generate_intent_contract_v1',
    'generate_intent_contract',
  ];

  // Patterns to check in activity_type or activity_name (case-insensitive substring match)
  const creationPatterns = [
    'intent contract',
    'semantic plan',
    'semantic skeleton',
    'ir formal',
    'workflow generation',
    'dsl repair',
    'capability bind',
    'requirements extract',
    'agent creation',
    'agent generation',
  ];

  // Execution activities - running agents
  const executionActivities = [
    'agent_execution',
    'execution_retry',
    'execution_fallback',
    'data_aware_execution',
    'llm_call',
    'llm_decision',
    'plugin_call',
    'step_repair',
    'advanced_recovery',
    'orchestration',
    'semantic_compression',
    'summarize_content',
    'answer_question',
    'generate_research_summary',
  ];

  // Memory activities
  const memoryActivities = [
    'memory_creation',
    'memory_summarization',
    'user_memory_extraction',
    'semantic_memory_search',
    'single_embedding',
    'batch_embedding',
    'async_embedding',
  ];

  // System/Platform activities - calibration, insights, health checks
  const systemActivities = [
    'calibration',
    'health_check',
    'insight_generation',
    'recommendation_generation',
    'effort_estimation',
    'plugin_suggestion',
    'reward_credit',
  ];

  // Check exact match first (normalized)
  if (creationActivities.includes(normalizedType)) return 'creation';
  if (executionActivities.includes(normalizedType)) return 'execution';
  if (memoryActivities.includes(normalizedType)) return 'memory';
  if (systemActivities.includes(normalizedType)) return 'system';

  // Check pattern match in activity_type (handles "Generate Intent Contract V1" style)
  const typeUpper = activityType.toUpperCase();
  if (creationPatterns.some(pattern => typeUpper.includes(pattern.toUpperCase()))) {
    return 'creation';
  }

  // Fallback: check activity_name for known creation patterns
  // This handles legacy records that may not have activity_type set
  if (activityName) {
    const nameUpper = activityName.toUpperCase();
    if (creationPatterns.some(pattern => nameUpper.includes(pattern.toUpperCase()))) {
      return 'creation';
    }
  }

  return 'system';
}

/**
 * Format activity type labels
 */
function formatActivityLabel(activity: string): string {
  if (!activity || activity === 'unknown') return 'System / Other';

  const labels: Record<string, string> = {
    // Agent lifecycle
    'agent_creation': 'Agent Creation',
    'agent_generation': 'Agent Generation',
    'agent_execution': 'Agent Execution',
    'execution_retry': 'Execution Retry',
    'execution_fallback': 'Execution Fallback',
    'data_aware_execution': 'Data-Aware Execution',

    // V6 Pipeline (snake_case)
    'intent_contract_generation': 'Intent Contract',
    'intent_extraction': 'Intent Extraction',
    'semantic_plan_generation': 'Semantic Plan',
    'semantic_skeleton_generation': 'Semantic Skeleton',
    'ir_formalization': 'IR Formalization',
    'workflow_generation': 'Workflow Generation',
    'dsl_repair': 'DSL Repair',
    'requirements_extraction': 'Requirements Extraction',
    'correction_intent_extraction': 'Correction Intent',
    'capability_binding': 'Capability Binding',

    // V6 Pipeline (human-readable format - some records have this in activity_type)
    'Generate Intent Contract V1': 'Intent Contract',
    'Generate Semantic Plan': 'Semantic Plan',
    'Generate Semantic Skeleton': 'Semantic Skeleton',

    // Memory
    'memory_creation': 'Memory Creation',
    'memory_summarization': 'Memory Summary',
    'user_memory_extraction': 'User Memory',
    'semantic_memory_search': 'Memory Search',

    // Embeddings
    'single_embedding': 'Embedding',
    'batch_embedding': 'Batch Embedding',
    'async_embedding': 'Async Embedding',

    // Execution
    'llm_call': 'LLM Call',
    'llm_decision': 'LLM Decision',
    'plugin_call': 'Plugin Call',
    'step_repair': 'Step Repair',
    'advanced_recovery': 'Advanced Recovery',
    'health_check': 'Health Check',

    // Orchestration
    'orchestration': 'Orchestration',
    'semantic_compression': 'Semantic Compression',

    // Insights
    'insight_generation': 'Insight Generation',
    'recommendation_generation': 'Recommendation',
    'effort_estimation': 'Effort Estimation',

    // Research plugin
    'summarize_content': 'Summarize Content',
    'answer_question': 'Answer Question',
    'generate_research_summary': 'Research Summary',

    // Credits
    'reward_credit': 'Reward Credit'
  };

  return labels[activity] || activity
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
