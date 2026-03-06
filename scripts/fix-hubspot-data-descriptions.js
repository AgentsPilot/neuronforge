#!/usr/bin/env node
/**
 * Fix missing 'data' property descriptions in HubSpot actions
 */

const fs = require('fs');
const path = require('path');

const hubspotFile = path.join(__dirname, '../lib/plugins/definitions/hubspot-plugin-v2.json');
const hubspot = JSON.parse(fs.readFileSync(hubspotFile, 'utf8'));

console.log('Fixing HubSpot data property descriptions...\n');

const dataDescriptions = {
  get_contact_deals: "Contact information and associated deals with pipeline details",
  get_contact_activities: "Contact information and recent activity history",
  search_contacts: "List of contacts matching the search criteria with their properties",
  get_deal: "Deal information including amount, stage, and associated properties",
  create_contact: "Newly created contact information with assigned contact ID",
  create_task: "Created task details including task ID and due date",
  create_deal: "Newly created deal information with deal ID and pipeline assignment",
  create_contact_note: "Created note details including note ID and timestamp"
};

let fixed = 0;

for (const [actionName, description] of Object.entries(dataDescriptions)) {
  if (hubspot.actions[actionName] &&
      hubspot.actions[actionName].output_schema &&
      hubspot.actions[actionName].output_schema.properties &&
      hubspot.actions[actionName].output_schema.properties.data) {

    const dataProp = hubspot.actions[actionName].output_schema.properties.data;

    if (!dataProp.description || dataProp.description === "") {
      dataProp.description = description;
      console.log(`✓ Fixed ${actionName}.data`);
      fixed++;
    } else {
      console.log(`- ${actionName}.data already has description`);
    }
  }
}

fs.writeFileSync(hubspotFile, JSON.stringify(hubspot, null, 2));

console.log(`\n✅ Fixed ${fixed} data property descriptions in HubSpot`);
console.log('\nRun audit to verify ZERO warnings:');
console.log('  node scripts/audit-plugin-completeness.js');
