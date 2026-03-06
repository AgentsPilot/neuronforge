#!/usr/bin/env ts-node
/**
 * Test script to verify idempotency metadata is correctly loaded and accessible
 * Tests Phase 0 completion: Plugin Registry as single source of truth
 */

import { PluginManagerV2 } from '../lib/server/plugin-manager-v2';
import { createLogger } from '../lib/logger';

const logger = createLogger({ module: 'TEST', service: 'IdempotencyMetadata' });

async function testIdempotencyMetadata() {
  logger.info('='.repeat(80));
  logger.info('Testing Idempotency Metadata Access');
  logger.info('='.repeat(80));

  // Initialize PluginManagerV2
  const manager = await PluginManagerV2.getInstance();

  // Test cases based on CLAUDE.md Problem #3
  const testCases = [
    {
      name: 'Google Drive: create_folder (non-idempotent with alternative)',
      plugin: 'google-drive',
      action: 'create_folder',
      expectedIdempotent: false,
      expectedAlternative: 'get_or_create_folder'
    },
    {
      name: 'Google Drive: get_or_create_folder (idempotent)',
      plugin: 'google-drive',
      action: 'get_or_create_folder',
      expectedIdempotent: true,
      expectedAlternative: null
    },
    {
      name: 'Google Drive: list_files (idempotent read operation)',
      plugin: 'google-drive',
      action: 'list_files',
      expectedIdempotent: true,
      expectedAlternative: null
    },
    {
      name: 'Google Sheets: create_spreadsheet (non-idempotent with alternative)',
      plugin: 'google-sheets',
      action: 'create_spreadsheet',
      expectedIdempotent: false,
      expectedAlternative: 'get_or_create_spreadsheet'
    },
    {
      name: 'Google Sheets: append_rows (non-idempotent, no alternative)',
      plugin: 'google-sheets',
      action: 'append_rows',
      expectedIdempotent: false,
      expectedAlternative: null
    },
    {
      name: 'Google Mail: send_email (non-idempotent)',
      plugin: 'google-mail',
      action: 'send_email',
      expectedIdempotent: false,
      expectedAlternative: null
    },
    {
      name: 'Slack: create_channel (non-idempotent with alternative)',
      plugin: 'slack',
      action: 'create_channel',
      expectedIdempotent: false,
      expectedAlternative: 'get_or_create_channel'
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    logger.info('');
    logger.info(`Testing: ${test.name}`);

    // Test isIdempotent()
    const isIdempotent = manager.isIdempotent(test.plugin, test.action);
    const idempotentMatch = isIdempotent === test.expectedIdempotent;

    // Test getIdempotentAlternative()
    const alternative = manager.getIdempotentAlternative(test.plugin, test.action);
    const alternativeMatch = alternative === test.expectedAlternative;

    const testPassed = idempotentMatch && alternativeMatch;

    if (testPassed) {
      logger.info(`  ✅ PASS`);
      logger.info(`     idempotent: ${isIdempotent} (expected: ${test.expectedIdempotent})`);
      if (alternative) {
        logger.info(`     alternative: ${alternative}`);
      }
      passed++;
    } else {
      logger.error(`  ❌ FAIL`);
      if (!idempotentMatch) {
        logger.error(`     idempotent: ${isIdempotent}, expected: ${test.expectedIdempotent}`);
      }
      if (!alternativeMatch) {
        logger.error(`     alternative: ${alternative}, expected: ${test.expectedAlternative}`);
      }
      failed++;
    }
  }

  // Test getNonIdempotentActions()
  logger.info('');
  logger.info('='.repeat(80));
  logger.info('Testing getNonIdempotentActions() for google-drive:');
  const nonIdempotent = manager.getNonIdempotentActions('google-drive');
  logger.info(`  Found ${nonIdempotent.length} non-idempotent actions: ${nonIdempotent.join(', ')}`);

  // Expected: create_folder, upload_file
  const expectedNonIdempotent = ['create_folder', 'upload_file'];
  const nonIdempotentMatch = expectedNonIdempotent.every(action => nonIdempotent.includes(action));

  if (nonIdempotentMatch) {
    logger.info(`  ✅ PASS: All expected non-idempotent actions found`);
    passed++;
  } else {
    logger.error(`  ❌ FAIL: Missing expected non-idempotent actions`);
    failed++;
  }

  // Test getIdempotencyMetadata()
  logger.info('');
  logger.info('='.repeat(80));
  logger.info('Testing getIdempotencyMetadata() for google-drive:');
  const metadata = manager.getIdempotencyMetadata('google-drive');

  if (metadata) {
    logger.info(`  Found metadata for ${Object.keys(metadata).length} actions`);

    // Verify create_folder has alternative
    if (metadata['create_folder']?.alternative === 'get_or_create_folder') {
      logger.info(`  ✅ PASS: create_folder has correct alternative`);
      passed++;
    } else {
      logger.error(`  ❌ FAIL: create_folder missing or incorrect alternative`);
      failed++;
    }

    // Verify list_files is idempotent
    if (metadata['list_files']?.idempotent === true) {
      logger.info(`  ✅ PASS: list_files is idempotent`);
      passed++;
    } else {
      logger.error(`  ❌ FAIL: list_files not marked as idempotent`);
      failed++;
    }
  } else {
    logger.error(`  ❌ FAIL: Failed to retrieve metadata`);
    failed += 2;
  }

  // Summary
  logger.info('');
  logger.info('='.repeat(80));
  logger.info('Test Summary:');
  logger.info(`  ✅ Passed: ${passed}`);
  if (failed > 0) {
    logger.error(`  ❌ Failed: ${failed}`);
  }
  logger.info(`  Total: ${passed + failed}`);
  logger.info('='.repeat(80));

  // Exit with appropriate code
  if (failed > 0) {
    logger.error('\n❌ Tests FAILED');
    process.exit(1);
  } else {
    logger.info('\n🎉 All tests PASSED! Phase 0 is 100% complete.');
    process.exit(0);
  }
}

// Run tests
testIdempotencyMetadata().catch(error => {
  logger.error({ err: error }, 'Test execution failed');
  process.exit(1);
});
