#!/usr/bin/env node
/**
 * Script to add idempotent metadata to all plugin actions
 * Based on CLAUDE.md requirement: Add `idempotent: boolean` field to plugin action schemas
 */

const fs = require('fs');
const path = require('path');

const pluginsDir = path.join(__dirname, '../lib/plugins/definitions');

// Rules for determining idempotency
const idempotentPatterns = {
  // Read operations - always idempotent
  read: /^(get|read|list|search|fetch|retrieve|find|show|view)_/,

  // Write operations that are idempotent due to their nature
  idempotentWrites: ['get_or_create_', 'share_', 'add_reaction', 'remove_reaction', 'mark_message_read'],

  // Update/Delete operations can be idempotent (repeated calls have same effect)
  updates: /^(update|delete|remove)_/,

  // Non-idempotent operations
  nonIdempotent: /^(create|send|append|insert|upload|post)_/
};

function determineIdempotency(actionName) {
  // Check for get_or_create pattern
  if (idempotentPatterns.idempotentWrites.some(pattern => actionName.includes(pattern))) {
    return true;
  }

  // Read operations
  if (idempotentPatterns.read.test(actionName)) {
    return true;
  }

  // Update/Delete operations (idempotent - running twice has same effect)
  if (idempotentPatterns.updates.test(actionName)) {
    return true;
  }

  // Create/Send/Append operations
  if (idempotentPatterns.nonIdempotent.test(actionName)) {
    return false;
  }

  // Default to true for safety (assume reads)
  console.warn(`⚠️  Unknown pattern for action: ${actionName}, defaulting to idempotent: true`);
  return true;
}

function findAlternative(actionName, allActions) {
  // Check for get_or_create alternative
  const getOrCreate = `get_or_create_${actionName.replace(/^create_/, '')}`;
  if (allActions.includes(getOrCreate)) {
    return getOrCreate;
  }
  return null;
}

function processPlugin(pluginFile) {
  const pluginPath = path.join(pluginsDir, pluginFile);
  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));

  const pluginName = plugin.plugin.name;
  const actions = Object.keys(plugin.actions);

  console.log(`\n📦 Processing ${pluginName} (${actions.length} actions)...`);

  let modified = false;

  actions.forEach(actionName => {
    const action = plugin.actions[actionName];

    // Skip if already has idempotent field
    if ('idempotent' in action) {
      console.log(`  ✓ ${actionName}: already has idempotent field`);
      return;
    }

    const isIdempotent = determineIdempotency(actionName);
    action.idempotent = isIdempotent;

    // Add alternative if non-idempotent and alternative exists
    if (!isIdempotent) {
      const alternative = findAlternative(actionName, actions);
      if (alternative) {
        action.idempotent_alternative = alternative;
        console.log(`  + ${actionName}: idempotent=${isIdempotent}, alternative=${alternative}`);
      } else {
        console.log(`  + ${actionName}: idempotent=${isIdempotent}`);
      }
    } else {
      console.log(`  + ${actionName}: idempotent=${isIdempotent}`);
    }

    modified = true;
  });

  if (modified) {
    fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));
    console.log(`✅ ${pluginName}: updated`);
  } else {
    console.log(`⏭️  ${pluginName}: no changes needed`);
  }
}

// Process all plugin files
const pluginFiles = fs.readdirSync(pluginsDir).filter(f => f.endsWith('-plugin-v2.json'));

console.log('🚀 Adding idempotent metadata to plugins...\n');
console.log(`Found ${pluginFiles.length} plugin files`);

pluginFiles.forEach(processPlugin);

console.log('\n✅ Done! All plugins processed.');
