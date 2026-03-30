// Test field name resolution
import { ExecutionContext } from '../lib/pilot/ExecutionContext';

const mockAgent: any = {
  id: 'test',
  agent_name: 'Test',
  pilot_steps: []
};

const context = new ExecutionContext('test', mockAgent, 'user', 'session', {}, false, {});

// Set an item with camelCase fields
const testItem = {
  filename: 'test.pdf',
  mimeType: 'application/pdf',  // camelCase
  size: 12345
};

context.setVariable('item', testItem);

// Try to resolve using snake_case
console.log('\n=== Testing Field Name Resolution ===\n');

try {
  const result1 = context.resolveVariable('{{item.mimeType}}');
  console.log('✅ {{item.mimeType}} (camelCase) =', result1);
} catch (e) {
  console.log('❌ {{item.mimeType}} failed:', e);
}

try {
  const result2 = context.resolveVariable('{{item.mime_type}}');
  console.log('✅ {{item.mime_type}} (snake_case) =', result2);
} catch (e: any) {
  console.log('❌ {{item.mime_type}} failed:', e.message);
}

try {
  const result3 = context.resolveVariable('{{item.filename}}');
  console.log('✅ {{item.filename}} =', result3);
} catch (e) {
  console.log('❌ {{item.filename}} failed:', e);
}
