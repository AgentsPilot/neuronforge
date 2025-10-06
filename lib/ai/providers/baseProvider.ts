// lib/ai/providers/baseProvider.ts
import { AIAnalyticsService, AICallData } from '@/lib/analytics/aiAnalytics';


export interface CallContext {
  userId: string;
  sessionId?: string;
  feature: string;
  component: string;
  workflow_step?: string;
  category?: string;
  // Add activity tracking fields
  activity_type?: string;
  activity_name?: string;
  agent_id?: string;
  activity_step?: string;
}

export abstract class BaseAIProvider {
  protected analytics: AIAnalyticsService;
  
  constructor(analytics?: AIAnalyticsService) {
    this.analytics = analytics || new AIAnalyticsService();
  }

  async callWithTracking<T>(
    context: CallContext,
    provider: string,
    model: string,
    endpoint: string,
    apiCall: () => Promise<T>,
    extractMetrics: (result: T) => { inputTokens: number; outputTokens: number; cost: number; responseSize?: number }
  ): Promise<T> {
    const startTime = Date.now();
    const callId = this.generateCallId();
    
    try {
      const result = await apiCall();
      const metrics = extractMetrics(result);
      
      // Track successful call with all context fields
      await this.analytics.trackAICall({
        call_id: callId,
        user_id: context.userId,
        session_id: context.sessionId,
        provider,
        model_name: model,
        endpoint,
        feature: context.feature,
        component: context.component,
        workflow_step: context.workflow_step,
        category: context.category || 'general',
        input_tokens: metrics.inputTokens,
        output_tokens: metrics.outputTokens,
        cost_usd: metrics.cost,
        latency_ms: Date.now() - startTime,
        response_size_bytes: metrics.responseSize,
        success: true,
        request_type: 'chat',
        // Activity tracking fields
        activity_type: context.activity_type,
        activity_name: context.activity_name,
        agent_id: context.agent_id,
        activity_step: context.activity_step
      });
      
      return result;
    } catch (error: any) {
      // Track failed call
      await this.analytics.trackAICall({
        call_id: callId,
        user_id: context.userId,
        session_id: context.sessionId,
        provider,
        model_name: model,
        endpoint,
        feature: context.feature,
        component: context.component,
        workflow_step: context.workflow_step,
        category: context.category || 'general',
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        latency_ms: Date.now() - startTime,
        success: false,
        error_code: error.code || 'UNKNOWN',
        error_message: error.message,
        request_type: 'chat',
        // Activity tracking fields
        activity_type: context.activity_type,
        activity_name: context.activity_name,
        agent_id: context.agent_id,
        activity_step: context.activity_step
      });
      
      throw error;
    }
  }

  private generateCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}