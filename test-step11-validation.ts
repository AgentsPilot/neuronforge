/**
 * Test that WorkflowPostValidator detects step11's item.map() error
 */

import { WorkflowPostValidator } from './lib/agentkit/v6/compiler/WorkflowPostValidator.ts';

const workflow = {
  workflow: [
    {
      "id": "step11",
      "name": "Format rows for appending to UrgentEmails",
      "type": "transform",
      "operation": "map",
      "dependencies": ["step9"],
      "input": "{{step9}}",
      "config": {
        "expression": "item.map(email => [email?.from ?? '', email?.subject ?? '', email?.date ?? '', email?.body ?? '', email?.id ?? ''])"
      }
    }
  ]
};

const validator = new WorkflowPostValidator({});

console.log('Testing step11 validation...\n');

const result = validator.validate(workflow as any, false);

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
});

console.log('\n✅ Expected: INVALID_MAP_LOGIC error for using item.map() in map operation');
