// lib/credits/agentSharingValidation.ts
// Validation rules for agent sharing to prevent abuse

import { SupabaseClient } from '@supabase/supabase-js';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  details?: Record<string, any>;
}

export interface AgentSharingConfig {
  // Quality thresholds
  minExecutions: number;
  minSuccessRate: number; // 0-100
  requireDescription: boolean;
  minDescriptionLength: number;

  // User limits
  maxSharesPerDay: number;
  maxSharesPerMonth: number;
  maxTotalShares: number; // Lifetime limit per user

  // Agent age requirement (prevent instant share of new agents)
  minAgentAgeHours: number;
}

// Default configuration - adjust these values based on your economics
const DEFAULT_CONFIG: AgentSharingConfig = {
  minExecutions: 3, // Agent must be executed at least 3 times
  minSuccessRate: 66, // At least 66% success rate
  requireDescription: true,
  minDescriptionLength: 20,

  maxSharesPerDay: 5,
  maxSharesPerMonth: 20,
  maxTotalShares: 100, // Prevent users from creating 1000 spam agents

  minAgentAgeHours: 1 // Agent must exist for at least 1 hour (prevent spam)
};

export class AgentSharingValidator {
  private config: AgentSharingConfig;

  constructor(
    private supabase: SupabaseClient,
    config?: Partial<AgentSharingConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate if an agent meets quality thresholds for sharing
   */
  async validateAgentQuality(agentId: string): Promise<ValidationResult> {
    try {
      console.log('🔍 [Validator] Validating agent quality for:', agentId);

      // Fetch agent details
      const { data: agent, error: agentError } = await this.supabase
        .from('agents')
        .select('agent_name, description, created_at, input_schema, status')
        .eq('id', agentId)
        .single();

      if (agentError || !agent) {
        console.error('❌ [Validator] Agent not found:', agentError);
        return { valid: false, reason: 'Agent not found' };
      }

      console.log('📊 [Validator] Agent data:', {
        name: agent.agent_name,
        created: agent.created_at,
        descLength: agent.description?.length || 0
      });

      // Check agent age
      const agentAge = Date.now() - new Date(agent.created_at).getTime();
      const agentAgeHours = agentAge / (1000 * 60 * 60);

      console.log(`⏰ [Validator] Agent age: ${agentAgeHours.toFixed(2)}h (required: ${this.config.minAgentAgeHours}h)`);

      if (agentAgeHours < this.config.minAgentAgeHours) {
        const hoursRemaining = Math.ceil(this.config.minAgentAgeHours - agentAgeHours);
        return {
          valid: false,
          reason: `Agent must be at least ${this.config.minAgentAgeHours} hour(s) old before sharing (${hoursRemaining}h remaining)`,
          details: { agentAgeHours: Math.round(agentAgeHours * 10) / 10 }
        };
      }

      // Check description requirement
      if (this.config.requireDescription) {
        const descLength = agent.description?.trim().length || 0;
        if (descLength < this.config.minDescriptionLength) {
          return {
            valid: false,
            reason: `Agent must have a description of at least ${this.config.minDescriptionLength} characters (currently: ${descLength})`,
            details: { descriptionLength: descLength, required: this.config.minDescriptionLength }
          };
        }
      }

      // Check execution history from agent_executions table (matches performance tab)
      const { data: executions, error: execError } = await this.supabase
        .from('agent_executions')
        .select('status')
        .eq('agent_id', agentId);

      if (execError) {
        console.error('❌ [Validator] Error fetching agent execution history:', execError);
        return { valid: false, reason: 'Error validating agent execution history' };
      }

      const totalExecutions = executions?.length || 0;
      // Accept 'success', 'completed', or 'finished' as successful statuses
      const successfulExecutions = executions?.filter(e =>
        e.status === 'success' || e.status === 'completed' || e.status === 'finished'
      ).length || 0;
      const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

      console.log(`📈 [Validator] Execution stats:`, {
        total: totalExecutions,
        successful: successfulExecutions,
        successRate: Math.round(successRate),
        required: `${this.config.minExecutions} runs, ${this.config.minSuccessRate}% success`,
        statuses: executions?.map(e => e.status)
      });

      // Check minimum executions
      if (totalExecutions < this.config.minExecutions) {
        return {
          valid: false,
          reason: `Agent must have at least ${this.config.minExecutions} successful test runs (currently: ${totalExecutions})`,
          details: { totalExecutions, required: this.config.minExecutions }
        };
      }

      // Check success rate
      if (successRate < this.config.minSuccessRate) {
        return {
          valid: false,
          reason: `Agent must have at least ${this.config.minSuccessRate}% success rate (currently: ${Math.round(successRate)}%)`,
          details: { successRate: Math.round(successRate), required: this.config.minSuccessRate }
        };
      }

      return {
        valid: true,
        details: {
          executions: totalExecutions,
          successRate: Math.round(successRate),
          agentAgeHours: Math.round(agentAgeHours * 10) / 10
        }
      };
    } catch (error) {
      console.error('Error in validateAgentQuality:', error);
      return { valid: false, reason: 'System error during validation' };
    }
  }

  /**
   * Validate user sharing limits (daily, monthly, lifetime)
   */
  async validateUserLimits(userId: string): Promise<ValidationResult> {
    try {
      // Get all shared agents by this user
      const { data: sharedAgents, error } = await this.supabase
        .from('shared_agents')
        .select('shared_at')
        .eq('user_id', userId);

      if (error) {
        console.error('Error fetching user shared agents:', error);
        return { valid: false, reason: 'Error validating user limits' };
      }

      const totalShares = sharedAgents?.length || 0;

      // Check lifetime limit
      if (totalShares >= this.config.maxTotalShares) {
        return {
          valid: false,
          reason: `Maximum lifetime share limit reached (${this.config.maxTotalShares} agents)`,
          details: { totalShares, limit: this.config.maxTotalShares }
        };
      }

      // Check daily limit
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const sharesLast24h = sharedAgents?.filter(s => s.shared_at >= oneDayAgo).length || 0;

      if (sharesLast24h >= this.config.maxSharesPerDay) {
        const nextShareTime = new Date(Math.min(...sharedAgents
          .filter(s => s.shared_at >= oneDayAgo)
          .map(s => new Date(s.shared_at).getTime())) + 24 * 60 * 60 * 1000);

        return {
          valid: false,
          reason: `Daily share limit reached (${this.config.maxSharesPerDay} per day). Try again in ${Math.ceil((nextShareTime.getTime() - Date.now()) / (1000 * 60 * 60))}h.`,
          details: { sharesLast24h, limit: this.config.maxSharesPerDay }
        };
      }

      // Check monthly limit
      const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const sharesLast30d = sharedAgents?.filter(s => s.shared_at >= oneMonthAgo).length || 0;

      if (sharesLast30d >= this.config.maxSharesPerMonth) {
        return {
          valid: false,
          reason: `Monthly share limit reached (${this.config.maxSharesPerMonth} per month)`,
          details: { sharesLast30d, limit: this.config.maxSharesPerMonth }
        };
      }

      return {
        valid: true,
        details: {
          sharesLast24h,
          sharesLast30d,
          totalShares,
          remainingDaily: this.config.maxSharesPerDay - sharesLast24h,
          remainingMonthly: this.config.maxSharesPerMonth - sharesLast30d,
          remainingLifetime: this.config.maxTotalShares - totalShares
        }
      };
    } catch (error) {
      console.error('Error in validateUserLimits:', error);
      return { valid: false, reason: 'System error during validation' };
    }
  }

  /**
   * Check if this specific agent has already been shared
   */
  async isAgentAlreadyShared(userId: string, agentId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('shared_agents')
        .select('id')
        .eq('user_id', userId)
        .eq('original_agent_id', agentId)
        .limit(1);

      if (error) {
        console.error('Error checking if agent already shared:', error);
        return false;
      }

      return data && data.length > 0;
    } catch (error) {
      console.error('Error in isAgentAlreadyShared:', error);
      return false;
    }
  }

