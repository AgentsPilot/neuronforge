/**
 * Conversion Follow-up Overdue Detector
 *
 * Detects CRM tasks that are past their due date and not completed.
 * Helps ensure timely follow-ups with leads and clients.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class ConvFollowupOverdueDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'conv_followup_overdue',
    name: 'Follow-ups Overdue',
    category: 'conversion',
    description: 'Detects scheduled follow-up tasks past their due date',

    watchedMetrics: ['conversion.overdue_tasks'],
    eventTypes: [],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0, // Any overdue task
    direction: 'above',
    minSamples: 1,

    severityFn: (overdueCount: number, avgDaysOverdue: number): InsightSeverity => {
      if (overdueCount >= 10 || avgDaysOverdue >= 7) return 'critical';
      if (overdueCount >= 5 || avgDaysOverdue >= 3) return 'high';
      if (overdueCount >= 2 || avgDaysOverdue >= 1) return 'medium';
      return 'low';
    },

    pairedProcessId: 'task_reminder',
    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 24,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    // Check cooldown
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const now = new Date();

    // Get overdue tasks (status not completed or cancelled, due_date < now)
    const { data: overdueTasks, error } = await this.supabase
      .from('crm_tasks')
      .select('id, title, due_date, contact_id, priority, created_at')
      .eq('user_id', userId)
      .neq('status', 'completed')
      .neq('status', 'cancelled')
      .lt('due_date', now.toISOString())
      .order('due_date', { ascending: true });

    if (error) {
      throw error;
    }

    if (!overdueTasks || overdueTasks.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate days overdue for each task
    const tasksWithOverdue = overdueTasks.map((task) => {
      const dueDate = new Date(task.due_date);
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      return { ...task, daysOverdue };
    });

    // Calculate average days overdue
    const avgDaysOverdue = Math.round(
      tasksWithOverdue.reduce((sum, t) => sum + t.daysOverdue, 0) / tasksWithOverdue.length
    );

    // Calculate severity
    const severity = this.definition.severityFn(overdueTasks.length, avgDaysOverdue);

    // Get contact info for affected tasks
    const contactIds = [...new Set(overdueTasks.map((t) => t.contact_id).filter(Boolean))];
    let contactNames: Record<string, string> = {};

    if (contactIds.length > 0) {
      const { data: contacts } = await this.supabase
        .from('crm_contacts')
        .select('id, first_name, last_name, email')
        .in('id', contactIds);

      if (contacts) {
        contactNames = contacts.reduce((acc, c) => {
          acc[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email;
          return acc;
        }, {} as Record<string, string>);
      }
    }

    // Estimate impact: each overdue task represents missed opportunity
    const avgDealValue = 300;
    const conversionRate = 0.1;
    const estimatedLoss = overdueTasks.length * avgDealValue * conversionRate;

    // Group by priority
    const priorityBreakdown = overdueTasks.reduce((acc, t) => {
      const priority = t.priority || 'normal';
      acc[priority] = (acc[priority] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'conversion.overdue_tasks',
      currentValue: overdueTasks.length,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'task',
      affectedEntityIds: overdueTasks.map((t) => t.id),
      affectedCount: overdueTasks.length,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'opportunity',
      impactPeriod: 'weekly',
      processParameters: {
        avg_days_overdue: avgDaysOverdue,
        priority_breakdown: priorityBreakdown,
        task_ids: overdueTasks.map((t) => t.id),
        task_details: tasksWithOverdue.map((t) => ({
          id: t.id,
          title: t.title,
          days_overdue: t.daysOverdue,
          priority: t.priority || 'normal',
          contact_name: t.contact_id ? contactNames[t.contact_id] : null,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
