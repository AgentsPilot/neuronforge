#!/usr/bin/env node
/**
 * Fix all remaining warnings to achieve 100% clean plugin registry
 */

const fs = require('fs');
const path = require('path');

const pluginsDir = path.join(__dirname, '../lib/plugins/definitions');

console.log('='.repeat(80));
console.log('Fixing All Plugin Warnings for Clean Registry');
console.log('='.repeat(80));
console.log('');

let totalFixes = 0;

// =============================================================================
// 1. Add common_errors to Airtable (8 actions)
// =============================================================================

console.log('1. Adding common_errors to Airtable...');

const airtableFile = path.join(pluginsDir, 'airtable-plugin-v2.json');
const airtable = JSON.parse(fs.readFileSync(airtableFile, 'utf8'));

const airtableCommonErrors = {
  "auth_failed": "Your Airtable connection has expired. Please go to Settings → Connected Apps to reconnect Airtable.",
  "not_found": "The specified base, table, or record was not found. Please check the ID and try again.",
  "permission_denied": "You don't have permission to access this resource. Please request access from the base owner or check your Airtable permissions.",
  "rate_limit": "Too many requests to Airtable API. Please wait a moment and try again.",
  "invalid_data": "The provided data is invalid. Please check field types and required fields match the table schema.",
  "api_error": "Airtable API error occurred. Please try again or contact support if the issue persists."
};

for (const actionName of Object.keys(airtable.actions)) {
  const action = airtable.actions[actionName];
  if (action.output_guidance && !action.output_guidance.common_errors) {
    action.output_guidance.common_errors = airtableCommonErrors;
    console.log(`  ✓ Added common_errors to ${actionName}`);
    totalFixes++;
  }
}

fs.writeFileSync(airtableFile, JSON.stringify(airtable, null, 2));
console.log('');

// =============================================================================
// 2. Add missing parameter descriptions to Google Calendar
// =============================================================================

console.log('2. Adding parameter descriptions to Google Calendar...');

const gcalFile = path.join(pluginsDir, 'google-calendar-plugin-v2.json');
const gcal = JSON.parse(fs.readFileSync(gcalFile, 'utf8'));

// create_event is missing 1 parameter description
if (gcal.actions.create_event && gcal.actions.create_event.parameters) {
  const params = gcal.actions.create_event.parameters.properties;

  // Find parameters without descriptions
  for (const [paramName, paramDef] of Object.entries(params)) {
    if (!paramDef.description) {
      // Add appropriate descriptions
      const descriptions = {
        calendar_id: "Calendar identifier (use 'primary' for user's primary calendar or specific calendar email)",
        event_details: "Event information including title, description, start/end times, and attendees",
        send_updates: "Whether to send email notifications to attendees about the event",
        conference_data: "Video conference details (Google Meet link, Zoom, etc.)"
      };

      if (descriptions[paramName]) {
        paramDef.description = descriptions[paramName];
        console.log(`  ✓ Added description to create_event.${paramName}`);
        totalFixes++;
      }
    }
  }
}

fs.writeFileSync(gcalFile, JSON.stringify(gcal, null, 2));
console.log('');

// =============================================================================
// 3. Add missing parameter descriptions to Google Mail
// =============================================================================

console.log('3. Adding parameter descriptions to Google Mail...');

const gmailFile = path.join(pluginsDir, 'google-mail-plugin-v2.json');
const gmail = JSON.parse(fs.readFileSync(gmailFile, 'utf8'));

// send_email missing 3 parameter descriptions
if (gmail.actions.send_email && gmail.actions.send_email.parameters) {
  const params = gmail.actions.send_email.parameters.properties;

  if (params.recipients && params.recipients.properties) {
    for (const [field, fieldDef] of Object.entries(params.recipients.properties)) {
      if (!fieldDef.description) {
        const descriptions = {
          to: "Primary recipients of the email",
          cc: "Carbon copy recipients",
          bcc: "Blind carbon copy recipients"
        };
        if (descriptions[field]) {
          fieldDef.description = descriptions[field];
          console.log(`  ✓ Added description to send_email.recipients.${field}`);
          totalFixes++;
        }
      }
    }
  }

  if (params.content && params.content.properties) {
    for (const [field, fieldDef] of Object.entries(params.content.properties)) {
      if (!fieldDef.description) {
        const descriptions = {
          subject: "Email subject line",
          body: "Plain text email body",
          html_body: "HTML formatted email body"
        };
        if (descriptions[field]) {
          fieldDef.description = descriptions[field];
          console.log(`  ✓ Added description to send_email.content.${field}`);
          totalFixes++;
        }
      }
    }
  }
}

