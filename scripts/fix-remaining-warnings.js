#!/usr/bin/env node
/**
 * Fix the remaining 11 warnings for 100% clean registry
 */

const fs = require('fs');
const path = require('path');

const pluginsDir = path.join(__dirname, '../lib/plugins/definitions');

console.log('Fixing remaining warnings...\n');

let totalFixes = 0;

// Fix 1: Google Calendar - reminders parameter
const gcalFile = path.join(pluginsDir, 'google-calendar-plugin-v2.json');
const gcal = JSON.parse(fs.readFileSync(gcalFile, 'utf8'));

if (gcal.actions.create_event.parameters.properties.reminders) {
  gcal.actions.create_event.parameters.properties.reminders.description =
    "Reminder settings for the event (time-based notifications before event starts)";
  console.log('✓ Fixed google-calendar.create_event.reminders');
  totalFixes++;
}

fs.writeFileSync(gcalFile, JSON.stringify(gcal, null, 2));

// Fix 2 & 3: Google Mail - nested parameter objects
const gmailFile = path.join(pluginsDir, 'google-mail-plugin-v2.json');
const gmail = JSON.parse(fs.readFileSync(gmailFile, 'utf8'));

// send_email
if (gmail.actions.send_email.parameters.properties.recipients &&
    !gmail.actions.send_email.parameters.properties.recipients.description) {
  gmail.actions.send_email.parameters.properties.recipients.description =
    "Email recipients (to, cc, bcc addresses)";
  console.log('✓ Fixed google-mail.send_email.recipients');
  totalFixes++;
}

if (gmail.actions.send_email.parameters.properties.content &&
    !gmail.actions.send_email.parameters.properties.content.description) {
  gmail.actions.send_email.parameters.properties.content.description =
    "Email content (subject, body, html_body)";
  console.log('✓ Fixed google-mail.send_email.content');
  totalFixes++;
}

if (gmail.actions.send_email.parameters.properties.options &&
    !gmail.actions.send_email.parameters.properties.options.description) {
  gmail.actions.send_email.parameters.properties.options.description =
    "Optional email settings (send immediately, request read receipt)";
  console.log('✓ Fixed google-mail.send_email.options');
  totalFixes++;
}

// create_draft
if (gmail.actions.create_draft.parameters.properties.recipients &&
    !gmail.actions.create_draft.parameters.properties.recipients.description) {
  gmail.actions.create_draft.parameters.properties.recipients.description =
    "Email recipients (to, cc, bcc addresses)";
  console.log('✓ Fixed google-mail.create_draft.recipients');
  totalFixes++;
}

if (gmail.actions.create_draft.parameters.properties.content &&
    !gmail.actions.create_draft.parameters.properties.content.description) {
  gmail.actions.create_draft.parameters.properties.content.description =
    "Email content (subject, body, html_body)";
  console.log('✓ Fixed google-mail.create_draft.content');
  totalFixes++;
}

fs.writeFileSync(gmailFile, JSON.stringify(gmail, null, 2));

// Fix 4: HubSpot - output properties
const hubspotFile = path.join(pluginsDir, 'hubspot-plugin-v2.json');
const hubspot = JSON.parse(fs.readFileSync(hubspotFile, 'utf8'));

const hubspotActions = [
  'get_contact_deals',
  'get_contact_activities',
  'search_contacts',
  'get_deal',
  'create_contact',
  'create_task',
  'create_deal',
  'create_contact_note'
];

const hubspotDescriptions = {
  deals: "List of associated deals with the contact",
  activities: "Recent activities and interactions with the contact",
  contacts: "List of contacts matching the search criteria",
  contact: "Contact information and properties",
  deal: "Deal information and properties",
  task: "Created task details",
  note: "Created note details",
  success: "Whether the operation completed successfully",
  message: "Status or confirmation message",
  total_count: "Total number of results available",
  has_more: "Whether there are more results to fetch",
  next_page_token: "Token for fetching the next page of results",
  // Generic fallbacks
  contact_id: "Unique HubSpot contact identifier",
  deal_id: "Unique HubSpot deal identifier",
  task_id: "Unique HubSpot task identifier",
  note_id: "Unique HubSpot note identifier",
  created_at: "Timestamp when the record was created (ISO 8601)",
  updated_at: "Timestamp when the record was last updated (ISO 8601)",
  retrieved_at: "Timestamp when data was fetched from HubSpot (ISO 8601)"
};

for (const actionName of hubspotActions) {
  if (hubspot.actions[actionName] && hubspot.actions[actionName].output_schema) {
    const props = hubspot.actions[actionName].output_schema.properties;
    let actionFixes = 0;

    for (const [propName, propDef] of Object.entries(props)) {
      if (!propDef.description && hubspotDescriptions[propName]) {
        propDef.description = hubspotDescriptions[propName];
        actionFixes++;
        totalFixes++;
      }
    }

    if (actionFixes > 0) {
      console.log(`✓ Fixed hubspot.${actionName} (${actionFixes} properties)`);
    }
  }
}

fs.writeFileSync(hubspotFile, JSON.stringify(hubspot, null, 2));

console.log(`\n✅ Fixed ${totalFixes} remaining issues`);
console.log('\nRun audit to verify zero warnings:');
console.log('  node scripts/audit-plugin-completeness.js');
