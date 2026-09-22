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

  /*
   * The MVP0 detectors, each pointed at a process that EXISTS.
   *
   * This map and each detector's own `pairedProcessId` are two statements of
   * the same fact, and they disagree: twenty detectors name a process that was
   * never built (`pipeline_nudge_sequence`, `task_reminder`, `add_cta_block`),
   * and this map covers only four. `KernelTrigger` fails a run it cannot find a
   * process for, and `getProcessForDetector` returns null for everything absent
   * here — so between them most "handle it for me" and "put it on autopilot"
   * paths are dead. Reconciling the two is its own piece of work; these entries
   * at least do not add to the pile.
   */
  /*
   * Detectors whose invented process was replaced by the real one that does
   * the same job — see each detector's own `pairedProcessId`. The parity test
   * in kernel/__tests__ keeps this map and those declarations in step.
   */
  crm_cold_leads: 'send_followup_nudge',
  conv_pipeline_stuck: 'send_followup_nudge',
  ret_repeat_booking_low: 'send_followup_nudge',
  crm_engagement_decay: 'send_followup_nudge',
  pricing_intro_offer_stuck: 'send_followup_nudge',
  cash_ar_aging: 'chase_overdue_invoices',
  ret_cancellation_spike: 'send_reminder_sequence',

  cash_booking_unpaid: 'chase_overdue_invoices',
  cash_revenue_at_risk: 'chase_overdue_invoices',
  conv_no_next_step: 'send_followup_nudge',
  conv_stage_dropoff: 'send_followup_nudge',
  conv_service_rate_drop: 'send_followup_nudge',
};

/**
 * Get the triggerable process for a detector
 */
/**
 * The process an INSIGHT can run, from the process id the insight already
 * carries.
 *
 * Preferred over `getProcessForDetector` wherever the caller holds an insight.
 * `paired_process_id` is written onto the row from the detector's own
 * definition at detection time, so it is the detector speaking directly —
 * whereas the detector-id lookup goes through a second, hand-maintained map
 * that can only ever agree or be wrong.
 */
export function getProcess(processId: string | null | undefined): TriggerableProcess | null {
  if (!processId) return null;
  return TRIGGERABLE_PROCESSES[processId] || null;
}

/**
 * The process a DETECTOR can run, by detector id.
 *
 * Still needed, and the map with it: the dashboard asks this question in the
 * browser, where the detector classes cannot be imported — they pull in a
 * Supabase client and the baseline calculator. A static map is the only form
 * that question can take on the client.
 *
 * `kernel/__tests__/detectorProcessParity.test.ts` holds the map to the
 * detectors so the two cannot drift apart quietly.
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