  /**
   * Complete validation - both agent quality and user limits
   */
  async validateSharing(userId: string, agentId: string): Promise<ValidationResult> {
    // Check if this specific agent has already been shared (FIRST CHECK)
    const alreadyShared = await this.isAgentAlreadyShared(userId, agentId);
    if (alreadyShared) {
      return {
        valid: false,
        reason: 'This agent has already been shared. Each agent can only be shared once.',
        details: { alreadyShared: true }
      };
    }

    // Validate agent quality (cheaper check first)
    const qualityCheck = await this.validateAgentQuality(agentId);
    if (!qualityCheck.valid) {
      return qualityCheck;
    }

    // Validate user limits
    const limitsCheck = await this.validateUserLimits(userId);
    if (!limitsCheck.valid) {
      return limitsCheck;
    }

    return {
      valid: true,
      details: {
        agentQuality: qualityCheck.details,
        userLimits: limitsCheck.details
      }
    };
  }

  /**
   * Get current sharing status for UI display
   */
  async getSharingStatus(userId: string): Promise<{
    sharesLast24h: number;
    sharesLast30d: number;
    totalShares: number;
    limits: {
      daily: number;
      monthly: number;
      lifetime: number;
    };
    remaining: {
      daily: number;
      monthly: number;
      lifetime: number;
    };
  }> {
    const result = await this.validateUserLimits(userId);

    return {
      sharesLast24h: result.details?.sharesLast24h || 0,
      sharesLast30d: result.details?.sharesLast30d || 0,
      totalShares: result.details?.totalShares || 0,
      limits: {
        daily: this.config.maxSharesPerDay,
        monthly: this.config.maxSharesPerMonth,
        lifetime: this.config.maxTotalShares
      },
      remaining: {
        daily: result.details?.remainingDaily || this.config.maxSharesPerDay,
        monthly: result.details?.remainingMonthly || this.config.maxSharesPerMonth,
        lifetime: result.details?.remainingLifetime || this.config.maxTotalShares
      }
    };
  }

  /**
   * Get configuration for display purposes
   */
  getConfig(): AgentSharingConfig {
    return { ...this.config };
  }
}
