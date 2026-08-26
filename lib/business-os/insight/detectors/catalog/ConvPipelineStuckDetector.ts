/**
 * Conversion Pipeline Stuck Detector
 *
 * Detects contacts stuck in the same pipeline stage for too long (14+ days).
 * Helps identify deals that need attention to move forward.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { COMMON_GUARDRAILS } from '../types';
import { getStageKeysByType, CLIENT_STAGE_TYPES, TERMINAL_STAGE_TYPES } from '@/lib/crm/StageTypeUtils';

export class ConvPipelineStuckDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'conv_pipeline_stuck',
    name: 'Pipeline Stuck',
    category: 'conversion',
    description: 'Detects contacts stuck in same stage for 14+ days',

    watchedMetrics: ['conversion.pipeline_velocity'],
    eventTypes: ['contact.stage_changed'],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 14, // 14 days in same stage
    direction: 'above',
    minSamples: 1,

    severityFn: (stuckCount: number, avgDaysStuck: number): InsightSeverity => {
      if (avgDaysStuck >= 28 || stuckCount >= 5) return 'critical';
      if (avgDaysStuck >= 21 || stuckCount >= 3) return 'high';
      if (avgDaysStuck >= 14 || stuckCount >= 1) return 'medium';
      return 'low';
    },

    pairedProcessId: 'pipeline_nudge_sequence',
    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'days_threshold',
        label: 'Days Before Stuck',
        type: 'number',
        default: 14,
        min: 7,
        max: 60,
      },
    ],
    guardrails: [
      COMMON_GUARDRAILS.max_1_per_contact_per_7d,
      COMMON_GUARDRAILS.max_20_per_run,
    ],
    cooldownHours: 48,
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

    const daysThreshold = 14;
    const stuckDate = new Date();
    stuckDate.setDate(stuckDate.getDate() - daysThreshold);

    // Get stages to exclude (clients and terminal stages) using semantic stage_type
    const excludeTypes = [...CLIENT_STAGE_TYPES, ...TERMINAL_STAGE_TYPES];
    const excludeStageKeys = await getStageKeysByType(this.supabase, userId, excludeTypes);

    // Get contacts that are NOT in excluded stages (clients, past_clients, lost, archived)
    // and haven't had a stage change in 14+ days
    let query = this.supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, email, stage, updated_at')
      .eq('user_id', userId)
      .lt('updated_at', stuckDate.toISOString());

    // Exclude converted/terminal stages if we found any
    if (excludeStageKeys.length > 0) {
      // Build NOT IN filter for stage keys
      const excludeList = excludeStageKeys.map(k => `"${k}"`).join(',');
      query = query.not('stage', 'in', `(${excludeList})`);
    }

    const { data: contacts, error: contactsError } = await query;

    if (contactsError) {
      throw contactsError;
    }

    if (!contacts || contacts.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Check for any recent activity that might indicate movement
    const contactIds = contacts.map((c) => c.id);
    const { data: recentActivities } = await this.supabase
      .from('crm_activities')
      .select('contact_id, activity_date')
      .eq('user_id', userId)
      .in('contact_id', contactIds)
      .gte('activity_date', stuckDate.toISOString());

    // Contacts with recent activity might be progressing
    const activeContactIds = new Set(recentActivities?.map((a) => a.contact_id) || []);

    // Filter to truly stuck contacts (no activity AND no stage change)
    const stuckContacts = contacts.filter((c) => !activeContactIds.has(c.id));

    if (stuckContacts.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate average days stuck
    const now = new Date();
    const daysStuckList = stuckContacts.map((c) => {
      const lastUpdate = new Date(c.updated_at);
      return Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));
    });
    const avgDaysStuck = Math.round(daysStuckList.reduce((a, b) => a + b, 0) / daysStuckList.length);

    // Calculate severity
    const severity = this.definition.severityFn(stuckContacts.length, avgDaysStuck);

    // Estimate impact: stuck deals × avg deal value × probability decay
    const avgDealValue = 300;
    const probabilityDecay = 0.5; // 50% less likely to close after being stuck
    const estimatedLoss = stuckContacts.length * avgDealValue * probabilityDecay;

    // Group by stage for analysis
    const stageBreakdown = stuckContacts.reduce((acc, c) => {
      acc[c.stage] = (acc[c.stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'conversion.pipeline_velocity',
      currentValue: stuckContacts.length,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'contact',
      affectedEntityIds: stuckContacts.map((c) => c.id),
      affectedCount: stuckContacts.length,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        days_threshold: daysThreshold,
        avg_days_stuck: avgDaysStuck,
        stage_breakdown: stageBreakdown,
        contact_ids: stuckContacts.map((c) => c.id),
        contact_details: stuckContacts.map((c) => ({
          id: c.id,
          name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email,
          stage: c.stage,
          days_stuck: Math.floor((now.getTime() - new Date(c.updated_at).getTime()) / (1000 * 60 * 60 * 24)),
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
