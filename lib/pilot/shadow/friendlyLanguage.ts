/**
 * Friendly Language Utility
 *
 * Maps technical step names, plugin/action names, error codes, and
 * step results into plain business language for non-technical users.
 *
 * Used by the calibration page to display step progress without
 * exposing internal implementation details.
 *
 * @module lib/pilot/shadow/friendlyLanguage
 */

import type { FailureCategory } from './types';

// ─── Step Type → Friendly Verb ──────────────────────────────

const STEP_TYPE_VERBS: Record<string, string> = {
  action: 'Running',
  transform: 'Processing',
  filter: 'Filtering',
  conditional: 'Checking conditions',
  loop: 'Repeating for each item',
  scatter_gather: 'Processing in parallel',
  ai_transform: 'Analyzing with AI',
  send_email: 'Sending email',
  sub_workflow: 'Running sub-workflow',
  human_approval: 'Waiting for approval',
};

// ─── Plugin → Friendly Name ─────────────────────────────────

const PLUGIN_FRIENDLY_NAMES: Record<string, string> = {
  'google-mail': 'Gmail',
  'google-sheets': 'Google Sheets',
  'google-drive': 'Google Drive',
  'google-calendar': 'Google Calendar',
  'google-docs': 'Google Docs',
  'google_sheets': 'Google Sheets',
  'google_mail': 'Gmail',
  'google_drive': 'Google Drive',
  'google_calendar': 'Google Calendar',
  'google_docs': 'Google Docs',
  gmail: 'Gmail',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  hubspot: 'HubSpot',
  linkedin: 'LinkedIn',
  airtable: 'Airtable',
  salesforce: 'Salesforce',
  zendesk: 'Zendesk',
  'chatgpt-research': 'AI Research',
  chatgpt_research: 'AI Research',
};

// ─── Action → Friendly Description ──────────────────────────

const ACTION_FRIENDLY: Record<string, string> = {
  // Read operations
  list_rows: 'Getting data from',
  read_range: 'Reading data from',
  list_records: 'Fetching records from',
  search_emails: 'Searching emails in',
  list_events: 'Getting events from',
  list_files: 'Listing files from',
  read_document: 'Reading document from',
  get_contact: 'Getting contact from',
  get_contact_deals: 'Getting deals from',
  get_contact_activities: 'Getting activities from',
  list_bases: 'Listing databases from',
  get_profile: 'Getting profile from',
  research_topic: 'Researching with',

  // Write operations
  send_email: 'Sending email via',
  send_message: 'Sending message via',
  send_template_message: 'Sending message via',
  write_range: 'Updating data in',
  append_rows: 'Adding data to',
  create_record: 'Creating record in',
  update_record: 'Updating record in',
  delete_record: 'Removing record from',
  create_event: 'Creating event in',
  upload_file: 'Uploading file to',
};

// ─── Failure Category → Friendly Error ──────────────────────

const CATEGORY_FRIENDLY_ERRORS: Record<FailureCategory, string> = {
  execution_error: 'The step failed to execute - check the error details below',
  missing_step: 'A required step is missing from the workflow',
  invalid_step_order: 'Steps are in the wrong order',
  capability_mismatch: 'This action is not supported',
  logic_error: 'There was an issue with the conditions',
  data_shape_mismatch: 'Had trouble reading the data format',
  data_unavailable: 'No data was found',
};

// ─── Error Sub-Type → Friendly Hint ─────────────────────────

const ERROR_SUBTYPE_HINTS: Record<string, string> = {
  retryable: 'This might work if you try again',
  auth: 'Please check your account connection',
  rate_limit: 'Too many requests — try again in a moment',
  api_error: 'The service returned an error',
};

// ─── Repair Action → Friendly Description ───────────────────

const REPAIR_ACTION_FRIENDLY: Record<string, string> = {
  extract_single_array: 'Auto-extracted the data list',
  extract_named_array: 'Auto-found the right data section',
  wrap_in_array: 'Auto-wrapped single item into a list',
  none: '',
};

// ─── Public API ─────────────────────────────────────────────

/**
 * Convert a technical step definition into a friendly step name.
 *
 * Examples:
 * - { name: "step1", type: "action", plugin: "google-sheets", action: "list_rows" }
 *   → "Getting data from Google Sheets"
 * - { name: "filter_leads", type: "transform" }
 *   → "Filtering leads"
 * - { name: "send_email_to_team", type: "action", plugin: "gmail", action: "send_email" }
 *   → "Sending email via Gmail"
 */
