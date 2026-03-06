#!/usr/bin/env node
/**
 * Fix missing usage_context fields in Slack plugin
 */

const fs = require('fs');
const path = require('path');

const slackFile = path.join(__dirname, '../lib/plugins/definitions/slack-plugin-v2.json');
const plugin = JSON.parse(fs.readFileSync(slackFile, 'utf8'));

// Usage contexts for each Slack action
const usageContexts = {
  send_message: "When user wants to send a notification, post an update, share information, or communicate with team members in Slack",
  read_messages: "When user wants to check messages, read conversation history, retrieve channel messages, or monitor Slack discussions",
  update_message: "When user wants to edit a previously sent message, correct information, or update message content in Slack",
  add_reaction: "When user wants to acknowledge messages, add emoji reactions, or express sentiment to Slack messages",
  remove_reaction: "When user wants to remove previously added emoji reactions from Slack messages",
  get_or_create_channel: "When user wants to ensure a channel exists, get channel info if it exists or create it if not (idempotent operation for recurring workflows)",
  create_channel: "When user wants to create a new Slack channel for team collaboration or project organization",
  list_channels: "When user wants to browse available channels, find channels by name, or explore Slack workspace channels",
  list_users: "When user wants to see team members, find users by name, or get workspace member information",
  get_user_info: "When user wants to look up specific user details, get user profile information, or verify user identity",
  upload_file: "When user wants to share files, upload documents, or attach content to Slack channels or conversations"
};

console.log('Fixing Slack plugin usage_context fields...\n');

let fixed = 0;

for (const [actionName, usageContext] of Object.entries(usageContexts)) {
  if (plugin.actions[actionName]) {
    if (!plugin.actions[actionName].usage_context) {
      plugin.actions[actionName].usage_context = usageContext;
      console.log(`✓ Added usage_context to ${actionName}`);
      fixed++;
    } else {
      console.log(`- ${actionName} already has usage_context`);
    }
  } else {
    console.log(`⚠ Action ${actionName} not found in plugin`);
  }
}

// Write back to file
fs.writeFileSync(slackFile, JSON.stringify(plugin, null, 2));

console.log(`\n✅ Fixed ${fixed} actions in slack-plugin-v2.json`);
