/**
 * Automation Manager
 *
 * Manages standing automations created from insights.
 * Handles creation, scheduling, execution, and lifecycle.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 5
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { KernelTrigger } from '../kernel/KernelTrigger';
import { TRIGGERABLE_PROCESSES, getProcessForDetector } from '../kernel/TriggerableProcesses';
import { DetectorEngine } from '../detectors/DetectorEngine';
import type { Insight } from '../repository/InsightRepository';

const logger = createLogger({ module: 'AutomationManager' });

// ===========================
// Types
// ===========================

export interface InsightAutomation {
  id: string;
  user_id: string;
  detector_id: string;
  trigger_condition: Record<string, unknown>;
  kernel_process_id: string;
  process_parameters: Record<string, unknown>;
  max_items_per_run: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  check_interval_minutes: number;
  last_check_at: string | null;
  next_check_at: string | null;
  is_active: boolean;
  paused_at: string | null;
  pause_reason: string | null;
  run_count: number;
  last_run_at: string | null;
  last_run_execution_id: string | null;
  last_outcome: Record<string, unknown> | null;
  total_items_processed: number;
  total_value_impact: number;
  created_from_insight_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAutomationParams {
  userId: string;
  detectorId: string;
  triggerCondition: Record<string, unknown>;
  processParameters?: Record<string, unknown>;
  checkIntervalMinutes?: number;
  maxItemsPerRun?: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  insightId?: string;
}

export interface AutomationRunResult {
  automationId: string;
  executionId?: string;
  status: 'skipped' | 'executed' | 'failed';
  reason?: string;
  itemsProcessed?: number;
  valueImpact?: number;
}

// ===========================
// AutomationManager
// ===========================

export class AutomationManager {
  private supabase: SupabaseClient;
  private kernelTrigger: KernelTrigger;
  private detectorEngine: DetectorEngine;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.kernelTrigger = new KernelTrigger(supabase);
    this.detectorEngine = new DetectorEngine(supabase);
  }

  /**
   * Create a new automation from an insight
   */
  async createFromInsight(
    insight: Insight,
    params: Partial<CreateAutomationParams> = {}
  ): Promise<InsightAutomation | null> {
    const process = getProcessForDetector(insight.detector_id);

    if (!process || !process.eligibleForAutomation) {
      logger.warn(
        { detectorId: insight.detector_id },
        'Detector not eligible for automation'
      );
      return null;
    }

    return this.create({
      userId: insight.user_id,
      detectorId: insight.detector_id,
      triggerCondition: insight.process_parameters || {},
      processParameters: params.processParameters || insight.process_parameters || {},
      checkIntervalMinutes: params.checkIntervalMinutes || 60,
      maxItemsPerRun: params.maxItemsPerRun || 20,
      quietHoursStart: params.quietHoursStart || 22,
      quietHoursEnd: params.quietHoursEnd || 8,
      insightId: insight.id,
    });
  }

  /**
   * Create a new automation
   */
  async create(params: CreateAutomationParams): Promise<InsightAutomation | null> {
    const {
      userId,
      detectorId,
      triggerCondition,
      processParameters = {},
      checkIntervalMinutes = 60,
      maxItemsPerRun = 20,
      quietHoursStart = 22,
      quietHoursEnd = 8,
      insightId,
    } = params;

    const process = getProcessForDetector(detectorId);
    if (!process) {
      logger.error({ detectorId }, 'No process found for detector');
      return null;
    }

    // Calculate next check time
    const nextCheckAt = new Date(Date.now() + checkIntervalMinutes * 60 * 1000);

    try {
      const { data, error } = await this.supabase
        .from('insight_automations')
        .insert({
          user_id: userId,
          detector_id: detectorId,
          trigger_condition: triggerCondition,
          kernel_process_id: process.processId,
          process_parameters: processParameters,
          max_items_per_run: maxItemsPerRun,
          quiet_hours_start: quietHoursStart,
          quiet_hours_end: quietHoursEnd,
          check_interval_minutes: checkIntervalMinutes,
          next_check_at: nextCheckAt.toISOString(),
          created_from_insight_id: insightId,
        })
        .select()
        .single();

      if (error) throw error;

      logger.info(
        { userId, automationId: data.id, detectorId, processId: process.processId },
        'Automation created'
      );

      // Mark insight as automated if we have one
      if (insightId) {
        await this.supabase
          .from('insights')
          .update({ status: 'automated' })
          .eq('id', insightId)
          .eq('user_id', userId);
      }

      return data;

    } catch (error) {
      logger.error({ err: error }, 'Failed to create automation');
      return null;
    }
  }

  /**
   * Get all automations for a user
   */
  async getForUser(userId: string): Promise<InsightAutomation[]> {
    const { data, error } = await this.supabase
      .from('insight_automations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error({ err: error }, 'Failed to fetch automations');
      return [];
    }

    return data || [];
  }

  /**
   * Get active automations due for checking
   */
  async getDueAutomations(): Promise<InsightAutomation[]> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('insight_automations')
      .select('*')
      .eq('is_active', true)
      .or(`next_check_at.is.null,next_check_at.lte.${now}`)
      .limit(100);

    if (error) {
      logger.error({ err: error }, 'Failed to fetch due automations');
      return [];
    }

    return data || [];
  }

  /**
   * Run a single automation
   */
  async runAutomation(automation: InsightAutomation): Promise<AutomationRunResult> {
    const { id, user_id, detector_id, kernel_process_id, process_parameters, quiet_hours_start, quiet_hours_end, max_items_per_run } = automation;

    logger.info({ automationId: id, userId: user_id, detectorId: detector_id }, 'Running automation');

    // Check quiet hours
    const now = new Date();
    const hour = now.getHours();
    if (hour >= quiet_hours_start || hour < quiet_hours_end) {
      logger.debug({ automationId: id }, 'Skipping - quiet hours');
      await this.updateNextCheck(id, automation.check_interval_minutes);
      return { automationId: id, status: 'skipped', reason: 'quiet_hours' };
    }

    // Run the detector to check if conditions are met
    const detection = await this.detectorEngine.runDetector(detector_id, user_id);

    if (!detection) {
      logger.debug({ automationId: id }, 'Skipping - no detection');
      await this.updateNextCheck(id, automation.check_interval_minutes);
      return { automationId: id, status: 'skipped', reason: 'no_detection' };
    }

    // Limit entity IDs
    const entityIds = detection.affectedEntityIds?.slice(0, max_items_per_run);

    // Trigger the kernel process
    const result = await this.kernelTrigger.trigger({
      processId: kernel_process_id,
      userId: user_id,
      triggeredBy: 'automation',
      parameters: process_parameters,
      entityIds,
    });

    // Update automation stats
    const updates: Record<string, unknown> = {
      last_check_at: now.toISOString(),
      next_check_at: new Date(Date.now() + automation.check_interval_minutes * 60 * 1000).toISOString(),
    };

    if (result.status === 'completed') {
      updates.run_count = automation.run_count + 1;
      updates.last_run_at = now.toISOString();
      updates.last_run_execution_id = result.executionId;
      updates.last_outcome = {
        itemsProcessed: result.itemsProcessed,
        itemsSucceeded: result.itemsSucceeded,
        itemsFailed: result.itemsFailed,
        valueImpact: result.valueImpact,
      };
      updates.total_items_processed = automation.total_items_processed + (result.itemsProcessed || 0);
      updates.total_value_impact = automation.total_value_impact + (result.valueImpact || 0);
    }

    await this.supabase
      .from('insight_automations')
      .update(updates)
      .eq('id', id);

    logger.info(
      {
        automationId: id,
        executionId: result.executionId,
        itemsProcessed: result.itemsProcessed,
      },
      'Automation executed'
    );

    return {
      automationId: id,
      executionId: result.executionId,
      status: result.status === 'completed' ? 'executed' : 'failed',
      reason: result.error,
      itemsProcessed: result.itemsProcessed,
      valueImpact: result.valueImpact,
    };
  }

  /**
   * Run all due automations
   */
  async runDueAutomations(): Promise<AutomationRunResult[]> {
    const dueAutomations = await this.getDueAutomations();

    logger.info({ count: dueAutomations.length }, 'Running due automations');

    const results: AutomationRunResult[] = [];

    for (const automation of dueAutomations) {
      try {
        const result = await this.runAutomation(automation);
        results.push(result);
      } catch (error) {
        logger.error(
          { err: error, automationId: automation.id },
          'Automation run failed'
        );
        results.push({
          automationId: automation.id,
          status: 'failed',
          reason: String(error),
        });
      }
    }

    return results;
  }

  /**
   * Pause an automation
   */
  async pause(automationId: string, userId: string, reason?: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('insight_automations')
      .update({
        is_active: false,
        paused_at: new Date().toISOString(),
        pause_reason: reason,
      })
      .eq('id', automationId)
      .eq('user_id', userId);

    if (error) {
      logger.error({ err: error }, 'Failed to pause automation');
      return false;
    }

    logger.info({ automationId, reason }, 'Automation paused');
    return true;
  }

  /**
   * Resume an automation
   */
  async resume(automationId: string, userId: string): Promise<boolean> {
    const nextCheckAt = new Date(Date.now() + 5 * 60 * 1000); // Check in 5 minutes

    const { error } = await this.supabase
      .from('insight_automations')
      .update({
        is_active: true,
        paused_at: null,
        pause_reason: null,
        next_check_at: nextCheckAt.toISOString(),
      })
      .eq('id', automationId)
      .eq('user_id', userId);

    if (error) {
      logger.error({ err: error }, 'Failed to resume automation');
      return false;
    }

    logger.info({ automationId }, 'Automation resumed');
    return true;
  }

  /**
   * Delete an automation
   */
  async delete(automationId: string, userId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('insight_automations')
      .delete()
      .eq('id', automationId)
      .eq('user_id', userId);

    if (error) {
      logger.error({ err: error }, 'Failed to delete automation');
      return false;
    }

    logger.info({ automationId }, 'Automation deleted');
    return true;
  }

  /**
   * Update next check time
   */
  private async updateNextCheck(automationId: string, intervalMinutes: number): Promise<void> {
    const nextCheckAt = new Date(Date.now() + intervalMinutes * 60 * 1000);

    await this.supabase
      .from('insight_automations')
      .update({
        last_check_at: new Date().toISOString(),
        next_check_at: nextCheckAt.toISOString(),
      })
      .eq('id', automationId);
  }

  /**
   * Update automation parameters
   */
  async updateParameters(
    automationId: string,
    userId: string,
    params: {
      triggerCondition?: Record<string, unknown>;
      processParameters?: Record<string, unknown>;
      checkIntervalMinutes?: number;
      maxItemsPerRun?: number;
      quietHoursStart?: number;
      quietHoursEnd?: number;
    }
  ): Promise<InsightAutomation | null> {
    const updates: Record<string, unknown> = {};

    if (params.triggerCondition) updates.trigger_condition = params.triggerCondition;
    if (params.processParameters) updates.process_parameters = params.processParameters;
    if (params.checkIntervalMinutes) updates.check_interval_minutes = params.checkIntervalMinutes;
    if (params.maxItemsPerRun) updates.max_items_per_run = params.maxItemsPerRun;
    if (params.quietHoursStart !== undefined) updates.quiet_hours_start = params.quietHoursStart;
    if (params.quietHoursEnd !== undefined) updates.quiet_hours_end = params.quietHoursEnd;

    const { data, error } = await this.supabase
      .from('insight_automations')
      .update(updates)
      .eq('id', automationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      logger.error({ err: error }, 'Failed to update automation');
      return null;
    }

    return data;
  }
}
