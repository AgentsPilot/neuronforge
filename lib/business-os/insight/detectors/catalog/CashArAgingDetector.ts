/**
 * Cash AR Aging Detector
 *
 * Detects invoices aging into harder-to-collect buckets (30-60d, 60-90d, 90+d).
 * Escalates collection priority based on age.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

interface AgingBucket {
  range: string;
  invoices: Array<{ id: string; amount: number; daysOverdue: number; contactId?: string }>;
  total: number;
}

export class CashArAgingDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_ar_aging',
    name: 'AR Aging Alert',
    category: 'cash_flow',
    description: 'Detects invoices aging into 60+ day buckets',

    watchedMetrics: ['cashflow.ar_aging'],
    eventTypes: ['invoice.overdue', 'ar.aged'],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0, // Any invoice in 60+ bucket
    direction: 'above',
    minSamples: 1,

    severityFn: (bucket90Plus: number, bucket6090: number): InsightSeverity => {
      if (bucket90Plus >= 2) return 'critical';
      if (bucket90Plus >= 1 || bucket6090 >= 3) return 'high';
      if (bucket6090 >= 1) return 'medium';
      return 'low';
    },

    pairedProcessId: 'escalated_collection_sequence',
    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'escalation_tone',
        label: 'Collection Tone',
        type: 'select',
        default: 'firm',
        options: [
          { value: 'professional', label: 'Professional' },
          { value: 'firm', label: 'Firm' },
          { value: 'final_notice', label: 'Final Notice' },
        ],
      },
    ],
    guardrails: [],
    cooldownHours: 72, // 3 days
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

    // Get all overdue invoices (unpaid, past due date)
    const { data: overdueInvoices, error } = await this.supabase
      .from('payment_invoices')
      .select('id, amount, due_date, contact_id, invoice_number')
      .eq('user_id', userId)
      .in('status', ['sent', 'overdue'])
      .lt('due_date', now.toISOString())
      .gt('amount', 0);

    if (error) {
      throw error;
    }

    if (!overdueInvoices || overdueInvoices.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate aging buckets
    const buckets: Record<string, AgingBucket> = {
      '30-60': { range: '30-60 days', invoices: [], total: 0 },
      '60-90': { range: '60-90 days', invoices: [], total: 0 },
      '90+': { range: '90+ days', invoices: [], total: 0 },
    };

    overdueInvoices.forEach((inv) => {
      const dueDate = new Date(inv.due_date);
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      const amount = parseFloat(inv.amount || '0');

      const invoiceData = {
        id: inv.id,
        amount,
        daysOverdue,
        contactId: inv.contact_id,
        invoiceNumber: inv.invoice_number,
      };

      if (daysOverdue >= 90) {
        buckets['90+'].invoices.push(invoiceData);
        buckets['90+'].total += amount;
      } else if (daysOverdue >= 60) {
        buckets['60-90'].invoices.push(invoiceData);
        buckets['60-90'].total += amount;
      } else if (daysOverdue >= 30) {
        buckets['30-60'].invoices.push(invoiceData);
        buckets['30-60'].total += amount;
      }
      // 0-30 days handled by existing cash_ar_overdue detector
    });

    // Only fire if invoices in 60+ bucket
    const bucket6090Count = buckets['60-90'].invoices.length;
    const bucket90PlusCount = buckets['90+'].invoices.length;

    if (bucket6090Count === 0 && bucket90PlusCount === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const severity = this.definition.severityFn(bucket90PlusCount, bucket6090Count);

    // Total at risk
    const totalAtRisk = buckets['60-90'].total + buckets['90+'].total;
    const totalInvoices = bucket6090Count + bucket90PlusCount;

    // Get contact names
    const contactIds = [
      ...buckets['60-90'].invoices.map((i) => i.contactId),
      ...buckets['90+'].invoices.map((i) => i.contactId),
    ].filter(Boolean) as string[];

    let contactNames: Record<string, string> = {};
    if (contactIds.length > 0) {
      const { data: contacts } = await this.supabase
        .from('crm_contacts')
        .select('id, first_name, last_name, email')
        .in('id', [...new Set(contactIds)]);

      if (contacts) {
        contactNames = contacts.reduce((acc, c) => {
          acc[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email;
          return acc;
        }, {} as Record<string, string>);
      }
    }

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.ar_aging',
      currentValue: totalInvoices,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'invoice',
      affectedEntityIds: [
        ...buckets['90+'].invoices.map((i) => i.id),
        ...buckets['60-90'].invoices.map((i) => i.id),
      ],
      affectedCount: totalInvoices,
      estimatedImpactUsd: totalAtRisk,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        escalation_tone: 'firm',
        total_at_risk: totalAtRisk,
        buckets: {
          '30-60': {
            count: buckets['30-60'].invoices.length,
            total: buckets['30-60'].total,
          },
          '60-90': {
            count: bucket6090Count,
            total: buckets['60-90'].total,
            invoices: buckets['60-90'].invoices.map((i) => ({
              ...i,
              contactName: i.contactId ? contactNames[i.contactId] : null,
            })),
          },
          '90+': {
            count: bucket90PlusCount,
            total: buckets['90+'].total,
            invoices: buckets['90+'].invoices.map((i) => ({
              ...i,
              contactName: i.contactId ? contactNames[i.contactId] : null,
            })),
          },
        },
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
