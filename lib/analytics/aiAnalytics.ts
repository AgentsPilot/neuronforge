// lib/analytics/aiAnalytics.ts
export interface AICallData {
  // Required fields
  user_id: string;
  provider: string;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  
  // Optional context fields
  session_id?: string;
  call_id?: string;
  endpoint?: string;
  feature?: string;
  component?: string;
  workflow_step?: string;
  request_type?: string;
  category?: string;
  
  // Performance metrics
  latency_ms?: number;
  response_size_bytes?: number;
  
  // Status tracking
  success?: boolean;
  error_code?: string;
  error_message?: string;
  
  // Activity tracking
  activity_type?: string;
  activity_name?: string;
  agent_id?: string;
  activity_step?: string;
  
  // Debug data (optional)
  request_payload?: any;
  response_metadata?: any;
  metadata?: any;
}

export interface AnalyticsConfig {
  enableRealtime?: boolean;
  enableCostTracking?: boolean;
  enablePerformanceMetrics?: boolean;
  batchSize?: number;
  flushInterval?: number;
}

export interface AnalyticsFilters {
  userId?: string;
  dateRange?: 'last_24h' | 'last_7d' | 'last_30d' | 'last_90d' | 'custom';
  startDate?: string;
  endDate?: string;
  feature?: string;
  component?: string;
  provider?: string;
  model?: string;
  groupBy?: string[];
  includeComparisons?: boolean;
}

export interface UsageReport {
  totalCost: number;
  totalTokens: number;
  totalCalls: number;
  avgLatency: number;
  errorRate: number;
  costChange: number;
  avgTokensPerCall: number;
  topFeatures: Array<{ name: string; cost: number; calls: number }>;
  topModels: Array<{ name: string; cost: number; tokens: number }>;
  dailyBreakdown: Array<{ date: string; cost: number; tokens: number; calls: number }>;
  featureBreakdown: Record<string, { cost: number; tokens: number; calls: number }>;
}

export class AIAnalyticsService {
  private supabase: any;
  private config: AnalyticsConfig;

  constructor(supabaseClient?: any, config?: AnalyticsConfig) {
    this.supabase = supabaseClient;
    
    this.config = {
      enableRealtime: true,
      enableCostTracking: true,
      enablePerformanceMetrics: true,
      batchSize: 10,
      flushInterval: 5000,
      ...config
    };
  }

