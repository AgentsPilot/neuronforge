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

/*
 * The AI pricing helpers (logAIPricingCreated / Updated / Deleted / ZeroCost /
 * Synced) were removed in AI model price review slice 6 with the only routes
 * that called them (Sync and the single-row edit). Their events stay registered
 * in `events.ts` so existing audit rows keep their label and severity (SA D-4).
 */
