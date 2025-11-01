// lib/audit/admin-helpers.ts
// Helper functions for admin configuration audit logging

import { auditLog } from '../services/AuditTrailService';
import { AUDIT_EVENTS } from './events';

/**
 * Log AIS mode switch (best_practice ↔ dynamic)
 */
export async function logAISModeSwitch(
  userId: string | null,
  oldMode: 'best_practice' | 'dynamic',
  newMode: 'best_practice' | 'dynamic',
  reason?: string
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.AIS_MODE_SWITCHED,
    entityType: 'system',
    entityId: 'ais_config',
    resourceName: 'AIS Configuration',
    changes: {
      before: { mode: oldMode },
      after: { mode: newMode },
    },
    details: {
      reason: reason || 'Admin manual switch',
      timestamp: new Date().toISOString(),
    },
    severity: 'warning',
  });
}

/**
 * Log AIS threshold update
 */
export async function logAISThresholdUpdate(
  userId: string | null,
  oldThreshold: number,
  newThreshold: number
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.AIS_THRESHOLD_UPDATED,
    entityType: 'system',
    entityId: 'ais_config',
    resourceName: 'AIS Configuration',
    changes: {
      before: { min_executions_threshold: oldThreshold },
      after: { min_executions_threshold: newThreshold },
    },
    details: {
      delta: newThreshold - oldThreshold,
      timestamp: new Date().toISOString(),
    },
    severity: 'warning',
  });
}

/**
 * Log reward config creation
 */
export async function logRewardConfigCreated(
  userId: string | null,
  rewardData: {
    id: string;
    reward_key: string;
    reward_name: string;
    credits_amount: number;
    is_active: boolean;
  }
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.REWARD_CONFIG_CREATED,
    entityType: 'reward_config',
    entityId: rewardData.id,
    resourceName: rewardData.reward_name,
    details: {
      reward_key: rewardData.reward_key,
      credits_amount: rewardData.credits_amount,
      is_active: rewardData.is_active,
    },
    severity: 'warning',
  });
}

/**
 * Log reward config update
 */
export async function logRewardConfigUpdated(
  userId: string | null,
  rewardId: string,
  rewardName: string,
  changes: Record<string, any>
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.REWARD_CONFIG_UPDATED,
    entityType: 'reward_config',
    entityId: rewardId,
    resourceName: rewardName,
    changes,
    details: {
      fields_updated: Object.keys(changes.after || changes),
      timestamp: new Date().toISOString(),
    },
    severity: 'info',
  });
}

/**
 * Log reward config deletion
 */
export async function logRewardConfigDeleted(
  userId: string | null,
  rewardId: string,
  rewardName: string,
  rewardData: any
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.REWARD_CONFIG_DELETED,
    entityType: 'reward_config',
    entityId: rewardId,
    resourceName: rewardName,
    details: {
      deleted_reward: rewardData,
      timestamp: new Date().toISOString(),
    },
    severity: 'critical',
  });
}

/**
 * Log reward config active status toggle
 */
export async function logRewardConfigToggled(
  userId: string | null,
  rewardId: string,
  rewardName: string,
  oldStatus: boolean,
  newStatus: boolean
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.REWARD_CONFIG_TOGGLED,
    entityType: 'reward_config',
    entityId: rewardId,
    resourceName: rewardName,
    changes: {
      before: { is_active: oldStatus },
      after: { is_active: newStatus },
    },
    details: {
      action: newStatus ? 'enabled' : 'disabled',
      timestamp: new Date().toISOString(),
    },
    severity: 'info',
  });
}

/**
 * Log routing configuration update
 */
export async function logRoutingConfigUpdated(
  userId: string | null,
  changes: Record<string, any>
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.ROUTING_CONFIG_UPDATED,
    entityType: 'system',
    entityId: 'routing_config',
    resourceName: 'Intelligent Routing Configuration',
    changes,
    details: {
      fields_updated: Object.keys(changes.after || changes),
      timestamp: new Date().toISOString(),
    },
    severity: 'warning',
  });
}

/**
 * Log AI pricing creation
 */
export async function logAIPricingCreated(
  userId: string | null,
  pricingData: {
    id: string;
    provider: string;
    model_name: string;
    input_cost_per_token: number;
    output_cost_per_token: number;
  }
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.AI_PRICING_CREATED,
    entityType: 'ai_pricing',
    entityId: pricingData.id,
    resourceName: `${pricingData.provider}/${pricingData.model_name}`,
    details: {
      provider: pricingData.provider,
      model_name: pricingData.model_name,
      input_cost_per_token: pricingData.input_cost_per_token,
      output_cost_per_token: pricingData.output_cost_per_token,
    },
    severity: 'warning',
  });
}

/**
 * Log AI pricing update
 */
export async function logAIPricingUpdated(
  userId: string | null,
  pricingId: string,
  modelName: string,
  changes: Record<string, any>
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.AI_PRICING_UPDATED,
    entityType: 'ai_pricing',
    entityId: pricingId,
    resourceName: modelName,
    changes,
    details: {
      fields_updated: Object.keys(changes.after || changes),
      timestamp: new Date().toISOString(),
    },
    severity: 'info',
  });
}

/**
 * Log AI pricing deletion
 */
export async function logAIPricingDeleted(
  userId: string | null,
  pricingId: string,
  modelName: string,
  pricingData: any
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.AI_PRICING_DELETED,
    entityType: 'ai_pricing',
    entityId: pricingId,
    resourceName: modelName,
    details: {
      deleted_pricing: pricingData,
      timestamp: new Date().toISOString(),
    },
    severity: 'critical',
  });
}

/**
 * Log AI pricing sync from external source
 */
export async function logAIPricingSynced(
  userId: string | null,
  syncResult: {
    models_updated: number;
    models_added: number;
    source: string;
  }
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.AI_PRICING_SYNCED,
    entityType: 'system',
    entityId: 'ai_pricing',
    resourceName: 'AI Model Pricing',
    details: {
      models_updated: syncResult.models_updated,
      models_added: syncResult.models_added,
      source: syncResult.source,
      timestamp: new Date().toISOString(),
    },
    severity: 'info',
  });
}