// create_draft missing 2 parameter descriptions
if (gmail.actions.create_draft && gmail.actions.create_draft.parameters) {
  const params = gmail.actions.create_draft.parameters.properties;

  if (params.recipients && params.recipients.properties) {
    for (const [field, fieldDef] of Object.entries(params.recipients.properties)) {
      if (!fieldDef.description) {
        const descriptions = {
          to: "Primary recipients of the email",
          cc: "Carbon copy recipients",
          bcc: "Blind carbon copy recipients"
        };
        if (descriptions[field]) {
          fieldDef.description = descriptions[field];
          console.log(`  ✓ Added description to create_draft.recipients.${field}`);
          totalFixes++;
        }
      }
    }
  }

  if (params.content && params.content.properties) {
    for (const [field, fieldDef] of Object.entries(params.content.properties)) {
      if (!fieldDef.description) {
        const descriptions = {
          subject: "Email subject line",
          body: "Plain text email body",
          html_body: "HTML formatted email body"
        };
        if (descriptions[field]) {
          fieldDef.description = descriptions[field];
          console.log(`  ✓ Added description to create_draft.content.${field}`);
          totalFixes++;
        }
      }
    }
  }
}

fs.writeFileSync(gmailFile, JSON.stringify(gmail, null, 2));
console.log('');

// =============================================================================
// 4. Add output property descriptions to HubSpot (9 actions)
// =============================================================================

console.log('4. Adding output property descriptions to HubSpot...');

const hubspotFile = path.join(pluginsDir, 'hubspot-plugin-v2.json');
const hubspot = JSON.parse(fs.readFileSync(hubspotFile, 'utf8'));

const hubspotDescriptions = {
  // Common fields
  contact_id: "Unique HubSpot contact identifier",
  deal_id: "Unique HubSpot deal identifier",
  task_id: "Unique HubSpot task identifier",
  note_id: "Unique HubSpot note identifier",
  email: "Contact's primary email address",
  firstname: "Contact's first name",
  lastname: "Contact's last name",
  company: "Company name associated with contact",
  phone: "Contact's phone number",
  created_at: "Timestamp when the record was created (ISO 8601)",
  updated_at: "Timestamp when the record was last updated (ISO 8601)",
  dealname: "Name/title of the deal",
  amount: "Deal value in the deal's currency",
  dealstage: "Current stage of the deal in the pipeline",
  closedate: "Expected or actual close date of the deal",
  pipeline: "Sales pipeline the deal belongs to",
  subject: "Subject/title of the task or note",
  body: "Content or description text",
  status: "Current status of the record",
  priority: "Priority level of the task",
  due_date: "Task due date",
  owner_id: "HubSpot user ID of the record owner",
  properties: "Additional custom properties from HubSpot",
  retrieved_at: "Timestamp when data was fetched from HubSpot (ISO 8601)"
};

for (const actionName of Object.keys(hubspot.actions)) {
  const action = hubspot.actions[actionName];

  if (action.output_schema && action.output_schema.properties) {
    let actionFixes = 0;

    for (const [propName, propDef] of Object.entries(action.output_schema.properties)) {
      if (!propDef.description && hubspotDescriptions[propName]) {
        propDef.description = hubspotDescriptions[propName];
        actionFixes++;
        totalFixes++;
      }
    }

    if (actionFixes > 0) {
      console.log(`  ✓ Added ${actionFixes} property descriptions to ${actionName}`);
    }
  }
}

fs.writeFileSync(hubspotFile, JSON.stringify(hubspot, null, 2));
console.log('');

// =============================================================================
// Summary
// =============================================================================

console.log('='.repeat(80));
console.log(`✅ Fixed ${totalFixes} issues across all plugins`);
console.log('='.repeat(80));
console.log('');
console.log('Run audit to verify:');
console.log('  node scripts/audit-plugin-completeness.js');
console.log('');
