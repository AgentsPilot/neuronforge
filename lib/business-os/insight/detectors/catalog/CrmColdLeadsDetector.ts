/**
 * CRM Cold Leads Detector
 *
 * Detects leads that have gone cold (no activity in 7+ days).
 * This is an absolute threshold detector - fires immediately when cold leads exist.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { COMMON_GUARDRAILS } from '../types';

export class CrmColdLeadsDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'crm_cold_leads',
    name: 'Cold Leads',
    category: 'conversion',
    description: 'Detects leads without activity in 7+ days',

    watchedMetrics: ['conversion.cold_leads_count'],
    eventTypes: ['contact.created', 'contact.stage_changed'],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    minSamples: 1,

    severityFn: (coldCount: number): InsightSeverity => {
      if (coldCount >= 10) return 'critical';
      if (coldCount >= 5) return 'high';
      if (coldCount >= 2) return 'medium';
      return 'low';
    },

    pairedProcessId: 'send_warmup_sequence',
    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'days_threshold',
        label: 'Days Without Activity',
        type: 'number',
        default: 7,
        min: 3,
        max: 30,
      },
      {
        id: 'tone',
        label: 'Follow-up Tone',
        type: 'select',
        default: 'friendly',
        options: [
          { value: 'friendly', label: 'Friendly' },
          { value: 'professional', label: 'Professional' },
          { value: 'urgent', label: 'Urgent' },
        ],
      },
    ],
    guardrails: [
      COMMON_GUARDRAILS.max_1_per_contact_per_7d,
      COMMON_GUARDRAILS.max_20_per_run,
    ],
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

    const daysThreshold = 7;
    const coldDate = new Date();
    coldDate.setDate(coldDate.getDate() - daysThreshold);

    // Get all leads (non-client contacts)
    const { data: leads, error: leadsError } = await this.supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, email, stage, created_at')
      .eq('user_id', userId)
      .in('stage', ['lead', 'new_lead', 'prospect', 'enquiry']);

    if (leadsError) {
      throw leadsError;
    }

    if (!leads || leads.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Get recent activities for these leads
    const leadIds = leads.map((l) => l.id);
    const { data: activities } = await this.supabase
      .from('crm_activities')
      .select('contact_id, activity_date')
      .eq('user_id', userId)
      .in('contact_id', leadIds)
      .gte('activity_date', coldDate.toISOString())
      .order('activity_date', { ascending: false });

    // Find leads with recent activity
    const activeLeadIds = new Set(activities?.map((a) => a.contact_id) || []);

    // Cold leads = leads without recent activity
    const coldLeads = leads.filter((lead) => {
      // If lead was created after the cold threshold, it's not cold yet
      if (new Date(lead.created_at) > coldDate) {
        return false;
      }
      return !activeLeadIds.has(lead.id);
    });

    if (coldLeads.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const severity = this.definition.severityFn(coldLeads.length, 0);

    // Estimate impact: avg deal value × conversion rate × cold leads
    const avgDealValue = 300;
    const conversionRate = 0.15;
    const estimatedLoss = coldLeads.length * avgDealValue * conversionRate;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'conversion.cold_leads_count',
      currentValue: coldLeads.length,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'contact',
      affectedEntityIds: coldLeads.map((l) => l.id),
      affectedCount: coldLeads.length,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        days_threshold: daysThreshold,
        tone: 'friendly',
        contact_ids: coldLeads.map((l) => l.id),
        contact_names: coldLeads.map((l) =>
          `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.email
        ),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
