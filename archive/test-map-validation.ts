/**
 * Test script to demonstrate WorkflowPostValidator detects map operation issues
 */

import { WorkflowPostValidator } from './lib/agentkit/v6/compiler/WorkflowPostValidator.ts';

// Sample workflow with the problematic step7
const testWorkflow = {
  workflow: [
    {
      id: 'step5',
      type: 'scatter_gather',
      scatter: {
        input: '{{step4}}',
        itemVariable: 'email',
        steps: [
          {
            id: 'step6',
            name: 'Check if email id already exists',
            type: 'transform',
            operation: 'filter',
            input: '{{step3.data}}',
            config: {
              condition: 'String(item) === String(email.id ?? \'\')'
            }
          },
          {
            id: 'step7',
            name: 'Keep email only if not found',
            type: 'transform',
            operation: 'map',  // ❌ WRONG
            input: '{{step6.data}}',
            config: {
              expression: '((item.length === 0) ? [email] : [])'  // ❌ WRONG LOGIC
            }
          }
        ]
      },
      gather: {
        operation: 'flatten'
      }
    }
  ]
};

// Initialize validator (no plugin schemas needed for this test)
const validator = new WorkflowPostValidator({});

console.log('Testing WorkflowPostValidator with problematic step7...\n');

// Run validation
const result = validator.validate(testWorkflow as any, false);

console.log('Validation Result:');
console.log('  Valid:', result.valid);
console.log('  Issues found:', result.issues.length);
console.log('\nIssues:');

result.issues.forEach((issue, index) => {
  console.log(`\n${index + 1}. ${issue.code} (${issue.severity})`);
  console.log(`   Step: ${issue.stepId}`);
  console.log(`   Message: ${issue.message}`);
  if (issue.suggestion) {
    console.log(`   Suggestion: ${issue.suggestion}`);
  }
  console.log(`   Auto-fixable: ${issue.autoFixable}`);
});

console.log('\n✅ Test complete!');
console.log('\nExpected output:');
console.log('  - INVALID_MAP_LOGIC error for step7 (uses item.length in map)');
console.log('  - MAP_RETURNS_ARRAY warning for step7 (returns arrays conditionally)');
