/**
 * Triggerable Processes Registry
 *
 * Maps insight detectors to kernel processes they can trigger.
 * The kernel defines the actual process steps - Insight just triggers.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 5
 */

import type { Guardrail, ParameterDefinition } from '../detectors/types';
import { COMMON_GUARDRAILS } from '../detectors/types';

// ===========================
// Types
// ===========================

export interface TriggerableProcess {
  /** Unique process ID */
  processId: string;

  /** Human-readable name */
  processName: string;

  /** Description of what this process does */
  description: string;

  /** Can this become a standing automation? */
  eligibleForAutomation: boolean;

  /** Parameters owner can customize */
  ownerParameters: ParameterDefinition[];

  /** Guardrails to apply */
  guardrails: Guardrail[];

  /** Entity type this process operates on */
  entityType: string;

  /** Action verb for UI (e.g., "Chase", "Send", "Draft") */
  actionVerb: string;

  /** Estimated time saved per execution (minutes) */
  estimatedTimeSavedMinutes: number;
}

// ===========================
// Process Registry
// ===========================

/**
 * Registry of processes that can be triggered by insights
 */
export const TRIGGERABLE_PROCESSES: Record<string, TriggerableProcess> = {
  chase_overdue_invoices: {
    processId: 'chase_overdue_invoices',
    processName: 'Chase Overdue Invoices',
    description: 'Send payment reminder emails to clients with overdue invoices',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'days_threshold',
        label: 'Days Overdue',
        type: 'number',
        default: 7,
        min: 1,
        max: 90,
      },
      {
        id: 'tone',
        label: 'Email Tone',
        type: 'select',
        default: 'professional',
        options: [
          { value: 'friendly', label: 'Friendly' },
          { value: 'professional', label: 'Professional' },
          { value: 'firm', label: 'Firm' },
        ],
      },
      {
        id: 'include_payment_link',
        label: 'Include Payment Link',
        type: 'boolean',
        default: true,
      },
    ],
    guardrails: [
      COMMON_GUARDRAILS.max_1_per_invoice_per_7d,
      COMMON_GUARDRAILS.max_20_per_run,
      COMMON_GUARDRAILS.quiet_hours,
    ],
    entityType: 'invoice',
    actionVerb: 'Chase',
    estimatedTimeSavedMinutes: 15,
  },

  send_reminder_sequence: {
    processId: 'send_reminder_sequence',
    processName: 'Send Booking Reminders',
    description: 'Send appointment reminder emails/SMS before bookings',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'hours_before',
        label: 'Hours Before Booking',
        type: 'number',
        default: 24,
        min: 1,
        max: 72,
      },
      {
        id: 'channel',
        label: 'Reminder Channel',
        type: 'select',
        default: 'email',
        options: [
          { value: 'email', label: 'Email' },
          { value: 'sms', label: 'SMS' },
          { value: 'both', label: 'Both' },
        ],
      },
    ],
    guardrails: [
      COMMON_GUARDRAILS.max_2_per_booking,
      COMMON_GUARDRAILS.quiet_hours,
    ],
    entityType: 'booking',
    actionVerb: 'Remind',
    estimatedTimeSavedMinutes: 5,
  },

  send_followup_nudge: {
    processId: 'send_followup_nudge',
    processName: 'Follow Up on Stalled Enquiries',
    description: 'Send follow-up emails to leads who haven\'t received a response',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'delay_hours',
        label: 'Delay After Enquiry',
        type: 'number',
        default: 48,
        min: 24,
        max: 168,
      },
      {
        id: 'tone',
        label: 'Email Tone',
        type: 'select',
        default: 'friendly',
        options: [
          { value: 'friendly', label: 'Friendly' },
          { value: 'professional', label: 'Professional' },
        ],
      },
    ],
    guardrails: [COMMON_GUARDRAILS.max_1_per_contact_per_48h],
    entityType: 'enquiry',
    actionVerb: 'Follow up',
    estimatedTimeSavedMinutes: 10,
  },

  draft_reply_templates: {
    processId: 'draft_reply_templates',
    processName: 'Draft Reply Templates',
    description: 'Generate reply templates for common enquiry types',
    eligibleForAutomation: false, // Advisory only
    ownerParameters: [
      {
        id: 'template_count',
        label: 'Number of Templates',
        type: 'number',
        default: 3,
        min: 1,
        max: 5,
      },
    ],
    guardrails: [],
    entityType: 'template',
    actionVerb: 'Draft',
    estimatedTimeSavedMinutes: 30,
  },
};

/**
 * Maps detector IDs to their paired process
 */
export const DETECTOR_TO_PROCESS: Record<string, string> = {
  cash_ar_overdue: 'chase_overdue_invoices',
  ret_no_show_spike: 'send_reminder_sequence',
  sales_stalled: 'send_followup_nudge',
  sales_reply_slow: 'draft_reply_templates',
  // ops_utilization_low has no paired process (advisory only)
};

/**
 * Get the triggerable process for a detector
 */
export function getProcessForDetector(detectorId: string): TriggerableProcess | null {
  const processId = DETECTOR_TO_PROCESS[detectorId];
  if (!processId) return null;
  return TRIGGERABLE_PROCESSES[processId] || null;
}

/**
 * Get all triggerable processes
 */
export function getAllProcesses(): TriggerableProcess[] {
  return Object.values(TRIGGERABLE_PROCESSES);
}

/**
 * Get processes eligible for automation
 */
export function getAutomatableProcesses(): TriggerableProcess[] {
  return Object.values(TRIGGERABLE_PROCESSES).filter((p) => p.eligibleForAutomation);
}