export function getFriendlyStepName(stepDef: {
  name: string;
  type: string;
  plugin?: string;
  action?: string;
  step_name?: string;
}): string {
  const plugin = stepDef.plugin;
  const action = stepDef.action;

  // Try plugin + action combination first
  if (plugin && action) {
    const friendlyPlugin = PLUGIN_FRIENDLY_NAMES[plugin] || plugin;
    const friendlyAction = ACTION_FRIENDLY[action];
    if (friendlyAction) {
      return `${friendlyAction} ${friendlyPlugin}`;
    }
    // Fallback: verb from step type + plugin name
    const verb = STEP_TYPE_VERBS[stepDef.type] || 'Running';
    return `${verb} ${friendlyPlugin}`;
  }

  // Use step_name or name as fallback, humanized
  const rawName = stepDef.step_name || stepDef.name;
  const humanized = humanizeStepName(rawName);

  // Prefix with step type verb if we have one
  const verb = STEP_TYPE_VERBS[stepDef.type];
  if (verb && !humanized.toLowerCase().startsWith(verb.toLowerCase())) {
    return `${verb} ${humanized.charAt(0).toLowerCase() + humanized.slice(1)}`;
  }

  return humanized;
}

/**
 * Generate a friendly summary for a step result.
 *
 * Examples:
 * - { status: "completed", itemCount: 47 } → "Found 47 items"
 * - { status: "completed", itemCount: 0 }  → "No items found"
 * - { status: "failed" }                    → "Something went wrong"
 * - { status: "skipped" }                   → "Skipped"
 * - { status: "running" }                   → "Working on it..."
 */
export function getFriendlyStepSummary(stepResult: {
  status: string;
  itemCount?: number;
  error?: string;
  step_type?: string;
}): string {
  switch (stepResult.status) {
    case 'completed': {
      if (stepResult.itemCount !== undefined && stepResult.itemCount !== null) {
        if (stepResult.itemCount === 0) return 'No items found';
        if (stepResult.itemCount === 1) return 'Found 1 item';
        return `Found ${stepResult.itemCount.toLocaleString()} items`;
      }
      return 'Completed successfully';
    }

    case 'failed':
      return stepResult.error
        ? truncateFriendly(stepResult.error, 80)
        : 'Something went wrong';

    case 'skipped':
      return 'Skipped — conditions not met';

    case 'running':
      return 'Working on it...';

    case 'pending':
      return 'Waiting...';

    default:
      return '';
  }
}

/**
 * Convert a failure category + error message into a friendly error string.
 *
 * Examples:
 * - ("execution_error", "401 Unauthorized", "auth")
 *   → "Could not connect — please check your account connection"
 * - ("data_shape_mismatch", "Expected array but got object")
 *   → "Had trouble reading the data format"
 * - ("data_unavailable", "No rows returned")
 *   → "No data was found"
 */
export function getFriendlyError(
  category: FailureCategory,
  errorMessage: string,
  subType?: string
): string {
  const baseFriendly = CATEGORY_FRIENDLY_ERRORS[category] || 'Something went wrong';

  // Add sub-type hint if available
  if (subType && ERROR_SUBTYPE_HINTS[subType]) {
    return `${baseFriendly} — ${ERROR_SUBTYPE_HINTS[subType]}`;
  }

  return baseFriendly;
}

/**
 * Get a friendly description for an auto-repair action.
 * Used for the "auto-fixed" badge tooltip.
 */
export function getFriendlyRepairDescription(repairAction: string): string {
  return REPAIR_ACTION_FRIENDLY[repairAction] || 'Auto-fixed a data issue';
}

/**
 * Get a friendly plugin name from a technical plugin ID.
 */
export function getFriendlyPluginName(pluginId: string): string {
  return PLUGIN_FRIENDLY_NAMES[pluginId] || pluginId;
}

// ─── Private Helpers ────────────────────────────────────────

/**
 * Convert a snake_case or camelCase step name into human-readable text.
 * "filter_leads_by_stage" → "Filter leads by stage"
 * "sendEmailToTeam" → "Send email to team"
 */
function humanizeStepName(name: string): string {
  if (!name) return 'Unknown step';

  // Remove step prefixes like "step1_", "step-2-"
  let cleaned = name.replace(/^step[-_]?\d+[-_]?/i, '');
  if (!cleaned) cleaned = name;

  // snake_case → spaces
  cleaned = cleaned.replace(/_/g, ' ');

  // camelCase → spaces
  cleaned = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Capitalize first letter
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();

  return cleaned.trim() || 'Processing';
}

/**
 * Truncate a string to a max length, adding "..." if needed.
 * Avoids cutting mid-word.
 */
function truncateFriendly(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;

  const truncated = text.substring(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.6) {
    return truncated.substring(0, lastSpace) + '...';
  }
  return truncated + '...';
}
