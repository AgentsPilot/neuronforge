/**
 * CRM Engagement Decay Detector
 *
 * Detects active clients going quiet (no activity in 30+ days).
 * Signals potential churn risk requiring re-engagement.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { COMMON_GUARDRAILS } from '../types';
import { buildClientStageFilter } from '@/lib/crm/StageTypeUtils';

export class CrmEngagementDecayDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'crm_engagement_decay',
    name: 'Client Engagement Decay',
    category: 'retention',
    description: 'Detects active clients with no activity in 30+ days',

    watchedMetrics: ['retention.clients_at_risk'],
    eventTypes: ['client.at_risk', 'client.churned'],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 30, // 30 days no activity
    direction: 'above',
    minSamples: 1,

    severityFn: (decayingCount: number, avgDaysSilent: number): InsightSeverity => {
      if (decayingCount >= 10 || avgDaysSilent >= 60) return 'critical';
      if (decayingCount >= 5 || avgDaysSilent >= 45) return 'high';
      if (decayingCount >= 2 || avgDaysSilent >= 30) return 'medium';
      return 'low';
    },

    pairedProcessId: 'client_checkin_sequence',
    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'days_threshold',
        label: 'Days Without Activity',
        type: 'number',
        default: 30,
        min: 14,
        max: 90,
      },
      {
        id: 'tone',
        label: 'Check-in Tone',
        type: 'select',
        default: 'caring',
        options: [
          { value: 'caring', label: 'Caring' },
          { value: 'professional', label: 'Professional' },
          { value: 'promotional', label: 'Promotional' },
        ],
      },
    ],
    guardrails: [
      COMMON_GUARDRAILS.max_1_per_contact_per_7d,
      COMMON_GUARDRAILS.max_20_per_run,
    ],
    cooldownHours: 168, // 1 week
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

    const daysThreshold = 30;
    const silentDate = new Date();
    silentDate.setDate(silentDate.getDate() - daysThreshold);

    // Get client stage keys for this user (uses stage_type with fallback)
    const clientStageKeys = await buildClientStageFilter(this.supabase, userId);

    if (clientStageKeys.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Get active clients - using semantic client stages instead of hardcoded 'client'
    const { data: clients, error: clientsError } = await this.supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, email, created_at')
      .eq('user_id', userId)
      .in('stage', clientStageKeys);

    if (clientsError) {
      throw clientsError;
    }

    if (!clients || clients.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Get recent activities for all clients
    const clientIds = clients.map((c) => c.id);
    const { data: activities } = await this.supabase
      .from('crm_activities')
      .select('contact_id, activity_date')
      .eq('user_id', userId)
      .in('contact_id', clientIds)
      .gte('activity_date', silentDate.toISOString());

    // Also check for recent bookings
    const { data: bookings } = await this.supabase
      .from('scheduling_bookings')
      .select('client_email, start_time')
      .eq('user_id', userId)
      .gte('start_time', silentDate.toISOString());

    // Build set of active clients
    const activeClientIds = new Set(activities?.map((a) => a.contact_id) || []);
    const activeClientEmails = new Set(bookings?.map((b) => b.client_email?.toLowerCase()) || []);

    // Find silent clients (no activity AND no bookings)
    const silentClients = clients.filter((client) => {
      if (activeClientIds.has(client.id)) return false;
      if (client.email && activeClientEmails.has(client.email.toLowerCase())) return false;
      // Only count if client relationship is at least 30 days old
      const clientSince = new Date(client.created_at);
      return clientSince < silentDate;
    });

    if (silentClients.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Get last activity date for each silent client
    const silentClientIds = silentClients.map((c) => c.id);
    const { data: lastActivities } = await this.supabase
      .from('crm_activities')
      .select('contact_id, activity_date')
      .eq('user_id', userId)
      .in('contact_id', silentClientIds)
      .order('activity_date', { ascending: false });

    // Build map of last activity per client
    const lastActivityMap: Record<string, Date> = {};
    lastActivities?.forEach((a) => {
      if (!lastActivityMap[a.contact_id]) {
        lastActivityMap[a.contact_id] = new Date(a.activity_date);
      }
    });

    // Calculate days silent for each client
    const now = new Date();
    const clientsWithDaysSilent = silentClients.map((client) => {
      const lastActivity = lastActivityMap[client.id] || new Date(client.created_at);
      const daysSilent = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
      return { ...client, daysSilent, lastActivity };
    });

    // Calculate average days silent
    const avgDaysSilent = Math.round(
      clientsWithDaysSilent.reduce((sum, c) => sum + c.daysSilent, 0) / clientsWithDaysSilent.length
    );

    // Calculate severity
    const severity = this.definition.severityFn(silentClients.length, avgDaysSilent);

    // Estimate impact: each silent client represents LTV at risk
    const avgClientLtv = 1000; // Rough estimate
    const churnProbability = 0.3; // 30% likely to churn if not re-engaged
    const estimatedLoss = silentClients.length * avgClientLtv * churnProbability;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'retention.clients_at_risk',
      currentValue: silentClients.length,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'contact',
      affectedEntityIds: silentClients.map((c) => c.id),
      affectedCount: silentClients.length,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        days_threshold: daysThreshold,
        avg_days_silent: avgDaysSilent,
        tone: 'caring',
        contact_ids: silentClients.map((c) => c.id),
        contact_details: clientsWithDaysSilent.map((c) => ({
          id: c.id,
          name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email,
          days_silent: c.daysSilent,
          last_activity: c.lastActivity.toISOString(),
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