  async trackAICall(callData: AICallData): Promise<void> {
    if (!this.supabase) {
      console.warn('⚠️ AI Analytics: No Supabase client available, skipping tracking');
      return;
    }

    console.log('📊 Starting AI call tracking:', {
      user_id: callData.user_id,
      feature: callData.feature,
      component: callData.component,
      model: callData.model_name,
      cost: callData.cost_usd,
      activity_type: callData.activity_type
    });

    try {
      const call_id = callData.call_id || this.generateCallId();

      // Validate session_id is a proper UUID, otherwise set to null
      const isValidUUID = (str: string | undefined) => {
        if (!str) return false;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(str);
      };

      const validSessionId = callData.session_id && isValidUUID(callData.session_id)
        ? callData.session_id
        : null;

      if (callData.session_id && !validSessionId) {
        console.warn(`⚠️ Invalid session_id format: "${callData.session_id}", setting to null`);
      }

      // Build the complete insert data using your full schema
      const insertData = {
        // Required fields
        user_id: callData.user_id,
        model_name: callData.model_name,
        provider: callData.provider,
        input_tokens: callData.input_tokens,
        output_tokens: callData.output_tokens,
        cost_usd: callData.cost_usd,

        // Optional basic fields
        request_type: callData.request_type || 'chat',
        session_id: validSessionId,
        category: callData.category || 'general',
        
        // Enhanced tracking fields (now supported by your schema)
        call_id,
        endpoint: callData.endpoint,
        feature: callData.feature,
        component: callData.component,
        workflow_step: callData.workflow_step,
        latency_ms: callData.latency_ms,
        response_size_bytes: callData.response_size_bytes,
        success: callData.success ?? true,
        error_code: callData.error_code,
        error_message: callData.error_message,
        request_payload: callData.request_payload,
        response_metadata: callData.response_metadata,
        
        // Activity tracking fields
        activity_type: callData.activity_type,
        activity_name: callData.activity_name,
        agent_id: callData.agent_id,
        activity_step: callData.activity_step,
        
        // Additional metadata in JSONB
        metadata: {
          timestamp: new Date().toISOString(),
          version: '2.0',
          tracked_by: 'ai_analytics_service',
          ...(callData.metadata || {})
        }
      };

      console.log('📊 Inserting to token_usage table:', {
        call_id,
        user_id: insertData.user_id,
        model_name: insertData.model_name,
        feature: insertData.feature,
        component: insertData.component,
        activity_type: insertData.activity_type,
        cost_usd: insertData.cost_usd,
        success: insertData.success
      });
      
      const { data, error } = await this.supabase
        .from('token_usage')
        .insert(insertData)
        .select('id, call_id, created_at'); // Return some data to confirm insert

      if (error) {
        console.error('❌ Failed to track AI call - Database error:', error);
        console.error('❌ Failed insert data sample:', {
          user_id: insertData.user_id,
          model_name: insertData.model_name,
          call_id: insertData.call_id
        });
      } else {
        console.log('✅ AI call tracked successfully in database');
        console.log('📊 Database returned:', data);
        console.log('📊 Tracked call summary:', {
          id: data?.[0]?.id,
          call_id: data?.[0]?.call_id,
          feature: callData.feature,
          activity_type: callData.activity_type,
          cost: callData.cost_usd,
          created_at: data?.[0]?.created_at
        });
      }
    } catch (error) {
      console.error('❌ AI tracking error - Exception:', error);
      console.error('❌ Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack?.slice(0, 500)
      });
    }
  }

  async getUsageAnalytics(filters: AnalyticsFilters): Promise<UsageReport> {
    if (!this.supabase) {
      console.warn('⚠️ AI Analytics: No Supabase client available for analytics');
      return this.getMockUsageReport();
    }

    try {
      let query = this.supabase.from('token_usage').select('*');
      
      // Apply filters
      if (filters.userId) {
        query = query.eq('user_id', filters.userId);
      }
      
      if (filters.feature) {
        query = query.eq('feature', filters.feature);
      }
      
      if (filters.component) {
        query = query.eq('component', filters.component);
      }
      
      if (filters.provider) {
        query = query.eq('provider', filters.provider);
      }
      
      if (filters.model) {
        query = query.eq('model_name', filters.model);
      }
      
      // Date range filtering
      const dateRange = this.getDateRange(filters.dateRange, filters.startDate, filters.endDate);
      if (dateRange.start) {
        query = query.gte('created_at', dateRange.start);
      }
      if (dateRange.end) {
        query = query.lte('created_at', dateRange.end);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return this.processUsageData(data, filters);
    } catch (error) {
      console.error('Error fetching usage analytics:', error);
      return this.getMockUsageReport();
    }
  }

  // Get agent-specific analytics
  async getAgentAnalytics(agentId: string, userId?: string): Promise<any> {
    if (!this.supabase) {
      return { totalCost: 0, totalCalls: 0, avgLatency: 0, activities: [] };
    }

    try {
      let query = this.supabase
        .from('token_usage')
        .select('*')
        .eq('agent_id', agentId);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      const totalCost = data.reduce((sum, row) => sum + parseFloat(row.cost_usd || 0), 0);
      const totalCalls = data.length;
      const avgLatency = data.length > 0 
        ? data.reduce((sum, row) => sum + (row.latency_ms || 0), 0) / data.length 
        : 0;

      return {
        agentId,
        totalCost,
        totalCalls,
        avgLatency,
        activities: data.map(row => ({
          activity_type: row.activity_type,
          activity_name: row.activity_name,
          cost: row.cost_usd,
          success: row.success,
          created_at: row.created_at
        }))
      };
    } catch (error) {
      console.error('Error fetching agent analytics:', error);
      return { totalCost: 0, totalCalls: 0, avgLatency: 0, activities: [] };
    }
  }

  private generateCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDateRange(range?: string, startDate?: string, endDate?: string) {
    if (range === 'custom' && startDate && endDate) {
      return { start: startDate, end: endDate };
    }
    
    const now = new Date();
    const ranges = {
      'last_24h': new Date(now.getTime() - 24 * 60 * 60 * 1000),
      'last_7d': new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      'last_30d': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      'last_90d': new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    };
    
    const start = ranges[range] || ranges['last_30d'];
    return { start: start.toISOString(), end: now.toISOString() };
  }

  private processUsageData(data: any[], filters: AnalyticsFilters): UsageReport {
    if (!data || data.length === 0) {
      return this.getMockUsageReport();
    }

    const totalCost = data.reduce((sum, row) => sum + parseFloat(row.cost_usd || 0), 0);
    const totalTokens = data.reduce((sum, row) => sum + (row.total_tokens || 0), 0);
    const totalCalls = data.length;
    
    const latencyData = data.filter(row => row.latency_ms);
    const avgLatency = latencyData.length > 0 
      ? latencyData.reduce((sum, row) => sum + row.latency_ms, 0) / latencyData.length 
      : 0;
    
    const errorRate = data.filter(row => row.success === false).length / Math.max(totalCalls, 1);
    const avgTokensPerCall = totalCalls > 0 ? totalTokens / totalCalls : 0;
    
    // Group by feature
    const featureBreakdown = data.reduce((acc, row) => {
      const feature = row.feature || 'unknown';
      if (!acc[feature]) {
        acc[feature] = { cost: 0, tokens: 0, calls: 0 };
      }
      acc[feature].cost += parseFloat(row.cost_usd || 0);
      acc[feature].tokens += row.total_tokens || 0;
      acc[feature].calls += 1;
      return acc;
    }, {});
    
    // Top features by cost
    const topFeatures = Object.entries(featureBreakdown)
      .map(([name, stats]: [string, any]) => ({ name, cost: stats.cost, calls: stats.calls }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
    
    // Group by model
    const modelBreakdown = data.reduce((acc, row) => {
      const model = row.model_name || 'unknown';
      if (!acc[model]) {
        acc[model] = { cost: 0, tokens: 0, calls: 0 };
      }
      acc[model].cost += parseFloat(row.cost_usd || 0);
      acc[model].tokens += row.total_tokens || 0;
      acc[model].calls += 1;
      return acc;
    }, {});
    
    const topModels = Object.entries(modelBreakdown)
      .map(([name, stats]: [string, any]) => ({ name, cost: stats.cost, tokens: stats.tokens }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
    
    // Daily breakdown
    const dailyBreakdown = data.reduce((acc, row) => {
      const date = new Date(row.created_at).toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { date, cost: 0, tokens: 0, calls: 0 };
      }
      acc[date].cost += parseFloat(row.cost_usd || 0);
      acc[date].tokens += row.total_tokens || 0;
      acc[date].calls += 1;
      return acc;
    }, {});
    
    return {
      totalCost,
      totalTokens,
      totalCalls,
      avgLatency,
      errorRate: errorRate * 100,
      costChange: 0,
      avgTokensPerCall,
      topFeatures,
      topModels,
      dailyBreakdown: Object.values(dailyBreakdown),
      featureBreakdown
    };
  }

  private getMockUsageReport(): UsageReport {
    return {
      totalCost: 0,
      totalTokens: 0,
      totalCalls: 0,
      avgLatency: 0,
      errorRate: 0,
      costChange: 0,
      avgTokensPerCall: 0,
      topFeatures: [],
      topModels: [],
      dailyBreakdown: [],
      featureBreakdown: {}
    };
  }
}