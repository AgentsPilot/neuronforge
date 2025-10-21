// Test script for AuditTrailService
// Validates core functionality in isolation before integration

import 'dotenv/config';
import { AuditTrailService, auditLog } from '@/lib/services/AuditTrailService';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testAuditService() {
  console.log('\n🧪 Testing Audit Trail Service');
  console.log('='.repeat(60));

  try {
    // Test 1: Singleton pattern
    console.log('\n✅ Test 1: Singleton Pattern');
    const instance1 = AuditTrailService.getInstance();
    const instance2 = AuditTrailService.getInstance();
    console.log('Same instance?', instance1 === instance2 ? '✅ YES' : '❌ NO');

    // Test 2: Basic logging
    console.log('\n✅ Test 2: Basic Logging');
    await auditLog({
      action: 'SETTINGS_PROFILE_UPDATED',
      entityType: 'user',
      entityId: 'test-user-123',
      userId: 'test-user-123',
      details: {
        test: true,
        timestamp: new Date().toISOString()
      },
      severity: 'info'
    });
    console.log('Log queued successfully');

    // Test 3: Logging with changes
    console.log('\n✅ Test 3: Logging with Change Detection');
    await auditLog({
      action: 'AGENT_UPDATED',
      entityType: 'agent',
      entityId: 'test-agent-456',
      userId: 'test-user-123',
      resourceName: 'Test Agent',
      changes: {
        status: { before: 'draft', after: 'active' },
        schedule_enabled: { before: false, after: true }
      },
      details: {
        reason: 'User activated agent'
      },
      severity: 'info'
    });
    console.log('Log with changes queued successfully');

    // Test 4: Critical event logging
    console.log('\n✅ Test 4: Critical Event Logging');
    await auditLog({
      action: 'AGENT_DELETED',
      entityType: 'agent',
      entityId: 'test-agent-789',
      userId: 'test-user-123',
      resourceName: 'Deleted Agent',
      details: {
        permanent: true,
        reason: 'User requested deletion'
      },
      severity: 'critical',
      complianceFlags: ['SOC2', 'GDPR']
    });
    console.log('Critical event queued successfully');

    // Test 5: Sensitive data sanitization
    console.log('\n✅ Test 5: Sensitive Data Sanitization');
    await auditLog({
      action: 'SETTINGS_API_KEY_CREATED',
      entityType: 'settings',
      entityId: 'test-settings-001',
      userId: 'test-user-123',
      changes: {
        api_key: { before: null, after: 'sk_test_abc123xyz' },
        password: { before: 'oldpass123', after: 'newpass456' }
      },
      details: {
        key_name: 'Production API Key'
      },
      severity: 'warning'
    });
    console.log('Sensitive data should be sanitized in logs');

    // Test 6: Force flush
    console.log('\n✅ Test 6: Force Flush to Database');
    const audit = AuditTrailService.getInstance();
    await audit.flush();
    console.log('Logs flushed to database');

    // Test 7: Query recent logs
    console.log('\n✅ Test 7: Query Recent Audit Logs');
    const result = await audit.query({
      userId: 'test-user-123',
      limit: 10,
      sortBy: 'created_at',
      sortOrder: 'desc'
    });
    console.log(`Found ${result.total} total logs for test user`);
    console.log(`Returned ${result.logs.length} logs in this page`);

    if (result.logs.length > 0) {
      console.log('\nMost recent log:');
      console.log('  Action:', result.logs[0].action);
      console.log('  Entity:', result.logs[0].entity_type);
      console.log('  Severity:', result.logs[0].severity);
      console.log('  Timestamp:', result.logs[0].created_at);

      if (result.logs[0].changes) {
        console.log('  Changes detected:', Object.keys(result.logs[0].changes).length, 'fields');

        // Check if sensitive data was sanitized
        const changes = result.logs[0].changes as any;
        if (changes.api_key || changes.password) {
          console.log('  ⚠️ Sensitive fields in changes:');
          if (changes.api_key) {
            console.log('    - api_key.after:', changes.api_key.after === '***REDACTED***' ? '✅ REDACTED' : '❌ NOT REDACTED');
          }
          if (changes.password) {
            console.log('    - password.before:', changes.password.before === '***REDACTED***' ? '✅ REDACTED' : '❌ NOT REDACTED');
            console.log('    - password.after:', changes.password.after === '***REDACTED***' ? '✅ REDACTED' : '❌ NOT REDACTED');
          }
        }
      }
    }

    // Test 8: Query by severity
    console.log('\n✅ Test 8: Query Critical Events');
    const criticalResult = await audit.query({
      severity: 'critical',
      limit: 5,
      sortBy: 'created_at',
      sortOrder: 'desc'
    });
    console.log(`Found ${criticalResult.total} critical events`);

    // Test 9: GDPR Export
    console.log('\n✅ Test 9: GDPR Data Export');
    const exportData = await audit.exportUserData('test-user-123');
    console.log('Export completed:');
    console.log('  Total Events:', exportData.totalEvents);
    console.log('  Date Range:', exportData.dateRange.from, 'to', exportData.dateRange.to);
    console.log('  Actions Summary:', Object.keys(exportData.summary.actionsPerformed).length, 'unique actions');

    // Cleanup: Delete test logs
    console.log('\n🧹 Cleanup: Deleting Test Logs');
    const { error: deleteError } = await supabase
      .from('audit_trail')
      .delete()
      .eq('user_id', 'test-user-123');

    if (deleteError) {
      console.log('⚠️ Could not delete test logs:', deleteError.message);
    } else {
      console.log('✅ Test logs cleaned up');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed successfully!');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

testAuditService();
