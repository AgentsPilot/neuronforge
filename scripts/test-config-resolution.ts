// Quick test to verify StepExecutor reads from step.config
import { ExecutionContext } from '../lib/pilot/ExecutionContext';

// Mock agent
const mockAgent: any = {
  id: 'test-agent',
  agent_name: 'Test Agent',
  pilot_steps: [],
  input_schema: [
    { name: 'drive_folder_name', default_value: 'TestFolderFromConfig' },
    { name: 'google_sheet_id', default_value: '1234567890' },
    { name: 'sheet_tab_name', default_value: 'Sheet1' },
    { name: 'amount_threshold_usd', default_value: 50 }
  ]
};

// Create ExecutionContext with workflow config
const workflowConfig = {
  drive_folder_name: 'TestFolderFromConfig',
  google_sheet_id: '1234567890',
  sheet_tab_name: 'Sheet1',
  amount_threshold_usd: 50
};

const context = new ExecutionContext(
  'test-exec-id',
  mockAgent,
  'test-user',
  'test-session',
  {}, // inputValues
  false, // batchCalibrationMode
  workflowConfig
);

// Test resolving {{config.drive_folder_name}}
console.log('\n=== Testing Config Resolution ===');
console.log('workflowConfig:', context.workflowConfig);

const testPattern = '{{config.drive_folder_name}}';
console.log('\nTest pattern:', testPattern);

try {
  const resolved = context.resolveVariable(testPattern);
  console.log('✅ Resolved to:', resolved);

  if (resolved === 'TestFolderFromConfig') {
    console.log('✅ SUCCESS: Config resolution working!');
  } else {
    console.log('❌ FAIL: Expected "TestFolderFromConfig", got:', resolved);
  }
} catch (error) {
  console.log('❌ ERROR:', error);
}

// Test resolveAllVariables on a step config object
console.log('\n=== Testing Step Config Resolution ===');
const stepConfig = {
  folder_name: '{{config.drive_folder_name}}',
  spreadsheet_id: '{{config.google_sheet_id}}',
  range: '{{config.sheet_tab_name}}'
};

console.log('Step config BEFORE:', stepConfig);
const resolvedConfig = context.resolveAllVariables(stepConfig);
console.log('Step config AFTER:', resolvedConfig);

if (resolvedConfig.folder_name === 'TestFolderFromConfig' &&
    resolvedConfig.spreadsheet_id === '1234567890' &&
    resolvedConfig.range === 'Sheet1') {
  console.log('✅ SUCCESS: All config patterns resolved correctly!');
} else {
  console.log('❌ FAIL: Some patterns not resolved correctly');
}

console.log('\n=== Test Complete ===\n');
