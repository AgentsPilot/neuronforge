#!/usr/bin/env node
/**
 * Simple test to verify idempotency metadata is correctly added to all plugins
 * No server dependencies required
 */

const fs = require('fs');
const path = require('path');

const pluginsDir = path.join(__dirname, '../lib/plugins/definitions');
const pluginFiles = fs.readdirSync(pluginsDir).filter(f => f.endsWith('-plugin-v2.json'));

console.log('='.repeat(80));
console.log('Testing Idempotency Metadata in Plugin JSON Files');
console.log('='.repeat(80));
console.log(`\nFound ${pluginFiles.length} plugin files\n`);

let totalActions = 0;
let actionsWithIdempotent = 0;
let actionsWithAlternatives = 0;
let passed = 0;
let failed = 0;

// Specific test cases from CLAUDE.md Problem #3
const criticalTests = [
  {
    plugin: 'google-drive-plugin-v2.json',
    action: 'create_folder',
    expectedIdempotent: false,
    expectedAlternative: 'get_or_create_folder'
  },
  {
    plugin: 'google-drive-plugin-v2.json',
    action: 'get_or_create_folder',
    expectedIdempotent: true,
    expectedAlternative: null
  },
  {
    plugin: 'google-sheets-plugin-v2.json',
    action: 'create_spreadsheet',
    expectedIdempotent: false,
    expectedAlternative: 'get_or_create_spreadsheet'
  },
  {
    plugin: 'slack-plugin-v2.json',
    action: 'create_channel',
    expectedIdempotent: false,
    expectedAlternative: 'get_or_create_channel'
  }
];

// Test each plugin file
for (const file of pluginFiles) {
  const filePath = path.join(pluginsDir, file);
  const plugin = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const pluginName = plugin.plugin.name;

  console.log(`📦 ${pluginName} (${file})`);

  const actions = Object.keys(plugin.actions);
  totalActions += actions.length;

  let pluginPassed = true;

  for (const actionName of actions) {
    const action = plugin.actions[actionName];

    // Check if idempotent field exists
    if ('idempotent' in action) {
      actionsWithIdempotent++;

      const icon = action.idempotent ? '✓' : '✗';
      const altText = action.idempotent_alternative ? ` → ${action.idempotent_alternative}` : '';
      console.log(`  ${icon} ${actionName}: idempotent=${action.idempotent}${altText}`);

      if (action.idempotent_alternative) {
        actionsWithAlternatives++;
      }
    } else {
      console.log(`  ❌ ${actionName}: MISSING idempotent field`);
      pluginPassed = false;
      failed++;
    }
  }

  if (pluginPassed) {
    passed++;
  }

  console.log('');
}

// Run critical tests
console.log('='.repeat(80));
console.log('Running Critical Tests (CLAUDE.md Problem #3)');
console.log('='.repeat(80));
console.log('');

let criticalPassed = 0;
let criticalFailed = 0;

for (const test of criticalTests) {
  const filePath = path.join(pluginsDir, test.plugin);
  const plugin = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const action = plugin.actions[test.action];

  const idempotentMatch = action.idempotent === test.expectedIdempotent;
  const alternativeMatch = (action.idempotent_alternative || null) === test.expectedAlternative;
  const testPassed = idempotentMatch && alternativeMatch;

  if (testPassed) {
    console.log(`✅ ${test.plugin}:${test.action}`);
    console.log(`   idempotent: ${action.idempotent} (✓)`);
    if (action.idempotent_alternative) {
      console.log(`   alternative: ${action.idempotent_alternative} (✓)`);
    }
    criticalPassed++;
  } else {
    console.log(`❌ ${test.plugin}:${test.action}`);
    if (!idempotentMatch) {
      console.log(`   idempotent: ${action.idempotent}, expected: ${test.expectedIdempotent}`);
    }
    if (!alternativeMatch) {
      console.log(`   alternative: ${action.idempotent_alternative || null}, expected: ${test.expectedAlternative}`);
    }
    criticalFailed++;
  }
  console.log('');
}

// Summary
console.log('='.repeat(80));
console.log('Summary:');
console.log('='.repeat(80));
console.log(`Total plugins: ${pluginFiles.length}`);
console.log(`Total actions: ${totalActions}`);
console.log(`Actions with idempotent field: ${actionsWithIdempotent} (${Math.round(actionsWithIdempotent/totalActions*100)}%)`);
console.log(`Actions with alternatives: ${actionsWithAlternatives}`);
console.log('');
console.log(`Plugin files passed: ${passed}/${pluginFiles.length}`);
console.log(`Critical tests passed: ${criticalPassed}/${criticalTests.length}`);
console.log('='.repeat(80));

// Determine overall result
const allActionsHaveIdempotent = actionsWithIdempotent === totalActions;
const allCriticalTestsPassed = criticalFailed === 0;
const success = allActionsHaveIdempotent && allCriticalTestsPassed && failed === 0;

if (success) {
  console.log('\n🎉 SUCCESS! All tests passed.');
  console.log('✅ Phase 0 is 100% complete - Plugin Registry is single source of truth for idempotency metadata.');
  process.exit(0);
} else {
  console.log('\n❌ FAILURE! Some tests failed.');
  if (!allActionsHaveIdempotent) {
    console.log(`   ${totalActions - actionsWithIdempotent} actions missing idempotent field`);
  }
  if (!allCriticalTestsPassed) {
    console.log(`   ${criticalFailed} critical tests failed`);
  }
  process.exit(1);
}
